from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    runtime_url: str = "http://127.0.0.1:8090"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    # Ram's Postgres — optional; until then timeline comes from runtime only
    database_url: str | None = None

    model_config = {"env_prefix": "PREVAIL_"}


settings = Settings()
