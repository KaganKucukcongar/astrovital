# AstroVital X · HADSE Calibration and CSV Collection

## How to start?
1. Obtain clear, informed consent from the participant. If the participant or sensor user is not an adult, also obtain consent from a parent/authorized adult.
2. Open the `http://192.168.10.1:5173/` page on the computer via Ethernet.
3. Go to **Health Analysis and HADSE → Personal Calibration and CSV Recording**.
4. Verify that the sensor and ESP32 data link are working.
5. Tick ​​the checkbox and press the **Start confirmed calibration** button.
6. In the first stage, the person should be measured in a relaxed and motionless state. Note that 20 quality samples are required for each channel. Pulse and SpO₂ channels are calibrated separately.
7. Once a reference is established, the system compares subsequent measurements with this reference. An anomaly is marked as a candidate only if there is deviation in 3 consecutive quality measurements.
8. **Stop CSV recording** when finished. Initialization for non-approved person.

## Ne kaydediliyor?
New CSV registration is **closed** until approval is given. When registration is turned on, only `source=measured` packages are recorded. CSV columns include UTC device/acquisition time, sequence number, pulse, estimated SpO₂, motion (g), signal quality, temperature, pressure, estimated altitude, compass, baseline references, anomaly candidate, and recommendation.

CSV does not contain names, phone numbers, clear IDs or addresses. The `verified_label` and `reviewer_notes` columns are left blank: the algorithm's own prediction cannot be used as a **correct label**.

## CSV nerede?
Pi: `/home/mustafa/astrovital/backend/data/calibration_sessions/session_...csv`
File permissions: 0600; folder permissions: 0700.
There is no automatic web upload or public CSV download API from the dashboard.

After the session ends, run the following command on the computer:
`python tools/calibration_csv_to_windows.py`

Files are transferred via SSH to the `~/Downloads/AstroVital_Kalibsyon_CSV` folder.

## How does the anomaly algorithm work?
- The starting reference is the median of at least 20 quiet, high-quality sensor values.
- For a healthy calibration, the signal quality should be at least 0.75 and the acceleration should be around 1g.
- Heart rate deviation from reference by `max(12 BPM, 4 × MAD); A `max(4 percentage points, 4 × MAD)` downward deviation in estimated SpO₂ may be a candidate for examination.
- An anomaly candidate is not created until the deviation is driven in **3 consecutive valid** packets.
- If there is a motion/signal problem, a **measurement verification warning** is displayed, not a personal health anomaly.
- If there is no connection, no new results are produced. The previous event remains with the timestamp.
- Each session collects up to 1,800 packets; then CSV recording stops automatically.

These are **prototype rules based on personal reference**, not clinical norms, trained ML model, or validated medical thresholds. In particular, optical sensor and calibration errors can cause false alarms or missed anomalies. The application does not provide health insurance to the person; If there are real symptoms, appropriate health support should be sought.

## Gizlilik
- Starting a recording without the participant's permission.
- CSV health measurement includes: sharing without permission, putting in an open GitHub repository, or uploading to the internet.
- Existing AstroVital **Mission Black Box SQLite recordings** continue to record telemetry apart from this new CSV mode. Explain this to the participant in advance.
- CSV is not automatically deleted when you log out; After the required period, securely delete the Pi and any computer copies.
- CSV start/stop is accepted only over the Pi's **Ethernet carrier network (192.168.10.0/24)**. It does not open from hotspot or internet.
