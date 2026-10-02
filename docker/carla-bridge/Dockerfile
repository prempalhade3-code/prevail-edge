FROM --platform=linux/amd64 python:3.10-slim

WORKDIR /app

RUN pip install --no-cache-dir carla==0.9.15 numpy Pillow websockets

COPY sim/ /app/sim/

ENV PREVAIL_RUNTIME_URL=http://host.docker.internal:8090
ENV CARLA_HOST=carla
ENV CARLA_PORT=2000
ENV PREVAIL_BRIDGE_PORT=8765

EXPOSE 8765 8766

CMD ["python", "-m", "sim.carla.prevail_bridge"]
