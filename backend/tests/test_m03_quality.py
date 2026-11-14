"""M03: veri kalite kapısı + karar vermekten kaçınma regresyonu."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.confidence import assess_confidence
from app.main import create_app


def telemetry(**changes):
    packet = {
        "device_id": "test-sim-m03", "sequence": 1,
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "source": "simulated", "heart_rate_bpm": 76, "spo2_pct": 98,
        "acceleration_g": 1.0, "signal_quality": 0.96,
    }
    packet.update(changes)
    return packet


@pytest.mark.parametrize("scenario,expected", [
    ("nominal", "continue"),
    ("poor_signal", "abstain"),
    ("high_motion", "abstain"),
    ("stale_data", "abstain"),
    ("future_data", "abstain"),
    ("missing_reading", "abstain"),
])
def test_scenarios_with_api(tmp_path, scenario, expected):
    client = TestClient(create_app(tmp_path / "m03.sqlite3"))
    response = client.post("/api/v1/simulation/step", json={"scenario": scenario, "sequence": 3})
    assert response.status_code == 200
    result = response.json()["assessment"]
    assert result["telemetry"]["source"] == "simulated"
    assert result["decision"]["status"] == expected
    assert result["decision"]["human_review_required"]
    if expected == "abstain":
        assert result["decision"]["score"] is None
        assert not result["confidence"]["usable"]
        assert result["route_plan"]["selected_route_id"] is None
        assert result["decision"]["reason"].startswith("Öneri üretilmedi")


def test_zeros_are_not_real_sensor_readings(tmp_path):
    client = TestClient(create_app(tmp_path / "m03.sqlite3"))
    response = client.post("/api/v1/telemetry", json=telemetry(heart_rate_bpm=0, spo2_pct=0))
    assert response.status_code == 200
    result = response.json()
    assert "missing_sensor_reading" in result["confidence"]["reasons"]
    assert result["confidence"]["score"] == 0
    assert result["decision"]["status"] == "abstain"


@pytest.mark.parametrize("delta,reason", [(-12, "stale_packet"), (12, "future_timestamp")])
def test_malformed_time_never_activates_decision(tmp_path, delta, reason):
    client = TestClient(create_app(tmp_path / "m03.sqlite3"))
    timestamp = datetime.now(timezone.utc) + timedelta(seconds=delta)
    response = client.post("/api/v1/telemetry", json=telemetry(observed_at=timestamp.isoformat()))
    assert response.status_code == 200
    assert reason in response.json()["confidence"]["reasons"]
    assert response.json()["decision"]["status"] == "abstain"


@pytest.mark.parametrize("bad_field,value", [
    ("observed_at", "invalid-date"),
    ("signal_quality", 2.0),
    ("acceleration_g", -1.0),
])
def test_invalid_http_payload_is_rejected(tmp_path, bad_field, value):
    client = TestClient(create_app(tmp_path / "m03.sqlite3"))
    response = client.post("/api/v1/telemetry", json=telemetry(**{bad_field: value}))
    assert response.status_code == 422


def test_fresh_packet_becomes_stale_for_confidence():
    now = datetime.now(timezone.utc)
    assert assess_confidence(observed_at=now, signal_quality=0.9,
                             acceleration_g=1, has_sensor_reading=True, now=now).usable
    check = assess_confidence(observed_at=now, signal_quality=0.9,
                              acceleration_g=1, has_sensor_reading=True,
                              now=now + timedelta(seconds=6))
    assert not check.usable
    assert check.reasons == ("stale_packet",)

def test_simulated_link_loss_never_reuses_previous_recommendation(tmp_path):
    client = TestClient(create_app(tmp_path / "m03.sqlite3"))
    good = client.post("/api/v1/simulation/step", json={"scenario": "nominal", "sequence": 1})
    assert good.json()["assessment"]["decision"]["status"] == "continue"
    loss = client.post("/api/v1/simulation/step", json={"scenario": "link_loss", "sequence": 2})
    assert loss.json()["packet_sent"] is False
    current = client.get("/api/v1/mission/status").json()
    assert current["link_status"] == "lost"
    assert current["assessment"]["decision"]["status"] == "abstain"
    assert current["assessment"]["confidence"]["usable"] is False
    assert current["assessment"]["route_plan"]["selected_route_id"] is None
    assert current["assessment"]["telemetry"]["sequence"] == 1  # Eski kayıt silinmez.
