export type Source = 'simulated' | 'measured';
export type Scenario = 'nominal' | 'moderate_exertion' | 'high_motion' | 'poor_signal' | 'stale_data' | 'future_data' | 'missing_reading' | 'link_loss';
export type Decision = 'continue' | 'review' | 'abstain';
export type CheckStatus = 'okay' | 'fatigued' | 'needs_help';
export type Page = 'overview' | 'telemetry' | 'hadse' | 'voice' | 'blackbox' | 'sensors' | 'notifications' | 'settings';

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
  { id: 'nominal', label: 'Normal görev', description: 'Kararlı sentetik telemetri' },
  { id: 'moderate_exertion', label: 'Fiziksel efor', description: 'Hareket ve nabızda değişim' },
  { id: 'high_motion', label: 'Yoğun hareket', description: 'Hareket nedeniyle değerlendirme yapılmaz' },
  { id: 'poor_signal', label: 'Düşük sinyal', description: 'Güvenilmez sensör verisi' },
  { id: 'stale_data', label: 'Gecikmiş paket', description: 'Güncelliğini kaybetmiş veri' },
  { id: 'future_data', label: 'Gelecek zamanlı paket', description: 'Cihaz saati uyumsuz: öneri üretilmez' },
  { id: 'missing_reading', label: 'Eksik sensör okumaları', description: 'Nabız ve SpO₂ yok: öneri üretilmez' },
  { id: 'link_loss', label: 'Bağlantı kaybı', description: 'Yeni telemetri paketi gelmez' },
];

export const CONFIDENCE_REASONS: Record<string,string> = {
  stale_packet: 'Ölçüm güncel değil (5 saniyeyi aştı)',
  future_timestamp: 'Ölçüm zamanı gelecekte (saat senkronizasyonunu kontrol edin)',
  low_signal_quality: 'Sinyal kalitesi yetersiz',
  excessive_motion: 'Hareket kaynaklı belirsizlik yüksek',
  missing_sensor_reading: 'Geçerli sensör okuması yok',
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
    reasons: ['Henüz telemetri alınmadı'], explanation: 'Değerlendirme için ölçüm bekleniyor.' };

  // Backend ile aynı demo kalite kapısı. Bu değer tıbbi risk skoru değildir.
  const reasons: string[] = [];
  const age = now - new Date(sample.observedAt).getTime();
  const invalidQuality = !Number.isFinite(sample.quality) || sample.quality < 0 || sample.quality > 1;
  const invalidMotion = !Number.isFinite(sample.acceleration) || sample.acceleration < 0 || sample.acceleration > 16;
  if (!Number.isFinite(age)) reasons.push('Zaman damgası geçersiz');
  else {
    if (age > 5000) reasons.push('Ölçüm güncel değil');
    if (age < -2000) reasons.push('Ölçüm zamanı gelecekte görünüyor');
  }
  if (invalidQuality || sample.quality < 0.6) reasons.push('Sinyal kalitesi yetersiz');
  if (invalidMotion || sample.acceleration > 2) reasons.push('Hareket ölçümü güvenilirliği etkiliyor');
  if ((sample.heartRate === null || sample.heartRate <= 0) &&
      (sample.spo2 === null || sample.spo2 <= 0)) reasons.push('Geçerli fizyolojik ölçüm yok');

  const quality = invalidQuality ? 0 : sample.quality;
  const movementFactor = invalidMotion || sample.acceleration > 2 ? 0.5 : 1;
  const freshnessFactor = !Number.isFinite(age) || age > 5000 || age < -2000 ? 0.2 : 1;
  const hasReading = (sample.heartRate !== null && sample.heartRate > 0) || (sample.spo2 !== null && sample.spo2 > 0);
  const confidence = Math.round(quality * movementFactor * freshnessFactor * (hasReading ? 1 : 0) * 1000) / 1000;
  if (reasons.length) return { status: 'abstain', score: null, confidence, usable: false, reasons,
    explanation: 'Öneri üretilmedi. Verinin kalitesini, zamanını ve sensör bağlantısını kontrol edin.' };
  if (selfCheck === 'needs_help' || selfCheck === 'fatigued' || sample.acceleration > 1.3) {
    return { status: 'review', score: Math.round(confidence * 100), confidence, usable: true, reasons: [],
      explanation: 'Hareket veya öz bildirim değişimi gözlemlendi. Operatör değerlendirmesi gerekli.' };
  }
  return { status: 'continue', score: Math.round(confidence * 100), confidence, usable: true, reasons: [],
    explanation: 'Veri kalite kontrollerini geçti. İzleme sürdürülüyor; bu tıbbi uygunluk kararı değildir.' };
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
    // Sıfır SpO₂ bir ölçüm değildir: cihaz henüz parmak algılamıyor olabilir.
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
  const labels = ['K', 'KD', 'D', 'GD', 'G', 'GB', 'B', 'KB'];
  return labels[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
}

// Canlı iletişim ile olçümün gözlem zamanı farklı şeylerdir. ESP32 RTC'si
// sunucu saatinden birkaç saniye geride olabilir. Akış, yeni paketlerin
// sunucu/tarayıcıya ulaşma zamanına göre izlenir; HADSE zaman kontrolü aynı kalır.
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
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('tr-TR', { hour12: false, timeZone: 'UTC' }) + ' UTC';
}

export function ageSeconds(dateIso: string, now = Date.now()) {
  const age = now - new Date(dateIso).getTime();
  return Number.isFinite(age) ? Math.round(age / 1000) : null;
}
