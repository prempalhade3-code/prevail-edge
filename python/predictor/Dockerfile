FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY python/predictor/requirements.txt /app/python/predictor/requirements.txt
RUN pip install --no-cache-dir -r /app/python/predictor/requirements.txt

# Copy source tree and configuration contracts
COPY python/ /app/python/
COPY deploy/ /app/deploy/
COPY docs/contracts/ /app/docs/contracts/

ENV PYTHONPATH=/app
ENV PREVAIL_PREDICTOR_PORT=8091
ENV PREVAIL_PREDICTOR_HOST=0.0.0.0

EXPOSE 8091

# Train initial model weights and export TorchScript artifact (<1MB)
RUN python -m python.predictor.train --epochs 5 --sequences 1000

CMD ["python", "-m", "python.predictor.main"]
