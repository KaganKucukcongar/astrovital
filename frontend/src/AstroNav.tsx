import {useCallback,useEffect,useMemo,useState} from 'react';
import {
  createNavProjector,metres,navStatusLabel,turnInstruction,normalizeBearing,relativeTurn,rotateWorldToDeviceUp,bearingFromWorldPoints,
  type NavMode,type NavStatus,type Point
} from './astronavDomain';

async function fetchNavigation(apiBase:string):Promise<NavStatus>{
  const res=await fetch(apiBase+'/api/v1/navigation/status',{
    cache:'no-store',signal:AbortSignal.timeout(3500)
  });
  if(!res.ok)throw new Error(res.status===404?"AstroNav backend is not installed yet.":'Navigasyon API: HTTP '+res.status);
  return await res.json() as NavStatus;
}

function NavMap({state}:{state:NavStatus}){
  const [orientation,setOrientation]=useState<'north'|'device'>('north');
  const base:Point=state.base_m??[0,0];
  const pos:Point=state.position_m??base;
  const goal:Point=state.goal_m??base;
  const active=state.routes.find(r=>r.id===state.active_route_id);
  const heading=state.sensor_ready&&state.mode==='estimated'&&
    state.heading_deg!==null&&Number.isFinite(state.heading_deg)?state.heading_deg:null;
  const deviceUp=orientation==='device'&&heading!==null;
  const viewHeading=deviceUp?heading:0;
  const toView=(p:Point)=>rotateWorldToDeviceUp(p,pos,viewHeading);
  const world=[base,pos,goal,...state.track_m,...state.routes.flatMap(r=>r.waypoints_m)] as Point[];
  const project=createNavProjector(world.map(toView));
  const pt=(p:Point)=>project(toView(p)).map(n=>n.toFixed(1)).join(',');
  const path=(nodes:Point[])=>nodes.map(pt).join(' ');
  const [px,py]=project(toView(pos)),[bx,by]=project(toView(base)),[gx,gy]=project(toView(goal));
  const geometricBearing=bearingFromWorldPoints(pos,goal);
  // A completed mission has no active arrow; never infer direction from an
  // almost-zero position error once arrival is reported.
  const absoluteBearing=state.session_status==='active'&&
    state.remaining_m!==null&&state.remaining_m>0.85
    ?state.target_bearing_deg??geometricBearing:null;
  const relativeBearing=absoluteBearing!==null&&heading!==null?relativeTurn(absoluteBearing,heading):null;
  const guidanceValid=state.session_status==='active'&&state.sensor_ready&&state.mode==='estimated'&&
    state.turn_deg!==null&&Number.isFinite(state.turn_deg)&&relativeBearing!==null;
  const OLEDturn=guidanceValid?state.turn_deg:null;
  const cardinal=([{label:'N',bearing:0},{label:'E',bearing:90},
                    {label:'S',bearing:180},{label:'W',bearing:270}] as const);
  const cardinalPosition=(bearing:number)=>{
    const rad=(bearing-viewHeading)*Math.PI/180;
    return [Math.sin(rad)*19,-Math.cos(rad)*19] as const;
  };
  return <div className="astronav-map-shell">
    <div className="astronav-map-top">
      <span>BIRD'S-EYE VIEW · RELATIVE COORDINATES</span>
      <div className="astronav-orientation-toggle" role="group" aria-label="Map direction">
        <button type="button" aria-pressed={orientation==='north'} onClick={()=>setOrientation('north')}>North Up</button>
        <button type="button" aria-pressed={orientation==='device'} disabled={heading===null}
          onClick={()=>setOrientation('device')}>Device Up</button>
      </div>
    </div>
    <svg viewBox="0 0 500 270" className="astronav-map-svg" role="img"
      aria-label="Relative track calculated from ESP32 step and compass; Not GPS or terrain map">
      <defs>
        <pattern id="astroNavGrid" width="25" height="25" patternUnits="userSpaceOnUse">
          <path d="M 25 0 L 0 0 0 25" stroke="#35536d" strokeOpacity=".22" strokeWidth="1" fill="none"/>
        </pattern>
        <radialGradient id="astroNavBaseGlow">
          <stop offset="0%" stopColor="#6ddfcf" stopOpacity=".28"/>
          <stop offset="100%" stopColor="#6ddfcf" stopOpacity="0"/>
        </radialGradient>
      </defs>
      <rect width="500" height="270" rx="7" fill="#0c1c30"/>
      <rect width="500" height="270" fill="url(#astroNavGrid)"/>
      <g fill="none" stroke="#537289" strokeOpacity=".22" strokeWidth="1">
        <circle cx="250" cy="135" r="42"/><circle cx="250" cy="135" r="95"/>
      </g>
      {state.routes.map((route,i)=>{
        const color=route.id==='A'?'#70dcd8':route.id==='B'?'#e6bd74':'#b5a1f2';
        const activeRoute=route.id===state.active_route_id;
        return <polyline key={route.id} points={path([pos,...route.waypoints_m])}
          fill="none" stroke={color} strokeWidth={activeRoute?3:1.5}
          strokeDasharray={activeRoute?'none':'5 7'} strokeOpacity={activeRoute?1:.55}
          strokeLinejoin="round" strokeLinecap="round"/>;
      })}
      {state.track_m.length>1&&<polyline points={path(state.track_m)} stroke="#39d9a4"
        strokeWidth="2.7" strokeDasharray="3 3" strokeLinecap="round" fill="none"/>}
      {active && active.waypoints_m.slice(0,-1).map((point,i)=>{
        const [x,y]=project(toView(point));
        return <g key={i}><circle cx={x} cy={y} r="5" fill="#d4ab68" stroke="#0a2034" strokeWidth="2"/>
          <text x={x+10} y={y-7} fill="#d5ac6d" fontSize="10">WP{i+1}</text></g>;
      })}
      <circle cx={bx} cy={by} r="31" fill="url(#astroNavBaseGlow)"/>
      <rect x={bx-9} y={by-9} width="18" height="18" rx="4" fill="#122a38" stroke="#79ecdb" strokeWidth="2"/>
      <path d={'M'+(bx-4)+' '+by+'h8M'+bx+' '+(by-4)+'v8'} stroke="#91ffe4" strokeWidth="1.5"/>
      <text x={bx+15} y={by+4} fill="#9de8d4" fontSize="11" fontWeight="700">BASE</text>
      {Math.hypot(gx-bx,gy-by)>6 && <g>
        <circle cx={gx} cy={gy} r="9" stroke="#f4c47b" strokeWidth="2" fill="#4c382b"/>
        <circle cx={gx} cy={gy} r="3" fill="#f4c47b"/>
        <text x={gx+12} y={gy-11} fill="#f6ce8b" fontSize="11">TARGET</text>
      </g>}
      <g transform={'translate('+px+' '+py+') rotate('+(heading===null?0:normalizeBearing(heading-viewHeading))+')'}>
        <circle r="15" fill="#55dceb" fillOpacity=".15"/>
        {heading===null
          ? <circle r="6" fill="#6ce7f0" stroke="#d5feff" strokeWidth="1.2"/>
          : <path d="M 0 -13 L 9 10 L 0 6 L -9 10 Z" fill="#6ce7f0" stroke="#d5feff" strokeWidth="1.2"/>}
      </g>
      {guidanceValid&&absoluteBearing!==null&&<g
        transform={'translate('+px+' '+py+') rotate('+normalizeBearing(absoluteBearing-viewHeading)+')'}>
        <path d="M0 -21 L-5 -27 L0 -39 L5 -27 Z" fill="#f4c47b" stroke="#ffe3a7" strokeWidth="1"/>
        <line x1="0" y1="-18" x2="0" y2="-31" stroke="#f4c47b" strokeWidth="2"/>
      </g>}
      <g transform="translate(452 43)" aria-label="magnetic north compass">
        <circle r="28" fill="#102338" stroke="#5a849a" strokeWidth="1.4"/>
        {cardinal.map(c=>{
          const [x,y]=cardinalPosition(c.bearing);
          return <text key={c.label} x={x} y={y+3.5} fontSize="10" fontWeight={c.label==='N'?700:500}
            textAnchor="middle" fill={c.label==='N'?'#f0d08e':'#92bacc'}>{c.label}</text>;
        })}
        <circle r="2" fill="#6bdce4"/>
      </g>
      <text x="16" y="251" fill="#7794a9" fontSize="10">{deviceUp?"Device forward = screen up":"East = right · Magnetic north = up"}</text>
      <text x="487" y="251" textAnchor="end" fill="#7395a9" fontSize="10">MAGNETIC NORTH · NO GPS</text>
    </svg>
    <div className="astronav-heading-sync" role="status">
      <svg className="astronav-oled-preview" viewBox="0 0 58 58" role="img"
        aria-label="Same relative rotation arrow as OLED">
        <circle cx="29" cy="29" r="25" fill="#0c1c30" stroke="#557b93" strokeWidth="1.5"/>
        {OLEDturn===null?<text x="29" y="35" textAnchor="middle" fill="#9db8c8" fontSize="19">?</text>:
          <g transform={'rotate('+OLEDturn+' 29 29)'}>
            <line x1="29" y1="40" x2="29" y2="23" stroke="#ffe3a7" strokeWidth="3"/>
            <path d="M29 9 L20 25 L38 25 Z" fill="#f4c47b"/>
            <circle cx="29" cy="29" r="3" fill="#0c1c30"/>
          </g>}
      </svg>
      <div>
        <strong>READ OLED · BY DEVICE: {OLEDturn===null?'—':OLEDturn.toFixed(1)+'°'}</strong>
        <span>{OLEDturn===null?"Waiting for updated direction information":turnInstruction(OLEDturn)}</span>
        <small>Destination on map: {absoluteBearing===null?'—':normalizeBearing(absoluteBearing).toFixed(1)+'°'} magnetic ·
          Device: {heading===null?'—':heading.toFixed(1)+'°'} magnetic</small>
        <small>{deviceUp?"Device up: target direction on the map is the same as the OLED arrow.":
          "North up: map is in absolute orientation, OLED arrow is relative to the front of the device."}</small>
      </div>
    </div>
    <div className="astronav-map-legend">
      <span><i className="astro-legend-base"/>Base</span>
      <span><i className="astro-legend-target"/>Target</span>
      <span><i className="astro-legend-route"/>Active route</span>
      <span><i className="astro-legend-track"/>Progress</span>
    </div>
  </div>;
}

