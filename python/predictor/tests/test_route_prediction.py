"""Route-aware next-edge prediction tests."""

from fastapi.testclient import TestClient

from python.predictor.service import app


def _client() -> TestClient:
    return TestClient(app)


def _register_route(client: TestClient, session_id: str, route: list[str]) -> None:
    resp = client.post(
        "/session/route",
        json={"session_id": session_id, "planned_route": route, "reset_history": True},
    )
    assert resp.status_code == 200


def _predict(client: TestClient, session_id: str, current_edge: str) -> dict:
    resp = client.post(
        "/predict",
        json={"session_id": session_id, "current_edge": current_edge},
    )
    assert resp.status_code == 200
    return resp.json()


def test_route_abc_progression():
    client = _client()
    sid = "route-abc-test"
    route = ["edge-a", "edge-b", "edge-c"]
    _register_route(client, sid, route)

    client.post(
        "/trajectory",
        json={"session_id": sid, "edge_id": "edge-a", "speed_mps": 8.0, "heading_deg": 72.0},
    )
    on_a = _predict(client, sid, "edge-a")
    assert on_a["predicted_next_edge"] == "edge-b"
    assert "edge-b" in on_a["probabilities"]
    assert on_a["probabilities"]["edge-b"] >= max(on_a["probabilities"].values())
    assert on_a["route_terminal"] is False
    assert on_a["for_edge"] == "edge-a"

    client.post(
        "/trajectory",
        json={"session_id": sid, "edge_id": "edge-b", "speed_mps": 11.0, "heading_deg": 56.0},
    )
    on_b = _predict(client, sid, "edge-b")
    assert on_b["predicted_next_edge"] == "edge-c"
    assert "edge-c" in on_b["probabilities"]
    assert on_b["route_terminal"] is False

    client.post(
        "/trajectory",
        json={"session_id": sid, "edge_id": "edge-c", "speed_mps": 11.0, "heading_deg": 36.0},
    )
    on_c = _predict(client, sid, "edge-c")
    assert on_c["predicted_next_edge"] is None
    assert on_c["probabilities"] == {}
    assert on_c["route_terminal"] is True
    assert on_c["eta_sec"] is None


def test_route_via_trajectory_payload():
    client = _client()
    sid = "route-trajectory-test"
    route = ["edge-b", "edge-d", "edge-a"]

    client.post(
        "/trajectory",
        json={
            "session_id": sid,
            "edge_id": "edge-b",
            "speed_mps": 10.0,
            "planned_route": route,
            "reset_route_history": True,
        },
    )
    data = _predict(client, sid, "edge-b")
    assert data["predicted_next_edge"] == "edge-d"
    assert "edge-d" in data["probabilities"]


def test_stale_global_scores_cannot_override_route():
    client = _client()
    sid = "route-stale-test"
    route = ["edge-a", "edge-b", "edge-c"]
    _register_route(client, sid, route)

    # Polluted history that would favour edge-c globally without route constraint.
    for edge in ("edge-a", "edge-b", "edge-c", "edge-a"):
        client.post(
            "/trajectory",
            json={"session_id": sid, "edge_id": edge, "speed_mps": 8.0},
        )

    data = _predict(client, sid, "edge-a")
    assert data["predicted_next_edge"] == "edge-b"
    assert "edge-b" in data["probabilities"]


def test_controlled_d_a_b_c_progression():
    """Validates the exact D -> A -> B -> C route progression required by user audit."""
    client = _client()
    sid = "d-a-b-c-progression-session"
    route = ["edge-d", "edge-a", "edge-b", "edge-c"]
    _register_route(client, sid, route)

    # 1. Vehicle on edge-d -> Next edge must be edge-a with highest confidence
    client.post("/trajectory", json={"session_id": sid, "edge_id": "edge-d", "speed_mps": 10.0})
    on_d = _predict(client, sid, "edge-d")
    assert on_d["predicted_next_edge"] == "edge-a"
    assert on_d["route_terminal"] is False
    assert on_d["probabilities"]["edge-a"] == max(on_d["probabilities"].values())
    assert on_d["probabilities"]["edge-a"] > on_d["probabilities"].get("edge-c", 0.0)

    # 2. Vehicle on edge-a -> Next edge must be edge-b with highest confidence (past edge-d suppressed)
    client.post("/trajectory", json={"session_id": sid, "edge_id": "edge-a", "speed_mps": 10.0})
    on_a = _predict(client, sid, "edge-a")
    assert on_a["predicted_next_edge"] == "edge-b"
    assert on_a["route_terminal"] is False
    assert on_a["probabilities"]["edge-b"] == max(on_a["probabilities"].values())
    assert on_a["probabilities"]["edge-b"] > on_a["probabilities"].get("edge-d", 0.0)

    # 3. Vehicle on edge-b -> Next edge must be edge-c with highest confidence
    client.post("/trajectory", json={"session_id": sid, "edge_id": "edge-b", "speed_mps": 10.0})
    on_b = _predict(client, sid, "edge-b")
    assert on_b["predicted_next_edge"] == "edge-c"
    assert on_b["route_terminal"] is False
    assert on_b["probabilities"]["edge-c"] == max(on_b["probabilities"].values())

    # 4. Vehicle on edge-c -> Route terminal state
    client.post("/trajectory", json={"session_id": sid, "edge_id": "edge-c", "speed_mps": 10.0})
    on_c = _predict(client, sid, "edge-c")
    assert on_c["predicted_next_edge"] is None
    assert on_c["probabilities"] == {}
    assert on_c["route_terminal"] is True
    assert on_c["eta_sec"] is None

