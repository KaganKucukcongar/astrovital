from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.confidence import assess_confidence
from app.hadse import evaluate
from app.main import create_app
from app.models import SimulationStepIn
from app.routes import WEIGHTS, route_plan
from app.simulator import make_simulated_packet


def plan_for(scenario, self_check=None):
    now = datetime.now(timezone.utc)
    packet = make_simulated_packet(SimulationStepIn(scenario=scenario, sequence=2), now=now)
    assert packet is not None
    confidence = assess_confidence(
        observed_at=packet.observed_at, signal_quality=packet.signal_quality,
        acceleration_g=packet.acceleration_g, has_sensor_reading=True, now=now,
    )
    decision = evaluate(
        confidence=confidence, signal_quality=packet.signal_quality,
        acceleration_g=packet.acceleration_g, source=packet.source,
        self_check=self_check,
    )
    return route_plan(packet=packet, confidence=confidence,
                      hadse_status=decision.status, self_check=self_check)


@pytest.mark.parametrize("scenario,expected", [
    ("nominal", "A"),
    ("moderate_exertion", "B"),
    ("operator_review", "C"),
])
def test_routes_change_with_usable_motion_scenario(scenario, expected):
    result = plan_for(scenario)
    assert result["status"] == "proposed"
    assert result["selected_route_id"] == expected
    assert result["human_review_required"] is True
    assert result["terrain_source"] == "synthetic_fixture"
    assert len(result["candidates"]) == 3
    assert [r["score"] for r in result["candidates"]] == sorted(
        [r["score"] for r in result["candidates"]], reverse=True,
    )


def test_weighted_costs_are_explainable_and_normalized():
    result = plan_for("nominal")
    assert sum(WEIGHTS.values()) == pytest.approx(1.0)
    for candidate in result["candidates"]:
        assert sum(candidate["factor_costs"].values()) == pytest.approx(candidate["cost"], abs=0.001)
        assert candidate["score"] == pytest.approx(100 * (1 - candidate["cost"]), abs=0.02)


def test_fatigue_changes_preferred_route_and_help_abstains():
    assert plan_for("nominal", self_check="fatigued")["selected_route_id"] == "C"
    result = plan_for("nominal", self_check="needs_help")
    assert result["status"] == "abstain"
    assert result["selected_route_id"] is None
    assert result["candidates"] == []


@pytest.mark.parametrize("scenario", ["high_motion", "poor_signal", "stale_data"])
def test_bad_telemetry_never_generates_candidate(scenario):
    result = plan_for(scenario)
    assert result["status"] == "abstain"
    assert result["selected_route_id"] is None
    assert result["human_review_required"]


def test_status_routes_follow_ingestion_and_log_transitions(tmp_path):
    client = TestClient(create_app(tmp_path / "blackbox.sqlite3"))
    for scenario, expected in [("nominal", "A"), ("moderate_exertion", "B"), ("operator_review", "C")]:
        result = client.post("/api/v1/simulation/step", json={"scenario": scenario, "sequence": 2})
        assert result.status_code == 200
        assert result.json()["assessment"]["route_plan"]["selected_route_id"] == expected
        status = client.get("/api/v1/mission/status").json()
        assert status["route_plan"]["selected_route_id"] == expected

    events = client.get("/api/v1/events?limit=30").json()["events"]
    transitions = [e for e in events if e["kind"] == "route_plan_changed"]
    assert len(transitions) == 3
    assert transitions[0]["payload"]["current"] == ["proposed", "C"]


def test_stale_status_clears_previous_auto_selection(tmp_path):
    client = TestClient(create_app(tmp_path / "blackbox.sqlite3"))
    packet = make_simulated_packet(SimulationStepIn(scenario="nominal", sequence=1))
    assert packet is not None
    packet.observed_at = datetime.now(timezone.utc) - timedelta(seconds=9)
    result = client.post("/api/v1/telemetry", json=packet.model_dump(mode="json"))
    assert result.json()["route_plan"]["status"] == "abstain"
    status = client.get("/api/v1/mission/status").json()["route_plan"]
    assert status["selected_route_id"] is None
