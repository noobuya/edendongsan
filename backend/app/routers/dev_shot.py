"""개발용 — 폰에서 찍은 화면 스크린샷이나 블로그 글 링크를 서버의 고정 경로로
올려, 클로드 코드가 파일 경로만으로 바로 Read 할 수 있게 한다. 사장님이 말로
설명하는 대신 화면을 찍어 올리거나 링크를 붙여넣고 "<경로> 확인해줘"라고
붙여넣으면 끝난다. 둘 다 항상 "최신 것"만 남도록, 올릴 때마다 이전 파일을
전부 지운다."""
import glob
import io
import os
import re
from html import unescape
from html.parser import HTMLParser
from urllib.parse import parse_qs, urlparse

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel

router = APIRouter(prefix="/api/dev-shot", tags=["dev-shot"])

SHOT_BASE = "/home/ubuntu/latest_shot"
BLOG_PATH = "/home/ubuntu/latest_blog.txt"

MAX_PHOTOS = 10


@router.post("")
async def upload_dev_shot(files: list[UploadFile] = File(...)):
    if not files:
        raise HTTPException(status_code=422, detail="사진이 없습니다.")
    if len(files) > MAX_PHOTOS:
        raise HTTPException(status_code=422, detail=f"한 번에 {MAX_PHOTOS}장까지 올릴 수 있어요.")

    # 이전 업로드(여러 장 버전의 _1.ext.. / 예전 단일 버전의 latest_shot.ext)를 모두 지운다.
    for old in glob.glob(f"{SHOT_BASE}_*.*") + glob.glob(f"{SHOT_BASE}.*"):
        os.remove(old)

    paths: list[str] = []
    for i, file in enumerate(files, start=1):
        raw = await file.read()
        if not raw:
            continue
        try:
            with Image.open(io.BytesIO(raw)) as img:
                fmt = (img.format or "PNG").upper()
                ext = "jpg" if fmt == "JPEG" else fmt.lower()
                to_save = img.convert("RGB") if fmt == "JPEG" else img.copy()
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
            raise HTTPException(status_code=422, detail=f"{i}번째 사진을 읽을 수 없습니다.") from exc
        path = f"{SHOT_BASE}_{i}.{ext}"
        to_save.save(path, fmt)
        paths.append(path)

    if not paths:
        raise HTTPException(status_code=422, detail="저장할 수 있는 사진이 없습니다.")
    return {"paths": paths}


# ── 블로그 글 링크 읽기 ──────────────────────────────────────────────────────
# 네이버 블로그는 blog.naver.com/{blogId}/{logNo} 주소가 실제로는 본문이 없는
# 프레임셋 페이지(진짜 글은 iframe 안의 PostView.naver)라, 그대로 받으면 본문이
# 거의 안 잡힌다. 모바일판(m.blog.naver.com/{blogId}/{logNo})은 같은 글을
# iframe 없이 바로 렌더링하므로, 네이버 주소는 전부 모바일판으로 바꿔서 받는다.
class _TextExtractor(HTMLParser):
    _BLOCK_TAGS = {"p", "div", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "blockquote"}
    _SKIP_TAGS = {"script", "style", "head"}

    def __init__(self) -> None:
        super().__init__()
        self.chunks: list[str] = []
        self.skip_depth = 0

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in self._SKIP_TAGS:
            self.skip_depth += 1
        elif tag in self._BLOCK_TAGS:
            self.chunks.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self._SKIP_TAGS and self.skip_depth > 0:
            self.skip_depth -= 1

    def handle_data(self, data: str) -> None:
        if self.skip_depth == 0:
            text = data.strip()
            if text:
                self.chunks.append(text + " ")


def _extract_text(html: str) -> str:
    parser = _TextExtractor()
    parser.feed(html)
    text = "".join(parser.chunks)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    return text.strip()


def _normalize_blog_url(raw_url: str) -> str:
    parsed = urlparse(raw_url)
    host = parsed.netloc.lower()
    if "blog.naver.com" not in host or host.startswith("m."):
        return raw_url

    if parsed.path.lower().rstrip("/").endswith("postview.naver"):
        qs = parse_qs(parsed.query)
        blog_id = (qs.get("blogId") or [None])[0]
        log_no = (qs.get("logNo") or [None])[0]
        if blog_id and log_no:
            return f"https://m.blog.naver.com/{blog_id}/{log_no}"
        return raw_url

    parts = [p for p in parsed.path.split("/") if p]
    if len(parts) >= 2 and parts[1].isdigit():
        return f"https://m.blog.naver.com/{parts[0]}/{parts[1]}"
    return raw_url


class BlogLinkRequest(BaseModel):
    url: str


_BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0 Safari/537.36"
}


@router.post("/blog")
async def fetch_dev_blog(payload: BlogLinkRequest):
    raw_url = payload.url.strip()
    if not raw_url:
        raise HTTPException(status_code=422, detail="링크를 입력해 주세요.")
    url = _normalize_blog_url(raw_url)

    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True, headers=_BROWSER_HEADERS) as client:
            res = await client.get(url)
            res.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"블로그 글을 불러오지 못했습니다: {exc}") from exc

    html = res.text
    title_match = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    title = unescape(title_match.group(1)).strip() if title_match else ""
    body = _extract_text(html)
    if not body:
        raise HTTPException(status_code=422, detail="이 페이지에서 글 내용을 찾지 못했습니다.")

    content = f"[원본 링크] {raw_url}\n[제목] {title}\n\n{body}" if title else f"[원본 링크] {raw_url}\n\n{body}"
    with open(BLOG_PATH, "w", encoding="utf-8") as f:
        f.write(content)

    return {"path": BLOG_PATH, "title": title, "preview": body[:400]}
