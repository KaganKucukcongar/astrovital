import {useCallback, useEffect, useRef, useState} from 'react';
import {PCM_BLOCK, PCM_RATE, Pcm8kPacketizer, decodePcm8u, pcmVuPercent} from './audioPcm';

type AudioStatus={esp32_connected:boolean;dashboard_connected:boolean};
const EMPTY:AudioStatus={esp32_connected:false,dashboard_connected:false};
const MICROPHONE_HINT="For microphone access, type chrome://flags/#unsafely-treat-insecure-origin-as-secure in the Chrome address bar and add http://192.168.4.1:5173. (Listen mode also works without this setting.)";
const STATUS_URL=`${window.location.protocol}//${window.location.hostname}:8000/api/v1/audio/status`;
const WS_URL=`${window.location.protocol==='https:'?'wss:':'ws:'}//${window.location.hostname}:8000/ws/audio?role=dashboard`;

async function getAudioStatus():Promise<AudioStatus>{
  const response=await fetch(STATUS_URL,{cache:'no-store',signal:AbortSignal.timeout(3500)});
  if(!response.ok)throw new Error("Audio presence service cannot be accessed");
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
      <strong>LIVE RADIO · 8 kHz PCM</strong>
    </div>
    <p>{!reachable?"The audio server cannot be reached":status.esp32_connected?"ESP32 audio socket connected Ready to listen":"ESP32 audio connection expected"}</p>
    <button className="radio-primary" type="button" onClick={onOpen}>Turn On Radio</button>
    <small>True WebSocket connection for listening and push-to-talk. Demo calls are separate.</small>
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
  const [wsInfo,setWsInfo]=useState("Listening is off");
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
    setListening(false);setSocketConnected(false);setWsInfo("Listening is off");setVu(0);
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
    setError('');setWsInfo("Connecting...");
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
      ws.onopen=()=>{if(socketRef.current===ws){setSocketConnected(true);setWsInfo("Radio connected · listening")}};
      ws.onerror=()=>{if(socketRef.current===ws)setError("The WebSocket audio bridge cannot be reached.")};
      ws.onclose=()=>{
        if(socketRef.current!==ws)return;
        socketRef.current=null;
        listeningRef.current=false;setListening(false);setSocketConnected(false);
        setWsInfo("Audio connection lost can be reopened");
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
      const msg=caught instanceof Error?caught.message:"Listening could not be started";
      setError("Failed to start audio playback: "+msg);
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
        ? window.location.hostname.startsWith('127.')
          ? "Microphone permission denied. To request permission again, press the button and confirm in the AstroVital X permission window."
          : "Microphone permission denied. Allow for Microphone from Chrome site permissions."
        : "Failed to access microphone: "+(caught instanceof Error?caught.message:"unknown error"));
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
      setError(name==='NotAllowedError' && window.location.hostname.startsWith('127.')
        ? "Microphone permission denied. First, confirm with the AstroVital X microphone permission button."
        : name==='NotAllowedError'||name==='SecurityError'||!navigator.mediaDevices?.getUserMedia
          ? MICROPHONE_HINT
          : "Microphone could not be used: "+(caught instanceof Error?caught.message:"unknown error"));
      stopMic();
    }
  },[enableListening,stopMic]);

  useEffect(()=>{
    if(!window.isSecureContext || !navigator.mediaDevices?.getUserMedia){
      setMicPermission('insecure');
      return;
    }
    // Electron's trusted localhost may report "granted" to a permission
    // *query* before the person has approved any actual microphone capture.
    // Never label it approved until getUserMedia really succeeds.
    if(window.location.hostname.startsWith('127.') && window.location.port==='5173'){
      setMicPermission('prompt');
      return;
    }
    let disposed=false;
    // The permission query is informative only; real recording still needs
    // the user's click on "Request Microphone Permission".
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
      <div><span className="radio-eyebrow">ASTROVITAL X / LIVE AUDIO BRIDGE</span><h3>Voice Communication (Radio)</h3>
        <p>8.000 Hz · 8-bit unsigned mono PCM · 256 byte / 32 ms · WebSocket</p></div>
      <span className="radio-live-badge">LOCAL NETWORK</span>
    </div>
    <div className="live-radio-status-grid">
      <div><span className={'radio-indicator '+(serverReachable?'is-online':'is-offline')}/><b>FastAPI</b><small>{serverReachable?"Voice service ready":"no connection"}</small></div>
      <div><span className={'radio-indicator '+(status.esp32_connected?'is-online':'is-offline')}/><b>ESP32</b><small>{status.esp32_connected?"Audio WebSocket connected":"Waiting for device"}</small></div>
      <div><span className={'radio-indicator '+(socketConnected?'is-online':'is-offline')}/><b>Dashboard</b><small>{socketConnected?"Live audio channel is on":"Listening is off"}</small></div>
    </div>
    <div className="live-radio-listening">
      <div className="live-radio-section-title"><b>Listening Mode</b><span>{wsInfo}</span></div>
      <div className="live-radio-controls">
        <button className={listening?'radio-secondary':'radio-primary'} type="button"
          onClick={()=>listening?disableListening():void enableListening()}>
          {listening?'Sesi Kapat':"Turn up the volume"}
        </button>
        <span className="live-radio-speaker-note">Incoming A0 PCM data is played directly on the speaker. During PTT, listening pauses temporarily.</span>
      </div>
      <div className="live-radio-vu-heading"><span>SOUND LEVEL · VU METER</span><span>{vu}%</span></div>
      <div className="live-radio-vu-track" role="progressbar" aria-label="Incoming audio level" aria-valuenow={vu} aria-valuemin={0} aria-valuemax={100}>
        <span className="live-radio-vu-fill" style={{width:vu+'%'}}/>
      </div>
      <small className="live-radio-muted-hint">While data is coming from the device, noise/chill on the A0 pin can also be observed in the volume level and speaker.</small>
    </div>
    <div className="live-radio-ptt">
      <div className="live-radio-section-title"><b>Push to Talk (PTT)</b><span className={pttActive?'radio-transmitting':''}>{pttActive?"MICROPHONE ACTIVE · SENDING":"Broadcast by pressing and holding"}</span></div>
      <div className="radio-mic-permission">
        <div>
          <strong>Microphone permission</strong>
          <span aria-live="polite" className={'radio-mic-state radio-mic-state-'+micPermission}>
            {micPermission==='granted'?"permission granted"
              :micPermission==='denied'?"Permission denied"
              :micPermission==='insecure'?"Browser is blocking microphone at this HTTP address"
              :micPermission==='requesting'?'Chrome izninizi bekliyor'
              : "Waiting for permission"}
          </span>
        </div>
        <button type="button" className="radio-secondary radio-mic-permission-button"
          disabled={micPermission==='requesting'||pttActive}
          onClick={()=>void requestMicrophonePermission()}>
          {micPermission==='granted'?"Double-Check Microphone Permission":"Request Microphone Permission"}
        </button>
      </div>
      {micPermission==='insecure' && <p className="radio-mic-security-warning">{MICROPHONE_HINT}</p>}
      <small className="radio-mic-consent-note">The permission button just opens Chrome's confirmation window. The microphone turned on for testing is stopped immediately; The actual broadcast is made only by pressing and holding PTT.</small>
      <button type="button" className={'radio-ptt-button '+(pttActive?'is-talking':'')}
        onMouseDown={e=>{if(e.button===0){e.preventDefault();void startPTT()}}}
        onMouseUp={stopMic} onMouseLeave={stopMic}
        onTouchStart={e=>{e.preventDefault();void startPTT()}}
        onTouchEnd={stopMic} onTouchCancel={stopMic}
        onKeyDown={e=>{if((e.key===' '||e.key==='Enter')&&!e.repeat){e.preventDefault();void startPTT()}}}
        onKeyUp={e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();stopMic()}}}
        aria-pressed={pttActive}>
        <span className="radio-ptt-icon">◉</span> {pttActive?"BROADCAST ACTIVE · END BY LEAVING":"Hold to Talk (PTT)"}
      </button>
      <small>Works with mouse, touch screen and keyboard. When released, the microphone track and audio processing are turned off.</small>
    </div>
    {error && <div className="live-radio-error" role="alert">{error}</div>}
    <div className="live-radio-footer">In this channel, actual voice packets are transmitted over the local network; It is an unencrypted WS connection. Not recorded without permission, but do not use outside of trusted local network.</div>
  </div>;
}
