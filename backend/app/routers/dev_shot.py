"""개발용 — 폰에서 찍은 화면 스크린샷을 서버의 고정 경로로 올려, 클로드 코드가
파일 경로만으로 바로 Read 할 수 있게 한다. 사장님이 말로 설명하는 대신 화면을
찍어 올리고 "/home/ubuntu/latest_shot.png 이 화면 확인해줘"라고 붙여넣으면 끝난다.
항상 "최신 한 장"만 남도록, 올릴 때마다 이전 latest_shot.* 전부를 지운다."""
import glob
import io
import os

from fastapi import APIRouter, File, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError

router = APIRouter(prefix="/api/dev-shot", tags=["dev-shot"])

SAVE_PATH_BASE = "/home/ubuntu/latest_shot"


@router.post("")
async def upload_dev_shot(file: UploadFile = File(...)):
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=422, detail="빈 파일입니다.")
    try:
        with Image.open(io.BytesIO(raw)) as img:
            fmt = (img.format or "PNG").upper()
            ext = "jpg" if fmt == "JPEG" else fmt.lower()
            to_save = img.convert("RGB") if fmt == "JPEG" else img.copy()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise HTTPException(status_code=422, detail="읽을 수 없는 이미지 파일입니다.") from exc

    for old in glob.glob(f"{SAVE_PATH_BASE}.*"):
        os.remove(old)

    path = f"{SAVE_PATH_BASE}.{ext}"
    to_save.save(path, fmt)
    return {"path": path}
