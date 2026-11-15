import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBearing,relativeTurn,rotateWorldToDeviceUp,
        bearingFromWorldPoints,createNavProjector,type Point} from '../src/astronavDomain.ts';

const close=(a:number,b:number,eps=1e-8)=>assert.ok(Math.abs(a-b)<eps,
  'expected '+a+' to equal '+b);

test('kuzey yukarıda K üst, G alt, D sağ, B sol',()=>{
  const origin:Point=[0,0];
  const project=createNavProjector([origin,[0,10],[0,-10],[10,0],[-10,0]]);
  const middle=project(origin);
  assert.ok(project([0,10])[1]<middle[1],'north must point upward');
  assert.ok(project([0,-10])[1]>middle[1],'south must point downward');
  assert.ok(project([10,0])[0]>middle[0],'east must point right');
  assert.ok(project([-10,0])[0]<middle[0],'west must point left');
});

test('manyetik yön dört ana doğrultuda: 0 K, 90 D, 180 G, 270 B',()=>{
  close(bearingFromWorldPoints([0,0],[0,10])!,0);
  close(bearingFromWorldPoints([0,0],[10,0])!,90);
  close(bearingFromWorldPoints([0,0],[0,-10])!,180);
  close(bearingFromWorldPoints([0,0],[-10,0])!,270);
});

test('OLED göreli açı, mutlak hedef ve cihaz pusulası farkıdır',()=>{
  close(relativeTurn(0,0),0);
  close(relativeTurn(90,0),90);
  close(relativeTurn(0,90),-90);
  close(relativeTurn(0,180),-180);
  close(relativeTurn(0,270),90);
  close(relativeTurn(145.8,107.6),38.2);
});

test('cihaz yukarı dönüştürmesinde kuzey sola, güney sağa geçer (cihaz doğuya bakıyor)',()=>{
  const origin:Point=[0,0];
  const north=rotateWorldToDeviceUp([0,10],origin,90);
  const south=rotateWorldToDeviceUp([0,-10],origin,90);
  const east=rotateWorldToDeviceUp([10,0],origin,90);
  close(north[0],-10);close(north[1],0);
  close(south[0],10);close(south[1],0);
  close(east[0],0);close(east[1],10);
});

test('canlı 107,6 cihaz / 145,8 hedef: harita ve OLED açısı eşleşir',()=>{
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

test('cihaz yönü 360 ve 0 aynı, negatif yönler de normalize olur',()=>{
  close(normalizeBearing(-90),270);
  close(normalizeBearing(360),0);
  close(relativeTurn(270,360),-90);
  const east=rotateWorldToDeviceUp([10,0],[0,0],450);
  close(east[0],0);close(east[1],10);
});

test('cihaz merkezli dönüş konumu uydurmaz: yol uzunluğu korunur',()=>{
  const origin:Point=[3,-6],point:Point=[6,2];
  for(const heading of [0,30,107.6,180,270]){
    const v=rotateWorldToDeviceUp(point,origin,heading);
    close(Math.hypot(...v),Math.hypot(point[0]-origin[0],point[1]-origin[1]));
  }
});
