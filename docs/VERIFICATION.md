# M03 verification record

**Verified:** November 14, 2026.

## Quality gate

| Input condition | Result |
| --- | --- |
| Fresh, valid telemetry | `continue` or `review` according to demo rules |
| Signal quality below 0.60 | `abstain` |
| Motion above 2.0 g | `abstain` |
| Packet older than 5 seconds | `abstain` |
| Timestamp more than 2 seconds ahead | `abstain` |
| Both pulse and SpO₂ missing or zero | `abstain` |
| Simulated link loss | `abstain` |

These are illustrative *data-quality* thresholds, not medically validated ranges or NASA operational limits. The score is not a clinical risk estimate. When confidence is unusable, HADSE provides a reason but **no recommendation or synthetic route selection**.

## Tests observed on the development machine

- Backend: **47 passing** pytest tests; one third-party Starlette deprecation warning.
- Frontend: **13 passing** tests.
- TypeScript type check and Vite production build passed.
- HTTP integration smoke tests passed for normal, low signal, high motion, stale packet, future packet, missing readings and simulated link loss.
- Headless Chrome display test passed for normal, future-dated and missing-reading scenarios.

## Pi deployment verification

- Pi-local FastAPI and static dashboard both returned HTTP 200.
- Ethernet client: `192.168.10.1:8000/health` and `192.168.10.1:5173` returned HTTP 200.
- Hotspot endpoints `192.168.4.1:8000/health` and `192.168.4.1:5173` returned HTTP 200 when tested from the Pi.
- Hotspot-origin CORS preflight returned the expected allowed origin.
- Pi backend and frontend systemd units were **active** and **enabled** at the final check.
- Pi HTTP simulation: `nominal` → `continue`, `poor_signal`, `future_data`, `missing_reading` → `abstain`.
- Pi clock corrected manually; automatic NTP synchronization was not available.

## Not verified

No end-to-end hardware validation with a real ESP32 sensor or independent mobile hotspot client was performed. No clinical assessment, medical automation or real Mars route autonomy was claimed.