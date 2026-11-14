from datetime import datetime, timedelta, timezone

from app.confidence import assess_confidence
from app.hadse import evaluate


def reading(**updates):
    args = dict(observed_at=datetime.now(timezone.utc), signal_quality=0.96,
                acceleration_g=1.0, has_sensor_reading=True)
    args.update(updates)
    return assess_confidence(**args)


def test_fresh_quality_data_is_usable():
    check = reading()
    assert check.usable
    assert check.score == 0.96


def test_stale_packet_forces_abstain():
    check = reading(observed_at=datetime.now(timezone.utc) - timedelta(seconds=9))
    decision = evaluate(confidence=check, signal_quality=0.96, acceleration_g=1.0,
                        source="simulated", self_check=None)
    assert "stale_packet" in check.reasons
    assert decision.status == "abstain"


def test_bad_motion_forces_abstain():
    check = reading(acceleration_g=3.0)
    assert not check.usable
    assert "excessive_motion" in check.reasons


def test_self_check_requires_operator_review():
    decision = evaluate(confidence=reading(), signal_quality=0.96, acceleration_g=1.0,
                        source="measured", self_check="needs_help")
    assert decision.status == "review"
    assert decision.human_review_required
