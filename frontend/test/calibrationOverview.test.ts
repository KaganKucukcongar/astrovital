import test from 'node:test';
import assert from 'node:assert/strict';
import {selectOverviewMissionAnalysis} from '../src/calibrationOverview.ts';

const common={mode:'api' as const,apiOnline:true,sensorStreamActive:true,measurementUsable:true};
const anomaly={type:'spo2_down',recommendation:'Astronot: Görev kontrolüne bildir ve sensörü doğrula.',confirmation:'3 ardışık kaliteli ölçümde görüldü',verified:false};
const monitoring={active:false,monitoring_enabled:true,phase:'finished',analysis_status:'normal',mission_recommendation:'Görev prosedürü çerçevesinde izlemeyi sürdür.',current_anomaly:null};

test('anomali yokken kişisel analiz ve görev önerisi her zaman görünür',()=>{
 const s=selectOverviewMissionAnalysis(monitoring,common);
 assert.equal(s.state,'normal');assert.match(s.recommendation,/Görev/);
});
test('CSV kapalı olsa bile aktif SpO₂ anomali adayı gösterilir',()=>{
 const s=selectOverviewMissionAnalysis({...monitoring,analysis_status:'anomaly',current_anomaly:anomaly},common);
 assert.equal(s.state,'anomaly');assert.equal(s.category,'Tahmini SpO₂ düşüşü');
 assert.match(s.recommendation,/Görev kontrolüne/);
});
test('nabız yüksek ve düşük sapma ayrı adlarla verilir',()=>{
 for(const [kind,label] of [['heart_rate_up','Nabızda artış sapması'],['heart_rate_down','Nabızda düşüş sapması']] as const) {
  const s=selectOverviewMissionAnalysis({...monitoring,analysis_status:'anomaly',current_anomaly:{...anomaly,type:kind}},common);
  assert.equal(s.category,label);
 }
});
test('geçersiz sensör verisini normal ya da anomali sayma',()=>{
 const s=selectOverviewMissionAnalysis({...monitoring,analysis_status:'anomaly',current_anomaly:anomaly},
 {...common,measurementUsable:false});
 assert.equal(s.state,'quality_issue');
});
test('referans yoksa normal deme ama görev önerisi göster',()=>{
 const s=selectOverviewMissionAnalysis(null,common);
 assert.equal(s.state,'inactive');assert.ok(s.recommendation.length>30);
});
test('ESP32 veri akışı durursa eski anomali aktif diye sunulmaz',()=>{
 const s=selectOverviewMissionAnalysis({...monitoring,analysis_status:'anomaly',current_anomaly:anomaly},
 {...common,sensorStreamActive:false});
 assert.equal(s.state,'offline');
});
test('simülasyon ve API hataları kişisel canlı analiz değildir',()=>{
 assert.equal(selectOverviewMissionAnalysis(monitoring,{...common,mode:'sim'}).state,'demo');
 assert.equal(selectOverviewMissionAnalysis(monitoring,{...common,apiOnline:false}).state,'offline');
});
test('kalibrasyon sürerken durum açıkça eksik görünür',()=>{
 const s=selectOverviewMissionAnalysis({...monitoring,analysis_status:'calibrating'},common);
 assert.equal(s.state,'calibrating');
});
