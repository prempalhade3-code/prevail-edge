FROM python:3.11-slim

WORKDIR /app

COPY python/predictor/requirements.txt /app/python/predictor/requirements.txt
RUN pip install --no-cache-dir -r /app/python/predictor/requirements.txt

COPY python/ /app/python/
COPY deploy/ /app/deploy/
COPY docs/contracts/ /app/docs/contracts/

ENV PYTHONPATH=/app
ENV PREVAIL_PREDICTOR_PORT=8091
ENV PREVAIL_PREDICTOR_HOST=0.0.0.0
ENV PREVAIL_REQUIRE_OFFICIAL_MODEL=1
ENV PREVAIL_USE_ONNX=1

EXPOSE 8091

# Prefer the host-trained official artifact; retrain only if metadata is missing.
RUN python -m python.predictor.verify_model || \
    (python -m python.predictor.download_official && \
     python -m python.predictor.train --epochs 8 --sequences 0 && \
     python -m python.predictor.verify_model)

CMD ["python", "-m", "python.predictor.main"]
