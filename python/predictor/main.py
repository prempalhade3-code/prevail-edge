"""Entrypoint to run the PREVAIL ML Predictor service."""

import uvicorn
from python.predictor.config import config


def main():
    """Runs the FastAPI predictor application with uvicorn."""
    print(f"Starting PREVAIL Predictor Service on {config.host}:{config.port}...")
    uvicorn.run(
        "python.predictor.service:app",
        host=config.host,
        port=config.port,
        log_level="info",
        reload=False,
    )


if __name__ == "__main__":
    main()
