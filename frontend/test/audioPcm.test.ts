import test from 'node:test';
import assert from 'node:assert/strict';
import {PCM_RATE,PCM_BLOCK,encodePcm8u,decodePcm8u,pcmVuPercent,Pcm8kPacketizer} from '../src/audioPcm.ts';

test('8kHz unsigned PCM fields are exactly specified',()=>{
 assert.equal(PCM_RATE,8000);assert.equal(PCM_BLOCK,256);
 assert.equal(encodePcm8u(-1),0);assert.equal(encodePcm8u(0),128);assert.equal(encodePcm8u(1),255);
});
test('received samples correctly map signed Float32 range',()=>{
 const values=decodePcm8u(new Uint8Array([0,64,128,192,255]));
 assert.equal(values[0],-1);assert.equal(values[2],0);
 assert.ok(Math.abs(values[3]-.5)<.00001);
});
test('A0 noise drives VU meter, silence stays at zero',()=>{
 assert.equal(pcmVuPercent(new Uint8Array(256).fill(128)),0);
 assert.ok(pcmVuPercent(new Uint8Array([0,255,0,255]))>80);
 assert.equal(pcmVuPercent(new Uint8Array()),0);
});
test('48kHz microphone resamples into whole 256-byte packets',()=>{
 const packetizer=new Pcm8kPacketizer(48000);
 const all:Uint8Array[]=[];
 const input=new Float32Array(48000);
 for(let i=0;i<input.length;i++)input[i]=Math.sin(2*Math.PI*440*i/48000);
 for(let i=0;i<input.length;i+=1024)
   all.push(...packetizer.feed(input.subarray(i,Math.min(input.length,i+1024))));
 assert.equal(all.length,31);
 assert.ok(all.every(x=>x.length===256));
 assert.ok(all.some(p=>p.some(s=>s>140||s<116)));
});
test('native 8kHz microphone yields exactly one frame per 256 samples',()=>{
 const packetizer=new Pcm8kPacketizer(8000);
 const a=packetizer.feed(new Float32Array(128));
 assert.equal(a.length,0);
 const b=packetizer.feed(new Float32Array(128));
 assert.equal(b.length,1);assert.equal(b[0].length,256);
 assert.deepEqual([...b[0]].every(x=>x===128),true);
});
test('input under 8 kHz is rejected',()=>{
 assert.throws(()=>new Pcm8kPacketizer(4000),/8 kHz/);
});
