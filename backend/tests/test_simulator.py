from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.models import SimulationStepIn
from app.simulator import make_simulated_packet


@pytest.mark.parametrize("scenario", [
    "nominal", "moderate_exertion", "operator_review", "high_motion", "poor_signal", "stale_data"
])
def test_all_generated_packets_are_simulated(scenario):
    tick = SimulationStepIn(scenario=scenario, sequence=17)
    now = datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc)
    packet = make_simulated_packet(tick, now=now)
    assert packet is not None
    assert packet.source == "simulated"
    assert packet == make_simulated_packet(tick, now=now)


def test_link_loss_generates_no_fake_measurement():
    assert make_simulated_packet(SimulationStepIn(scenario="link_loss", sequence=1)) is None


@pytest.mark.parametrize("scenario,expected", [
    ("nominal", "continue"),
    ("moderate_exertion", "continue"),
    ("operator_review", "review"),
    ("high_motion", "abstain"),
    ("poor_signal", "abstain"),
    ("stale_data", "abstain"),
])
def test_scenario_goes_through_real_confidence_and_hadse(tmp_path, scenario, expected):
    client = TestClient(create_app(tmp_path / "blackbox.sqlite3"))
    response = client.post("/api/v1/simulation/step", json={"scenario": scenario, "sequence": 7})
    assert response.status_code == 200
    body = response.json()
    assert body["packet_sent"] is True
    assert body["assessment"]["telemetry"]["source"] == "simulated"
    assert body["assessment"]["decision"]["status"] == expected
    assert client.get("/api/v1/events").json()["events"][0]["kind"] == "telemetry_assessed"


def test_link_loss_preserves_last_packet_and_logs_failure(tmp_path):
    client = TestClient(create_app(tmp_path / "blackbox.sqlite3"))
    client.post("/api/v1/simulation/step", json={"scenario": "nominal", "sequence": 1})
    response = client.post("/api/v1/simulation/step", json={"scenario": "link_loss", "sequence": 2})
    assert response.status_code == 200
    assert response.json()["packet_sent"] is False
    state = client.get("/api/v1/mission/status").json()
    assert state["link_status"] == "lost"
    assert state["assessment"]["telemetry"]["sequence"] == 1
    assert client.get("/api/v1/events").json()["events"][0]["kind"] == "simulation_link_loss"


def test_unrecognized_scenario_is_rejected(tmp_path):
    client = TestClient(create_app(tmp_path / "blackbox.sqlite3"))
    result = client.post("/api/v1/simulation/step", json={"scenario": "real_medical_data", "sequence": 1})
    assert result.status_code == 422
