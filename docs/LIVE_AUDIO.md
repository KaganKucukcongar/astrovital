# AstroVital X · Live WebSocket radio

## Audio format and bridge
- WebSocket: `ws://<Pi-IP>:8000/ws/audio?role=esp32` ve `?role=dashboard`.
- Binary audio: 8000 Hz, 8-bit unsigned mono PCM, 256 bytes (32 ms), silence 128.
- The FastAPI bridge is asynchronous; The reconnected device inherits the old role socket. In the slow receiver, old blocks are discarded.
- `GET /api/v1/audio/status` returns connection statuses. Audio is not recorded on the server side.
- `backend/pyproject.toml` contains the required `websockets>=14,<17` dependency.

## Dashboard ve PTT
- WebSocket and AudioContext are initialized by clicking **Volume Up** from the **Voice Communication (Radio)** screen.
- Incoming PCM blocks are converted to Float32, timed to the speaker, and displayed on the VU meter.
- While **PTT** is pressed, the microphone stream changes to 8 kHz PCM blocks; When released, the microphone turns off.
- Visual search popups are a separate demo.

## Microphone in HTTP local network
Chrome usually blocks access to `getUserMedia` on `http://192.168.4.1:5173`. You can create a separate Chrome profile/shortcut just for the demo:
```powershell
powershell -File .\tools\create_radio_chrome_shortcut.ps1
```
It only makes `http://192.168.10.1:5173` and `http://192.168.4.1:5173` addresses trustworthy in that Chrome session. **It does not grant microphone permission automatically.** The user confirms the Chrome permission by pressing the **Request Microphone Permission** option on the panel. The temporary microphone stream that is turned on for control stops immediately; actual broadcasting occurs only when PTT is pressed.

**Security:** `--unsafely-treat-insecure-origin-as-secure` relaxes browser protection. Use only in controlled local network demo. The production system requires HTTPS/WSS, authentication, and network access control. This `ws://` channel is unencrypted and unauthenticated; Port 8000 should not be opened to the internet.

## Hardware and verification
- Even if the ESP32's audio WebSocket is connected, the physical quality of the A0 microphone and D5 speaker is not verified. Strong offset/noise observed at input A0; Keep the volume low.
- `cd frontend && npm test && npm run build` (40 tests passed).
- `backend/tests/audio_integration_checks.py` does HTTP/telemetry checks during mutual audio, connection takeover and audio only on the isolated `127.0.0.1:18084` test server. Do not run against the production database.
- This change did not edit the ESP32 firmware; Do not add the user's local Wi-Fi credentials to the source repository.
