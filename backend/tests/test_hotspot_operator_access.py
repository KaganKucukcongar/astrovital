"""Hotspot CSV operator authorization is separate from informed consent."""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.main import create_app
from app.models import CalibrationStartIn


def request_for(ip: str, token: str | None = None) -> Request:
    headers = []
    if token is not None:
        headers = [(b"x-astrovital-operator-key", token.encode("utf-8"))]
    return Request({"type": "http", "client": (ip, 54321),
                    "method": "POST", "path": "/", "headers": headers})


def test_hotspot_requires_operator_token_and_participant_consent(tmp_path: Path, monkeypatch):
    key = "0123456789abcdef0123456789abcdef"
    secret_file = tmp_path / ".operator-calibration-key"
    monkeypatch.setenv("ASTROVITAL_CALIBRATION_OPERATOR_KEY_FILE", str(secret_file))
    app = create_app(tmp_path / "blackbox.sqlite3")
    endpoints = {route.path: route.endpoint for route in app.routes}
    start = endpoints["/api/v1/calibration/start"]
    stop = endpoints["/api/v1/calibration/stop"]
    status = endpoints["/api/v1/calibration/status"]

    with pytest.raises(HTTPException) as missing_file:
        start(CalibrationStartIn(consent=True), request_for("192.168.4.23", key))
    assert missing_file.value.status_code == 503
    assert not list(tmp_path.rglob("*.csv"))

    secret_file.write_text(key, encoding="utf-8")
    for ip, bad_key in [("192.168.4.23", None), ("192.168.4.23", "wrong"),
                        ("172.16.0.10", key)]:
        with pytest.raises(HTTPException) as denied:
            start(CalibrationStartIn(consent=True), request_for(ip, bad_key))
        assert denied.value.status_code == 403
        assert not status()["active"]
        assert not list(tmp_path.rglob("*.csv"))

    with pytest.raises(HTTPException) as no_consent:
        start(CalibrationStartIn(consent=False), request_for("192.168.4.23", key))
    assert no_consent.value.status_code == 409
    assert not status()["active"]

    started = start(CalibrationStartIn(consent=True), request_for("192.168.4.23", key))
    assert started["active"]
    assert started["phase"] == "baseline"
    assert len(list(tmp_path.rglob("*.csv"))) == 1

    with pytest.raises(HTTPException) as stop_denied:
        stop(request_for("192.168.4.23"))
    assert stop_denied.value.status_code == 403
    assert status()["active"]

    stopped = stop(request_for("192.168.4.23", key))
    assert not stopped["active"]


def test_ethernet_retains_existing_operator_access(tmp_path: Path):
    app = create_app(tmp_path / "blackbox.sqlite3")
    endpoints = {route.path: route.endpoint for route in app.routes}
    start = endpoints["/api/v1/calibration/start"]
    stop = endpoints["/api/v1/calibration/stop"]

    assert start(CalibrationStartIn(consent=True), request_for("192.168.10.12"))["active"]
    assert not stop(request_for("192.168.10.12"))["active"]


def test_browser_preflight_allows_hotspot_operator_header(tmp_path: Path):
    client = TestClient(create_app(tmp_path / "blackbox.sqlite3"))
    response = client.options("/api/v1/calibration/start", headers={
        "Origin": "http://192.168.4.1:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-astrovital-operator-key",
    })
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://192.168.4.1:5173"
    assert "x-astrovital-operator-key" in response.headers["access-control-allow-headers"].lower()
