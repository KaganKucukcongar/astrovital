import {useEffect, useRef, useState, type ReactNode} from 'react';
import {
  VOICE_TARGETS, demoCallPhaseLabel, formatDemoCallDuration,
  type VoiceCallDirection, type VoiceCallPhase, type VoiceCallTarget
} from './voiceCallModel';

// İkonlar yerel SVG ile çizilir. Mikrofon izni veya gerçek ses aktarımı yoktur.
function VoiceGlyph({name,size=19}:{name:'phone'|'mic'|'volume'|'end'|'close'|'radio'|'shield'|'clock'|'check';size?:number}) {
  const paths:Record<string,ReactNode>={
    phone:<path d="M22 16.8v3a2 2 0 0 1-2.2 2A19.7 19.7 0 0 1 2.2 4.2 2 2 0 0 1 4.2 2h3a2 2 0 0 1 2 1.7l.5 3a2 2 0 0 1-.6 1.7L7.2 10a16 16 0 0 0 6.8 6.8l1.6-1.9a2 2 0 0 1 1.7-.6l3 .5a2 2 0 0 1 1.7 2Z"/>,
    mic:<><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8"/></>,
    volume:<><path d="M11 5 6 9H2v6h4l5 4V5ZM15 9a5 5 0 0 1 0 6M18 6a9 9 0 0 1 0 12"/></>,
    end:<path d="M3 14a17 17 0 0 1 18 0l-2 4-4-2.1v-2.1a16 16 0 0 0-6 0v2.1L5 18l-2-4Z"/>,
    close:<path d="M18 6 6 18M6 6l12 12"/>,
    radio:<><circle cx="12" cy="12" r="2"/><path d="M7 7a7 7 0 0 0 0 10M17 7a7 7 0 0 1 0 10M3 3a12 12 0 0 0 0 18M21 3a12 12 0 0 1 0 18"/></>,
    shield:<><path d="M12 2 20 6v6c0 5-3.6 8-8 10-4.4-2-8-5-8-10V6Z"/><path d="m9 12 2 2 4-4"/></>,
    clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/></>,
    check:<path d="m4 12 5 5L20 6"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function VoiceCallPanel({compact=false,onStart}:{
  compact?:boolean;onStart:(target:VoiceCallTarget,direction:VoiceCallDirection)=>void;
}) {
  if(compact)return <div className="voice-quick-panel">
    <div className="voice-quick-status"><span className="voice-demo-dot"/><b>SESLİ GÖRÜŞME · DEMO</b><span>Yerel arayüz prototipi</span></div>
    <p>Mesajlaşma yerine görev merkezini veya EVA ekibini sesli çağrı arayüzüyle canlandırın.</p>
    <div className="voice-quick-actions">
      <button type="button" className="voice-call-primary" onClick={()=>onStart('mission','outgoing')}><VoiceGlyph name="phone" size={17}/> Görev Merkezini Ara</button>
      <button type="button" className="voice-call-secondary" onClick={()=>onStart('eva','outgoing')}>EVA Ekibi</button>
    </div>
    <small>Çağrı popup olarak açılır. Mikrofon veya gerçek iletişim kullanılmaz.</small>
  </div>;
  return <div className="voice-page">
    <div className="voice-page-hero">
      <div className="voice-hero-identity"><span className="voice-hero-icon"><VoiceGlyph name="radio" size={30}/></span><div><span className="voice-eyebrow">MARSUP / GÖREV İLETİŞİM AĞI</span><h2>Sesli İletişim Terminali</h2><p>Görev merkezi ile mürettebat arasındaki sesli aramanın görsel prototipi.</p></div></div>
      <span className="voice-demo-stamp">DEMO MODU</span>
    </div>
    <div className="voice-contact-grid">
      {(Object.keys(VOICE_TARGETS) as VoiceCallTarget[]).map(target=><div className="voice-contact-card" key={target}>
        <div className="voice-contact-head"><span className="voice-contact-avatar"><VoiceGlyph name={target==='earth'?'radio':'phone'} size={23}/></span><span className="voice-contact-pill">SANAL HAT</span></div>
        <strong>{VOICE_TARGETS[target].label}</strong>
        <p>{VOICE_TARGETS[target].role}</p>
        <span className="voice-contact-code">{VOICE_TARGETS[target].code}</span>
        <button type="button" className="voice-call-primary" onClick={()=>onStart(target,'outgoing')}><VoiceGlyph name="phone" size={17}/> Aramayı Başlat</button>
      </div>)}
    </div>
    <div className="voice-page-footer-grid">
      <div className="voice-information"><VoiceGlyph name="shield" size={23}/><div><strong>Güvenli demo davranışı</strong><p>Görüşme kuruldu, mikrofon açık ve hoparlör etkin göstergeleri yalnızca arayüz durumlarıdır. Gerçek ses, çağrı kaydı, telsiz veya internet bağlantısı yoktur.</p></div></div>
      <div className="voice-incoming-demo"><strong>Gelen çağrı görünümünü test et</strong><p>Görev merkezinden örnek bir çağrı gelsin. Açılan pencereden cevapla veya reddet.</p><button type="button" className="voice-call-secondary" onClick={()=>onStart('mission','incoming')}>Gelen Demo Çağrıyı Göster</button></div>
    </div>
  </div>;
}

export function VoiceCallModal({target,direction,onClose}:{
  target:VoiceCallTarget;direction:VoiceCallDirection;onClose:()=>void;
}) {
  const [phase,setPhase]=useState<VoiceCallPhase>(direction==='incoming'?'ringing':'dialing');
  const [seconds,setSeconds]=useState(0);
  const [micMuted,setMicMuted]=useState(false);
  const [speakerEnabled,setSpeakerEnabled]=useState(true);
  const closeRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    // Gerçek iletişim kurulmaz; 1.8 saniye sonra başarı durumu simüle edilir.
    if(direction!=='outgoing')return;
    const timer=window.setTimeout(()=>setPhase('connected'),1800);
    return ()=>window.clearTimeout(timer);
  },[direction]);
  useEffect(()=>{
    if(phase!=='connected')return;
    const timer=window.setInterval(()=>setSeconds(s=>s+1),1000);
    return ()=>window.clearInterval(timer);
  },[phase]);
  useEffect(()=>{
    closeRef.current?.focus();
    const handleKey=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose();};
    window.addEventListener('keydown',handleKey);
    const previous=document.body.style.overflow;
    document.body.style.overflow='hidden';
    return ()=>{window.removeEventListener('keydown',handleKey);document.body.style.overflow=previous;};
  },[onClose]);
  const remote=VOICE_TARGETS[target];
  const connected=phase==='connected';
  const ended=phase==='ended';
  return <div className="voice-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section className="voice-modal" role="dialog" aria-modal="true" aria-labelledby="voice-dialog-title" aria-describedby="voice-dialog-description">
      <header className="voice-modal-top"><span>ASTROVITAL X <b>· SESLİ İLETİŞİM</b></span><span className="voice-modal-demo">TAMAMEN DEMO</span><button type="button" className="voice-modal-close" ref={closeRef} onClick={onClose} aria-label="Arama penceresini kapat"><VoiceGlyph name="close" size={18}/></button></header>
      <div className="voice-modal-body">
        <div className="voice-modal-orbit"><div className={'voice-avatar-orbit voice-avatar-'+phase}><VoiceGlyph name="radio" size={39}/></div></div>
        <span className={'voice-call-status voice-status-'+phase}><span className="voice-demo-dot"/>{demoCallPhaseLabel(phase,direction)}</span>
        <h2 id="voice-dialog-title">{remote.label}</h2>
        <p id="voice-dialog-description">{remote.role} · {remote.code}</p>
        <div className="voice-call-timer"><VoiceGlyph name="clock" size={15}/>{connected||ended?formatDemoCallDuration(seconds):'00:00'}</div>
        <div className="voice-call-waveform" aria-hidden="true">{Array.from({length:22},(_,i)=><span key={i} style={{height:(8+(i*19)%31)+'px'}}/>)}</div>
        <p className="voice-call-privacy">Ses iletilmiyor. Mikrofon ve hoparlör düğmeleri yalnızca görsel simülasyondur.</p>
      </div>
      {phase==='ringing'?<div className="voice-incoming-actions">
        <button type="button" className="voice-call-decline" onClick={()=>setPhase('ended')}><VoiceGlyph name="end"/> Reddet</button>
        <button type="button" className="voice-call-accept" onClick={()=>setPhase('connected')}><VoiceGlyph name="phone"/> Yanıtla</button>
      </div>:ended?<div className="voice-call-ended-actions">
        <p>Demo görüşme sonlandırıldı</p>
        <button type="button" className="voice-call-primary" onClick={onClose}>Pencereyi Kapat</button>
      </div>:<div className="voice-modal-controls">
        <button type="button" className={'voice-control '+(micMuted?'voice-control-off':'')} disabled={!connected} aria-pressed={micMuted} onClick={()=>setMicMuted(v=>!v)}><VoiceGlyph name="mic"/><span>{micMuted?'Mikrofon kapalı':'Mikrofon açık'}</span></button>
        <button type="button" className={'voice-control '+(!speakerEnabled?'voice-control-off':'')} disabled={!connected} aria-pressed={!speakerEnabled} onClick={()=>setSpeakerEnabled(v=>!v)}><VoiceGlyph name="volume"/><span>{speakerEnabled?'Hoparlör açık':'Hoparlör kapalı'}</span></button>
        <button type="button" className="voice-control voice-control-end" onClick={()=>setPhase('ended')}><VoiceGlyph name="end"/><span>Aramayı Bitir</span></button>
      </div>}
      <div className="voice-modal-bottom">SIMULATION ONLY <span>NO AUDIO · NO WEBRTC · NO RECORDING</span></div>
    </section>
  </div>;
}
