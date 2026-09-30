from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    gemini_api_key: str = ""
    replicate_api_token: str = ""
    storage_dir: str = "storage"
    # "코드:이름,코드:이름" 형식. 비어 있으면 아무도 자동화 기능을 쓸 수 없다.
    automation_codes: str = ""
    cors_origins: list[str] = ["http://localhost:3000"]

    model_config = SettingsConfigDict(env_file=".env")


@lru_cache
def get_settings() -> Settings:
    return Settings()
