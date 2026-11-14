"""Opt-in, pseudonymous CSV baseline collection and non-clinical trend flags.

This is NOT trained ML or a validated medical anomaly detector. The baseline
is a robust per-session reference for a calm, stationary participant. Users
must give informed permission before telemetry is written to a separate CSV.
"""
from __future__ import annotations

import csv
import math
import os
import secrets
import statistics
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.models import TelemetryIn

MIN_BASELINE = 20
MAX_BASELINE = 30
MAX_RECORDS = 1800
MIN_QUALITY = 0.75

CSV_FIELDS = [
    "session_id", "received_at_utc", "observed_at_utc", "phase", "source",
    "device_id", "sequence", "heart_rate_bpm", "spo2_pct",
    "acceleration_g", "signal_quality", "temperature_c", "pressure_hpa",
    "altitude_m", "heading_deg", "heading_calibrated", "mag_x_ut",
    "mag_y_ut", "mag_z_ut", "steps_total", "stride_length_m",
    "accepted_for_baseline", "baseline_hr_median", "baseline_spo2_median",
    "candidate_anomaly", "recommendation", "verified_label", "reviewer_notes",
]

RECOMMENDATIONS = {
    "heart_rate_up": (
        "Nabız kişisel başlangıç düzeyinden yükseldi. Kişinin durumunu sorun, "
        "hareketi ve sensör temasını kontrol ederek sakin koşulda ölçümü tekrarlayın. "
        "Değişim sürerse yetkili bir yetişkin veya sağlık uzmanına danışın."
    ),
    "heart_rate_down": (
        "Nabız kişisel başlangıç düzeyinden düştü. Sensör yerleşimini doğrulayın, "
        "ölçümü yeniden alın ve kişiye nasıl hissettiğini sorun. "
        "Değişim sürerse sağlık uzmanına danışın."
    ),
    "spo2_down": (
        "Tahmini SpO2 kişisel başlangıç ölçümüne göre düştü. Optik sensörün "
        "temasını ve sinyal kalitesini kontrol ederek tekrar ölçün. "
        "Kişi kendisini kötü hissediyorsa veya düşük ölçüm sürüyorsa "
        "gecikmeden bir yetişkinin ve sağlık uzmanının değerlendirmesini isteyin."
    ),
}

QUALITY_NOTE = (
    "Sinyal veya hareket nedeniyle ölçüm güvenilir değil. "
    "Sensör temasını kontrol edin ve kişi sakin dururken yeniden deneyin."
)


def _median(values: list[float]) -> float | None:
    return round(float(statistics.median(values)), 2) if len(values) >= MIN_BASELINE else None


def _mad(values: list[float]) -> float:
    med = statistics.median(values)
    return float(statistics.median([abs(value - med) for value in values]))


