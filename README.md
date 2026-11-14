# AstroVital X

AstroVital X is a research prototype for astronaut telemetry monitoring and explainable, rule-based mission decision support. It combines a FastAPI backend with a React/TypeScript dashboard, a hardware-independent simulator, and a Raspberry Pi deployment.

This repository captures the **M03-tested implementation deployed to a Raspberry Pi on November 14, 2026**. The operator interface remains in Turkish.

## Features

- Telemetry intake with explicit `measured` or `simulated` source labels.
- Sensor Confidence Engine: packet age, future timestamps, signal quality, motion and missing readings.
- HADSE: transparent rules returning `continue`, `review`, or `abstain` with reasons. Invalid telemetry never receives an operational recommendation.
- Astronaut Self-Check, synthetic route comparison, and a persisted Mission Black Box event log.
- Browser dashboard and independent simulator modes (including low signal, high motion, stale/future packets, missing readings and link loss).
- Raspberry Pi Wi-Fi hotspot / Ethernet operation without requiring internet access at runtime.

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

The dashboard uses the browser hostname to locate the API on port `8000`, making the same build usable over a Raspberry Pi hotspot (`192.168.4.1`) or Ethernet (`192.168.10.1`). It explicitly labels unimplemented navigation, Earth link and environmental measurements as **DEMO**. No unsupported clinical or hardware capabilities are claimed.

The API connectivity indicator is now resilient to transient polling failures. Requests are not overlapped, optional event history is fetched every six seconds, a failed optional endpoint cannot declare the API offline, and three consecutive fully failed polls are required before marking a previously connected API offline. Mission refresh delays retain last-known data and are indicated separately.

Run `cd frontend && npm test && npm run build` to execute **16 frontend tests** and the production build (verified on November 14, 2026). The tested Raspberry Pi deployment uses prebuilt static frontend files; compiled assets, device credentials and runtime databases are not committed.

**Validation scope:** The updated frontend was tested with a real Raspberry Pi API and simulated network-block scenarios. Physical ESP32 telemetry had been observed reaching the Pi, but that does not constitute medical validation, and pixel-perfect parity for every Figma page was not independently verified.
