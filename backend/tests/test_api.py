from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.main import create_app


def sample(source="simulated", when=None):
    return {
        "device_id": "test-esp32", "sequence": 1,
        "observed_at": (when or datetime.now(timezone.utc)).isoformat(),
        "source": source, "heart_rate_bpm": 78, "spo2_pct": 97,
        "acceleration_g": 1.0, "signal_quality": 0.95,
    }


def test_telemetry_self_check_and_blackbox(tmp_path):
    client = TestClient(create_app(tmp_path / "test.sqlite3"))
    result = client.post("/api/v1/telemetry", json=sample())
    assert result.status_code == 200
    assert result.json()["decision"]["source"] == "simulated"
    assert result.json()["decision"]["status"] == "continue"
    check = client.post("/api/v1/self-check", json={"status": "needs_help"})
    assert check.status_code == 200
    state = client.get("/api/v1/mission/status").json()
    assert state["assessment"]["decision"]["status"] == "review"
    events = client.get("/api/v1/events").json()["events"]
    assert len(events) == 5
    assert events[0]["kind"] == "decision_updated"
    assert events[1]["kind"] == "route_plan_changed"


def test_stale_packets_never_result_in_continue(tmp_path):
    client = TestClient(create_app(tmp_path / "test.sqlite3"))
    stale = sample(when=datetime.now(timezone.utc) - timedelta(seconds=12))
    result = client.post("/api/v1/telemetry", json=stale)
    assert result.json()["decision"]["status"] == "abstain"


def test_input_validation(tmp_path):
    client = TestClient(create_app(tmp_path / "test.sqlite3"))
    invalid = sample()
    invalid["signal_quality"] = 8
    assert client.post("/api/v1/telemetry", json=invalid).status_code == 422