class CalibrationRecorder:
    """Single-session CSV capture. Main API protects calls with its existing lock."""

    def __init__(self, directory: Path):
        self.directory = Path(directory)
        self.active = False
        self.session_id: str | None = None
        self.csv_filename: str | None = None
        self.started_at: str | None = None
        self.stopped_at: str | None = None
        self.record_count = 0
        self.valid_quality_count = 0
        self.hr_baseline: list[float] = []
        self.spo2_baseline: list[float] = []
        self.last_packet_key: tuple[str, int, str] | None = None
        self.deviation_streak: dict[str, int] = {
            "heart_rate_up": 0, "heart_rate_down": 0, "spo2_down": 0
        }
        self.current_anomaly: dict[str, Any] | None = None
        self.last_anomaly: dict[str, Any] | None = None
        self.anomaly_count = 0
        self.last_quality_warning: str | None = None

    def start(self, *, consent: bool) -> dict[str, Any]:
        if not consent:
            raise ValueError("Katılımcının bilgilendirilmiş onayı gereklidir.")
        if self.active:
            raise ValueError("Bir kalibrasyon oturumu zaten aktif.")
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        try:
            os.chmod(self.directory, 0o700)
        except OSError:
            pass
        self.active = False
        self.session_id = secrets.token_hex(8)
        self.csv_filename = "session_" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "_" + self.session_id + ".csv"
        self.started_at = datetime.now(timezone.utc).isoformat()
        self.stopped_at = None
        self.record_count = 0
        self.valid_quality_count = 0
        self.hr_baseline.clear()
        self.spo2_baseline.clear()
        self.last_packet_key = None
        self.deviation_streak = {k: 0 for k in self.deviation_streak}
        self.current_anomaly = None
        self.last_anomaly = None
        self.anomaly_count = 0
        self.last_quality_warning = None
        path = self.directory / self.csv_filename
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(fd, "w", newline="", encoding="utf-8") as file:
                csv.DictWriter(file, fieldnames=CSV_FIELDS).writeheader()
        except Exception:
            path.unlink(missing_ok=True)
            raise
        self.active = True
        return self.status()

    def stop(self) -> dict[str, Any]:
        if not self.active:
            raise ValueError("Aktif bir kalibrasyon oturumu yok.")
        self.active = False
        self.stopped_at = datetime.now(timezone.utc).isoformat()
        return self.status()

    def _baseline(self) -> dict[str, dict[str, float | int | None]]:
        result: dict[str, dict[str, float | int | None]] = {}
        for name, values in (("heart_rate_bpm", self.hr_baseline), ("spo2_pct", self.spo2_baseline)):
            result[name] = {
                "count": len(values),
                "median": _median(values),
                "mad": round(_mad(values), 2) if len(values) >= MIN_BASELINE else None,
                "required": MIN_BASELINE,
            }
        return result

    def status(self) -> dict[str, Any]:
        baseline = self._baseline()
        calibrated = any(entry["median"] is not None for entry in baseline.values())
        return {
            "active": self.active,
            "phase": "inactive" if self.session_id is None
                else "finished" if not self.active
                else "monitoring" if calibrated
                else "baseline",
            "session_id": self.session_id,
            "csv_filename": self.csv_filename,
            "started_at": self.started_at,
            "stopped_at": self.stopped_at,
            "sample_count": self.record_count,
            "quality_accepted_count": self.valid_quality_count,
            "max_samples": MAX_RECORDS,
            "baseline": baseline,
            "calibrated": calibrated,
            "anomaly_count": self.anomaly_count,
            "current_anomaly": self.current_anomaly,
            "last_anomaly": self.last_anomaly,
            "quality_warning": self.last_quality_warning,
            "explanation": (
                "Bu sistem kişisel başlangıç düzeyinden istatistiksel sapma adaylarını bulur. "
                "Tıbbi tanı, eğitimli yapay zeka modeli veya klinik alarm değildir. "
                "CSV'deki verified_label alanı insan incelemesi için boş bırakılır."
            ),
        }

    def record(self, packet: TelemetryIn, received_at: datetime | None = None) -> dict[str, Any] | None:
        if not self.active or packet.source != "measured":
            return None
        key = (packet.device_id, packet.sequence, packet.observed_at.isoformat())
        if key == self.last_packet_key:
            return None
        self.last_packet_key = key
        arrived = received_at or datetime.now(timezone.utc)
        stable = packet.signal_quality >= MIN_QUALITY and abs(packet.acceleration_g - 1.0) <= 0.25
        hr = float(packet.heart_rate_bpm) if packet.heart_rate_bpm is not None and packet.heart_rate_bpm > 0 else None
        spo2 = float(packet.spo2_pct) if packet.spo2_pct is not None and packet.spo2_pct > 0 else None
        good = stable and (hr is not None or spo2 is not None)
        if good:
            self.valid_quality_count += 1
        phase_before = self.status()["phase"]
        # Calibrate each channel independently. For example, if MAX30102
        # initially sends HR=0 but SpO2 is valid, HR may gain its own baseline
        # later without changing the already frozen SpO2 reference.
        if good:
            if hr is not None and len(self.hr_baseline) < MIN_BASELINE:
                self.hr_baseline.append(hr)
            if spo2 is not None and len(self.spo2_baseline) < MIN_BASELINE:
                self.spo2_baseline.append(spo2)

        current = []
        if good and phase_before == "monitoring":
            if hr is not None and len(self.hr_baseline) >= MIN_BASELINE:
                center = float(statistics.median(self.hr_baseline))
                threshold = max(12.0, 4.0 * _mad(self.hr_baseline))
                if hr > center + threshold:
                    current.append("heart_rate_up")
                elif hr < center - threshold:
                    current.append("heart_rate_down")
            if spo2 is not None and len(self.spo2_baseline) >= MIN_BASELINE:
                center = float(statistics.median(self.spo2_baseline))
                threshold = max(4.0, 4.0 * _mad(self.spo2_baseline))
                if spo2 < center - threshold:
                    current.append("spo2_down")

        self.last_quality_warning = None if good else QUALITY_NOTE
        if not good:
            self.deviation_streak = {k: 0 for k in self.deviation_streak}
            self.current_anomaly = None
        else:
            for category in self.deviation_streak:
                self.deviation_streak[category] = self.deviation_streak[category] + 1 if category in current else 0
            triggered = [category for category, count in self.deviation_streak.items() if count >= 3]
            if triggered:
                category = triggered[0]
                if not self.current_anomaly or self.current_anomaly["type"] != category:
                    self.current_anomaly = {
                        "type": category,
                        "detected_at": arrived.isoformat(),
                        "recommendation": RECOMMENDATIONS[category],
                        "confirmation": "3 ardışık kaliteli ölçümde görüldü",
                        "verified": False,
                    }
                    self.last_anomaly = dict(self.current_anomaly)
                    self.anomaly_count += 1
            else:
                self.current_anomaly = None

        baseline = self._baseline()
        row = {
            "session_id": self.session_id,
            "received_at_utc": arrived.isoformat(),
            "observed_at_utc": packet.observed_at.isoformat(),
            "phase": phase_before,
            "source": packet.source,
            "device_id": packet.device_id,
            "sequence": packet.sequence,
            "heart_rate_bpm": hr,
            "spo2_pct": spo2,
            "acceleration_g": packet.acceleration_g,
            "signal_quality": packet.signal_quality,
            "temperature_c": packet.temperature_c,
            "pressure_hpa": packet.pressure_hpa,
            "altitude_m": packet.altitude_m,
            "heading_deg": packet.heading_deg,
            "heading_calibrated": packet.heading_calibrated,
            "mag_x_ut": packet.mag_x_ut,
            "mag_y_ut": packet.mag_y_ut,
            "mag_z_ut": packet.mag_z_ut,
            "steps_total": packet.steps_total,
            "stride_length_m": packet.stride_length_m,
            "accepted_for_baseline": bool(good and phase_before == "baseline"),
            "baseline_hr_median": baseline["heart_rate_bpm"]["median"],
            "baseline_spo2_median": baseline["spo2_pct"]["median"],
            "candidate_anomaly": self.current_anomaly["type"] if self.current_anomaly else "",
            "recommendation": self.current_anomaly["recommendation"] if self.current_anomaly else "",
            # DO NOT auto-label medical ground truth from the rule itself.
            "verified_label": "",
            "reviewer_notes": "",
        }
        assert self.csv_filename is not None
        with (self.directory / self.csv_filename).open("a", newline="", encoding="utf-8") as file:
            csv.DictWriter(file, fieldnames=CSV_FIELDS).writerow(row)
        self.record_count += 1
        if self.record_count >= MAX_RECORDS:
            self.stop()
        return self.status()
