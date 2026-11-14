# Raspberry Pi deployment

This is the configuration that was verified for the M03 demo, with all credentials excluded. The source is prepared on a development PC and copied to the Pi using SSH/SCP. Do **not** copy a Windows virtual environment or `node_modules` onto Linux.

## Target layout

```text
/home/mustafa/astrovital/
  backend/
    app/
    pyproject.toml
    .venv/                  Pi-local Python virtual environment
    data/                   Pi-local runtime database (do not overwrite)
  frontend/
    dist/                   built dashboard
/usr/local/lib/astrovital/
  run-backend.sh
  run-frontend.sh
/etc/systemd/system/
  astro-backend.service
  astro-frontend.service
```

The tested Pi exposed Ethernet `192.168.10.1/24` and its own Wi-Fi access point at `192.168.4.1/24`. These values are device-specific. The hotspot is configured separately through NetworkManager. **Never put a Wi-Fi password or SSH password in the repository.**

## Prepare backend on the Pi

From a Pi-local shell:

```sh
cd /home/mustafa/astrovital/backend
python3 -m venv .venv
.venv/bin/python -m pip install "fastapi>=0.115,<1" "uvicorn>=0.30,<1"
```

The verified Pi had Python 3.13 on aarch64 but no internet. Dependencies were transferred as compatible wheel files and installed with:

```sh
.venv/bin/python -m pip install --no-index --find-links /path/to/offline-wheels "fastapi>=0.115,<1" "uvicorn>=0.30,<1"
```

Offline wheels must match the Pi's Python version, ABI and CPU architecture.

## Build and copy the frontend

On a development computer:

```sh
cd frontend
npm install
npm run build
```

Copy `backend/app`, `backend/pyproject.toml`, and the generated `frontend/dist` to the respective Pi directories. Preserve `backend/data` and the Pi's existing `.venv`. The compiled frontend resolves its API base using the browser's current hostname and port `8000`, so clients connected to the Pi's Wi-Fi hotspot call the Pi rather than their own `127.0.0.1`.

## Register services

Copy the runner scripts in `deploy/raspberry-pi/` to `/usr/local/lib/astrovital/`, and the service units to `/etc/systemd/system/`. Review the username and paths before applying:

```sh
sudo chmod 755 /usr/local/lib/astrovital/run-backend.sh /usr/local/lib/astrovital/run-frontend.sh
sudo systemctl daemon-reload
sudo systemctl enable --now astro-backend astro-frontend
sudo systemctl status astro-backend astro-frontend
```

The frontend runner serves the built static files with Python's HTTP server on port `5173`; Node.js is **not** required on the Pi at runtime for this build. FastAPI serves port `8000`. For an internet-facing production deployment, use an appropriate web server, HTTPS and authentication instead of exposing development services.

## Smoke tests

```sh
curl -fsS http://127.0.0.1:8000/health
curl -fsSI http://127.0.0.1:5173/
systemctl is-active astro-backend astro-frontend
systemctl is-enabled astro-backend astro-frontend
```

On the verified hotspot, the equivalent addresses were `http://192.168.4.1:8000` and `http://192.168.4.1:5173`. The API's CORS policy explicitly allows the verified hotspot and Ethernet origins. Reconfigure allowed origins if the network changes.

## Important: system time

HADSE checks timestamps: data older than 5 seconds or more than 2 seconds in the future is not usable. The tested offline Pi initially had an incorrect clock. Its time was manually synchronized, but NTP remained unsynchronized. Verify and synchronize the Pi clock after every power cycle when there is no reliable NTP or RTC. Wrong time causes expected `abstain` outcomes.

## Known limits

The dashboard and API were tested over Ethernet and loopback, and the Pi hotspot endpoints and CORS were checked from the Pi. Independent phone access through the hotspot and physical ESP32 telemetry were not tested in this release.