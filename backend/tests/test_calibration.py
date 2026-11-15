"""Run with the Pi backend venv in an isolated temporary directory."""
import csv
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import HTTPException
from starlette.requests import Request

from app.calibration import CalibrationRecorder
from app.main import create_app
from app.models import CalibrationStartIn, TelemetryIn


def sample(sequence: int, *, hr: int = 72, spo2: float = 98.0,
           quality: float = 0.9, acceleration: float = 1.02,
           source: str = "measured") -> TelemetryIn:
    return TelemetryIn(
        device_id="ASTRO-CAL-TEST", sequence=sequence,
        observed_at=datetime.now(timezone.utc) - timedelta(seconds=4),
        source=source, heart_rate_bpm=hr, spo2_pct=spo2,
        acceleration_g=acceleration, signal_quality=quality,
        temperature_c=23.4, pressure_hpa=1010.5, altitude_m=24.2
    )


def request_for(ip: str) -> Request:
    return Request({"type": "http", "client": (ip, 12345), "method": "POST",
                    "path": "/", "headers": []})


class CalibrationTests(unittest.TestCase):
    def test_opt_in_and_csv_anomaly_pipeline(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = create_app(Path(tmp) / "blackbox.sqlite3")
            endpoints = {route.path: route.endpoint for route in app.routes}
            start = endpoints["/api/v1/calibration/start"]
            stop = endpoints["/api/v1/calibration/stop"]
            status = endpoints["/api/v1/calibration/status"]
            post = endpoints["/api/v1/telemetry"]
            mission = endpoints["/api/v1/mission/status"]

            with self.assertRaises(HTTPException):
                start(CalibrationStartIn(consent=False), request_for("192.168.10.219"))
            with self.assertRaises(HTTPException):
                start(CalibrationStartIn(consent=True), request_for("192.168.4.128"))
            self.assertFalse(status()["active"])
            self.assertEqual(list(Path(tmp).rglob("*.csv")), [])

            started = start(CalibrationStartIn(consent=True), request_for("192.168.10.219"))
            self.assertEqual(started["phase"], "baseline")
            self.assertEqual(started["sample_count"], 0)
            self.assertIsNone(started["baseline"]["heart_rate_bpm"]["median"])
            self.assertTrue(started["active"])

            # Measured packets are captured; simulated packets are not.
            post(sample(100,source="simulated"))
            self.assertEqual(status()["sample_count"], 0)
            for sequence in range(1, 24):
                post(sample(sequence))
            result = status()
            self.assertTrue(result["calibrated"])
            self.assertEqual(result["phase"], "monitoring")
            self.assertEqual(result["baseline"]["heart_rate_bpm"]["median"], 72)
            self.assertEqual(result["baseline"]["spo2_pct"]["median"], 98)
            self.assertEqual(result["sample_count"], 23)
            self.assertEqual(mission()["calibration"]["phase"], "monitoring")

            # A transient single sample is only a candidate, not an alert.
            post(sample(24,hr=98))
            self.assertIsNone(status()["current_anomaly"])
            post(sample(25,hr=98))
            self.assertIsNone(status()["current_anomaly"])
            post(sample(26,hr=98))
            alarm = status()
            self.assertEqual(alarm["current_anomaly"]["type"], "heart_rate_up")
            self.assertEqual(alarm["anomaly_count"], 1)
            self.assertFalse(alarm["current_anomaly"]["verified"])
            self.assertIn("repeat", alarm["current_anomaly"]["recommendation"])

            # Low quality cannot count as another physiological anomaly.
            post(sample(27,hr=98,quality=0.1))
            self.assertIsNone(status()["current_anomaly"])
            self.assertIsNotNone(status()["quality_warning"])
            self.assertEqual(status()["anomaly_count"], 1)
            # Bad data should not join baseline or trigger new alarms.
            post(sample(28,hr=180,quality=0.1))
            self.assertEqual(status()["anomaly_count"], 1)

            stopped = stop(request_for("192.168.10.219"))
            self.assertEqual(stopped["phase"], "finished")
            self.assertFalse(stopped["active"])
            post(sample(29))
            self.assertEqual(status()["sample_count"], 28)
            paths = list((Path(tmp)/"calibration_sessions").glob("*.csv"))
            self.assertEqual(len(paths), 1)
            with paths[0].open(encoding="utf-8",newline="") as f:
                records=list(csv.DictReader(f))
            self.assertEqual(len(records), 28)
            self.assertEqual(records[0]["source"], "measured")
            self.assertEqual(records[0]["verified_label"], "")
            self.assertEqual(records[25]["candidate_anomaly"], "heart_rate_up")
            self.assertEqual(records[-1]["accepted_for_baseline"], "False")
            self.assertTrue(all("name" not in col.lower() for col in records[0].keys()))
            if os.name == "posix":
                self.assertEqual(paths[0].stat().st_mode & 0o777, 0o600)

    def test_bad_measurements_do_not_fabricate_baseline(self):
        with tempfile.TemporaryDirectory() as tmp:
            rec=CalibrationRecorder(Path(tmp)/"calibration")
            rec.start(consent=True)
            for i in range(25):
                rec.record(sample(i,hr=0,spo2=0,quality=0.3))
            self.assertFalse(rec.status()["calibrated"])
            self.assertEqual(rec.status()["phase"],"baseline")
            self.assertEqual(rec.status()["sample_count"],25)
            rec.stop()

    def test_late_heart_rate_sensor_gets_separate_reference(self):
        with tempfile.TemporaryDirectory() as tmp:
            rec=CalibrationRecorder(Path(tmp)/"calibration")
            rec.start(consent=True)
            for i in range(20):
                rec.record(sample(i,hr=0,spo2=97))
            self.assertIsNone(rec.status()["baseline"]["heart_rate_bpm"]["median"])
            self.assertEqual(rec.status()["baseline"]["spo2_pct"]["median"],97)
            for i in range(20,40):
                rec.record(sample(i,hr=72,spo2=97))
            self.assertEqual(rec.status()["baseline"]["heart_rate_bpm"]["median"],72)
            self.assertEqual(rec.status()["baseline"]["spo2_pct"]["median"],97)
            self.assertEqual(rec.status()["anomaly_count"],0)
            rec.stop()

    def test_spo2_fall_generates_quality_gated_candidate(self):
        with tempfile.TemporaryDirectory() as tmp:
            rec=CalibrationRecorder(Path(tmp)/"calibration")
            rec.start(consent=True)
            for i in range(20):
                rec.record(sample(i,hr=72,spo2=98))
            for i in range(20,23):
                rec.record(sample(i,hr=72,spo2=92))
            self.assertEqual(rec.status()["current_anomaly"]["type"],"spo2_down")
            self.assertFalse(rec.status()["current_anomaly"]["verified"])
            rec.stop()

    def test_motion_artifact_does_not_trigger_physiological_anomaly(self):
        with tempfile.TemporaryDirectory() as tmp:
            rec=CalibrationRecorder(Path(tmp)/"calibration")
            rec.start(consent=True)
            for i in range(20):
                rec.record(sample(i,hr=72,spo2=98))
            for i in range(20,24):
                rec.record(sample(i,hr=125,spo2=82,acceleration=1.8))
            self.assertEqual(rec.status()["anomaly_count"],0)
            self.assertIsNotNone(rec.status()["quality_warning"])
            rec.stop()

    def test_no_duplicates_or_automatic_capture(self):
        with tempfile.TemporaryDirectory() as tmp:
            rec=CalibrationRecorder(Path(tmp)/"calibration")
            self.assertIsNone(rec.record(sample(1)))
            self.assertFalse((Path(tmp)/"calibration").exists())
            rec.start(consent=True)
            packet=sample(1)
            rec.record(packet)
            self.assertIsNone(rec.record(packet))
            self.assertEqual(rec.status()["sample_count"],1)
            rec.stop()


if __name__=="__main__":
    unittest.main(verbosity=2)
