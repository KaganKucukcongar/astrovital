import {useCallback, useEffect, useRef, useState} from 'react';
import {PCM_BLOCK, PCM_RATE, Pcm8kPacketizer, decodePcm8u, pcmVuPercent} from './audioPcm';

type AudioStatus={esp32_connected:boolean;dashboard_connected:boolean};
const EMPTY:AudioStatus={esp32_connected:false,dashboard_connected:false};
const MICROPHONE_HINT='Mikrofon erişimi için Chrome adres çubuğuna chrome://flags/#unsafely-treat-insecure-origin-as-secure yazıp http://192.168.4.1:5173 adresini ekleyin. (Dinleme modu bu ayar olmadan da çalışır.)';
const STATUS_URL=`${window.location.protocol}//${window.location.hostname}:8000/api/v1/audio/status`;
const WS_URL=`${window.location.protocol==='https:'?'wss:':'ws:'}//${window.location.hostname}:8000/ws/audio?role=dashboard`;

async function getAudioStatus():Promise<AudioStatus>{
  const response=await fetch(STATUS_URL,{cache:'no-store',signal:AbortSignal.timeout(3500)});
  if(!response.ok)throw new Error('Ses durum servisi erişilemiyor');
  const data=await response.json() as Partial<AudioStatus>;
  return {esp32_connected:data.esp32_connected===true,dashboard_connected:data.dashboard_connected===true};
}

export function LiveRadioSummary({onOpen}: {onOpen:()=>void}) {
  const [status,setStatus]=useState<AudioStatus>(EMPTY);
  const [reachable,setReachable]=useState(false);
  useEffect(()=>{
    let alive=true;
    const poll=async()=>{
      try{const info=await getAudioStatus();if(alive){setStatus(info);setReachable(true)}}
      catch{if(alive){setStatus(EMPTY);setReachable(false)}}
    };
    void poll();
    const id=window.setInterval(()=>void poll(),3000);
    return()=>{alive=false;window.clearInterval(id)};
  },[]);
  return <div className="live-radio-summary">
    <div className="live-radio-row">
      <span className={'radio-indicator '+(status.esp32_connected?'is-online':'is-offline')}/>
      <strong>CANLI TELSİZ · 8 kHz PCM</strong>
    </div>
    <p>{!reachable?'Ses sunucusuna ulaşılamıyor':status.esp32_connected?'ESP32 ses soketi bağlı · Dinlemeye hazır':'ESP32 ses bağlantısı bekleniyor'}</p>
    <button className="radio-primary" type="button" onClick={onOpen}>Telsizi Aç</button>
    <small>Dinleme ve bas-konuş için gerçek WebSocket bağlantısı. Demo aramalar ayrı.</small>
  </div>;
}

