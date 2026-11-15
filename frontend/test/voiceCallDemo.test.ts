import test from 'node:test';
import assert from 'node:assert/strict';
import {formatDemoCallDuration,demoCallPhaseLabel,VOICE_TARGETS} from '../src/voiceCallModel.ts';

test("call timer advances in seconds and minutes",()=>{
 assert.equal(formatDemoCallDuration(0),'00:00');
 assert.equal(formatDemoCallDuration(9),'00:09');
 assert.equal(formatDemoCallDuration(67),'01:07');
 assert.equal(formatDemoCallDuration(600),'10:00');
});
test("negative or invalid counter values ​​do not show incorrect duration",()=>{
 assert.equal(formatDemoCallDuration(-2),'00:00');
 assert.equal(formatDemoCallDuration(NaN),'00:00');
});
test("incoming call phase explains to the user that it is a demo",()=>{
 assert.equal(demoCallPhaseLabel('ringing','incoming'),"Incoming demo call");
});
test("conversation statuses are clearly and distinctly labeled",()=>{
 assert.match(demoCallPhaseLabel('dialing','outgoing'),/DEMO/);
 assert.match(demoCallPhaseLabel('connected','outgoing'),/simulation/i);
 assert.match(demoCallPhaseLabel('ended','incoming'),/end|terminat/i);
});
test("all targets carry virtual line ID",()=>{
 for(const key of ['mission','eva','earth'] as const){
   assert.ok(VOICE_TARGETS[key].label.length>=6);
   assert.ok(VOICE_TARGETS[key].code.length>=5);
 }
});
