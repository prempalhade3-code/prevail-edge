from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    runtime_url: str = "http://127.0.0.1:8090"
    # Comma-separated edge-a=http://...,edge-b=... for the four-process mesh.
    edge_urls: str = ""
    bootstrap_edge_id: str = "edge-a"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    # Live store is PostgreSQL in Docker. SQLite is host-fallback only.
    database_url: str | None = None
    require_postgres: bool = False
    sim_bridge_http_url: str = "http://127.0.0.1:8766"
    sim_bridge_ws_url: str = "ws://127.0.0.1:8765"

    model_config = {"env_prefix": "PREVAIL_"}


settings = Settings()
