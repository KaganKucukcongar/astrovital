// Sadece arayüz prototipi: gerçek ses, mikrofon, ağ bağlantısı veya çağrı kaydı yoktur.
export type VoiceCallTarget = 'mission' | 'eva' | 'earth';
export type VoiceCallDirection = 'outgoing' | 'incoming';
export type VoiceCallPhase = 'dialing' | 'ringing' | 'connected' | 'ended';

export const VOICE_TARGETS: Record<VoiceCallTarget,{label:string;role:string;code:string}> = {
  mission:{label:'Yerel Görev Merkezi',role:'Mars istasyonu · yerel operatör',code:'MCC-LOCAL'},
  eva:{label:'EVA Mürettebatı',role:'Dış görev ekibi · telsiz prototipi',code:'EVA-TEAM'},
  earth:{label:'Dünya Görev Kontrol',role:'Uzaktan bağlantı · simülasyon',code:'MCC-EARTH'},
};

export function formatDemoCallDuration(totalSeconds:number):string {
  const s=Math.max(0,Math.floor(Number.isFinite(totalSeconds)?totalSeconds:0));
  return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
}

export function demoCallPhaseLabel(phase:VoiceCallPhase,direction:VoiceCallDirection):string {
  if(phase==='dialing')return 'Bağlantı kuruluyor · DEMO';
  if(phase==='ringing')return direction==='incoming'?'Gelen demo çağrı':'Çağrı bekleniyor · DEMO';
  if(phase==='connected')return 'Görüşme simülasyonu aktif';
  return 'Demo çağrı sonlandırıldı';
}
