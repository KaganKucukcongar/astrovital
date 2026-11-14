import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoSample, assessSample, mapApiTelemetry, isLiveMeasured } from '../src/domain.ts';

test('demo verisi gerçek ölçüm olarak etiketlenmez', () => {
  const packet = createDemoSample('nominal', 1, 1000000);
  assert.equal(packet?.source, 'simulated');
});
test('sinyal bozuksa HADSE öneri vermez', () => {
  const sample = createDemoSample('poor_signal', 2, 1000000);
  assert.equal(assessSample(sample, null, 1000000).status, 'abstain');
});
test('yüksek hareket geçici duraksatma üretir', () => {
  const sample = createDemoSample('high_motion', 3, 1000000);
  assert.equal(assessSample(sample, null, 1000000).usable, false);
});
test('bağlantı kaybında hayali paket üretilmez', () => {
  assert.equal(createDemoSample('link_loss', 4), null);
});
test('eski telemetri güvenilir sayılmaz', () => {
  const sample = createDemoSample('stale_data', 5, 1000000);
  assert.equal(assessSample(sample, null, 1000000).status, 'abstain');
});
test('API kaynak türünü korur', () => {
  const t = mapApiTelemetry({ device_id: 'real-device', sequence: 1, observed_at: '2026-11-14T11:00:00Z', source: 'measured', heart_rate_bpm: 74, spo2_pct: 98, acceleration_g: 1.02, signal_quality: .9 });
  assert.equal(t.source, 'measured');
  assert.equal(t.heartRate, 74);
});

test('SpO2 sıfır gerçek doygunluk ölçümü sayılmaz', () => {
  const t = mapApiTelemetry({device_id:'esp32',sequence:12,observed_at:'2026-11-14T12:00:00Z',source:'measured',heart_rate_bpm:80,spo2_pct:0,acceleration_g:1,signal_quality:0.9});
  assert.equal(t.spo2, null);
  assert.equal(t.heartRate, 80);
});
test('yeni gerçek paket canlı sensör kabul edilir, demo paketi edilmez', () => {
  const t = mapApiTelemetry({device_id:'esp32',sequence:12,observed_at:'2026-11-14T12:00:00Z',source:'measured',heart_rate_bpm:80,spo2_pct:97,acceleration_g:1,signal_quality:0.9});
  assert.equal(isLiveMeasured(t, new Date('2026-11-14T12:00:03Z').getTime()), true);
  assert.equal(isLiveMeasured(t, new Date('2026-11-14T12:00:20Z').getTime()), false);
  assert.equal(isLiveMeasured({...t,source:'simulated'}, new Date('2026-11-14T12:00:03Z').getTime()), false);
});

test('gelecek zamanli paket yerel HADSE tarafindan reddedilir', () => {
  const packet = createDemoSample('future_data', 3, 1000000);
  const result = assessSample(packet, null, 1000000);
  assert.equal(result.status, 'abstain');
  assert.equal(result.usable, false);
  assert.ok(result.reasons.some(r => r.includes('gelecekte')));
});

test('eksik sensor okumasi hem puan hem oneriyi sifirlar', () => {
  const packet = createDemoSample('missing_reading', 3, 1000000);
  const result = assessSample(packet, null, 1000000);
  assert.equal(packet?.heartRate, null);
  assert.equal(packet?.spo2, null);
  assert.equal(result.status, 'abstain');
  assert.equal(result.confidence, 0);
});

test('gecersiz zaman damgasi kabul edilmez', () => {
  const packet = createDemoSample('nominal', 1, 1000000);
  assert.ok(packet);
  const result = assessSample({...packet!, observedAt: 'INVALID'}, null, 1000000);
  assert.equal(result.status, 'abstain');
});

test('API okumasi sifir degerli sensor girdilerini yok sayar', () => {
  const packet = mapApiTelemetry({device_id:'esp32',sequence:3,observed_at:'2026-11-14T12:00:00Z',source:'simulated',heart_rate_bpm:0,spo2_pct:0,acceleration_g:1,signal_quality:.95});
  const result = assessSample(packet, null, new Date('2026-11-14T12:00:00Z').getTime());
  assert.equal(result.status, 'abstain');
  assert.equal(result.confidence, 0);
});

test('eski gercek paket canli diye gosterilmez', () => {
  const packet = mapApiTelemetry({device_id:'esp32',sequence:7,observed_at:'2026-11-14T12:00:00Z',source:'measured',heart_rate_bpm:80,spo2_pct:97,acceleration_g:1,signal_quality:.95});
  assert.equal(isLiveMeasured(packet, new Date('2026-11-14T12:00:06Z').getTime()), false);
});
