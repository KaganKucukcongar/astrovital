import test from 'node:test';
import assert from 'node:assert/strict';
import { nextApiConnection } from '../src/apiConnectivity.ts';

test('single timeout retains online state, next successful poll resets failures', () => {
  const one=nextApiConnection({online:true,consecutiveFailures:0},false);
  assert.equal(one.online,true);
  assert.equal(one.consecutiveFailures,1);
  const recovered=nextApiConnection(one,true);
  assert.deepEqual(recovered,{online:true,consecutiveFailures:0});
});
test('three consecutive failed polls mark API offline', () => {
  const a=nextApiConnection({online:true,consecutiveFailures:0},false);
  const b=nextApiConnection(a,false);
  const c=nextApiConnection(b,false);
  assert.equal(b.online,true);
  assert.equal(c.online,false);
  assert.equal(nextApiConnection(c,true).online,true);
});
test('startup stays offline before first confirmed response',()=>{
  assert.equal(nextApiConnection({online:false,consecutiveFailures:0},false).online,false);
  assert.equal(nextApiConnection({online:false,consecutiveFailures:1},true).online,true);
});
