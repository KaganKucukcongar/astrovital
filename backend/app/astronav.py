"""AstroNav: live ESP32 heading and pedometer-based relative tracking.

Experimental 10-metre heading-locked target and geometric route alternatives.
No GPS, terrain, obstacle avoidance, or certified emergency navigation.
Unmeasured movement is never fabricated; origin is defined by the operator.
"""
from __future__ import annotations

import math
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field, ConfigDict

TARGET_DISTANCE_M = 10.0
ARRIVAL_RADIUS_M = .85
NAV_SOURCE_TTL_S = 7.0
ROUTE_IDS = ("A", "B", "C")


def norm360(deg: float) -> float:
    return (deg % 360.0 + 360.0) % 360.0


def turn_delta(target: float, heading: float) -> float:
    return (target - heading + 540.0) % 360.0 - 180.0


def distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def bearing(a: tuple[float, float], b: tuple[float, float]) -> float:
    return norm360(math.degrees(math.atan2(b[0] - a[0], b[1] - a[1])))


def advance(pos: tuple[float, float], heading: float, metres: float) -> tuple[float, float]:
    angle = math.radians(heading)
    return pos[0] + math.sin(angle) * metres, pos[1] + math.cos(angle) * metres


def finite(x: object) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


class NavStartIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    device_id: str = Field(min_length=1, max_length=64)
    mode: Literal["estimated"] = "estimated"
    distance_m: float = Field(default=10.0, ge=TARGET_DISTANCE_M, le=TARGET_DISTANCE_M, allow_inf_nan=False)


class NavRouteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    route_id: Literal["A", "B", "C"]


class NavApprovalIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    approved: bool


class NavStepIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    distance_m: float = Field(default=1, gt=0, le=2, allow_inf_nan=False)


class NavReturnIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    approved: bool


@dataclass
class NavSession:
    device_id: str
    mode: str
    target: tuple[float, float]
    target_heading_deg: float
    pos: tuple[float, float] = (0.0, 0.0)
    goal_type: str = "target"
    status: str = "active"
    active_route: str = "A"
    pending_route: str | None = None
    waypoints: list[tuple[float, float]] = field(default_factory=list)
    step_anchor: int | None = None
    observed_sequence: int | None = None
    path: deque[tuple[float, float]] = field(default_factory=lambda: deque([(0, 0)], maxlen=180))
    distance_walked: float = 0.0
    warnings: list[str] = field(default_factory=list)


