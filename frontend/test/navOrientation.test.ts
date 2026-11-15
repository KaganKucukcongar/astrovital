import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBearing,relativeTurn,rotateWorldToDeviceUp,
        bearingFromWorldPoints,createNavProjector,type Point} from '../src/astronavDomain.ts';

const close=(a:number,b:number,eps=1e-8)=>assert.ok(Math.abs(a-b)<eps,
  'expected '+a+' to equal '+b);

test("north above, N top, S bottom, E right, W left",()=>{
  const origin:Point=[0,0];
  const project=createNavProjector([origin,[0,10],[0,-10],[10,0],[-10,0]]);
  const middle=project(origin);
  assert.ok(project([0,10])[1]<middle[1],'north must point upward');
  assert.ok(project([0,-10])[1]>middle[1],'south must point downward');
  assert.ok(project([10,0])[0]>middle[0],'east must point right');
  assert.ok(project([-10,0])[0]<middle[0],'west must point left');
});

test("magnetic direction in four cardinal directions: 0 N, 90 E, 180 S, 270 W",()=>{
  close(bearingFromWorldPoints([0,0],[0,10])!,0);
  close(bearingFromWorldPoints([0,0],[10,0])!,90);
  close(bearingFromWorldPoints([0,0],[0,-10])!,180);
  close(bearingFromWorldPoints([0,0],[-10,0])!,270);
});

test("OLED is the difference of relative angle, absolute target and device compass",()=>{
  close(relativeTurn(0,0),0);
  close(relativeTurn(90,0),90);
  close(relativeTurn(0,90),-90);
  close(relativeTurn(0,180),-180);
  close(relativeTurn(0,270),90);
  close(relativeTurn(145.8,107.6),38.2);
});

test("In the device up conversion, north moves to the left, south moves to the right (device facing east)",()=>{
  const origin:Point=[0,0];
  const north=rotateWorldToDeviceUp([0,10],origin,90);
  const south=rotateWorldToDeviceUp([0,-10],origin,90);
  const east=rotateWorldToDeviceUp([10,0],origin,90);
  close(north[0],-10);close(north[1],0);
  close(south[0],10);close(south[1],0);
  close(east[0],0);close(east[1],10);
});

test("live 107.6 device / 145.8 target: map and OLED angle match",()=>{
  const position:Point=[7.869,-1.025];
  const goal:Point=[9.432,-3.322];
  const device=107.6;
  const absolute=bearingFromWorldPoints(position,goal)!;
  const viewTarget=rotateWorldToDeviceUp(goal,position,device);
  const measuredViewBearing=bearingFromWorldPoints([0,0],viewTarget)!;
  const expected=normalizeBearing(absolute-device);
  close(measuredViewBearing,expected);
  close(relativeTurn(absolute,device),expected,1e-8);
  assert.ok(Math.abs(expected-38.2)<0.2,expected.toString());
});

test("device direction 360 and 0 are the same, negative directions are also normalized",()=>{
  close(normalizeBearing(-90),270);
  close(normalizeBearing(360),0);
  close(relativeTurn(270,360),-90);
  const east=rotateWorldToDeviceUp([10,0],[0,0],450);
  close(east[0],0);close(east[1],10);
});

test("does not match device-centered rotation position: path length is preserved",()=>{
  const origin:Point=[3,-6],point:Point=[6,2];
  for(const heading of [0,30,107.6,180,270]){
    const v=rotateWorldToDeviceUp(point,origin,heading);
    close(Math.hypot(...v),Math.hypot(point[0]-origin[0],point[1]-origin[1]));
  }
});
