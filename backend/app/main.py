from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.routers import blog, jobs, pricing, quotes, upload

settings = get_settings()
app = FastAPI(title="AI 시공 견적/렌더링 API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    # 같은 Wi-Fi의 폰(삼성 인터넷 등)이 PC의 프론트(http://192.168.x.x:3000)로 열 때도 통과시킨다.
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=settings.storage_dir), name="static")
app.include_router(upload.router)
app.include_router(jobs.router)
app.include_router(quotes.router)
app.include_router(blog.router)
app.include_router(pricing.router)


# 견적 계산기(estimator_app, Flask)를 같은 서버 아래 /estimator 로 함께 서비스한다.
# ngrok 무료 플랜은 고정 도메인이 하나뿐이라, 이렇게 해야 같은 주소로 두 화면을 다 열 수 있다.
# 실패해도 메인 백엔드는 그대로 떠야 하므로 예외는 삼키고 경고만 남긴다.
try:
    import importlib.util
    import sys
    from pathlib import Path

    from a2wsgi import WSGIMiddleware

    _estimator_path = Path(__file__).resolve().parents[2] / "estimator_app" / "app.py"
    # 백엔드에도 `app` 패키지가 있어 이름이 겹치므로, 다른 이름으로 파일 경로에서 직접 불러온다.
    _spec = importlib.util.spec_from_file_location("estimator_flask", _estimator_path)
    _module = importlib.util.module_from_spec(_spec)
    sys.modules["estimator_flask"] = _module
    _spec.loader.exec_module(_module)
    app.mount("/estimator", WSGIMiddleware(_module.app))
except Exception as exc:  # noqa: BLE001
    print(f"[warn] 견적 계산기(/estimator)를 붙이지 못했습니다: {exc}")


# 프론트(Next.js, :3000)도 같은 주소로 내보낸다.
# ngrok 무료 플랜은 고정 도메인이 하나뿐인데 그 도메인은 이 백엔드에 물려 있다. 폰 브라우저가
# 화면(프론트)과 API(백엔드)를 한 주소에서 받게 해야 삼성 인터넷 같은 브라우저에서 바로 열린다.
# 위에서 등록한 API 경로(/api/*, /static, /estimator, /docs)가 먼저 매칭되고, 그 밖의 경로만
# 프론트로 넘어간다. 반드시 파일의 맨 마지막에 둔다.
import os

import httpx
from fastapi import Request, Response

_FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://127.0.0.1:3000")
_HOP_BY_HOP = {"connection", "keep-alive", "transfer-encoding", "upgrade", "te", "trailer", "proxy-authenticate",
               "proxy-authorization", "content-length", "content-encoding", "host"}
_proxy_client = httpx.AsyncClient(timeout=120.0, follow_redirects=False)


@app.api_route("/{path:path}", methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
               include_in_schema=False)
async def _frontend_proxy(path: str, request: Request) -> Response:
    url = f"{_FRONTEND_ORIGIN}/{path}"
    headers = {k: v for k, v in request.headers.items() if k.lower() not in _HOP_BY_HOP}
    headers["accept-encoding"] = "identity"  # 압축을 풀고 다시 싸는 수고를 없앤다.
    try:
        upstream = await _proxy_client.request(
            request.method, url, params=request.query_params, headers=headers, content=await request.body()
        )
    except httpx.HTTPError:
        return Response("프론트 서버(3000)에 연결하지 못했습니다.", status_code=502, media_type="text/plain; charset=utf-8")
    out_headers = {k: v for k, v in upstream.headers.items() if k.lower() not in _HOP_BY_HOP}
    return Response(content=upstream.content, status_code=upstream.status_code, headers=out_headers)


# ---------------------------------------------------------------------------
# 프론트의 Fast Refresh(HMR) 웹소켓도 같은 주소로 그대로 이어준다.
#
# [왜 필요한가]
# APK(Capacitor)를 이제 번들 파일이 아니라 이 주소(capacitor.config.ts의 server.url)를
# 그대로 열도록 바꿨다 — 그래서 코드를 고치고 저장하면 폰 앱도 같이 바뀐다. 그런데 위
# _frontend_proxy는 매 요청마다 새로 응답을 받아 돌려주는 방식이라 Next 개발 서버가 여는
# 실시간 갱신용 웹소켓(/_next/webpack-hmr)은 그 방식으로 중계할 수 없다. 이 라우트가
# 없으면 화면이 자동으로 새로고침되지 않고, 앱을 껐다 켜야만 바뀐 내용이 보인다.
# HTTP 라우트(api_route)와 웹소켓 라우트는 서로 다른 프로토콜이라 같은 경로여도 부딪히지
# 않는다.
import asyncio

import websockets
from fastapi import WebSocket, WebSocketDisconnect
from websockets.exceptions import ConnectionClosed

_WS_FRONTEND_ORIGIN = _FRONTEND_ORIGIN.replace("http://", "ws://").replace("https://", "wss://")


@app.websocket("/{path:path}")
async def _frontend_ws_proxy(websocket: WebSocket, path: str) -> None:
    target = f"{_WS_FRONTEND_ORIGIN}/{path}"
    if websocket.url.query:
        target += f"?{websocket.url.query}"

    try:
        upstream = await websockets.connect(target, open_timeout=10, max_size=None)
    except OSError:
        # 프론트 개발 서버가 꺼져 있으면 핸드셰이크만 거절한다 — 화면(HTTP)은 여전히 뜨고,
        # 실시간 갱신만 빠진 채로 동작한다.
        await websocket.close(code=1011)
        return

    await websocket.accept(subprotocol=upstream.subprotocol)

    async def client_to_upstream() -> None:
        try:
            while True:
                message = await websocket.receive()
                if message["type"] == "websocket.disconnect":
                    break
                if message.get("text") is not None:
                    await upstream.send(message["text"])
                elif message.get("bytes") is not None:
                    await upstream.send(message["bytes"])
        except (WebSocketDisconnect, ConnectionClosed):
            pass

    async def upstream_to_client() -> None:
        try:
            async for message in upstream:
                if isinstance(message, (bytes, bytearray)):
                    await websocket.send_bytes(message)
                else:
                    await websocket.send_text(message)
        except ConnectionClosed:
            pass

    await asyncio.gather(client_to_upstream(), upstream_to_client())
    for closer in (upstream.close, websocket.close):
        try:
            await closer()
        except Exception:  # noqa: BLE001 - 이미 닫힌 연결을 또 닫으려다 나는 오류는 무시한다
            pass
