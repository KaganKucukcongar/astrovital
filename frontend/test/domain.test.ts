import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoSample, assessSample, mapApiTelemetry, isLiveMeasured, isSensorStreamActive, compassDirection } from '../src/domain.ts';

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

test('ESP32 çevre ve pusula ölçümleri API telemetrisinden alınır', () => {
  const t=mapApiTelemetry({device_id:'esp32',sequence:42,observed_at:'2026-11-14T17:20:00Z',
    source:'measured',heart_rate_bpm:70,spo2_pct:98,acceleration_g:1.1,signal_quality:0.9,
    temperature_c:23.7,pressure_hpa:1011.6,altitude_m:14.2,
    mag_x_ut:24.2,mag_y_ut:8.3,mag_z_ut:3.9,heading_deg:0,heading_calibrated:true});
  assert.equal(t.temperatureC,23.7);
  assert.equal(t.pressureHpa,1011.6);
  assert.equal(t.altitudeM,14.2);
  assert.equal(t.headingDeg,0);
  assert.equal(t.headingCalibrated,true);
  assert.equal(t.magX,24.2);
  assert.equal(t.magY,8.3);
  assert.equal(t.magZ,3.9);
});

test('BMP180 olmayan paketin 0 çevre değerleri gerçek ölçüm sayılmaz',()=>{
  const t=mapApiTelemetry({device_id:'esp32',sequence:15,source:'measured',
    observed_at:'2026-11-14T17:20:00Z',heart_rate_bpm:0,spo2_pct:0,
    acceleration_g:1.02,signal_quality:0,temperature_c:0,pressure_hpa:0,altitude_m:0,
    mag_x_ut:0,mag_y_ut:0,mag_z_ut:0,heading_deg:0,heading_calibrated:false});
  assert.equal(t.temperatureC,null);
  assert.equal(t.pressureHpa,null);
  assert.equal(t.altitudeM,null);
  assert.equal(t.headingDeg,null);
});

test('demo çevre verisi üretmez; 0 derece gerçek kuzeydir',()=>{
  const demo=createDemoSample('nominal',1);
  assert.equal(demo?.temperatureC,null);
  assert.equal(demo?.headingDeg,null);
  assert.equal(compassDirection(0),'K');
  assert.equal(compassDirection(45),'KD');
  assert.equal(compassDirection(180),'G');
  assert.equal(compassDirection(315),'KB');
});

test('4 saniye geriden gelen ESP32 zaman damgası akışı sahte koparmasın',()=>{
  const now=new Date('2026-11-14T20:00:00Z').getTime();
  const measured=mapApiTelemetry({device_id:'esp32',sequence:50,source:'measured',
    observed_at:'2026-11-14T19:59:53Z',heart_rate_bpm:80,spo2_pct:97,acceleration_g:1,signal_quality:0.9});
  assert.equal(isLiveMeasured(measured,now),false);
  assert.equal(isSensorStreamActive(measured,now-2000,now),true);
});
test('8 saniyeden uzun süre yeni paket yoksa ESP32 akışı bağlı görünmesin',()=>{
  const now=Date.now();
  const measured=mapApiTelemetry({device_id:'esp32',sequence:51,source:'measured',
    observed_at:new Date(now-4000).toISOString(),heart_rate_bpm:80,spo2_pct:97,acceleration_g:1,signal_quality:0.9});
  assert.equal(isSensorStreamActive(measured,now-8000,now),false);
  assert.equal(isSensorStreamActive(measured,null,now),false);
  assert.equal(isSensorStreamActive({...measured,source:'simulated'},now-500,now),false);
});
