"""Deterministic, explicitly synthetic telemetry for a hardware-free demo.

All generated packets must remain `source=simulated`. No medical inference,
NASA dataset, real astronaut, or physical sensor is involved.
"""

from datetime import datetime, timedelta, timezone
from math import sin

from app.models import SimulationStepIn, TelemetryIn


def make_simulated_packet(
    step: SimulationStepIn, *, now: datetime | None = None
) -> TelemetryIn | None:
    """Produce one reproducible scenario packet, or None for lost uplink."""
    if step.scenario == "link_loss":
        return None

    now = now or datetime.now(timezone.utc)
    phase = step.sequence
    pulse = round(77 + 4 * sin(phase * 0.42))
    saturation = round(97 + 0.6 * sin(phase * 0.23), 1)
    signal_quality = round(0.95 - 0.03 * abs(sin(phase * 0.31)), 3)
    acceleration_g = round(1.0 + 0.06 * abs(sin(phase * 0.63)), 3)
    observed_at = now

    if step.scenario == "moderate_exertion":
        acceleration_g = 1.6
    elif step.scenario == "operator_review":
        acceleration_g = 1.95
        signal_quality = 0.9
    elif step.scenario == "high_motion":
        acceleration_g = 2.7
        signal_quality = 0.75
    elif step.scenario == "poor_signal":
        signal_quality = 0.2
    elif step.scenario == "stale_data":
        observed_at -= timedelta(seconds=12)
    elif step.scenario == "future_data":
        observed_at += timedelta(seconds=12)
    elif step.scenario == "missing_reading":
        pulse = None
        saturation = None

    return TelemetryIn(
        device_id="simulated-esp32",
        sequence=step.sequence,
        observed_at=observed_at,
        source="simulated",
        heart_rate_bpm=pulse,
        spo2_pct=saturation,
        acceleration_g=acceleration_g,
        signal_quality=signal_quality,
    )
