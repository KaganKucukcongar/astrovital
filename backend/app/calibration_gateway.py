"""Restricted AstroHotspot operator bridge for an already-running AstroVital backend.

Why: an active AstroNav mission must not be reset by restarting the main FastAPI
process. Forward only explicitly approved CSV start/stop actions from a
key-authorized hotspot operator to the existing backend via loopback.
Remove this bridge after main backend is safely restarted with the new guard.
"""
from __future__ import annotations

import ipaddress
import json
import os
import secrets
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request as UrlRequest, urlopen

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.models import CalibrationStartIn

OPERATOR_KEY_FILE = Path(os.environ.get(
    "ASTROVITAL_CALIBRATION_OPERATOR_KEY_FILE",
    "/home/mustafa/astrovital/.operator-calibration-key",
))
BACKEND_ORIGIN = "http://127.0.0.1:8000"

app = FastAPI(title="AstroVital CSV hotspot operator bridge", docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://192.168.4.1:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-AstroVital-Operator-Key"],
    allow_credentials=False,
)


def authorize_hotspot_operator(request: Request) -> None:
    """A 128-bit per-Pi operator token, not merely joining the Wi-Fi SSID."""
    try:
        address = ipaddress.ip_address(request.client.host if request.client else "")
    except ValueError:
        raise HTTPException(403, "AstroHotspot local network only")
    if address not in ipaddress.ip_network("192.168.4.0/24"):
        raise HTTPException(403, "AstroHotspot local network only")
    try:
        expected = OPERATOR_KEY_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        raise HTTPException(503, "Hotspot operator key not configured")
    supplied = request.headers.get("x-astrovital-operator-key", "")
    if len(expected) < 32 or not secrets.compare_digest(expected, supplied):
        raise HTTPException(403, "Operator key missing or invalid")


def forward_calibration(action: str, body: dict) -> JSONResponse:
    """Only two allowlisted commands are ever forwarded to loopback."""
    if action not in ("start", "stop"):
        raise HTTPException(404, "Desteklenmeyen komut")
    url = BACKEND_ORIGIN + "/api/v1/calibration/" + action
    payload = json.dumps(body, separators=(",", ":")).encode("utf-8")
    forwarded = UrlRequest(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(forwarded, timeout=6) as response:
            return JSONResponse(status_code=response.status, content=json.load(response))
    except HTTPError as exc:
        try:
            detail = json.loads(exc.read().decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            detail = {"detail": "Backend rejected the request"}
        return JSONResponse(status_code=exc.code, content=detail)
    except (OSError, URLError):
        raise HTTPException(503, "Unable to access main backend")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "calibration-hotspot-bridge", "temporary": True}


@app.post("/api/v1/calibration/start")
def start(payload: CalibrationStartIn, request: Request) -> JSONResponse:
    authorize_hotspot_operator(request)
    if not payload.consent:
        raise HTTPException(409, "Participant consent required for CSV registration")
    return forward_calibration("start", {"consent": True})


@app.post("/api/v1/calibration/stop")
def stop(request: Request) -> JSONResponse:
    authorize_hotspot_operator(request)
    return forward_calibration("stop", {})
