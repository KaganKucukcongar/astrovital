"""HTTP entrypoint for the first, intentionally bounded vertical slice."""

import os
import ipaddress
import logging
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

from fastapi import FastAPI, Query, Request, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from app.blackbox import BlackBox
from app.audio_bridge import AudioBridge
from app.astronav import AstroNavEngine, NavStartIn, NavStepIn, NavRouteIn, NavApprovalIn, NavReturnIn
from app.calibration import CalibrationRecorder
from app.confidence import assess_confidence
from app.hadse import evaluate
from app.models import CalibrationStartIn, SelfCheckIn, SelfCheckOut, SimulationStepIn, TelemetryIn
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
    calibration = CalibrationRecorder(blackbox.path.parent / "calibration_sessions")
    audio_bridge = AudioBridge()  # Async and independent of the telemetry Lock.
    astronav = AstroNavEngine()  # Real ESP32 dead reckoning only; no GPS or terrain.

    def require_operator_ethernet(request: Request) -> None:
        # Measurement capture is explicitly opt-in and never remotely
        # controllable by ordinary AstroHotspot clients (192.168.4.0/24).
        host = request.client.host if request.client else ""
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            raise HTTPException(status_code=403, detail="Yerel operatör bağlantısı gerekli")
        if not (address.is_loopback or address in ipaddress.ip_network("192.168.10.0/24")):
            raise HTTPException(status_code=403, detail="Kalibrasyon yalnızca Ethernet operatör bağlantısından yönetilir")

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

    @api.websocket("/ws/audio")
    async def audio_ws(websocket: WebSocket, role: str | None = None) -> None:
        await audio_bridge.handle(websocket, role)

    @api.get("/api/v1/audio/status")
    async def audio_status() -> dict[str, bool]:
        return await audio_bridge.status()

    def require_navigation_lan(request: Request) -> None:
        # Local demo only. This is NOT a production authentication scheme.
        host = request.client.host if request.client else ""
        try:
            addr = ipaddress.ip_address(host)
        except ValueError:
            raise HTTPException(403, "Yalnızca yerel görev ağı")
        if not (addr.is_loopback or addr in ipaddress.ip_network("192.168.4.0/24")
                or addr in ipaddress.ip_network("192.168.10.0/24")):
            raise HTTPException(403, "Navigasyon kontrolü yalnızca yerel ağda")

    @api.get("/api/v1/navigation/status")
    def navigation_status() -> dict:
        return astronav.status()

    @api.get("/api/v1/navigation/guidance")
    def navigation_guidance(device_id: str = Query(min_length=1, max_length=64)) -> dict:
        # Existing Nano ESP32 firmware expects these keys for the OLED NAV page.
        return astronav.guidance(device_id)

    @api.post("/api/v1/navigation/start")
    def navigation_start(payload: NavStartIn, request: Request) -> dict:
        require_navigation_lan(request)
        result = astronav.start(payload)
        blackbox.append("astronav_started", {"device_id":payload.device_id,
            "mode":payload.mode,"position_source":"pedometer_dead_reckoning"})
        return result

    @api.post("/api/v1/navigation/propose")
    def navigation_propose(payload: NavRouteIn, request: Request) -> dict:
        require_navigation_lan(request)
        return astronav.propose(payload)

    @api.post("/api/v1/navigation/approve")
    def navigation_approve(payload: NavApprovalIn, request: Request) -> dict:
        require_navigation_lan(request)
        result = astronav.approve(payload)
        blackbox.append("astronav_route_decision", {
            "approved":payload.approved,"route_id":result["active_route_id"]})
        return result

    @api.post("/api/v1/navigation/return")
    def navigation_return(payload: NavReturnIn, request: Request) -> dict:
        require_navigation_lan(request)
        result = astronav.return_to_base(payload)
        blackbox.append("astronav_return_to_base", {"approved":True})
        return result

    @api.post("/api/v1/navigation/demo-step")
    def navigation_demo_step(payload: NavStepIn, request: Request) -> dict:
        require_navigation_lan(request)
        return astronav.demo_step(payload)

    @api.post("/api/v1/navigation/reset")
    def navigation_reset(request: Request) -> dict:
        require_navigation_lan(request)
        result = astronav.reset()
        blackbox.append("astronav_reset", {"status":"idle"})
        return result

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
            astronav.observe(packet)
            blackbox.append("telemetry_assessed", assessment)
            # CSV is written ONLY during a consented, explicitly started session.
            # A recording failure must never interrupt the ESP32 telemetry API.
            try:
                previous_count = calibration.anomaly_count
                calibration.record(packet)
                if calibration.anomaly_count > previous_count and calibration.current_anomaly:
                    blackbox.append("calibration_candidate_anomaly", {
                        "session_id": calibration.session_id,
                        "type": calibration.current_anomaly["type"],
                        "verified": False,
                    })
            except Exception:
                logging.exception("Calibration CSV recording error; live telemetry remains available")
                calibration.active = False
                calibration.last_quality_warning = "CSV kaydı durdu; yerel diski kontrol edin."
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

    @api.post("/api/v1/calibration/start")
    def start_calibration(payload: CalibrationStartIn, request: Request) -> dict:
        require_operator_ethernet(request)
        with lock:
            try:
                result = calibration.start(consent=payload.consent)
            except ValueError as exc:
                raise HTTPException(status_code=409, detail=str(exc))
            blackbox.append("calibration_started", {"session_id": calibration.session_id})
            return result

    @api.post("/api/v1/calibration/stop")
    def stop_calibration(request: Request) -> dict:
        require_operator_ethernet(request)
        with lock:
            try:
                result = calibration.stop()
            except ValueError as exc:
                raise HTTPException(status_code=409, detail=str(exc))
            blackbox.append("calibration_stopped", {
                "session_id": calibration.session_id,
                "sample_count": calibration.record_count,
            })
            return result

    @api.get("/api/v1/calibration/status")
    def calibration_status() -> dict:
        with lock:
            return calibration.status()

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
                "calibration": calibration.status(),
            }

    @api.get("/api/v1/events")
    def events(limit: int = Query(default=20, ge=1, le=100)) -> dict:
        return {"events": blackbox.recent(limit)}

    return api


app = create_app()
