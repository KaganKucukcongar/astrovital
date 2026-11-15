import test from 'node:test';
import assert from 'node:assert/strict';
import {selectOverviewMissionAnalysis} from '../src/calibrationOverview.ts';

const common={mode:'api' as const,apiOnline:true,sensorStreamActive:true,measurementUsable:true};
const anomaly={type:'spo2_down',recommendation:"Astronaut: Notify mission control and verify sensor.",confirmation:"Seen in 3 consecutive quality measurements",verified:false};
const monitoring={active:false,monitoring_enabled:true,phase:'finished',analysis_status:'normal',mission_recommendation:"Maintain monitoring within mission procedure.",current_anomaly:null};

test("Personal analysis and mission recommendation always visible when there are no anomalies",()=>{
 const s=selectOverviewMissionAnalysis(monitoring,common);
 assert.equal(s.state,'normal');assert.match(s.recommendation,/mission/i);
});
test("Active SpO₂ anomaly candidate is shown even if CSV is turned off",()=>{
 const s=selectOverviewMissionAnalysis({...monitoring,analysis_status:'anomaly',current_anomaly:anomaly},common);
 assert.equal(s.state,'anomaly');assert.equal(s.category,"Estimated SpO₂ drop");
 assert.match(s.recommendation,/mission control/i);
});
test("Pulse high and low deviation are given separate names",()=>{
 for(const [kind,label] of [['heart_rate_up',"Increased heart rate deviation"],['heart_rate_down',"Decrease in heart rate"]] as const) {
  const s=selectOverviewMissionAnalysis({...monitoring,analysis_status:'anomaly',current_anomaly:{...anomaly,type:kind}},common);
  assert.equal(s.category,label);
 }
});
test("consider invalid sensor data as normal or anomaly",()=>{
 const s=selectOverviewMissionAnalysis({...monitoring,analysis_status:'anomaly',current_anomaly:anomaly},
 {...common,measurementUsable:false});
 assert.equal(s.state,'quality_issue');
});
test("If there is no reference, don't say it's normal, but show a task suggestion.",()=>{
 const s=selectOverviewMissionAnalysis(null,common);
 assert.equal(s.state,'inactive');assert.ok(s.recommendation.length>30);
});
test("If the ESP32 data flow stops, the old anomaly is not presented as active",()=>{
 const s=selectOverviewMissionAnalysis({...monitoring,analysis_status:'anomaly',current_anomaly:anomaly},
 {...common,sensorStreamActive:false});
 assert.equal(s.state,'offline');
});
test("simulation and API errors are not personal live analysis",()=>{
 assert.equal(selectOverviewMissionAnalysis(monitoring,{...common,mode:'sim'}).state,'demo');
 assert.equal(selectOverviewMissionAnalysis(monitoring,{...common,apiOnline:false}).state,'offline');
});
test("status appears clearly incomplete while calibration is in progress",()=>{
 const s=selectOverviewMissionAnalysis({...monitoring,analysis_status:'calibrating'},common);
 assert.equal(s.state,'calibrating');
});
