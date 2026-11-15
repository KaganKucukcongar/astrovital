import test from 'node:test';
import assert from 'node:assert/strict';
import {metres,turnInstruction,navStatusLabel,createNavProjector,type NavStatus} from '../src/astronavDomain.ts';

test('göreli mesafe okunabilir, geçersiz mesafe gizlenir',()=>{
 assert.equal(metres(10),'10,0 m');
 assert.equal(metres(1.25),'1,3 m');
 assert.equal(metres(null),'—');
 assert.equal(metres(Number.NaN),'—');
});
test('sol, sağ, düz ve bilinmeyen yön komutları ayrılır',()=>{
 assert.equal(turnInstruction(0),'Düz devam');
 assert.equal(turnInstruction(16),'Düz devam');
 assert.match(turnInstruction(45),/sağa/i);
 assert.match(turnInstruction(-90),/Sola/i);
 assert.match(turnInstruction(175),/Geri/i);
 assert.equal(turnInstruction(null),'Yön doğrulanamadı');
});
test('mod ile varış bildirimi birbirinden ayrılır',()=>{
 const empty={
  session_status:'idle',mode:'unavailable',device_id:null,demo:false,goal_type:'target',
 } as NavStatus;
 assert.match(navStatusLabel(empty),/başlatılmadı/i);
 assert.match(navStatusLabel({...empty,session_status:'active',mode:'unavailable',demo:false}),/sensör/i);
 assert.match(navStatusLabel({...empty,session_status:'active',mode:'estimated',demo:false,goal_type:'tracking'}),/telemetri/i);
 assert.match(navStatusLabel({...empty,session_status:'active',mode:'estimated',demo:false,goal_type:'base'}),/üs yönü/i);
 assert.match(navStatusLabel({...empty,session_status:'completed',goal_type:'base'}),/Üs yakınlığı/i);
});
test('2D koordinat projeksiyonu merkezde üssü ve kuzey yönünü korur',()=>{
 const project=createNavProjector([[0,0],[0,10],[3,4]]);
 const base=project([0,0]),north=project([0,10]);
 assert.ok(base.every(Number.isFinite));
 assert.ok(north[1]<base[1], 'Kuzey ekranda yukarıda görünmeli');
 assert.ok(project([5,0])[0]>base[0], 'Doğu sağda görünmeli');
});
test('tek noktalı veya boş rota listesinde de güvenli projeksiyon',()=>{
 const project=createNavProjector([]);
 assert.deepEqual(project([0,0]),[250,135]);
});
