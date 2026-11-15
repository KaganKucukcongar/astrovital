export type Source = 'simulated' | 'measured';
export type Scenario = 'nominal' | 'moderate_exertion' | 'high_motion' | 'poor_signal' | 'stale_data' | 'future_data' | 'missing_reading' | 'link_loss';
export type Decision = 'continue' | 'review' | 'abstain';
export type CheckStatus = 'okay' | 'fatigued' | 'needs_help';
export type Page = 'overview' | 'telemetry' | 'hadse' | 'astronav' | 'voice' | 'blackbox' | 'sensors' | 'notifications' | 'settings';

export type Sample = {
  id: string;
  deviceId: string;
  sequence: number;
  observedAt: string;
  source: Source;
  heartRate: number | null;
  spo2: number | null;
  acceleration: number;
  quality: number;
  temperatureC: number | null;
  pressureHpa: number | null;
  altitudeM: number | null;
  headingDeg: number | null;
  headingCalibrated: boolean;
  magX: number | null;
  magY: number | null;
  magZ: number | null;
};

export type Assessment = {
  status: Decision;
  score: number | null;
  confidence: number;
  usable: boolean;
  reasons: string[];
  explanation: string;
};

export type LogEvent = {
  id: string;
  kind: string;
  at: string;
  detail: string;
  source: 'simulated' | 'api' | 'local';
};

export const SCENARIOS: { id: Scenario; label: string; description: string }[] = [
  { id: 'nominal', label: "normal duty", description: "Stable synthetic telemetry" },
  { id: 'moderate_exertion', label: 'Fiziksel efor', description: "Change in movement and pulse" },
  { id: 'high_motion', label: "intense movement", description: "No evaluation due to movement" },
  { id: 'poor_signal', label: "low signal", description: "Unreliable sensor data" },
  { id: 'stale_data', label: "delayed package", description: "outdated data" },
  { id: 'future_data', label: "Future tense package", description: "Device time is incompatible: suggestion is not generated" },
  { id: 'missing_reading', label: "Missing sensor readings", description: "No pulse and SpO₂: no recommendation generated" },
  { id: 'link_loss', label: "connection loss", description: 'Yeni telemetri paketi gelmez' },
];

export const CONFIDENCE_REASONS: Record<string,string> = {
  stale_packet: "Measurement is out of date (exceeded 5 seconds)",
  future_timestamp: "Measurement time in the future (check clock synchronization)",
  low_signal_quality: "Signal quality is poor",
  excessive_motion: "Uncertainty due to movement is high",
  missing_sensor_reading: "No valid sensor reading",
};
export const describeConfidenceReason = (reason: string): string => CONFIDENCE_REASONS[reason] || reason;

export const nowStamp = () => new Date().toISOString();

export function createDemoSample(scenario: Scenario, sequence: number, now = Date.now()): Sample | null {
  if (scenario === 'link_loss') return null;
  const phase = sequence * 0.57;
  const base = scenario === 'moderate_exertion' ? 106 :
    scenario === 'high_motion' ? 115 : 78;
  const heartRate = scenario === 'poor_signal' || scenario === 'missing_reading' ? null : Math.round(base + 3 * Math.sin(phase));
  const spo2 = scenario === 'poor_signal' || scenario === 'missing_reading' ? null : scenario === 'moderate_exertion' ? 97 : 98;
  const acceleration = scenario === 'high_motion' ? 2.32 : scenario === 'moderate_exertion' ? 1.41 : 1.03 + 0.04 * Math.cos(phase);
  const quality = scenario === 'poor_signal' ? 0.22 : scenario === 'high_motion' ? 0.75 : 0.96;
  const observedAt = new Date(now + (scenario === 'future_data' ? 12000 : scenario === 'stale_data' ? -12000 : 0)).toISOString();
  return { id: 'demo:' + sequence, deviceId: 'ASTRO-X-DEMO', sequence, observedAt,
    source: 'simulated', heartRate, spo2, acceleration, quality,
    temperatureC: null, pressureHpa: null, altitudeM: null, headingDeg: null,
    headingCalibrated: false, magX: null, magY: null, magZ: null };
}

