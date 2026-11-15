// Interface prototype only: no real audio, microphone, network connection or call recording.
export type VoiceCallTarget = 'mission' | 'eva' | 'earth';
export type VoiceCallDirection = 'outgoing' | 'incoming';
export type VoiceCallPhase = 'dialing' | 'ringing' | 'connected' | 'ended';

export const VOICE_TARGETS: Record<VoiceCallTarget,{label:string;role:string;code:string}> = {
  mission:{label:"Local Mission Center",role:"Mars station · local operator",code:'MCC-LOCAL'},
  eva:{label:"EVA Crew",role:"Away team radio prototype",code:'EVA-TEAM'},
  earth:{label:"World Mission Control",role:"Remote connection simulation",code:'MCC-EARTH'},
};

export function formatDemoCallDuration(totalSeconds:number):string {
  const s=Math.max(0,Math.floor(Number.isFinite(totalSeconds)?totalSeconds:0));
  return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
}

export function demoCallPhaseLabel(phase:VoiceCallPhase,direction:VoiceCallDirection):string {
  if(phase==='dialing')return "Establishing connection · DEMO";
  if(phase==='ringing')return direction==='incoming'?"Incoming demo call":"Call waiting · DEMO";
  if(phase==='connected')return "Call simulation active";
  return "Demo call terminated";
}
