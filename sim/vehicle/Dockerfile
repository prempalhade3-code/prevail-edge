FROM python:3.11-slim

WORKDIR /app

# Copy requirement definitions and project structure
COPY sim/vehicle/requirements.txt /app/sim/vehicle/requirements.txt
RUN pip install --no-cache-dir -r /app/sim/vehicle/requirements.txt

COPY python/ /app/python/
COPY deploy/ /app/deploy/
COPY sim/ /app/sim/

ENV PYTHONPATH=/app

CMD ["python", "sim/vehicle/replayer.py", "--continuous"]
