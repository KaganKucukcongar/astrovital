"""Transparent operational decision support. Never diagnoses or acts autonomously."""

from dataclasses import asdict, dataclass
from typing import Any, Literal

from app.confidence import Confidence

REASON_TEXT = {
    "stale_packet": "ölçüm 5 saniyeden eski",
    "future_timestamp": "ölçüm zaman damgası gelecekte",
    "low_signal_quality": "sinyal kalitesi düşük",
    "excessive_motion": "hareket nedeniyle veri güvenilmez",
    "missing_sensor_reading": "geçerli sensör okuması yok",
}


@dataclass(frozen=True)
class Decision:
    status: Literal["continue", "review", "abstain"]
    score: float | None
    reason: str
    source: Literal["measured", "simulated"]
    human_review_required: bool = True

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def evaluate(
    *,
    confidence: Confidence,
    signal_quality: float,
    acceleration_g: float,
    source: Literal["measured", "simulated"],
    self_check: str | None,
) -> Decision:
    if not confidence.usable:
        return Decision(
            status="abstain",
            score=None,
            reason="Öneri üretilmedi: " + ", ".join(REASON_TEXT.get(r, r) for r in confidence.reasons) + ".",
            source=source,
        )

    # DEMO-ONLY operational priorities, not biomedical risk thresholds.
    quality_cost = 1 - signal_quality
    motion_cost = min(1.0, max(0.0, acceleration_g - 1.0))
    self_report_cost = {None: 0.0, "okay": 0.0, "fatigued": 0.6, "needs_help": 1.0}.get(
        self_check, 0.0
    )
    weighted = round(0.4 * quality_cost + 0.35 * motion_cost + 0.25 * self_report_cost, 3)
    needs_review = weighted >= 0.3 or self_check == "needs_help"
    return Decision(
        status="review" if needs_review else "continue",
        score=weighted,
        reason=(
            "Demo hareket, sinyal veya öz bildirim kuralı tetiklendi; operatör incelemesi gerekli."
            if needs_review
            else "Veri kalite kontrollerini geçti; operasyonel izleme sürdürülebilir. İnsan gözetimi gereklidir."
        ),
        source=source,
    )
