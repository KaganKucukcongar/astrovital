import test from 'node:test';
import assert from 'node:assert/strict';
import {metres,turnInstruction,navStatusLabel,createNavProjector,type NavStatus} from '../src/astronavDomain.ts';

test("relative distance can be read, invalid distance is hidden",()=>{
 assert.equal(metres(10),'10.0 m');
 assert.equal(metres(1.25),'1.3 m');
 assert.equal(metres(null),'—');
 assert.equal(metres(Number.NaN),'—');
});
test("left, right, straight and unknown direction commands are separated",()=>{
 assert.equal(turnInstruction(0),"Continue straight");
 assert.equal(turnInstruction(16),"Continue straight");
 assert.match(turnInstruction(45),/right/i);
 assert.match(turnInstruction(-90),/left/i);
 assert.match(turnInstruction(175),/reverse|back/i);
 assert.equal(turnInstruction(null),"Direction could not be verified");
});
test("mode and arrival notification are separated",()=>{
 const empty={
  session_status:'idle',mode:'unavailable',device_id:null,demo:false,goal_type:'target',
 } as NavStatus;
 assert.match(navStatusLabel(empty),/not started/i);
 assert.match(navStatusLabel({...empty,session_status:'active',mode:'unavailable',demo:false}),/sensor/i);
 assert.match(navStatusLabel({...empty,session_status:'active',mode:'estimated',demo:false,goal_type:'tracking'}),/telemetry/i);
 assert.match(navStatusLabel({...empty,session_status:'active',mode:'estimated',demo:false,goal_type:'base'}),/base direction/i);
 assert.match(navStatusLabel({...empty,session_status:'completed',goal_type:'base'}),/base proximity/i);
});
test("2D coordinate projection preserves base and north direction at center",()=>{
 const project=createNavProjector([[0,0],[0,10],[3,4]]);
 const base=project([0,0]),north=project([0,10]);
 assert.ok(base.every(Number.isFinite));
 assert.ok(north[1]<base[1], "North should appear above the screen");
 assert.ok(project([5,0])[0]>base[0], "East should appear on the right");
});
test("Safe projection also on single-point or empty route lists",()=>{
 const project=createNavProjector([]);
 assert.deepEqual(project([0,0]),[250,135]);
});
