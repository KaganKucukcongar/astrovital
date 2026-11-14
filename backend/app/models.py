"""External API contracts; keep input validation at the HTTP boundary."""

from datetime import datetime
from typing import Literal

from pydantic import AwareDatetime, BaseModel, Field


class TelemetryIn(BaseModel):
    device_id: str = Field(min_length=1, max_length=64)
    sequence: int = Field(ge=0)
    observed_at: AwareDatetime
    source: Literal["measured", "simulated"]
    heart_rate_bpm: int | None = Field(default=None, ge=0, le=300)
    spo2_pct: float | None = Field(default=None, ge=0, le=100)
    acceleration_g: float = Field(ge=0, le=16)
    signal_quality: float = Field(ge=0, le=1)
    # Optional environmental and navigation measurements from Arduino Nano ESP32.
    # These are kept separate from the physiological HADSE confidence gate.
    mag_x_ut: float | None = Field(default=None, allow_inf_nan=False)
    mag_y_ut: float | None = Field(default=None, allow_inf_nan=False)
    mag_z_ut: float | None = Field(default=None, allow_inf_nan=False)
    heading_deg: float | None = Field(default=None, ge=0, le=360, allow_inf_nan=False)
    heading_calibrated: bool | None = None
    temperature_c: float | None = Field(default=None, allow_inf_nan=False)
    pressure_hpa: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    altitude_m: float | None = Field(default=None, allow_inf_nan=False)
    steps_total: int | None = Field(default=None, ge=0)
    stride_length_m: float | None = Field(default=None, ge=0, allow_inf_nan=False)


class CalibrationStartIn(BaseModel):
    # Explicit opt-in; no name, age, or identity is sent to the server.
    consent: bool


class SelfCheckIn(BaseModel):
    status: Literal["okay", "fatigued", "needs_help"]
    note: str = Field(default="", max_length=300)


class SelfCheckOut(SelfCheckIn):
    recorded_at: datetime


class SimulationStepIn(BaseModel):
    """A deterministic demo clock tick; never accepts a measured-data source."""

    scenario: Literal[
        "nominal", "moderate_exertion", "operator_review", "high_motion",
        "poor_signal", "stale_data", "future_data", "missing_reading", "link_loss"
    ] = "nominal"
    sequence: int = Field(ge=0)