export function AstroNavSummary({apiBase,onOpen}:{apiBase:string;onOpen:()=>void}){
  const [status,setStatus]=useState<NavStatus|null>(null);
  const [apiAvailable,setApiAvailable]=useState(false);
  useEffect(()=>{
    let alive=true;
    const poll=async()=>{
      try{const s=await fetchNavigation(apiBase);if(alive){setStatus(s);setApiAvailable(true)}}
      catch{if(alive)setApiAvailable(false)}
    };
    void poll();
    const timer=window.setInterval(()=>void poll(),3500);
    return()=>{alive=false;window.clearInterval(timer)};
  },[apiBase]);
  return <div className="astronav-summary">
    <div className="astronav-summary-top">
      <span className={'astronav-status-dot '+(apiAvailable?'ready':'offline')}/>
      <strong>ASTRONAV · MISSION ROUTE</strong>
      <small>{status?.session_status==='active'?(status.goal_type==='base'?"RETURN TO BASE":"TARGET TRACKING"):status?.sensor_ready?'ESP32 READY':"WAITING FOR SENSOR"}</small>
    </div>
    <div className="astronav-summary-kpis">
      <div><span>{status?.goal_type==='base'?"Remaining at base (estimated)":"Remaining on target (estimated)"}</span><b>{metres(status?.remaining_m)}</b></div>
      <div><span>ESP32 step counter</span><b>{status?.steps_total??'—'}</b></div>
    </div>
    <p>{apiAvailable?navStatusLabel(status):"Navigation API connection pending"}</p>
    <button className="astro-button-primary" type="button" onClick={onOpen}>Open AstroNav →</button>
    <small>Relative position estimate referenced to magnetic north. No true north correction, no GPS, and no terrain map.</small>
  </div>;
}