export function LiveRadioPanel() {
  const [status,setStatus]=useState<AudioStatus>(EMPTY);
  const [serverReachable,setServerReachable]=useState(false);
  const [listening,setListening]=useState(false);
  const [socketConnected,setSocketConnected]=useState(false);
  const [pttActive,setPttActive]=useState(false);
  const [vu,setVu]=useState(0);
  const [error,setError]=useState('');
  const [micPermission,setMicPermission]=useState<'unknown'|'prompt'|'requesting'|'granted'|'denied'|'insecure'>('unknown');
  const [wsInfo,setWsInfo]=useState('Dinleme kapalı');
  const listeningRef=useRef(false);
  const socketRef=useRef<WebSocket|null>(null);
  const playbackRef=useRef<AudioContext|null>(null);
  const nextPlayTimeRef=useRef(0);
  const sourcesRef=useRef(new Set<AudioBufferSourceNode>());
  const lastRxRef=useRef(0);
  const pttHeldRef=useRef(false);
  const micTokenRef=useRef(0);
  const micStreamRef=useRef<MediaStream|null>(null);
  const micContextRef=useRef<AudioContext|null>(null);
  const micSourceRef=useRef<MediaStreamAudioSourceNode|null>(null);
  const micProcessorRef=useRef<ScriptProcessorNode|null>(null);
  const micSinkRef=useRef<GainNode|null>(null);

  const stopMic=useCallback(()=>{
    pttHeldRef.current=false;
    micTokenRef.current++;
    const processor=micProcessorRef.current;
    if(processor){processor.onaudioprocess=null;processor.disconnect();micProcessorRef.current=null}
    micSourceRef.current?.disconnect();micSourceRef.current=null;
    micSinkRef.current?.disconnect();micSinkRef.current=null;
    micStreamRef.current?.getTracks().forEach(track=>track.stop());micStreamRef.current=null;
    const ctx=micContextRef.current;micContextRef.current=null;
    if(ctx)void ctx.close().catch(()=>{});
    setPttActive(false);
  },[]);

  const disableListening=useCallback(()=>{
    stopMic();
    listeningRef.current=false;
    setListening(false);setSocketConnected(false);setWsInfo('Dinleme kapalı');setVu(0);
    const ws=socketRef.current;socketRef.current=null;
    if(ws){ws.onopen=null;ws.onclose=null;ws.onerror=null;ws.onmessage=null;ws.close()}
    for(const source of sourcesRef.current){try{source.stop()}catch{};source.disconnect()}
    sourcesRef.current.clear();
    nextPlayTimeRef.current=0;
    const ctx=playbackRef.current;playbackRef.current=null;
    if(ctx)void ctx.close().catch(()=>{});
  },[stopMic]);

  const enableListening=useCallback(async()=>{
    if(listeningRef.current)return;
    setError('');setWsInfo('Bağlanıyor...');
    try {
      // Browser autoplay policies require a click/touch before AudioContext.resume().
      const ctx=new AudioContext({sampleRate:PCM_RATE});
      playbackRef.current=ctx;
      await ctx.resume();
      if(!playbackRef.current || playbackRef.current!==ctx){await ctx.close();return}
      const ws=new WebSocket(WS_URL);
      ws.binaryType='arraybuffer';
      socketRef.current=ws;
      listeningRef.current=true;
      setListening(true);
      ws.onopen=()=>{if(socketRef.current===ws){setSocketConnected(true);setWsInfo('Telsiz bağlı · dinleniyor')}};
      ws.onerror=()=>{if(socketRef.current===ws)setError('WebSocket ses köprüsüne ulaşılamıyor.')};
      ws.onclose=()=>{
        if(socketRef.current!==ws)return;
        socketRef.current=null;
        listeningRef.current=false;setListening(false);setSocketConnected(false);
        setWsInfo('Ses bağlantısı koptu · yeniden açılabilir');
        stopMic();
        if(playbackRef.current===ctx){playbackRef.current=null;void ctx.close().catch(()=>{})}
      };
      ws.onmessage=(event:MessageEvent)=>{
        if(!(event.data instanceof ArrayBuffer) || socketRef.current!==ws)return;
        const packet=new Uint8Array(event.data);
        if(packet.length!==PCM_BLOCK)return;
        lastRxRef.current=performance.now();
        setVu(pcmVuPercent(packet));
        // A brief scheduled buffer prevents 32ms packets from clicking.
        // Trim latency after a stall rather than playing old queued audio.
        if(pttHeldRef.current)return; // Half-duplex radio prevents acoustic feedback.
        const outputCtx=playbackRef.current;
        if(!outputCtx || outputCtx.state!=='running')return;
        const samples=decodePcm8u(packet);
        const buffer=outputCtx.createBuffer(1,samples.length,PCM_RATE);
        buffer.copyToChannel(samples,0);
        const source=outputCtx.createBufferSource();
        source.buffer=buffer;
        source.connect(outputCtx.destination);
        const now=outputCtx.currentTime;
        if(nextPlayTimeRef.current<now+0.025 || nextPlayTimeRef.current>now+0.55)
          nextPlayTimeRef.current=now+0.042;
        source.onended=()=>{source.disconnect();sourcesRef.current.delete(source)};
        sourcesRef.current.add(source);
        source.start(nextPlayTimeRef.current);
        nextPlayTimeRef.current+=buffer.duration;
      };
    }catch(caught){
      const msg=caught instanceof Error?caught.message:'Dinleme başlatılamadı';
      setError('Ses dinleme başlatılamadı: '+msg);
      disableListening();
    }
  },[disableListening,stopMic]);

  // Explicit consent click. The temporary stream is closed immediately;
  // no audio is sent to ESP32 during the permission-check action.
  const requestMicrophonePermission=useCallback(async()=>{
    setError('');
    if(!window.isSecureContext || !navigator.mediaDevices?.getUserMedia){
      setMicPermission('insecure');
      setError(MICROPHONE_HINT);
      return;
    }
    setMicPermission('requesting');
    let stream:MediaStream|undefined;
    try {
      stream=await navigator.mediaDevices.getUserMedia({
        audio:{echoCancellation:true,noiseSuppression:true}
      });
      setMicPermission('granted');
    }catch(caught){
      const name=caught instanceof Error?caught.name:'';
      setMicPermission(name==='NotAllowedError'?'denied':'unknown');
      setError(name==='NotAllowedError'
        ? 'Mikrofon izni reddedildi. Chrome adres çubuğundaki site izinlerinden Mikrofon → İzin ver seçeneğini kullan.'
        : 'Mikrofon erişimi sağlanamadı: '+(caught instanceof Error?caught.message:'Bilinmeyen hata'));
    }finally{
      stream?.getTracks().forEach(track=>track.stop());
    }
  },[]);

  const startPTT=useCallback(async()=>{
    if(pttHeldRef.current)return;
    pttHeldRef.current=true;
    const token=++micTokenRef.current;
    setError('');
    // Request permission INSIDE user gesture. WebSocket handshake can finish later.
    if(!navigator.mediaDevices?.getUserMedia){
      setError(MICROPHONE_HINT);
      pttHeldRef.current=false;return;
    }
    let media:Promise<MediaStream>;
    try{media=navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}})}
    catch{setError(MICROPHONE_HINT);pttHeldRef.current=false;return}
    if(!listeningRef.current)void enableListening();
    try {
      const stream=await media;
      setMicPermission('granted');
      if(!pttHeldRef.current || token!==micTokenRef.current){
        stream.getTracks().forEach(t=>t.stop());return;
      }
      micStreamRef.current=stream;
      // Native recording rate is usually 48 kHz; Pcm8kPacketizer resamples
      // continuously to 8 kHz and emits precisely 256-byte Uint8Array frames.
      const context=new AudioContext();
      micContextRef.current=context;
      await context.resume();
      if(!pttHeldRef.current || token!==micTokenRef.current){stopMic();return}
      const src=context.createMediaStreamSource(stream);
      const processor=context.createScriptProcessor(1024,1,1);
      const silentSink=context.createGain();silentSink.gain.value=0;
      micSourceRef.current=src;micProcessorRef.current=processor;micSinkRef.current=silentSink;
      const packetizer=new Pcm8kPacketizer(context.sampleRate);
      processor.onaudioprocess=e=>{
        if(!pttHeldRef.current)return;
        const socket=socketRef.current;
        if(!socket || socket.readyState!==WebSocket.OPEN)return;
        for(const block of packetizer.feed(e.inputBuffer.getChannelData(0))){
          // Bounded send backlog: low-latency PTT is more useful than stale speech.
          if(socket.bufferedAmount < PCM_BLOCK*12)socket.send(block);
        }
        e.outputBuffer.getChannelData(0).fill(0);
      };
      src.connect(processor);processor.connect(silentSink);silentSink.connect(context.destination);
      setPttActive(true);
    }catch(caught){
      const name=caught instanceof DOMException?caught.name:'';
      if(name==='NotAllowedError')setMicPermission('denied');
      setError(name==='NotAllowedError'||name==='SecurityError'||!navigator.mediaDevices?.getUserMedia
        ? MICROPHONE_HINT
        : 'Mikrofon kullanılamadı: '+(caught instanceof Error?caught.message:'Bilinmeyen hata'));
      stopMic();
    }
  },[enableListening,stopMic]);

  useEffect(()=>{
    if(!window.isSecureContext || !navigator.mediaDevices?.getUserMedia){
      setMicPermission('insecure');
      return;
    }
    let disposed=false;
    // The permission query is informative only; real recording still needs
    // the user's click on "Mikrofon İznini İste".
    if(navigator.permissions?.query){
      void navigator.permissions.query({name:'microphone' as PermissionName})
        .then(permission=>{
          if(!disposed){
            setMicPermission(permission.state);
            permission.onchange=()=>{
              if(!disposed)setMicPermission(permission.state);
            };
          }
          if(disposed)permission.onchange=null;
        })
        .catch(()=>{if(!disposed)setMicPermission('prompt')});
    }else{
      setMicPermission('prompt');
    }
    return()=>{disposed=true};
  },[]);

  useEffect(()=>{
    let alive=true;
    const poll=async()=>{
      try{const info=await getAudioStatus();if(alive){setStatus(info);setServerReachable(true)}}
      catch{if(alive){setServerReachable(false);setStatus(EMPTY)}}
    };
    void poll();
    const interval=window.setInterval(()=>void poll(),2500);
    const levelInterval=window.setInterval(()=>{
      if(performance.now()-lastRxRef.current>500)setVu(0);
    },180);
    const onBlur=()=>stopMic();
    window.addEventListener('blur',onBlur);
    return()=>{
      alive=false;window.clearInterval(interval);window.clearInterval(levelInterval);
      window.removeEventListener('blur',onBlur);
      // Prevent audio, microphone or sockets surviving a component unmount.
      stopMic();
      const ws=socketRef.current;socketRef.current=null;
      if(ws){ws.onopen=null;ws.onclose=null;ws.onerror=null;ws.onmessage=null;ws.close()}
      for(const source of sourcesRef.current){try{source.stop()}catch{};source.disconnect()}
      sourcesRef.current.clear();
      const ctx=playbackRef.current;playbackRef.current=null;
      if(ctx)void ctx.close().catch(()=>{});
    };
  },[stopMic]);

  return <div className="live-radio-panel">
    <div className="live-radio-top">
      <div><span className="radio-eyebrow">ASTROVITAL X / GERÇEK SES KÖPRÜSÜ</span><h3>Sesli İletişim (Telsiz)</h3>
        <p>8.000 Hz · 8-bit unsigned mono PCM · 256 byte / 32 ms · WebSocket</p></div>
      <span className="radio-live-badge">YEREL AĞ</span>
    </div>
    <div className="live-radio-status-grid">
      <div><span className={'radio-indicator '+(serverReachable?'is-online':'is-offline')}/><b>FastAPI</b><small>{serverReachable?'Ses servisi hazır':'Bağlantı yok'}</small></div>
      <div><span className={'radio-indicator '+(status.esp32_connected?'is-online':'is-offline')}/><b>ESP32</b><small>{status.esp32_connected?'Ses WebSocket bağlı':'Cihaz bekleniyor'}</small></div>
      <div><span className={'radio-indicator '+(socketConnected?'is-online':'is-offline')}/><b>Dashboard</b><small>{socketConnected?'Canlı ses kanalı açık':'Dinleme kapalı'}</small></div>
    </div>
    <div className="live-radio-listening">
      <div className="live-radio-section-title"><b>Dinleme Modu</b><span>{wsInfo}</span></div>
      <div className="live-radio-controls">
        <button className={listening?'radio-secondary':'radio-primary'} type="button"
          onClick={()=>listening?disableListening():void enableListening()}>
          {listening?'Sesi Kapat':'Sesi Aç'}
        </button>
        <span className="live-radio-speaker-note">Gelen A0 PCM verisi doğrudan hoparlörde çalınır. PTT sırasında dinleme geçici olarak duraklar.</span>
      </div>
      <div className="live-radio-vu-heading"><span>SES SEVİYESİ · VU METRE</span><span>{vu}%</span></div>
      <div className="live-radio-vu-track" role="progressbar" aria-label="Gelen ses seviyesi" aria-valuenow={vu} aria-valuemin={0} aria-valuemax={100}>
        <span className="live-radio-vu-fill" style={{width:vu+'%'}}/>
      </div>
      <small className="live-radio-muted-hint">Cihazdan veri gelirken A0 pinindeki parazit/cızırtı da ses düzeyinde ve hoparlörde izlenebilir.</small>
    </div>
    <div className="live-radio-ptt">
      <div className="live-radio-section-title"><b>Bas-Konuş (PTT)</b><span className={pttActive?'radio-transmitting':''}>{pttActive?'MİKROFON AKTİF · GÖNDERİLİYOR':'Basılı tutarak yayın yap'}</span></div>
      <div className="radio-mic-permission">
        <div>
          <strong>Mikrofon izni</strong>
          <span aria-live="polite" className={'radio-mic-state radio-mic-state-'+micPermission}>
            {micPermission==='granted'?'İzin verildi'
              :micPermission==='denied'?'İzin reddedildi'
              :micPermission==='insecure'?'Tarayıcı bu HTTP adresinde mikrofonu engelliyor'
              :micPermission==='requesting'?'Chrome izninizi bekliyor'
              : 'İzin bekleniyor'}
          </span>
        </div>
        <button type="button" className="radio-secondary radio-mic-permission-button"
          disabled={micPermission==='requesting'||pttActive}
          onClick={()=>void requestMicrophonePermission()}>
          {micPermission==='granted'?'Mikrofon İznini Tekrar Kontrol Et':'Mikrofon İznini İste'}
        </button>
      </div>
      {micPermission==='insecure' && <p className="radio-mic-security-warning">{MICROPHONE_HINT}</p>}
      <small className="radio-mic-consent-note">İzin düğmesi yalnızca Chrome'un onay penceresini açar. Test için açılan mikrofon hemen durdurulur; gerçek yayın sadece PTT'ye basılı tuttuğunda yapılır.</small>
      <button type="button" className={'radio-ptt-button '+(pttActive?'is-talking':'')}
        onMouseDown={e=>{if(e.button===0){e.preventDefault();void startPTT()}}}
        onMouseUp={stopMic} onMouseLeave={stopMic}
        onTouchStart={e=>{e.preventDefault();void startPTT()}}
        onTouchEnd={stopMic} onTouchCancel={stopMic}
        onKeyDown={e=>{if((e.key===' '||e.key==='Enter')&&!e.repeat){e.preventDefault();void startPTT()}}}
        onKeyUp={e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();stopMic()}}}
        aria-pressed={pttActive}>
        <span className="radio-ptt-icon">◉</span> {pttActive?'YAYIN AKTİF · BIRAKARAK BİTİR':'Konuşmak İçin Basılı Tut (PTT)'}
      </button>
      <small>Fare, dokunmatik ekran ve klavyeyle çalışır. Bırakıldığında mikrofon izi ve ses işleme kapatılır.</small>
    </div>
    {error && <div className="live-radio-error" role="alert">{error}</div>}
    <div className="live-radio-footer">Bu kanalda gerçek ses paketleri yerel ağ üzerinden iletilir; şifrelenmemiş WS bağlantısıdır. İzinsiz kaydedilmez, ancak güvenilir yerel ağ dışında kullanma.</div>
  </div>;
}
