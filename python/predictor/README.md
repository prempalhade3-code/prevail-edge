# PREVAIL ML Predictor Subsystem (`python/predictor`)

The ML Predictor subsystem generates next-edge probability distributions for vehicle sessions across edge coverage regions. The speculation manager in Prem's Rust runtime (`rust/prevail-runtime/`) consumes these predictions over HTTP to orchestrate speculative warm shadows and state handoffs.

---

## 1. Overview & Contract

- **Owner:** Atharva (`@Neelkanth27`)
- **Protocol:** HTTP REST (`POST /predict` on port `8091`)
- **JSON Schema:** [`docs/contracts/prediction-result.schema.json`](../../docs/contracts/prediction-result.schema.json)
- **Model Target:** Compact PyTorch GRU exported to TorchScript / ONNX (&lt; 1 MB footprint)

### Request Payload (`POST /predict`)
```json
{
  "session_id": "session-vehicle-1"
}
```

### Response Payload (`PredictionResult`)
```json
{
  "session_id": "session-vehicle-1",
  "model_version": "gru-edge-v0.1.0",
  "probabilities": {
    "edge-a": 0.05,
    "edge-b": 0.82,
    "edge-c": 0.10,
    "edge-d": 0.03
  },
  "eta_sec": 12.5,
  "computed_at_ms": 1700000000000
}
```

---

## 2. Directory Structure

```
python/predictor/
├── config.py              # Configuration & edge region discovery
├── model.py               # EdgePredictorGRU architecture & TorchScript/ONNX export (<1MB)
├── dataset.py             # Synthetic sequence generator & GPS trajectory ingest
├── train.py               # Training pipeline with Top-1 / Top-2 accuracy evaluation
├── dask_preprocess.py     # (Optional) Distributed GPS log preprocessing
├── baseline/              # Destination-matrix Markov transition baseline
│   └── matrix_baseline.py
├── service.py             # FastAPI REST application (POST /predict, GET /health)
├── main.py                # Service entrypoint (runs uvicorn on port 8091)
├── Dockerfile             # Docker container definition
├── requirements.txt       # Dependencies
└── tests/                 # Contract and unit tests
    ├── test_service.py
    └── test_model.py
```

---

## 3. Quick Start & Local Development

### Installation
```bash
pip install -r python/predictor/requirements.txt
```

### Run Model Training & Export
```bash
python -m python.predictor.train --epochs 10 --sequences 2000
```
This trains the GRU on synthetic transition sequences and exports a compact TorchScript model (`python/predictor/models/gru_predictor.pt`, ~85 KB).

### Start Predictor Service
```bash
python -m python.predictor.main
```
The service will listen on `http://0.0.0.0:8091`.

### Query Inference Endpoint
```bash
curl -s -X POST http://127.0.0.1:8091/predict \
  -H "Content-Type: application/json" \
  -d '{"session_id":"session-vehicle-1"}'
```

---

## 4. Running with Docker

```bash
# Build image from repo root
docker build -t prevail-predictor -f python/predictor/Dockerfile .

# Run container
docker run -p 8091:8091 prevail-predictor
```

---

## 5. Running Tests

```bash
pytest python/predictor/tests/ -v
```
All tests validate strict JSON schema compliance against `docs/contracts/prediction-result.schema.json` and assert probability distribution properties.