export function AstroNavPanel({apiBase,deviceId,canEstimate,sensorHeading}:{
  apiBase:string;deviceId:string;canEstimate:boolean;sensorHeading:number|null;
}){
  const [state,setState]=useState<NavStatus|null>(null);
  const [busy,setBusy]=useState(false);
  const [online,setOnline]=useState(false);
  const [error,setError]=useState('');
  const [confirmReturn,setConfirmReturn]=useState(false);
  const [confirmReset,setConfirmReset]=useState(false);
  const [lastUpdated,setLastUpdated]=useState<number|null>(null);
  const load=useCallback(async()=>{
    try{
      const value=await fetchNavigation(apiBase);
      setState(value);setOnline(true);setLastUpdated(Date.now());
    }catch(e){
      setOnline(false);
      setError(e instanceof Error?e.message:"No AstroNav connection");
    }
  },[apiBase]);
  useEffect(()=>{
    void load();
    const timer=window.setInterval(()=>void load(),1400);
    return()=>window.clearInterval(timer);
  },[load]);
  async function action(endpoint:string,body:Record<string,unknown>={}){
    if(busy)return;
    setBusy(true);setError('');
    try{
      const response=await fetch(apiBase+'/api/v1/navigation/'+endpoint,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(body),
        signal:AbortSignal.timeout(5000)
      });
      const payload=await response.json() as NavStatus&{detail?:unknown};
      if(!response.ok){
        const text=typeof payload.detail==='string'?payload.detail:'HTTP '+response.status;
        throw new Error(text);
      }
      setState(payload);setOnline(true);setLastUpdated(Date.now());
      setConfirmReturn(false);setConfirmReset(false);
    }catch(e){
      setError(e instanceof Error?e.message:"The transaction could not be completed");
    }finally{setBusy(false)}
  }

  const active=state?.session_status==='active';
  const finished=state?.session_status==='completed';
  const routes=state?.routes||[];
  const selected=routes.find(x=>x.id===state?.active_route_id);
  const direction=turnInstruction(state?.turn_deg??null);
  const ready=Boolean(canEstimate && state?.sensor_ready && state?.sensor_device_id===deviceId && (state?.sensor_age_s??Infinity)<=2.5);
  const heading=ready?(state?.heading_deg??sensorHeading):null;
  const source=ready?(state?.session_status==='idle'?"ESP32 LIVE / TRACK READY":"LIVE STEP + COMPASS"):"WAITING FOR SENSOR DATA";

  return <div className="astronav-page">
    <div className="astronav-banner">
      <div><span className="astro-eyebrow">ASTROVITAL X / NAVIGATION UNIT</span>
        <h2>AstroNav <span>10 Meter Target and Mission Route</span></h2>
        <p>When the mission is started, a target is placed 10 meters ahead of the current calibrated compass direction. Position is estimated from ESP32 pitch and compass; There is no GPS or terrain map.</p>
      </div>
      <span className={'astronav-banner-badge '+(active?'is-on':'')}>{source}</span>
    </div>
    <div className="astronav-sensor-row">
      <div><span className={'astronav-status-dot '+(online?'ready':'offline')}/><b>Pi AstroNav API</b><small>{online?"Connected":"no connection"}</small></div>
      <div><b>ESP32 compass</b><strong>{heading===null?'—':heading.toFixed(1)+'°'}</strong></div>
      <div><b>Live step / compass</b><strong>{ready?'READY':"EXPECTED"}</strong></div>
      <div><b>Oturum</b><strong>{navStatusLabel(state)}</strong></div>
    </div>
    {state&&state.session_status!=='active'&&<div className="astronav-start-panel">
      <div><strong>Create a mission target 10 m in the direction you are currently facing</strong>
        <p>Start while facing the target at the base point. The system fixes the current compass heading, sets the start (0,0) and the target as 10 meters ahead. Actual GPS location is not used.</p></div>
      <div className="astronav-start-controls">
        <strong>TARGET: 10.0 m · INITIAL DIRECTION: {heading===null?'—':heading.toFixed(1)+'°'}</strong>
        <button className="astro-button-primary" type="button" disabled={!online||busy||!ready}
          onClick={()=>void action('start',{device_id:deviceId,mode:'estimated',distance_m:10})}>Start Mission · 10 m</button>
        {!ready&&<small>True ESP32 connection, current telemetry, compass calibration and stride length required. It does not start with simulation.</small>}
      </div>
    </div>}
    {state&&state.session_status!=='idle'&&<>
      {active&&<div className="astronav-start-panel" role="status">
        <div><strong>{state.goal_type==='base'?"Return to base mode is on":"Mission started · 10 m target locked"}</strong>
          <p>{state.goal_type==='base'
            ?"The arrow on the OLED indicates the direction from your location estimate to the base. There is no map or obstacle detection."
            :"The direction indicated by the OLED arrow rotates to the target created 10 meters ahead. The target does not change until the target is reached or the Return to Base command is given."}</p></div>
        <div className="astronav-start-controls">
          <strong>OLED: {ready?(state.turn_deg===null?"Direction awaited":direction):"Sensor data awaited"}</strong>
          <small>Short button press switches OLED pages; Position movement is calculated from actual measurements only.</small>
        </div>
      </div>}
      <div className="astronav-kpi-grid">
        <div><small>{state.goal_type==='base'?"REMAINING TO THE BASE (ESTIMATE)":"REMAINING TO TARGET (ESTIMATE)"}</small><strong>{metres(state.remaining_m)}</strong></div>
        <div><small>{state.goal_type==='base'?"BASE DIRECTION (RELATIVE)":"TARGET DIRECTION (RELATIVE)"}</small>
          <strong>{state.turn_deg===null?'—':state.turn_deg.toFixed(0)+'°'}</strong>
          <span>{ready?direction:"Caliber live compass expected"}</span></div>
        <div><small>PROGRESSING BY STEPS</small><strong>{metres(state.distance_walked_m)}</strong></div>
        <div><small>ESP32 PEP COUNTER</small><strong>{state.steps_total??'—'}</strong>
          <span>{state.goal_type==='base'?"Showing base direction":'10 m hedefi izleniyor'}</span></div>
      </div>
      <div className="astronav-map-grid">
        <NavMap state={state}/>
        <div className="astronav-route-section">
          <div className="astronav-section-title"><strong>Location Based on Actual Measurement</strong><span>STEP + COMPASS</span></div>
          <p>Map north is the calibrated magnetic reference of the ESP32 magnetometer. No geo true north correction applied. The OLED arrow does not indicate absolute direction, but rotation relative to the direction the device is facing forward. Physical location and disabilities cannot be verified.</p>
          {state.goal_type==='target'&&<div className="astronav-route-list">
            <div className="astronav-section-title"><strong>Bird's eye view alternatives</strong><span>GEOMETRIC DRAWINGS / NO OBSTACLE ANALYSIS</span></div>
            <p>A is the shortest line, B is the geometric deviation from the left, and C is the geometric deviation from the right. These are not actual walkable routes or obstacle perimeters. The OLED arrow always points to the target regardless of the selected line.</p>
            {state.routes.map(route=><button key={route.id} type="button"
              className="astronav-route" disabled={busy||!active||route.id===state.active_route_id}
              onClick={()=>void action('propose',{route_id:route.id})}>
              <span className="astronav-route-label">{route.id}</span>
              <span><strong>{route.label}</strong><small>Plan length: {metres(route.distance_m)}{route.id===state.active_route_id?" · Displayed":" · Select on map"}</small></span>
            </button>)}
            {state.pending_route_id&&<div className="astronav-approval">
              <strong>{state.pending_route_id} Show drawing?</strong>
              <small>The selection does not change the OLED target. There is no real terrain verification.</small>
              <div>
                <button type="button" className="astro-button-primary" disabled={busy} onClick={()=>void action('approve',{approved:true})}>Confirm Selection</button>
                <button type="button" className="astro-button-secondary" disabled={busy} onClick={()=>void action('approve',{approved:false})}>Cancel</button>
              </div>
            </div>}
          </div>}
          <div className="astronav-route-list">
            <div className="astronav-route"><div><span className="astronav-route-label">ESP</span>
              <div><strong>Caliber stride length</strong><small>{metres(state.stride_length_m)}</small></div></div></div>
            <div className="astronav-route"><div><span className="astronav-route-label">API</span>
              <div><strong>Telemetry age</strong><small>{state.sensor_age_s==null?'—':state.sensor_age_s.toFixed(1)+' sn'}</small></div></div></div>
            <div className="astronav-route"><div><span className="astronav-route-label">10m</span>
              <div><strong>Initial target direction</strong><small>{state.target_heading_deg==null?'—':state.target_heading_deg.toFixed(1)+'°'}</small></div></div></div>
          </div>
          {state.goal_type==='base'&&<p>Exponent direction is calculated as a straight line from the estimated location to the origin. Obstacles or safe walking route are not evaluated.</p>}
        </div>
      </div>
      <div className="astronav-actions">
        {(active||finished)&&state.goal_type!=='base'&&!confirmReturn&&<button type="button" disabled={busy}
          className="astro-button-secondary" onClick={()=>setConfirmReturn(true)}>Return to Base</button>}
        {confirmReturn&&<div className="astronav-approval">
          <strong>Initiate return to base mode?</strong>
          <small>The base direction is shown based on the relative position calculated from the pitch and compass. The actual terrain and obstacles are unknown.</small>
          <div><button type="button" className="astro-button-primary" disabled={busy}
            onClick={()=>void action('return',{approved:true})}>Start Return to Base</button>
            <button type="button" className="astro-button-secondary" onClick={()=>setConfirmReturn(false)}>Cancel</button></div>
        </div>}
        {(!confirmReset)&&<button type="button" className="astro-button-danger" disabled={busy} onClick={()=>setConfirmReset(true)}>Reset Session</button>}
        {confirmReset&&<div className="astronav-approval">
          <strong>Reset session?</strong>
          <div><button type="button" className="astro-button-danger" disabled={busy} onClick={()=>void action('reset')}>Yes, reset</button>
            <button type="button" className="astro-button-secondary" onClick={()=>setConfirmReset(false)}>Cancel</button></div>
        </div>}
      </div>
      {finished&&<div className="astronav-arrived" role="status">{state.goal_type==='base'?"near base":"Near 10m target"} arrival was predicted. Physical arrival has not been confirmed.</div>}
    </>}
    {state && state.warnings.length>0 && <div className="astronav-warnings" role="status">
      {state.warnings.map((warning,i)=><p key={i}>• {warning}</p>)}
    </div>}
    {error&&<div className="astronav-error" role="alert">{error}</div>}
    <div className="astronav-footer">
      <span>MONITORING: {lastUpdated?new Date(lastUpdated).toLocaleTimeString('en-US'):"EXPECTED"}</span>
      <span>IMPORTANT: Magnetic compass calibration does not provide reliable heading without verifying the physical forward orientation and horizontal attitude of the device. There is no GPS or true north correction.</span>
    </div>
  </div>;
}
