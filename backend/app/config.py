from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    gemini_api_key: str = ""
    replicate_api_token: str = ""
    storage_dir: str = "storage"
    # "코드:이름,코드:이름" 형식. 비어 있으면 아무도 자동화 기능을 쓸 수 없다.
    automation_codes: str = ""
    # 관리자 페이지(/admin/students) 접속 토큰. 비어 있으면 관리자 기능이 꺼진다.
    admin_token: str = ""
    cors_origins: list[str] = ["http://localhost:3000"]
    # Firebase 서비스 계정 키(JSON) 파일 경로 — 서버에서 푸시 알림을 보낼 때 쓴다.
    # 비어 있거나 파일이 없으면 push.py가 조용히 발송을 건너뛴다(부가 기능이라
    # 설정 전이어도 앱 전체가 막히면 안 된다).
    firebase_credentials_path: str = ""

    model_config = SettingsConfigDict(env_file=".env")


@lru_cache
def get_settings() -> Settings:
    return Settings()