class AstroNavEngine:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._session: NavSession | None = None
        self._latest: dict | None = None
        self._latest_received = 0.0

    def observe(self, packet: object) -> None:
        """Very small sync update, called from an existing HTTP telemetry thread."""
        if getattr(packet, "source", None) != "measured":
            return
        with self._lock:
            heading = getattr(packet, "heading_deg", None)
            calibrated = getattr(packet, "heading_calibrated", None) is True
            steps = getattr(packet, "steps_total", None)
            stride = getattr(packet, "stride_length_m", None)
            self._latest = {
                "device_id": getattr(packet, "device_id", ""),
                "heading_deg": float(heading) if finite(heading) else None,
                "heading_calibrated": calibrated,
                "steps_total": int(steps) if isinstance(steps, int) and steps >= 0 else None,
                "stride_length_m": float(stride) if finite(stride) and .3 <= stride <= 1.5 else None,
                "sequence": int(getattr(packet, "sequence", 0)),
            }
            self._latest_received = time.monotonic()
            session = self._session
            if not session or session.mode != "estimated" or session.status != "active":
                return
            if session.device_id != self._latest["device_id"]:
                return
            if session.observed_sequence is not None and self._latest["sequence"] <= session.observed_sequence:
                return
            session.observed_sequence = self._latest["sequence"]
            current_steps = self._latest["steps_total"]
            if current_steps is None:
                session.warnings = ["No stride sensor data; The location is not changed."]
                session.step_anchor = None
                return
            previous = session.step_anchor
            session.step_anchor = current_steps
            if previous is None:
                return
            delta_steps = current_steps - previous
            if delta_steps < 0 or delta_steps > 8:
                session.warnings = ["Step counter has been reset or there is a jump; progress skipped."]
                return
            if delta_steps == 0:
                return
            if not calibrated or self._latest["heading_deg"] is None:
                session.warnings = ["Compass calibration or bearing data missing; steps not processed."]
                return
            stride_m = self._latest["stride_length_m"]
            if stride_m is None:
                session.warnings = ["Calibrated stride length is missing; distance not calculated."]
                return
            metres = delta_steps * stride_m
            previous_position = session.pos
            session.pos = advance(session.pos, self._latest["heading_deg"], metres)
            session.distance_walked += metres
            session.path.append(session.pos)
            session.warnings = []
            self._check_arrival(session, previous_position)

    def _valid_heading(self, s: NavSession) -> tuple[float | None, str]:
        t = self._latest
        if not t or t["device_id"] != s.device_id:
            return None, "There is no live compass telemetry for this device."
        if time.monotonic() - self._latest_received > NAV_SOURCE_TTL_S:
            return None, "Compass telemetry is out of date."
        if not t["heading_calibrated"] or t["heading_deg"] is None:
            return None, "Compass calibration required."
        return t["heading_deg"], ""

    def _check_arrival(self, s: NavSession, previous: tuple[float, float] | None = None) -> None:
        goal = (0.0, 0.0) if s.goal_type == "base" else s.target
        # A coordinate guess is NOT a physical arrival guarantee.
        near = distance(s.pos, goal) <= ARRIVAL_RADIUS_M
        # A step can cross a target between packets. Test point-to-segment distance.
        if previous is not None:
            vx, vy = s.pos[0] - previous[0], s.pos[1] - previous[1]
            denom = vx * vx + vy * vy
            if denom > 0:
                u = max(0.0, min(1.0,
                    ((goal[0] - previous[0]) * vx + (goal[1] - previous[1]) * vy) / denom))
                near = near or distance((previous[0] + u * vx, previous[1] + u * vy), goal) <= ARRIVAL_RADIUS_M
        if near:
            s.status = "completed"

    def start(self, payload: NavStartIn) -> dict:
        with self._lock:
            if self._session is not None and self._session.status == "active":
                raise HTTPException(409, "Reset the active duty first.")
            t = self._latest
            if not t or t["device_id"] != payload.device_id:
                raise HTTPException(409, "Actual telemetry is expected for the selected ESP32.")
            if time.monotonic() - self._latest_received > NAV_SOURCE_TTL_S:
                raise HTTPException(409, "The measurement is out of date.")
            if not t["heading_calibrated"] or t["heading_deg"] is None:
                raise HTTPException(409, "Calibrate the compass first.")
            if t["steps_total"] is None or t["stride_length_m"] is None:
                raise HTTPException(409, "Step counter and calibrated stride length required.")
            # Freeze the currently measured heading exactly when start is pressed.
            heading = t["heading_deg"]
            target = advance((0.0, 0.0), heading, TARGET_DISTANCE_M)
            self._session = NavSession(
                device_id=payload.device_id, mode="estimated",
                target=target, target_heading_deg=heading, goal_type="target",
                step_anchor=t["steps_total"], observed_sequence=t["sequence"]
            )
            return self.status()

    def propose(self, payload: NavRouteIn) -> dict:
        with self._lock:
            s = self._active()
            if s.goal_type != "target":
                raise HTTPException(409, "Alternative drawings are only available in the target mission.")
            s.pending_route = payload.route_id
            return self.status()

    def approve(self, payload: NavApprovalIn) -> dict:
        with self._lock:
            s = self._active()
            if s.pending_route is None:
                raise HTTPException(409, "Choose alternative route first.")
            if payload.approved:
                s.active_route = s.pending_route
            s.pending_route = None
            return self.status()

    def _routes(self, s: NavSession) -> list[dict]:
        if s.goal_type == "base":
            return [{"id":"A", "label":"Base direction / direct (estimated)",
                     "distance_m":round(distance(s.pos,(0.0,0.0)),2),
                     "waypoints_m":[[0.0,0.0]]}]
        tx,ty = s.target
        # Conceptual alternatives are NOT obstacle-aware, mapped or validated trails.
        nx,ny = math.cos(math.radians(s.target_heading_deg)), -math.sin(math.radians(s.target_heading_deg))
        routes = [
            ("A","direct line",[[round(tx,3),round(ty,3)]]),
            ("B","Geometric left deviation",[[round(tx*.5-nx*2.5,3),round(ty*.5-ny*2.5,3)],
                                        [round(tx,3),round(ty,3)]]),
            ("C","Geometric right deviation",[[round(tx*.5+nx*2.5,3),round(ty*.5+ny*2.5,3)],
                                        [round(tx,3),round(ty,3)]])
        ]
        return [{"id":rid,"label":label+" (no terrain verification)",
                 "waypoints_m":nodes,
                 "distance_m":round(sum(distance(a,b) for a,b in zip(
                    [(0.0,0.0)]+[tuple(x) for x in nodes[:-1]],
                    [tuple(x) for x in nodes])),2)}
                for rid,label,nodes in routes]

    def return_to_base(self, payload: NavReturnIn) -> dict:
        with self._lock:
            s = self._session
            if s is None:
                raise HTTPException(409, "Start the mission first.")
            if not payload.approved:
                raise HTTPException(409, "Confirmation required for return to base.")
            heading, warning = self._valid_heading(s)
            if heading is None:
                raise HTTPException(409, warning)
            s.goal_type = "base"
            s.active_route = "A"
            s.pending_route = None
            s.waypoints = [(0.0, 0.0)]
            s.status = "active"
            self._check_arrival(s)
            return self.status()

    def demo_step(self, payload: NavStepIn) -> dict:
        raise HTTPException(410, "Virtual progression has been removed. Only ESP32 pitch telemetry is used.")

    def reset(self) -> dict:
        with self._lock:
            self._session = None
            return self.status()

    def _active(self) -> NavSession:
        if self._session is None or self._session.status != "active":
            raise HTTPException(409, "No active AstroNav session.")
        return self._session

    def status(self) -> dict:
        with self._lock:
            s = self._session
            t = self._latest
            age = (time.monotonic() - self._latest_received) if t else None
            sensor_ready = bool(t and age is not None and age <= NAV_SOURCE_TTL_S
                                and t["heading_calibrated"] and t["heading_deg"] is not None
                                and t["steps_total"] is not None and t["stride_length_m"] is not None)
            sensor = {
                "sensor_ready": sensor_ready,
                "sensor_age_s": round(age, 1) if age is not None else None,
                "steps_total": t["steps_total"] if t else None,
                "stride_length_m": t["stride_length_m"] if t else None,
                "sensor_device_id": t["device_id"] if t else None,
            }
            if s is None:
                return {
                    "session_status": "idle", "mode": "unavailable",
                    "device_id": None, "demo": False, "goal_type": "target",
                    "position_source": "not_available",
                    "position_m": None, "base_m": [0, 0], "goal_m": None,
                    "target_m": None, "target_heading_deg": None,
                    "track_m": [], "distance_walked_m": 0,
                    "routes": [], "active_route_id": None, "pending_route_id": None,
                    "remaining_m": None, "turn_deg": None, "heading_deg": None,
                    "next_waypoint": "EXPECTED", "warnings": [],
                    "terrain_source": "none", **sensor,
                }
            heading, warning = self._valid_heading(s)
            returning = s.goal_type == "base"
            goal = (0.0,0.0) if returning else s.target
            remaining = distance(s.pos, goal)
            target_bearing = bearing(s.pos, goal) if remaining > ARRIVAL_RADIUS_M else None
            turn = (turn_delta(target_bearing, heading)
                    if heading is not None and target_bearing is not None and s.status == "active" else None)
            warnings = list(s.warnings)
            if warning:
                warnings.append(warning)
            if not sensor_ready:
                warnings.append("Live step/compass data is missing or outdated; The move cannot be verified.")
            warnings.append("Target location and arrival are relative estimation from measured step/compass; There is no GPS.")
            if not returning:
                warnings.append("A/B/C alternatives are sketches only; actual terrain and obstacles unknown.")
            return {
                "session_status": s.status,
                "mode": "estimated" if sensor_ready and heading is not None else "unavailable",
                "device_id": s.device_id, "demo": False, "goal_type": s.goal_type,
                "position_source": "pedometer_dead_reckoning",
                "position_m": [round(v,3) for v in s.pos],
                "base_m": [0.0,0.0],
                "goal_m": [round(v,3) for v in goal],
                "target_m": [round(v,3) for v in s.target],
                "target_heading_deg": round(s.target_heading_deg,1),
                "track_m": [[round(x,3),round(y,3)] for x,y in s.path],
                "distance_walked_m": round(s.distance_walked,2),
                "routes": self._routes(s), "active_route_id":s.active_route,
                "pending_route_id":s.pending_route,
                "remaining_m": round(remaining,2),
                "turn_deg": round(turn,1) if turn is not None else None,
                "heading_deg": round(heading,1) if heading is not None else None,
                "target_bearing_deg": round(target_bearing,1) if target_bearing is not None else None,
                "next_waypoint": "VARIS" if s.status == "completed"
                                 else "US" if returning else "AIM",
                "warnings": warnings, "terrain_source": "none", **sensor,
            }

    def guidance(self, device_id: str) -> dict:
        with self._lock:
            state = self.status()
            if state["device_id"] != device_id:
                state = self._idle_guidance()
            routes = state.get("routes", [])
            alternatives = {r["id"]: r["distance_m"] for r in routes}
            return {
                "mode": state["mode"],
                "session_status": state["session_status"],
                "remaining_m": state["remaining_m"],
                "turn_deg": state["turn_deg"],
                "demo": state["demo"],
                "goal_type": state["goal_type"],
                "active_route_id": state["active_route_id"] or "A",
                "alternatives_m": {name: alternatives.get(name, 0.0) for name in ROUTE_IDS},
                "next_waypoint": state["next_waypoint"],
            }

    def _idle_guidance(self) -> dict:
        return {"mode": "unavailable", "session_status": "idle",
                "remaining_m": None, "turn_deg": None, "demo": False,
                "goal_type": "target", "active_route_id": "A",
                "alternatives_m": {"A": 0.0, "B": 0.0, "C": 0.0},
                "next_waypoint": "PASIF"}
