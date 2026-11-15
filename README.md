# AstroVital X

AstroVital X is a research prototype for astronaut telemetry monitoring and explainable, rule-based mission decision support. It combines a FastAPI backend with a React/TypeScript dashboard, a hardware-independent simulator, and a Raspberry Pi deployment.

This repository contains the M03 baseline and the November 15, 2026 AstroNav, live radio, hotspot CSV operator-control, and English-language interface updates. The operator interface and user-facing guidance are in English.

## Features

- Telemetry intake with explicit `measured` or `simulated` source labels.
- Sensor Confidence Engine: packet age, future timestamps, signal quality, motion and missing readings.
- HADSE: transparent rules returning `continue`, `review`, or `abstain` with reasons. Invalid telemetry never receives an operational recommendation.
- Astronaut Self-Check, synthetic route comparison, and a persisted Mission Black Box event log.
- Browser dashboard and independent simulator modes (including low signal, high motion, stale/future packets, missing readings and link loss).
- Raspberry Pi Wi-Fi hotspot / Ethernet operation without requiring internet access at runtime.
- AstroNav: a 10 m heading-locked relative target, pedometer-based position estimation, return-to-base guidance, and magnetic-north / device-up map views; no GPS or obstacle avoidance.
- Live 8 kHz PCM voice radio bridge with explicit microphone permission.
- Opt-in personal-baseline CSV calibration; hotspot write access requires a separately stored operator key, and participant consent is always required.

**Scope:** This is not a clinical diagnostic or medical device, does not use AI models, and does not autonomously navigate a real Mars route. Synthetic demo routes are not safety-certified. Measured hardware telemetry requires separate physical validation.

## Repository structure

```text
backend/
  app/                FastAPI endpoints, rules, simulator, events and demo routes
  tests/              Backend unit and HTTP tests
  pyproject.toml
frontend/
  src/                React interface and local fallback HADSE
  test/               Frontend domain tests
  public/
  package.json
deploy/raspberry-pi/   systemd units and service runner scripts
docs/                  Deployment and verification
```

## Run locally

Requires Python 3.11+ and Node.js 22+.

**Backend** (terminal 1):

```sh
cd backend
python -m venv .venv
# Activate the virtual environment for your shell.
python -m pip install -e ".[dev]"
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

**Frontend** (terminal 2):

```sh
cd frontend
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. The frontend defaults to calling the backend on port `8000` at the same hostname; override with `VITE_API_BASE` when needed.

## Tests

```sh
cd backend && python -m pytest -q
cd ../frontend && npm test && npm run build
```

See [deployment instructions](docs/DEPLOYMENT.md) for the Raspberry Pi layout and [verification notes](docs/VERIFICATION.md) for the observed M03 results and limitations.

## Data and security

Do not commit SSH keys, device credentials, `.env` files, real telemetry data, SQLite databases, local virtual environments, or `node_modules`. The hotspot credentials and SSH settings are configured separately on each device. Source labels are important: the dashboard must not label synthetic packets as measured astronaut data.

## Status

The source was deployed and checked over Raspberry Pi Ethernet. Backend and frontend services were active and enabled at verification time; both HTTP endpoints and the M03 scenarios passed. A separate end-to-end test using a physical ESP32 and an independent phone client was **not** performed.


## November 14, 2026 dashboard release

The browser dashboard has been updated to follow the AstroVital X Figma design reference (overview layout, dark mission-control styling, four telemetry metrics, trend chart, HADSE and self-check sections). Existing backend integration, self-check submission, event history, sensor quality rules and the simulator remain available.

The dashboard uses the browser hostname to locate the API on port `8000`, making the same build usable over a Raspberry Pi hotspot (`192.168.4.1`) or Ethernet (`192.168.10.1`). At the time of that historical release, navigation and Earth-link mockups were labeled **DEMO**; later AstroNav updates added live heading-and-step relative navigation without GPS. No unsupported clinical or hardware capabilities are claimed.

The API connectivity indicator is now resilient to transient polling failures. Requests are not overlapped, optional event history is fetched every six seconds, a failed optional endpoint cannot declare the API offline, and three consecutive fully failed polls are required before marking a previously connected API offline. Mission refresh delays retain last-known data and are indicated separately.

Run `cd frontend && npm test && npm run build` to execute **16 frontend tests** and the production build (verified on November 14, 2026). The tested Raspberry Pi deployment uses prebuilt static frontend files; compiled assets, device credentials and runtime databases are not committed.

**Validation scope:** The updated frontend was tested with a real Raspberry Pi API and simulated network-block scenarios. Physical ESP32 telemetry had been observed reaching the Pi, but that does not constitute medical validation, and pixel-perfect parity for every Figma page was not independently verified.

## November 14, 2026 environmental telemetry and HADSE calibration

The Raspberry Pi API now accepts BMP180 temperature, pressure and barometric altitude, plus magnetometer and compass telemetry. The dashboard displays measurements with source, freshness and compass-calibration indications; missing readings are not fabricated. The API service and ESP32 stream indicators are independent, so device clock skew does not falsely mark an accessible API offline.

The HADSE page adds an **opt-in CSV calibration session**. A consenting participant's measured (never simulated) packets may be recorded to a local, access-restricted CSV. The first 20 quality-accepted readings establish per-channel personal baselines. Subsequent repeated deviations yield explainable, **unverified anomaly candidates** and suggestions to recheck readings or obtain human review. This is a rule-based research prototype, **not trained ML or a clinically validated diagnosis system**. The existing HADSE quality gate is unchanged. All CSV files, local database records, credentials and deployment backups are excluded from version control.

Read [the calibration guide](docs/HADSE_CALIBRATION.md) for consent, operating instructions, limitations and the optional local CSV transfer helper. The backend calibration module was exercised with isolated unit tests; the frontend has 21 passing tests and its production build was verified. The active calibration session remains off until explicitly started.

## Live radio and microphone permission panel

Added two-way 8 kHz PCM WebSocket audio bridge between ESP32 and Raspberry Pi, VU meter and push-to-talk (PTT) in the dashboard, as well as explicit user microphone permission control. See [Live Radio Guide](docs/LIVE_AUDIO.md) for details, restrictions and secure local Chrome shortcut installation. The quality of the physical audio hardware has not yet been verified.


## November 15, 2026: English interface and operator controls

The React dashboard, AstroNav map, voice communication panel, simulation labels, status messages, HTML metadata, README, and technical guides use English. The frontend retains the same API field names and endpoint paths, so the wire protocol does not change when the UI language changes.

The live AstroNav prototype uses a calibrated magnetic heading and estimated step length. Its 10 m target and return-to-base directions are **relative estimates, not GPS coordinates or verified safe routes**. Three route drawings are schematic only. Magnetic north is not corrected to geographic true north.

CSV calibration start/stop controls still require informed participant consent. Ethernet operator access remains supported. For AstroHotspot operation, the backend checks a private server-side operator token; the token must never be stored in source control or included in frontend assets. During a running mission, a temporary port 8001 bridge can forward these operations to the existing backend without restarting the in-memory AstroNav session. The bridge is deployment-specific and is not a general-purpose authenticated API.

After the changes are safely deployed, run the frontend domain tests (npm test and npm run build) and backend tests (python -m pytest). These tests do not replace physical ESP32, microphone, or Wi-Fi validation.
