import {useCallback,useEffect,useMemo,useState} from 'react';
import {
  createNavProjector,metres,navStatusLabel,turnInstruction,normalizeBearing,relativeTurn,rotateWorldToDeviceUp,bearingFromWorldPoints,
  type NavMode,type NavStatus,type Point
} from './astronavDomain';

async function fetchNavigation(apiBase:string):Promise<NavStatus>{
  const res=await fetch(apiBase+'/api/v1/navigation/status',{
    cache:'no-store',signal:AbortSignal.timeout(3500)
  });
  if(!res.ok)throw new Error(res.status===404?'AstroNav backend henüz kurulu değil.':'Navigasyon API: HTTP '+res.status);
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
  const cardinal=([{label:'K',bearing:0},{label:'D',bearing:90},
                    {label:'G',bearing:180},{label:'B',bearing:270}] as const);
  const cardinalPosition=(bearing:number)=>{
    const rad=(bearing-viewHeading)*Math.PI/180;
    return [Math.sin(rad)*19,-Math.cos(rad)*19] as const;
  };
  return <div className="astronav-map-shell">
    <div className="astronav-map-top">
      <span>KUŞ BAKIŞI · GÖRELİ KOORDİNATLAR</span>
      <div className="astronav-orientation-toggle" role="group" aria-label="Harita yönü">
        <button type="button" aria-pressed={orientation==='north'} onClick={()=>setOrientation('north')}>Kuzey yukarı</button>
        <button type="button" aria-pressed={orientation==='device'} disabled={heading===null}
          onClick={()=>setOrientation('device')}>Cihaz yukarı</button>
      </div>
    </div>
    <svg viewBox="0 0 500 270" className="astronav-map-svg" role="img"
      aria-label="ESP32 adım ve pusulasından hesaplanan göreli iz; GPS ya da arazi haritası değil">
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
      <text x={bx+15} y={by+4} fill="#9de8d4" fontSize="11" fontWeight="700">ÜS</text>
      {Math.hypot(gx-bx,gy-by)>6 && <g>
        <circle cx={gx} cy={gy} r="9" stroke="#f4c47b" strokeWidth="2" fill="#4c382b"/>
        <circle cx={gx} cy={gy} r="3" fill="#f4c47b"/>
        <text x={gx+12} y={gy-11} fill="#f6ce8b" fontSize="11">HEDEF</text>
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
      <g transform="translate(452 43)" aria-label="Manyetik kuzey pusulası">
        <circle r="28" fill="#102338" stroke="#5a849a" strokeWidth="1.4"/>
        {cardinal.map(c=>{
          const [x,y]=cardinalPosition(c.bearing);
          return <text key={c.label} x={x} y={y+3.5} fontSize="10" fontWeight={c.label==='K'?700:500}
            textAnchor="middle" fill={c.label==='K'?'#f0d08e':'#92bacc'}>{c.label}</text>;
        })}
        <circle r="2" fill="#6bdce4"/>
      </g>
      <text x="16" y="251" fill="#7794a9" fontSize="10">{deviceUp?'Cihaz ileri = ekran yukarısı':'Doğu = sağ · Manyetik kuzey = yukarı'}</text>
      <text x="487" y="251" textAnchor="end" fill="#7395a9" fontSize="10">MANYETİK / GPS YOK</text>
    </svg>
    <div className="astronav-heading-sync" role="status">
      <svg className="astronav-oled-preview" viewBox="0 0 58 58" role="img"
        aria-label="OLED ile aynı göreli dönüş oku">
        <circle cx="29" cy="29" r="25" fill="#0c1c30" stroke="#557b93" strokeWidth="1.5"/>
        {OLEDturn===null?<text x="29" y="35" textAnchor="middle" fill="#9db8c8" fontSize="19">?</text>:
          <g transform={'rotate('+OLEDturn+' 29 29)'}>
            <line x1="29" y1="40" x2="29" y2="23" stroke="#ffe3a7" strokeWidth="3"/>
            <path d="M29 9 L20 25 L38 25 Z" fill="#f4c47b"/>
            <circle cx="29" cy="29" r="3" fill="#0c1c30"/>
          </g>}
      </svg>
      <div>
        <strong>OLED OKU · CİHAZA GÖRE: {OLEDturn===null?'—':OLEDturn.toFixed(1)+'°'}</strong>
        <span>{OLEDturn===null?'Güncel yön bilgisi bekleniyor':turnInstruction(OLEDturn)}</span>
        <small>Haritada hedef: {absoluteBearing===null?'—':normalizeBearing(absoluteBearing).toFixed(1)+'°'} manyetik ·
          Cihaz: {heading===null?'—':heading.toFixed(1)+'°'} manyetik</small>
        <small>{deviceUp?'Cihaz yukarı: haritadaki hedef doğrultusu OLED okuyla aynı.':
          'Kuzey yukarı: harita mutlak yönde, OLED oku cihazın önüne göredir.'}</small>
      </div>
    </div>
    <div className="astronav-map-legend">
      <span><i className="astro-legend-base"/>Üs</span>
      <span><i className="astro-legend-target"/>Hedef</span>
      <span><i className="astro-legend-route"/>Aktif rota</span>
      <span><i className="astro-legend-track"/>İlerleme</span>
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
      <strong>ASTRONAV · GÖREV ROTASI</strong>
      <small>{status?.session_status==='active'?(status.goal_type==='base'?'ÜSSE DÖNÜŞ':'HEDEF TAKİBİ'):status?.sensor_ready?'ESP32 HAZIR':'SENSÖR BEKLENİYOR'}</small>
    </div>
    <div className="astronav-summary-kpis">
      <div><span>{status?.goal_type==='base'?'Üsse kalan (tahmini)':'Hedefe kalan (tahmini)'}</span><b>{metres(status?.remaining_m)}</b></div>
      <div><span>ESP32 adım sayacı</span><b>{status?.steps_total??'—'}</b></div>
    </div>
    <p>{apiAvailable?navStatusLabel(status):'Navigasyon API bağlantısı bekleniyor'}</p>
    <button className="astro-button-primary" type="button" onClick={onOpen}>AstroNav'ı Aç →</button>
    <small>Manyetik kuzey referanslı göreli tahmin. Gerçek kuzey düzeltmesi, GPS ve arazi haritası yok.</small>
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
      setError(e instanceof Error?e.message:'AstroNav bağlantısı yok');
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
      setError(e instanceof Error?e.message:'İşlem yapılamadı');
    }finally{setBusy(false)}
  }

  const active=state?.session_status==='active';
  const finished=state?.session_status==='completed';
  const routes=state?.routes||[];
  const selected=routes.find(x=>x.id===state?.active_route_id);
  const direction=turnInstruction(state?.turn_deg??null);
  const ready=Boolean(canEstimate && state?.sensor_ready && state?.sensor_device_id===deviceId && (state?.sensor_age_s??Infinity)<=2.5);
  const heading=ready?(state?.heading_deg??sensorHeading):null;
  const source=ready?(state?.session_status==='idle'?'ESP32 CANLI / TAKİP HAZIR':'CANLI ADIM + PUSULA'):'SENSÖR VERİSİ BEKLENİYOR';

  return <div className="astronav-page">
    <div className="astronav-banner">
      <div><span className="astro-eyebrow">ASTROVITAL X / NAVİGASYON BİRİMİ</span>
        <h2>AstroNav <span>10 Metre Hedef ve Görev Rotası</span></h2>
        <p>Görev başlatıldığında o andaki kalibre pusula yönünün 10 metre ilerisine hedef konur. Konum, ESP32 adım ve pusulasından tahmin edilir; GPS veya arazi haritası yoktur.</p>
      </div>
      <span className={'astronav-banner-badge '+(active?'is-on':'')}>{source}</span>
    </div>
    <div className="astronav-sensor-row">
      <div><span className={'astronav-status-dot '+(online?'ready':'offline')}/><b>Pi AstroNav API</b><small>{online?'Bağlı':'Bağlantı yok'}</small></div>
      <div><b>ESP32 pusula</b><strong>{heading===null?'—':heading.toFixed(1)+'°'}</strong></div>
      <div><b>Canlı adım / pusula</b><strong>{ready?'HAZIR':'BEKLENİYOR'}</strong></div>
      <div><b>Oturum</b><strong>{navStatusLabel(state)}</strong></div>
    </div>
    {state&&state.session_status!=='active'&&<div className="astronav-start-panel">
      <div><strong>Şu an baktığın yönde 10 m görev hedefi oluştur</strong>
        <p>Üs noktasında hedefe doğru bakarken başlat. Sistem bu anki pusula yönünü sabitler, başlangıcı (0,0) ve hedefi 10 metre ileri olarak belirler. Gerçek GPS konumu kullanılmaz.</p></div>
      <div className="astronav-start-controls">
        <strong>HEDEF: 10,0 m · BAŞLANGIÇ YÖNÜ: {heading===null?'—':heading.toFixed(1)+'°'}</strong>
        <button className="astro-button-primary" type="button" disabled={!online||busy||!ready}
          onClick={()=>void action('start',{device_id:deviceId,mode:'estimated',distance_m:10})}>Görev Başlat · 10 m</button>
        {!ready&&<small>Gerçek ESP32 bağlantısı, güncel telemetri, pusula kalibrasyonu ve adım uzunluğu gereklidir. Simülasyonla başlatılmaz.</small>}
      </div>
    </div>}
    {state&&state.session_status!=='idle'&&<>
      {active&&<div className="astronav-start-panel" role="status">
        <div><strong>{state.goal_type==='base'?'Üsse dönüş modu açık':'Görev başladı · 10 m hedef kilitlendi'}</strong>
          <p>{state.goal_type==='base'
            ?'OLED üzerindeki ok, konum tahmininizden üsse doğru yönü gösterir. Harita veya engel algılama bulunmaz.'
            :'OLED okunun gösterdiği yön, 10 metre ileride oluşturulan hedefe döner. Hedefe varana veya Üsse Dön komutu verilene kadar hedef değişmez.'}</p></div>
        <div className="astronav-start-controls">
          <strong>OLED: {ready?(state.turn_deg===null?'Yön bekleniyor':direction):'Sensör verisi bekleniyor'}</strong>
          <small>Kısa düğme basışı OLED sayfalarını değiştirir; konum hareketi yalnızca gerçek ölçümlerden hesaplanır.</small>
        </div>
      </div>}
      <div className="astronav-kpi-grid">
        <div><small>{state.goal_type==='base'?'ÜSSE KALAN (TAHMİNİ)':'HEDEFE KALAN (TAHMİNİ)'}</small><strong>{metres(state.remaining_m)}</strong></div>
        <div><small>{state.goal_type==='base'?'ÜS YÖNÜ (GÖRELİ)':'HEDEF YÖNÜ (GÖRELİ)'}</small>
          <strong>{state.turn_deg===null?'—':state.turn_deg.toFixed(0)+'°'}</strong>
          <span>{ready?direction:'Kalibre canlı pusula bekleniyor'}</span></div>
        <div><small>ADIMLARLA İLERLENEN</small><strong>{metres(state.distance_walked_m)}</strong></div>
        <div><small>ESP32 ADIM SAYACI</small><strong>{state.steps_total??'—'}</strong>
          <span>{state.goal_type==='base'?'Üs yönü gösteriliyor':'10 m hedefi izleniyor'}</span></div>
      </div>
      <div className="astronav-map-grid">
        <NavMap state={state}/>
        <div className="astronav-route-section">
          <div className="astronav-section-title"><strong>Gerçek Ölçüme Dayalı Konum</strong><span>ADIM + PUSULA</span></div>
          <p>Harita kuzeyi, ESP32 manyetometresinin kalibre edilmiş manyetik referansıdır. Coğrafi gerçek kuzey düzeltmesi uygulanmadı. OLED oku mutlak yönü değil, cihazın ileri baktığı yöne göre dönüşü gösterir. Fiziksel konum ve engeller doğrulanamaz.</p>
          {state.goal_type==='target'&&<div className="astronav-route-list">
            <div className="astronav-section-title"><strong>Kuş bakışı alternatifler</strong><span>GEOMETRİK ÇİZİMLER / ENGEL ANALİZİ YOK</span></div>
            <p>A en kısa çizgi, B soldan ve C sağdan geometrik sapmadır. Bunlar gerçek yürünebilir rota veya engel çevresi değildir. OLED oku seçilen çizgiden bağımsız olarak daima hedefi gösterir.</p>
            {state.routes.map(route=><button key={route.id} type="button"
              className="astronav-route" disabled={busy||!active||route.id===state.active_route_id}
              onClick={()=>void action('propose',{route_id:route.id})}>
              <span className="astronav-route-label">{route.id}</span>
              <span><strong>{route.label}</strong><small>Plan uzunluğu: {metres(route.distance_m)}{route.id===state.active_route_id?' · Görüntülenen':' · Haritada seç'}</small></span>
            </button>)}
            {state.pending_route_id&&<div className="astronav-approval">
              <strong>{state.pending_route_id} çizimi gösterilsin mi?</strong>
              <small>Seçim OLED hedefini değiştirmez. Gerçek arazi doğrulaması yoktur.</small>
              <div>
                <button type="button" className="astro-button-primary" disabled={busy} onClick={()=>void action('approve',{approved:true})}>Seçimi Onayla</button>
                <button type="button" className="astro-button-secondary" disabled={busy} onClick={()=>void action('approve',{approved:false})}>Vazgeç</button>
              </div>
            </div>}
          </div>}
          <div className="astronav-route-list">
            <div className="astronav-route"><div><span className="astronav-route-label">ESP</span>
              <div><strong>Kalibre adım uzunluğu</strong><small>{metres(state.stride_length_m)}</small></div></div></div>
            <div className="astronav-route"><div><span className="astronav-route-label">API</span>
              <div><strong>Telemetri yaşı</strong><small>{state.sensor_age_s==null?'—':state.sensor_age_s.toFixed(1)+' sn'}</small></div></div></div>
            <div className="astronav-route"><div><span className="astronav-route-label">10m</span>
              <div><strong>Başlangıçtaki hedef yönü</strong><small>{state.target_heading_deg==null?'—':state.target_heading_deg.toFixed(1)+'°'}</small></div></div></div>
          </div>
          {state.goal_type==='base'&&<p>Üs yönü, tahmini konumdan başlangıç noktasına doğru düz çizgiyle hesaplanır. Engeller veya güvenli yürüyüş rotası değerlendirilmez.</p>}
        </div>
      </div>
      <div className="astronav-actions">
        {(active||finished)&&state.goal_type!=='base'&&!confirmReturn&&<button type="button" disabled={busy}
          className="astro-button-secondary" onClick={()=>setConfirmReturn(true)}>Üsse Dön</button>}
        {confirmReturn&&<div className="astronav-approval">
          <strong>Üsse dönüş modu başlatılsın mı?</strong>
          <small>Üs yönü adım ve pusuladan hesaplanan göreli konuma göre gösterilir. Gerçek arazi ve engeller bilinmez.</small>
          <div><button type="button" className="astro-button-primary" disabled={busy}
            onClick={()=>void action('return',{approved:true})}>Üsse Dönüşü Başlat</button>
            <button type="button" className="astro-button-secondary" onClick={()=>setConfirmReturn(false)}>İptal</button></div>
        </div>}
        {(!confirmReset)&&<button type="button" className="astro-button-danger" disabled={busy} onClick={()=>setConfirmReset(true)}>Oturumu Sıfırla</button>}
        {confirmReset&&<div className="astronav-approval">
          <strong>Oturum sıfırlansın mı?</strong>
          <div><button type="button" className="astro-button-danger" disabled={busy} onClick={()=>void action('reset')}>Evet, sıfırla</button>
            <button type="button" className="astro-button-secondary" onClick={()=>setConfirmReset(false)}>Vazgeç</button></div>
        </div>}
      </div>
      {finished&&<div className="astronav-arrived" role="status">{state.goal_type==='base'?'Üs yakınında':'10 m hedefi yakınında'} varış tahmin edildi. Fiziksel varış doğrulanmadı.</div>}
    </>}
    {state && state.warnings.length>0 && <div className="astronav-warnings" role="status">
      {state.warnings.map((warning,i)=><p key={i}>• {warning}</p>)}
    </div>}
    {error&&<div className="astronav-error" role="alert">{error}</div>}
    <div className="astronav-footer">
      <span>İZLEME: {lastUpdated?new Date(lastUpdated).toLocaleTimeString('tr-TR'):'BEKLENİYOR'}</span>
      <span>ÖNEMLİ: Manyetik pusula kalibrasyonu, cihazın fiziksel ileri yönü ve yatay duruşu doğrulanmadan güvenilir yön göstermez. GPS veya gerçek kuzey düzeltmesi yoktur.</span>
    </div>
  </div>;
}
