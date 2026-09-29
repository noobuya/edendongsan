# MVP용 인메모리 저장소. 서버 재시작 시 유실되므로
# 운영 단계에서는 Redis 또는 PostgreSQL 기반 잡 큐(Celery 등)로 교체할 것.
JOBS: dict[str, dict] = {}
