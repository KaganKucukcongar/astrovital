import test from 'node:test';
import assert from 'node:assert/strict';
import {formatDemoCallDuration,demoCallPhaseLabel,VOICE_TARGETS} from '../src/voiceCallModel.ts';

test('çağrı sayacı saniye ve dakika biçiminde ilerler',()=>{
 assert.equal(formatDemoCallDuration(0),'00:00');
 assert.equal(formatDemoCallDuration(9),'00:09');
 assert.equal(formatDemoCallDuration(67),'01:07');
 assert.equal(formatDemoCallDuration(600),'10:00');
});
test('negatif veya geçersiz sayaç değerleri yanlış süre göstermez',()=>{
 assert.equal(formatDemoCallDuration(-2),'00:00');
 assert.equal(formatDemoCallDuration(NaN),'00:00');
});
test('gelen arama aşaması kullanıcıya demo olduğunu açıklar',()=>{
 assert.equal(demoCallPhaseLabel('ringing','incoming'),'Gelen demo çağrı');
});
test('görüşme durumları açık ve farklı etiketlenir',()=>{
 assert.match(demoCallPhaseLabel('dialing','outgoing'),/DEMO/);
 assert.match(demoCallPhaseLabel('connected','outgoing'),/simülasyonu/);
 assert.match(demoCallPhaseLabel('ended','incoming'),/sonlandırıldı/);
});
test('bütün hedefler sanal hat kimliği taşır',()=>{
 for(const key of ['mission','eva','earth'] as const){
   assert.ok(VOICE_TARGETS[key].label.length>=6);
   assert.ok(VOICE_TARGETS[key].code.length>=5);
 }
});
