"""Contract and unit tests for the FastAPI predictor inference service."""

import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
import jsonschema

from python.predictor.service import app


@pytest.fixture
def client():
    """Test client fixture for FastAPI app."""
    return TestClient(app)


@pytest.fixture
def prediction_schema():
    """Loads the official prediction result JSON schema contract."""
    repo_root = Path(__file__).resolve().parents[3]
    schema_path = repo_root / "docs" / "contracts" / "prediction-result.schema.json"
    with open(schema_path, "r", encoding="utf-8") as f:
        return json.load(f)


def test_health_endpoint(client):
    """Verifies GET /health returns 200 and healthy status."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "model_version" in data
    assert "edge_ids" in data
    assert isinstance(data["edge_ids"], list)


def test_predict_fixed_input_and_contract_schema(client, prediction_schema):
    """Verifies POST /predict validates against prediction-result.schema.json with fixed input."""
    payload = {"session_id": "session-vehicle-1"}
    response = client.post("/predict", json=payload)
    assert response.status_code == 200

    data = response.json()

    # 1. Strict JSON Schema Validation
    jsonschema.validate(instance=data, schema=prediction_schema)

    # 2. Structural & Field Assertions
    assert data["session_id"] == "session-vehicle-1"
    assert isinstance(data["model_version"], str)
    assert len(data["model_version"]) > 0

    probs = data["probabilities"]
    assert isinstance(probs, dict)
    assert len(probs) >= 4
    for edge in ["edge-a", "edge-b", "edge-c", "edge-d"]:
        assert edge in probs
        assert 0.0 <= probs[edge] <= 1.0

    # 3. Probability Sum ≈ 1.0
    prob_sum = sum(probs.values())
    assert pytest.approx(prob_sum, abs=1e-4) == 1.0

    # 4. Computed timestamps & ETA
    assert isinstance(data["computed_at_ms"], int)
    assert data["computed_at_ms"] > 0
    if "eta_sec" in data and data["eta_sec"] is not None:
        assert data["eta_sec"] >= 0.0


def test_predict_with_trajectory_history(client, prediction_schema):
    """Verifies sequence state ingestion via POST /trajectory affects prediction."""
    session_id = "session-vehicle-history-test"

    # Ingest historical path: edge-a -> edge-b
    client.post("/trajectory", json={"session_id": session_id, "edge_id": "edge-a", "speed_mps": 15.0})
    client.post("/trajectory", json={"session_id": session_id, "edge_id": "edge-b", "speed_mps": 14.5})

    response = client.post("/predict", json={"session_id": session_id})
    assert response.status_code == 200
    data = response.json()

    # Must validate schema
    jsonschema.validate(instance=data, schema=prediction_schema)
    assert data["session_id"] == session_id
    assert pytest.approx(sum(data["probabilities"].values()), abs=1e-4) == 1.0


def test_predict_missing_session_id(client):
    """Verifies 422 Unprocessable Entity when session_id is missing."""
    response = client.post("/predict", json={})
    assert response.status_code == 422
