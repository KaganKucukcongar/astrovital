"""HTTP entrypoint for the first, intentionally bounded vertical slice."""

import os
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from app.blackbox import BlackBox
from app.confidence import assess_confidence
from app.hadse import evaluate
from app.models import SelfCheckIn, SelfCheckOut, SimulationStepIn, TelemetryIn
from app.routes import route_plan, ROUTES
from app.simulator import make_simulated_packet


def create_app(db_path: Path | None = None) -> FastAPI:
    api = FastAPI(title="AstroVital X Mission API", version="0.3.0")
    api.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://192.168.4.1:5173", "http://192.168.10.1:5173"],
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    blackbox = BlackBox(db_path or Path(os.getenv("ASTROVITAL_DB_PATH", "data/mission_blackbox.sqlite3")))
    lock = Lock()
    state: dict[str, object | None] = {
        "telemetry": None, "assessment": None, "self_check": None,
        "link_status": "unknown", "simulation_scenario": None,
    }

    def make_assessment(packet: TelemetryIn) -> dict:
        confidence = assess_confidence(
            observed_at=packet.observed_at,
            signal_quality=packet.signal_quality,
            acceleration_g=packet.acceleration_g,
            has_sensor_reading=(packet.heart_rate_bpm is not None and packet.heart_rate_bpm > 0) or (packet.spo2_pct is not None and packet.spo2_pct > 0),
        )
        current_check = state["self_check"]
        status = current_check["status"] if isinstance(current_check, dict) else None
        decision = evaluate(
            confidence=confidence,
            signal_quality=packet.signal_quality,
            acceleration_g=packet.acceleration_g,
            source=packet.source,
            self_check=status,
        )
        routing = route_plan(
            packet=packet, confidence=confidence, hadse_status=decision.status,
            self_check=status,
        )
        return {"telemetry": packet.model_dump(mode="json"),
                "confidence": confidence.to_dict(), "decision": decision.to_dict(),
                "route_plan": routing}

    def update_assessment(assessment: dict) -> None:
        """Called under lock. Log routing transitions without noisy duplicates."""
        previous = state["assessment"]
        previous_route = previous.get("route_plan") if isinstance(previous, dict) else None
        new_route = assessment["route_plan"]
        before = (previous_route.get("status"), previous_route.get("selected_route_id")) if previous_route else None
        after = (new_route["status"], new_route["selected_route_id"])
        state["assessment"] = assessment
        if before != after:
            blackbox.append("route_plan_changed", {
                "previous": before, "current": after,
                "reason": new_route["reason"],
                "terrain_source": new_route["terrain_source"],
            })

    @api.get("/health")
    def health() -> dict:
        return {"status": "ok", "system": "AstroVital X", "version": "0.3.0"}

    @api.get("/api/v1/routes")
    def route_catalog() -> dict:
        return {"terrain_source": "synthetic_fixture", "routes": [route.to_dict() for route in ROUTES]}

    @api.post("/api/v1/telemetry")
    def receive_telemetry(packet: TelemetryIn) -> dict:
        with lock:
            assessment = make_assessment(packet)
            state["telemetry"] = packet
            update_assessment(assessment)
            blackbox.append("telemetry_assessed", assessment)
            state["link_status"] = "connected"
            return assessment

    @api.post("/api/v1/simulation/step")
    def simulation_step(step: SimulationStepIn) -> dict:
        """Run one synthetic tick through the normal telemetry pipeline."""
        packet = make_simulated_packet(step)
        if packet is None:
            with lock:
                state["link_status"] = "lost"
                state["simulation_scenario"] = step.scenario
                blackbox.append(
                    "simulation_link_loss", {"scenario": step.scenario, "sequence": step.sequence}
                )
            return {"scenario": step.scenario, "sequence": step.sequence, "packet_sent": False}

        assessment = receive_telemetry(packet)
        with lock:
            state["simulation_scenario"] = step.scenario
        return {
            "scenario": step.scenario, "sequence": step.sequence,
            "packet_sent": True, "assessment": assessment,
        }

    @api.post("/api/v1/self-check")
    def submit_self_check(check: SelfCheckIn) -> dict:
        recorded = SelfCheckOut(**check.model_dump(), recorded_at=datetime.now(timezone.utc))
        payload = recorded.model_dump(mode="json")
        with lock:
            blackbox.append("self_check", payload)
            state["self_check"] = payload
            last_packet = state["telemetry"]
            if isinstance(last_packet, TelemetryIn):
                assessment = make_assessment(last_packet)
                update_assessment(assessment)
                blackbox.append("decision_updated", assessment)
            return payload

    @api.get("/api/v1/mission/status")
    def mission_status() -> dict:
        with lock:
            last_packet = state["telemetry"]
            if isinstance(last_packet, TelemetryIn) and state["link_status"] != "lost":
                # Zaman geçtikçe son ölçüm eskir; yeniden POST gerekmez.
                update_assessment(make_assessment(last_packet))
            assessment = deepcopy(state["assessment"])
            routing = assessment.get("route_plan") if isinstance(assessment, dict) else route_plan(
                packet=None, confidence=None, hadse_status=None, self_check=None,
            )
            if state["link_status"] == "lost" and isinstance(assessment, dict):
                # Simülasyonda bilinen bağlantı kaybında eski kararı güvenilir sayma.
                assessment["confidence"] = {"score": 0.0, "usable": False, "reasons": ["link_loss"]}
                assessment["decision"] = {
                    "status": "abstain", "score": None,
                    "reason": "Öneri üretilmedi: yeni telemetri gelmiyor; bağlantı kayıp.",
                    "source": assessment["telemetry"]["source"],
                    "human_review_required": True,
                }
                routing = route_plan(packet=None, confidence=None, hadse_status=None, self_check=None)
                assessment["route_plan"] = routing
            return {
                "assessment": assessment, "self_check": state["self_check"],
                "link_status": state["link_status"],
                "simulation_scenario": state["simulation_scenario"],
                "route_plan": routing,
            }

    @api.get("/api/v1/events")
    def events(limit: int = Query(default=20, ge=1, le=100)) -> dict:
        return {"events": blackbox.recent(limit)}

    return api


app = create_app()
