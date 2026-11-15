"""Explainable sensor-data gate (not a physiological assessment)."""

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any


@dataclass(frozen=True)
class Confidence:
    score: float
    usable: bool
    reasons: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def assess_confidence(
    *,
    observed_at: datetime,
    signal_quality: float,
    acceleration_g: float,
    has_sensor_reading: bool,
    now: datetime | None = None,
) -> Confidence:
    """Apply deliberately simple, auditable demo thresholds.

    The quality scalar must come from a documented sensor algorithm before
    the source can truthfully be tagged `measured`.
    """
    now = now or datetime.now(timezone.utc)
    if not observed_at.tzinfo or not now.tzinfo:
        raise ValueError("Timestamps must include timezone")
    age_seconds = (now - observed_at).total_seconds()
    reasons: list[str] = []

    if age_seconds > 5:
        reasons.append("stale_packet")
    if age_seconds < -2:
        reasons.append("future_timestamp")
    if not 0 <= signal_quality <= 1 or signal_quality < 0.6:
        reasons.append("low_signal_quality")
    if not 0 <= acceleration_g <= 16 or acceleration_g > 2.0:
        reasons.append("excessive_motion")
    if not has_sensor_reading:
        reasons.append("missing_sensor_reading")

    # This score is only an indicator of demo data quality, not biomedical reliability.
    quality = min(1.0, max(0.0, signal_quality))
    movement_factor = 0.5 if acceleration_g > 2.0 or acceleration_g < 0 else 1.0
    freshness_factor = 0.2 if age_seconds > 5 or age_seconds < -2 else 1.0
    score = round(quality * movement_factor * freshness_factor * (1.0 if has_sensor_reading else 0.0), 3)
    return Confidence(score=score, usable=not reasons, reasons=tuple(reasons))
