"""Isolated tests; these never send a request to the live Raspberry Pi backend."""
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from fastapi.responses import JSONResponse
from starlette.requests import Request

from app import calibration_gateway as gateway
from app.models import CalibrationStartIn


def fake_request(ip: str, key: str | None) -> Request:
    h=[] if key is None else [(b"x-astrovital-operator-key",key.encode())]
    return Request({"type":"http","client":(ip,50000),"method":"POST","path":"/","headers":h})


def test_hotspot_gateway_denies_other_users(tmp_path: Path, monkeypatch):
    key="f"*32
    p=tmp_path/".operator"
    p.write_text(key,encoding="utf-8")
    monkeypatch.setattr(gateway,"OPERATOR_KEY_FILE",p)
    for ip, token in [("192.168.4.34",None),("192.168.4.34","wrong"),
                      ("192.168.10.99",key),("10.1.2.3",key)]:
        with pytest.raises(HTTPException) as exc:
            gateway.authorize_hotspot_operator(fake_request(ip,token))
        assert exc.value.status_code==403
    assert gateway.authorize_hotspot_operator(fake_request("192.168.4.34",key)) is None


def test_gateway_uses_existing_csv_engine_and_consent(tmp_path: Path, monkeypatch):
    key="e"*32
    p=tmp_path/".operator"
    p.write_text(key,encoding="utf-8")
    monkeypatch.setattr(gateway,"OPERATOR_KEY_FILE",p)
    calls=[]
    def proxy(action,body):
        calls.append((action,body))
        return JSONResponse({"active":action=="start"})
    monkeypatch.setattr(gateway,"forward_calibration",proxy)
    req=fake_request("192.168.4.44",key)
    with pytest.raises(HTTPException) as no_consent:
        gateway.start(CalibrationStartIn(consent=False),req)
    assert no_consent.value.status_code==409
    assert calls==[]
    assert gateway.start(CalibrationStartIn(consent=True),req).status_code==200
    assert gateway.stop(req).status_code==200
    assert calls==[("start",{"consent":True}),("stop",{})]


def test_gateway_preflight_for_hotspot_browser():
    client=TestClient(gateway.app)
    r=client.options("/api/v1/calibration/start",headers={
      "Origin":"http://192.168.4.1:5173",
      "Access-Control-Request-Method":"POST",
      "Access-Control-Request-Headers":"content-type,x-astrovital-operator-key",
    })
    assert r.status_code==200
    assert r.headers["access-control-allow-origin"]=="http://192.168.4.1:5173"
    assert "x-astrovital-operator-key" in r.headers["access-control-allow-headers"].lower()