export function assessSample(sample: Sample | null, selfCheck: CheckStatus | null, now = Date.now()): Assessment {
  if (!sample) return { status: 'abstain', score: null, confidence: 0, usable: false,
    reasons: ["No telemetry received yet"], explanation: "Measurements are awaited for evaluation." };

  // Same demo quality gate as backend. This value is not a medical risk score.
  const reasons: string[] = [];
  const age = now - new Date(sample.observedAt).getTime();
  const invalidQuality = !Number.isFinite(sample.quality) || sample.quality < 0 || sample.quality > 1;
  const invalidMotion = !Number.isFinite(sample.acceleration) || sample.acceleration < 0 || sample.acceleration > 16;
  if (!Number.isFinite(age)) reasons.push("Timestamp is invalid");
  else {
    if (age > 5000) reasons.push("Measurement is out of date");
    if (age < -2000) reasons.push("Measurement time appears in the future");
  }
  if (invalidQuality || sample.quality < 0.6) reasons.push("Signal quality is poor");
  if (invalidMotion || sample.acceleration > 2) reasons.push("Motion measurement affects reliability");
  if ((sample.heartRate === null || sample.heartRate <= 0) &&
      (sample.spo2 === null || sample.spo2 <= 0)) reasons.push("No valid physiological measurements");

  const quality = invalidQuality ? 0 : sample.quality;
  const movementFactor = invalidMotion || sample.acceleration > 2 ? 0.5 : 1;
  const freshnessFactor = !Number.isFinite(age) || age > 5000 || age < -2000 ? 0.2 : 1;
  const hasReading = (sample.heartRate !== null && sample.heartRate > 0) || (sample.spo2 !== null && sample.spo2 > 0);
  const confidence = Math.round(quality * movementFactor * freshnessFactor * (hasReading ? 1 : 0) * 1000) / 1000;
  if (reasons.length) return { status: 'abstain', score: null, confidence, usable: false, reasons,
    explanation: "No recommendations were produced. Check the quality of data, timeliness and sensor connection." };
  if (selfCheck === 'needs_help' || selfCheck === 'fatigued' || sample.acceleration > 1.3) {
    return { status: 'review', score: Math.round(confidence * 100), confidence, usable: true, reasons: [],
      explanation: "Movement or self-report change observed. Operator evaluation required." };
  }
  return { status: 'continue', score: Math.round(confidence * 100), confidence, usable: true, reasons: [],
    explanation: "Passed data quality checks. Monitoring continues; This is not a medical fitness decision." };
}

export function mapApiTelemetry(t: Record<string, unknown>): Sample {
  const num = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
  // The firmware sends 0 for unavailable BMP180 readings. A zero temperature
  // itself is valid; use pressure > 0 to distinguish missing BMP180 data.
  const pressure = num(t.pressure_hpa);
  const bmpAvailable = pressure !== null && pressure > 0;
  // Firmware sends an all-zero magnetometer vector when unavailable.
  // Heading 0° remains a valid direction when a nonzero horizontal vector exists.
  const rawMagX = num(t.mag_x_ut);
  const rawMagY = num(t.mag_y_ut);
  const rawMagZ = num(t.mag_z_ut);
  const magAvailable = rawMagX !== null && rawMagY !== null && rawMagZ !== null &&
    Math.hypot(rawMagX, rawMagY) > 0.01;
  const heading = num(t.heading_deg);
  return {
    id: String(t.device_id ?? 'device') + ':' + String(t.sequence ?? 0) + ':' + String(t.observed_at ?? ''),
    deviceId: String(t.device_id ?? '—'), sequence: Number(t.sequence ?? 0),
    observedAt: String(t.observed_at ?? ''),
    source: t.source === 'measured' ? 'measured' : 'simulated',
    heartRate: num(t.heart_rate_bpm) !== null && num(t.heart_rate_bpm)! > 0 ? num(t.heart_rate_bpm) : null,
    // Zero SpO₂ is not a measurement: the device may not yet detect a finger.
    spo2: num(t.spo2_pct) !== null && num(t.spo2_pct)! > 0 && num(t.spo2_pct)! <= 100 ? num(t.spo2_pct) : null,
    acceleration: num(t.acceleration_g) ?? 0, quality: num(t.signal_quality) ?? 0,
    temperatureC: bmpAvailable ? num(t.temperature_c) : null,
    pressureHpa: bmpAvailable ? pressure : null,
    altitudeM: bmpAvailable ? num(t.altitude_m) : null,
    headingDeg: magAvailable && heading !== null && heading >= 0 && heading <= 360 ? heading : null,
    headingCalibrated: t.heading_calibrated === true,
    magX: magAvailable ? rawMagX : null,
    magY: magAvailable ? rawMagY : null,
    magZ: magAvailable ? rawMagZ : null,
  };
}

export function compassDirection(degrees: number | null): string {
  if (degrees === null || !Number.isFinite(degrees)) return '—';
  const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return labels[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
}

// Live communication and measurement observation time are different things. ESP32 RTC
// It may be a few seconds behind the server time. Streaming, new packages
// tracked by time of arrival at the server/browser; HADSE time control remains the same.
export function isSensorStreamActive(sample: Sample | null, lastReceivedAt: number | null, now = Date.now()): boolean {
  if (!sample || sample.source !== 'measured' || lastReceivedAt === null) return false;
  const elapsed = now - lastReceivedAt;
  return Number.isFinite(elapsed) && elapsed >= -2000 && elapsed <= 6500;
}

export function isLiveMeasured(sample: Sample | null, now = Date.now()): boolean {
  if (!sample || sample.source !== 'measured') return false;
  const age = now - new Date(sample.observedAt).getTime();
  return Number.isFinite(age) && age >= -2000 && age <= 5000;
}

export function clockTime(dateIso: string): string {
  const date = new Date(dateIso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('en-US', { hour12: false, timeZone: 'UTC' }) + ' UTC';
}

export function ageSeconds(dateIso: string, now = Date.now()) {
  const age = now - new Date(dateIso).getTime();
  return Number.isFinite(age) ? Math.round(age / 1000) : null;
}
