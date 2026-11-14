"""Integration validation against the isolated Pi uvicorn staging server.

Uses actual binary WebSocket clients, exercises both directions, empty peer,
role takeover, invalid frame ignore, and concurrent health/status HTTP calls.
No participant telemetry or audio is recorded.
"""
from __future__ import annotations

import asyncio
import json
import time
from urllib.request import urlopen, Request
from datetime import datetime, timezone

import websockets

HOST="127.0.0.1"
PORT=18084
API=f"http://{HOST}:{PORT}"
WS=f"ws://{HOST}:{PORT}/ws/audio"

async def get_json(path):
    def read():
        with urlopen(API+path,timeout=5) as r:return json.load(r)
    return await asyncio.to_thread(read)

async def eventually(predicate,timeout=3):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        status=await get_json("/api/v1/audio/status")
        if predicate(status):return status
        await asyncio.sleep(.05)
    raise AssertionError("Status did not reach expected values")

async def main():
    assert (await get_json("/health"))["status"]=="ok"
    initial=await get_json("/api/v1/audio/status")
    assert initial=={"esp32_connected":False,"dashboard_connected":False},initial
    print("ZERO_CONNECTION_STATUS_OK",flush=True)

    async with websockets.connect(WS+"?role=esp32") as esp:
        await eventually(lambda s:s["esp32_connected"] and not s["dashboard_connected"])
        await esp.send(bytes(range(256)))   # no dashboard => packet dropped safely.
        async with websockets.connect(WS+"?role=dashboard") as dash:
            await eventually(lambda s:s["esp32_connected"] and s["dashboard_connected"])
            up=bytes(range(256))
            await esp.send(up)
            received=await asyncio.wait_for(dash.recv(),2)
            assert received==up,("esp to dashboard data not preserved",received[:12])
            print("ESP32_TO_DASHBOARD_256_BYTES_OK",flush=True)

            down=bytes([128]*256)
            await dash.send(down)
            assert await asyncio.wait_for(esp.recv(),2)==down
            print("DASHBOARD_TO_ESP32_256_BYTES_OK",flush=True)

            # Invalid length must not be forwarded (and session must remain).
            await esp.send(bytes(100))
            try:
                await asyncio.wait_for(dash.recv(),.25)
                raise AssertionError("Wrong-length frame forwarded")
            except asyncio.TimeoutError:
                pass
            print("INVALID_PCM_SIZE_IGNORED_OK",flush=True)

            # New device socket supersedes old one; no stale role owner.
            async with websockets.connect(WS+"?role=esp32") as esp2:
                await asyncio.wait_for(esp.wait_closed(),3)
                await eventually(lambda s:s["esp32_connected"] and s["dashboard_connected"])
                assert esp.close_code==4000,esp.close_code
                await esp2.send(up)
                assert await asyncio.wait_for(dash.recv(),2)==up
                await dash.send(down)
                assert await asyncio.wait_for(esp2.recv(),2)==down
                print("ESP32_REBOOT_TAKEOVER_OK",flush=True)

                # Flood bursts while HTTP endpoints remain responsive.
                before=time.monotonic()
                async def send_burst():
                    for i in range(35):
                        await esp2.send(bytes([i%256])*256)
                async def http():
                    for i in range(8):
                        h=await get_json("/health")
                        s=await get_json("/api/v1/audio/status")
                        m=await get_json("/api/v1/mission/status")
                        assert h["status"]=="ok" and s["esp32_connected"] and "assessment" in m
                async def post_telemetry():
                    # Writes only to the isolated staging database, never production.
                    sample={
                        "device_id":"WS-AUDIO-INTEGRATION-TEST",
                        "sequence":123,
                        "observed_at":datetime.now(timezone.utc).isoformat(),
                        "source":"simulated",
                        "heart_rate_bpm":76,"spo2_pct":97.4,
                        "acceleration_g":1.0,"signal_quality":0.95,
                    }
                    def post():
                        req=Request(API+"/api/v1/telemetry",
                            data=json.dumps(sample).encode("utf-8"),
                            headers={"Content-Type":"application/json"},method="POST")
                        with urlopen(req,timeout=5) as response:
                            assert response.status==200
                            return json.load(response)
                    outcome=await asyncio.to_thread(post)
                    assert outcome["telemetry"]["device_id"]=="WS-AUDIO-INTEGRATION-TEST"
                await asyncio.wait_for(asyncio.gather(send_burst(),http(),post_telemetry()),7)
                print("TELEMETRY_POST_UNBLOCKED_DURING_AUDIO_PASS",flush=True)
                print("HTTP_REMAINED_RESPONSIVE_WITH_AUDIO",round(time.monotonic()-before,2),flush=True)

        # esp2 has disconnected; the old esp was replaced and closed earlier.
        await eventually(lambda s:not s["esp32_connected"] and not s["dashboard_connected"])
    await eventually(lambda s:not s["esp32_connected"] and not s["dashboard_connected"])
    print("DISCONNECT_CLEANUP_STATUS_OK",flush=True)

    # Bad role cannot claim a peer.
    try:
        async with websockets.connect(WS+"?role=intruder"):pass
        raise AssertionError("Unauthorized role accepted")
    except websockets.exceptions.InvalidHandshake:
        print("INVALID_ROLE_REJECTED_OK",flush=True)
    assert (await get_json("/health"))["status"]=="ok"
    print("AUDIO_WEBSOCKET_INTEGRATION_PASS",flush=True)

if __name__=="__main__":
    asyncio.run(main())
