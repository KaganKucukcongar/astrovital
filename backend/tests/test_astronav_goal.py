"""Measured ESP32 heading/step relative navigation regression tests.

These tests model telemetry; they do not validate physical location accuracy.
"""
from types import SimpleNamespace
from fastapi import HTTPException
from pydantic import ValidationError
import time
from app import astronav as m

def packet(seq,steps,heading=0.0,calibrated=True,source="measured",id="astrovital-esp32-01"):
    return SimpleNamespace(device_id=id,sequence=seq,source=source,
        steps_total=steps,heading_deg=heading,heading_calibrated=calibrated,stride_length_m=.667)

def test_live_heading_locked_10m_target_and_magnetic_guidance():
    e=m.AstroNavEngine()
    try:e.start(m.NavStartIn(device_id="astrovital-esp32-01"));assert False
    except HTTPException as ex:assert ex.status_code==409
    try:m.NavStartIn(device_id="astrovital-esp32-01",mode="simulation");assert False
    except ValidationError:pass
    try:m.NavStartIn(device_id="astrovital-esp32-01",distance_m=11);assert False
    except ValidationError:pass
    e.observe(packet(1,100,0))
    s=e.start(m.NavStartIn(device_id="astrovital-esp32-01"))
    assert s["goal_type"]=="target" and s["target_m"]==[0,10]
    assert s["remaining_m"]==10 and s["target_heading_deg"]==0
    assert s["turn_deg"]==0 and len(s["routes"])==3
    assert s["routes"][0]["distance_m"]==10
    assert s["routes"][1]["distance_m"]>10 and s["routes"][2]["distance_m"]>10
    assert e.guidance("astrovital-esp32-01")["turn_deg"]==0
    try:e.start(m.NavStartIn(device_id="astrovital-esp32-01"));assert False
    except HTTPException as ex:assert ex.status_code==409
    s=e.propose(m.NavRouteIn(route_id="B"))
    assert s["pending_route_id"]=="B" and s["active_route_id"]=="A"
    s=e.approve(m.NavApprovalIn(approved=True))
    assert s["pending_route_id"] is None and s["active_route_id"]=="B"
    e.propose(m.NavRouteIn(route_id="C"))
    s=e.approve(m.NavApprovalIn(approved=False))
    assert s["active_route_id"]=="B" and s["pending_route_id"] is None
    e.observe(packet(2,107,0))
    s=e.status()
    assert s["session_status"]=="active" and s["remaining_m"]==round(10-7*.667,2),s
    e.observe(packet(3,107,90))
    s=e.status()
    assert s["turn_deg"]==-90.0 and s["target_m"]==[0,10],s
    e.observe(packet(3,109,90))
    assert e.status()["remaining_m"]==s["remaining_m"]
    e.observe(packet(4,109,0))
    e.observe(packet(5,115,0))
    s=e.status()
    assert s["session_status"]=="completed" and s["turn_deg"] is None,s
    assert abs(s["position_m"][1]-10.005)<.02,s
    s=e.return_to_base(m.NavReturnIn(approved=True))
    assert s["goal_type"]=="base" and s["session_status"]=="active" and len(s["routes"])==1,s
    assert abs(s["turn_deg"])==180.0 and s["remaining_m"]>9.5,s
    e.observe(packet(6,123,180))
    e.observe(packet(7,130,180))
    s=e.status()
    assert s["session_status"]=="completed" and s["remaining_m"]<=.85,s
    assert e.reset()["session_status"]=="idle"
    e.observe(packet(20,150,90))
    s=e.start(m.NavStartIn(device_id="astrovital-esp32-01"))
    assert s["target_m"]==[10.0,0.0] and s["turn_deg"]==0,s
    e._latest_received=time.monotonic()-9
    assert e.status()["mode"]=="unavailable" and e.status()["turn_deg"] is None
