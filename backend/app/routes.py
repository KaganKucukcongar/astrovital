"""Explainable, scenario-driven route ranking over SYNTHETIC terrain fixtures.

This engine ranks fictional route candidates for a supervised demo. It does
not calculate paths, ingest NASA terrain, or authorize astronaut movement.
"""

from dataclasses import asdict, dataclass
from typing import Any

from app.confidence import Confidence
from app.models import TelemetryIn


@dataclass(frozen=True)
class Route:
    id: str
    name: str
    distance_km: float
    slope_deg: float
    obstacle_count: int
    duration_min: int

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


ROUTES = (
    Route("A", "Ridge Traverse", 4.8, 6.2, 2, 92),
    Route("B", "Northern Arc", 5.6, 4.8, 2, 100),
    Route("C", "South Basin", 6.2, 2.6, 4, 138),
)

# Matches the earlier agreed HADSE route-cost dimensions; normalized inputs
# are demo-specific and documented below, not scientific safety thresholds.
WEIGHTS = {
    "distance": 0.25,
    "slope": 0.30,
    "obstacles": 0.20,
    "wearable_load": 0.15,
    "duration": 0.10,
}


def clamp(value: float) -> float:
    return min(1.0, max(0.0, value))


def route_plan(
    *,
    packet: TelemetryIn | None,
    confidence: Confidence | None,
    hadse_status: str | None,
    self_check: str | None,
) -> dict[str, Any]:
    """Choose a provisional candidate, or abstain with an explicit cause.

    The five weighted components are route distance (from 4 to 8 km), slope
    (0 to 10 degrees), obstacle count (0 to 10), wearable load, and duration
    (0 to 180 minutes). Human load rises with motion/self-reported fatigue.
    """
    common = {
        "terrain_source": "synthetic_fixture",
        "human_review_required": True,
        "weights": WEIGHTS,
    }

    def abstain(reason: str) -> dict[str, Any]:
        return {
            **common, "status": "abstain", "selected_route_id": None,
            "human_load": None, "candidates": [], "reason": reason,
        }

    if packet is None or confidence is None:
        return abstain("No telemetry; automatic route recommendation withheld")
    if not confidence.usable or hadse_status == "abstain":
        return abstain("Sensor-confidence gate: " + ", ".join(confidence.reasons))
    if self_check == "needs_help":
        return abstain("Astronaut requested help; operator review before route selection")

    motion_load = clamp((packet.acceleration_g - 1.0) / 0.95)
    human_load = max(motion_load, 1.0 if self_check == "fatigued" else 0.0)
    candidates = []
    for route in ROUTES:
        components = {
            "distance": WEIGHTS["distance"] * clamp((route.distance_km - 4.0) / 4.0),
            "slope": WEIGHTS["slope"] * clamp(route.slope_deg / 10.0),
            "obstacles": WEIGHTS["obstacles"] * clamp(route.obstacle_count / 10.0),
            "wearable_load": WEIGHTS["wearable_load"] * clamp(
                (route.slope_deg / 10.0) * (0.15 + 0.85 * human_load)
            ),
            "duration": WEIGHTS["duration"] * clamp(route.duration_min / 180.0),
        }
        cost = sum(components.values())
        candidates.append({
            **route.to_dict(), "score": round(100 * (1.0 - cost), 2),
            "cost": round(cost, 4),
            "factor_costs": {key: round(value, 4) for key, value in components.items()},
        })

    candidates.sort(key=lambda item: (-item["score"], item["id"]))
    selected = candidates[0]
    return {
        **common,
        "status": "proposed",
        "selected_route_id": selected["id"],
        "human_load": round(human_load, 3),
        "candidates": candidates,
        "reason": (
            f"Route {selected['id']} has the lowest demo weighted cost "
            f"({selected['cost']:.3f}); operator approval required"
        ),
    }
