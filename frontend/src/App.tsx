import { useCallback, useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import {
  SCENARIOS, assessSample, ageSeconds, clockTime, compassDirection, createDemoSample, describeConfidenceReason, isLiveMeasured, isSensorStreamActive, mapApiTelemetry, nowStamp,
  type Assessment, type CheckStatus, type LogEvent, type Page, type Sample, type Scenario
} from './domain';
import { nextApiConnection } from './apiConnectivity';
import { selectOverviewMissionAnalysis } from './calibrationOverview';
import {VoiceCallModal, VoiceCallPanel} from './VoiceCallDemo';
import {LiveRadioPanel, LiveRadioSummary} from './LiveRadio';
import {AstroNavPanel, AstroNavSummary} from './AstroNav';
import {type VoiceCallDirection, type VoiceCallTarget} from './voiceCallModel';

const API = import.meta.env.VITE_API_BASE || window.location.protocol + '//' + window.location.hostname + ':8000';

type CalibrationReference = {count:number; median:number|null; mad:number|null; required:number};
type CalibrationStatus = {
  active:boolean; phase:'inactive'|'baseline'|'monitoring'|'finished';
  monitoring_enabled:boolean;analysis_status:string;analysis_label:string;
  mission_recommendation:string;last_received_at:string|null;
  deviation_progress?:Record<string,number>;
  session_id:string|null;csv_filename:string|null;started_at:string|null;
  sample_count:number; quality_accepted_count:number; max_samples:number;
  baseline: {heart_rate_bpm:CalibrationReference; spo2_pct:CalibrationReference};
  calibrated:boolean;anomaly_count:number; quality_warning:string|null;
  current_anomaly:{type:string;detected_at:string;recommendation:string;confirmation:string;verified:boolean}|null;
  last_anomaly:{type:string;detected_at:string;recommendation:string;confirmation:string;verified:boolean}|null;
};
type ApiMission = {
  calibration?: CalibrationStatus;
  assessment: {
    telemetry: Record<string, unknown>;
    confidence: { score: number; usable: boolean; reasons: string[] };
    decision: { status: Assessment['status']; score: number | null; reason: string };
  } | null;
  self_check: { status: CheckStatus; recorded_at: string } | null;
  link_status: 'connected' | 'lost' | 'unknown';
};
const NAV: { id: Page; label: string; icon: string; section: string }[] = [
  { id: 'overview', label: "Overview", icon: 'grid', section: "MONITORING" },
  { id: 'telemetry', label: "Live Telemetry", icon: 'activity', section: "MONITORING" },
  { id: 'hadse', label: "Health Analysis and HADSE", icon: 'pulse', section: "MONITORING" },
  { id: 'astronav', label: "AstroNav | Return to Base", icon: 'compass', section: "MONITORING" },
  { id: 'voice', label: "Voice Communication (Radio)", icon: 'phone', section: "MONITORING" },
  { id: 'blackbox', label: "Mission Logs", icon: 'database', section: "SYSTEM" },
  { id: 'sensors', label: "Sensors and Connectivity", icon: 'radio', section: "SYSTEM" },
  { id: 'notifications', label: 'Bildirimler', icon: 'bell', section: "SYSTEM" },
  { id: 'settings', label: 'Ayarlar / Oturum', icon: 'settings', section: "SYSTEM" }
];

const ICON_PATHS: Record<string, ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  activity: <path d="M2 12h4l3-7 4 14 3-7h6"/>,
  pulse: <><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0l-1 1-1-1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/><path d="M4 12h4l2-3 3 6 2-3h4"/></>,
  clipboard: <><rect x="5" y="4" width="14" height="18" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="m9 14 2 2 4-5"/></>,
  phone: <path d="M22 16.8v3a2 2 0 0 1-2.2 2A19.7 19.7 0 0 1 2.2 4.2 2 2 0 0 1 4.2 2h3a2 2 0 0 1 2 1.7l.5 3a2 2 0 0 1-.6 1.7L7.2 10a16 16 0 0 0 6.8 6.8l1.6-1.9a2 2 0 0 1 1.7-.6l3 .5a2 2 0 0 1 1.7 2Z"/>,
  compass: <><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5Z"/></>,
  database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/></>,
  radio: <><circle cx="12" cy="12" r="2"/><path d="M7 7a7 7 0 0 0 0 10M17 7a7 7 0 0 1 0 10M4 4a11 11 0 0 0 0 16M20 4a11 11 0 0 1 0 16"/></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2.2 2.2M16.8 16.8 19 19M19 5l-2.2 2.2M7.2 16.8 5 19"/></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
  chevron: <path d="m9 18 6-6-6-6"/>,
  check: <path d="m4 12 5 5L20 6"/>,
  shield: <><path d="m12 2 8 4v6c0 5-3.6 8-8 10-4.4-2-8-5-8-10V6Z"/><path d="m9 12 2 2 4-4"/></>,
  wifi: <><path d="M2 8c6-5 14-5 20 0M5 12c4-3 10-3 14 0M8 16c2-1 6-1 8 0"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/></>,
  play: <path d="m8 5 11 7-11 7Z"/>,
  pause: <><path d="M8 5v14M16 5v14"/></>,
  refresh: <><path d="M20 7V3h-4M4 17v4h4M20 3a9 9 0 0 0-16 7M4 21a9 9 0 0 0 16-7"/></>,
  filter: <><path d="M3 5h18M6 12h12M9 19h6"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></>,
  alert: <><path d="m12 3 10 18H2Z"/><path d="M12 9v5m0 3v.2"/></>,
  monitor: <><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M12 17v4m-5 0h10"/></>,
  sliders: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="16" cy="17" r="2"/></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16"/>
};
function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICON_PATHS[name] || ICON_PATHS.grid}</svg>;
}
function Pill({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info'; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}
function Panel({ title, subtitle, children, action, className = '' }: { title: string; subtitle?: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>
    <div className="panel-head"><div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>{action}</div>
    <div className="panel-content">{children}</div>
  </section>;
}
function TinyChart({ values, color = '#39c8e8' }: { values: number[]; color?: string }) {
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * 124},${44 - ((v - Math.min(...values)) / (Math.max(1, Math.max(...values) - Math.min(...values)))) * 34}`).join(' ');
  return <svg viewBox="0 0 124 52" className="tiny-chart" aria-label="measurement trend">
    <polyline points={pts} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round"/>
  </svg>;
}
function Metric({ title, value, unit, note, accent, chart, icon }: { title: string; value: string; unit: string; note: string; accent: string; chart: number[]; icon: string }) {
  return <div className="metric-card">
    <div className="metric-top"><span>{title}</span><div className="metric-icon"><Icon name={icon} size={17}/></div></div>
    <div className="metric-mid"><div><strong>{value}</strong><small>{unit}</small></div><TinyChart values={chart.length > 1 ? chart : [1,1,1,1,1]} color={accent}/></div>
    <div className="metric-foot"><span className="trend-indicator" style={{ background: accent }}/>{note}</div>
  </div>;
}
const SERIES = [
  { key: 'heartRate', name: "Pulse", unit: 'BPM', color: '#39c8e8' },
  { key: 'spo2', name: 'SpO₂', unit: '%', color: '#32d6a0' },
  { key: 'acceleration', name: 'Hareket', unit: 'g', color: '#ffbd59' }
] as const;
type SeriesKey = typeof SERIES[number]['key'];
function TelemetryChart({ samples, selected, height = 270 }: { samples: Sample[]; selected: SeriesKey; height?: number }) {
  const series = SERIES.find(item => item.key === selected)!;
  const data = samples.slice(-48).map((p, i) => ({ n: i, value: p[selected] })).filter((p): p is { n: number; value: number } => typeof p.value === 'number');
  const vals = data.map(x => x.value);
  const base = selected === 'heartRate' ? [60, 120] : selected === 'spo2' ? [92, 100] : [0, 2.5];
  const min = Math.min(base[0], ...vals), max = Math.max(base[1], ...vals);
  const mapY = (v: number) => 218 - ((v - min) / Math.max(1, max - min)) * 190;
  const mapX = (n: number) => 48 + (n / Math.max(1, samples.slice(-48).length - 1)) * 740;
  const points = data.map(p => `${mapX(p.n)},${mapY(p.value)}`).join(' ');
  return <div className="chart-shell">
    <svg viewBox="0 0 840 274" role="img" aria-label={`${series.name} measurements over time`} style={{ height }}>
      <defs><linearGradient id={`chartGradient-${selected}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={series.color} stopOpacity=".20"/><stop offset="100%" stopColor={series.color} stopOpacity="0"/>
      </linearGradient></defs>
      {[0,1,2,3,4].map(i => <g key={i}><line x1="48" x2="798" y1={28 + i * 47.5} y2={28 + i * 47.5} stroke="#28364b" strokeDasharray="3 5"/>
        <text x="36" y={32 + i * 47.5} fontSize="11" fill="#74849c" textAnchor="end">{(max - (i / 4) * (max - min)).toFixed(selected === 'acceleration' ? 1 : 0)}</text></g>)}
      {points && <><polygon points={`${mapX(data[0].n)},218 ${points} ${mapX(data[data.length-1].n)},218`} fill={`url(#chartGradient-${selected})`}/>
        <polyline points={points} fill="none" stroke={series.color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"/>
        <circle cx={mapX(data[data.length-1].n)} cy={mapY(data[data.length-1].value)} r="5" fill={series.color} stroke="#101b2c" strokeWidth="3"/></>}
      {[0,.25,.5,.75,1].map((fraction,i) => { const item = samples[Math.round(fraction * Math.max(0,samples.length-1))]; const label=item?clockTime(item.observedAt).replace(' UTC',''):'—'; return <text key={i} x={48+i*187.5} y="253" fontSize="11" fill="#74849c" textAnchor={i===0?'start':i===4?'end':'middle'}>{label}</text>; })}
    </svg>
    {data.length < 2 && <div className="chart-empty">Chart requires at least two valid measurements</div>}
  </div>;
}

function OverviewTelemetryChart({samples}: {samples: Sample[]}) {
  const recent = samples.slice(-48);
  const seriesLine=(key:'heartRate'|'spo2'|'acceleration', min:number, max:number) => {
    const points:string[]=[];
    recent.forEach((sample,i)=>{
      const val=sample[key];
      if(typeof val!=='number'||!Number.isFinite(val))return;
      const x=68+(i/Math.max(1,recent.length-1))*1014;
      const y=210-((Math.min(max,Math.max(min,val))-min)/(max-min))*155;
      points.push(x.toFixed(1)+','+y.toFixed(1));
    });
    return points.length>=2 ? points.join(' ') : '';
  };
  const heart=seriesLine('heartRate',40,130);
  const oxygen=seriesLine('spo2',80,100);
  const motion=seriesLine('acceleration',0,3);
  const hasData=Boolean(heart||oxygen||motion);
  const axes=[0,1,2,3,4];
  const measured=recent.some(sample=>sample.source==='measured');
  return <div className="figma-chart-wrap">
    <div className="figma-chart-legend">
      <span><i style={{background:'#4ce3aa'}}/>Heart rate BPM</span>
      <span><i style={{background:'#72c7f7'}}/>SpO₂ · %</span>
      <span><i style={{background:'#f7c654'}}/>Hareket · g</span>
      <span className="figma-chart-note">{measured?"ACTUAL MEASUREMENT":recent.length?"DEMO / SIMULATION":"WAITING FOR MEASUREMENT"}</span>
    </div>
    <svg viewBox="0 0 1150 270" preserveAspectRatio="none" className="figma-multi-svg" role="img" aria-label="Heart rate, estimated oxygen saturation and acceleration telemetry">
      {axes.map(i=><line key={i} x1="68" x2="1082" y1={55+i*39} y2={55+i*39} stroke="#253449" strokeDasharray="3 5"/>)}
      {recent.length>1 && axes.map(i=><text key={i} x={68+i*253.5} y="250" textAnchor={i===0?'start':i===4?'end':'middle'} fill="#6e8499" fontSize="11">{clockTime(recent[Math.round(i*(recent.length-1)/4)].observedAt)}</text>)}
      {heart&&<polyline points={heart} stroke="#4ce3aa" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/>}
      {oxygen&&<polyline points={oxygen} stroke="#72c7f7" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/>}
      {motion&&<polyline points={motion} stroke="#f7c654" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/>}
    </svg>
    {!hasData&&<div className="figma-chart-empty">At least two valid measurements are required for the live chart. Demo data is not displayed as actual sensor measurement.</div>}
  </div>;
}

function StatLine({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div className="stat-line"><span>{label}</span><strong className={tone || ''}>{value}</strong></div>;
}
function Progress({ value, tone = 'cyan' }: { value: number; tone?: string }) {
  return <div className="progress"><div className={`progress-${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }}/></div>;
}
function emptyLog(text: string) { return <div className="empty-state"><Icon name="database" size={30}/><strong>No registrations yet</strong><span>{text}</span></div>; }
function statusText(s: Assessment['status']) {
  return s === 'continue' ? "Monitoring continues" : s === 'review' ? "Human evaluation required" : "No recommendation produced";
}
function statusTone(s: Assessment['status']): 'good'|'warn'|'bad' { return s==='continue'?'good':s==='review'?'warn':'bad'; }
function eventName(kind: string) {
  const names: Record<string,string> = { telemetry_assessed:"Telemetry evaluated", route_plan_changed:"Route evaluation updated",
    self_check:"Astronaut self-assessment", decision_updated:"HADSE was re-evaluated", simulation_link_loss:"connection loss",
    'demo-start':"Demo session opened", 'demo-packet':"Simulation telemetry", 'demo-no-signal':"Simulated connection loss",
    'demo-check':"Self-assessment recorded" };
  return names[kind] || kind.replaceAll('_',' ');
}
export default function App() {
  const [page, setPage] = useState<Page>('overview');
  const [mode, setMode] = useState<'sim'|'api'>('api');
  const [scenario, setScenario] = useState<Scenario>('nominal');
  const [running, setRunning] = useState(false);
  const [backendOnline, setBackendOnline] = useState(false);
  const [apiMission, setApiMission] = useState<ApiMission | null>(null);
  const [apiEvents, setApiEvents] = useState<LogEvent[]>([]);
  const [apiSamples, setApiSamples] = useState<Sample[]>([]);
  const [demoSamples, setDemoSamples] = useState<Sample[]>(() => Array.from({length:18}, (_,i) => createDemoSample('nominal',i+1,Date.now()-((17-i)*2000))!));
  const [demoEvents, setDemoEvents] = useState<LogEvent[]>([{ id:'start',kind:'demo-start',at:nowStamp(),detail:"Local instance session started",source:'simulated' as const }]);
  const [notice, setNotice] = useState('');
  // The voice conversation is animated entirely within the browser; No API/microphone used.
  const [voiceCall, setVoiceCall] = useState<{target:VoiceCallTarget;direction:VoiceCallDirection}|null>(null);
  const closeVoiceCall=useCallback(()=>setVoiceCall(null),[]);
  const openVoiceCall=(target:VoiceCallTarget,direction:VoiceCallDirection)=>setVoiceCall({target,direction});
  const [now, setNow] = useState(Date.now());
  const [series, setSeries] = useState<SeriesKey>('heartRate');
  const [timeRange, setTimeRange] = useState('15 dk');
  const [paused, setPaused] = useState(false);
  const [frozenSamples, setFrozenSamples] = useState<Sample[] | null>(null);
  const [logQuery, setLogQuery] = useState('');
  const [logFilter, setLogFilter] = useState("all");
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);
  const [missionId, setMissionId] = useState('MARSUP-01');
  const [mobileNav, setMobileNav] = useState(false);
  const [demoLinkLost, setDemoLinkLost] = useState(false);
  const seq = useRef(18);
  const connectionState = useRef({online:false,consecutiveFailures:0});
  const pollInFlight = useRef(false);
  const pollNumber = useRef(0);
  const missionErrors = useRef(0);
  const [apiSyncDelayed, setApiSyncDelayed] = useState(false);
  const [calibrationConsent, setCalibrationConsent] = useState(false);
  const [sameParticipant, setSameParticipant] = useState(false);
  const [calibrationBusy, setCalibrationBusy] = useState(false);
  // The operator key is only kept in RAM, not saved in localStorage.
  const [hotspotOperatorKey, setHotspotOperatorKey] = useState('');
  const [showHotspotOperatorField, setShowHotspotOperatorField] = useState(window.location.hostname==='192.168.4.1');
  const [calibrationActionError, setCalibrationActionError] = useState('');
  // Since the device's own clock can be delayed by ~4 seconds, the flow of packets
  // We watch via; Thus, we do not relax the 5-s HADSE quality limit.
  const latestMeasuredPacketKey = useRef<string | null>(null);
  const [latestMeasuredReceivedAt, setLatestMeasuredReceivedAt] = useState<number | null>(null);

  const refreshApi = useCallback(async () => {
    // No concurrent polls: slow Wi-Fi responses must not race each other.
    if (pollInFlight.current) return;
    pollInFlight.current = true;
    const includeEvents = pollNumber.current++ % 3 === 0;
    const request = async (path: string) => {
      const r = await fetch(API + path, { signal: AbortSignal.timeout(4000), cache:'no-store' });
      if (!r.ok) throw new Error('HTTP '+r.status);
      return r;
    };
    try {
      const [health, mission, events] = await Promise.allSettled([
        request('/health'),
        request('/api/v1/mission/status'),
        includeEvents ? request('/api/v1/events?limit=80') : Promise.resolve(null)
      ]);
      // A failed events query does not mean the API went offline.
      const alive = health.status==='fulfilled' || mission.status==='fulfilled'
        || (events.status==='fulfilled' && events.value!==null);
      const state = nextApiConnection(connectionState.current,alive);
      connectionState.current = state;
      setBackendOnline(state.online);
      let latestTelemetry: Record<string,unknown> | null = null;
      if (mission.status==='fulfilled') {
        try {
          const data = await mission.value.json() as ApiMission;
          setApiMission(data);
          latestTelemetry = data.assessment?.telemetry ?? null;
          missionErrors.current=0;
          setApiSyncDelayed(false);
        } catch {
          missionErrors.current++;
          if(missionErrors.current>=2) setApiSyncDelayed(true);
        }
      } else {
        missionErrors.current++;
        if(missionErrors.current>=2 && state.online) setApiSyncDelayed(true);
      }

      const historical: Sample[] = [];
      let matchingServerReceiptAt: number | null = null;
      if(events.status==='fulfilled' && events.value!==null) {
        try {
          const log = await events.value.json() as {events:{id:number;kind:string;occurred_at:string;payload:Record<string,unknown>}[]};
          if(latestTelemetry?.source === 'measured') {
            // Black Box event time is generated by Raspberry Pi, not ESP32 RTC.
            const matched = log.events.find(e=>{
              const t=e.payload?.telemetry as Record<string,unknown> | undefined;
              return e.kind==='telemetry_assessed' &&
                t?.device_id === latestTelemetry?.device_id &&
                t?.sequence === latestTelemetry?.sequence &&
                t?.observed_at === latestTelemetry?.observed_at;
            });
            const serverMs = matched ? Date.parse(matched.occurred_at) : NaN;
            if(Number.isFinite(serverMs)) matchingServerReceiptAt=serverMs;
          }
          setApiEvents(log.events.map(e=>({
            id:String(e.id),kind:e.kind,at:e.occurred_at,
            detail:e.kind==='telemetry_assessed'?"Evaluated by FastAPI"
              :e.kind==='simulation_link_loss'?"Simulation disconnected":"Task event logged",
            source:'api'
          })));
          historical.push(...log.events
            .filter(e=>e.kind==='telemetry_assessed' && e.payload?.telemetry && typeof e.payload.telemetry==='object')
            .map(e=>mapApiTelemetry(e.payload.telemetry as Record<string,unknown>))
            .reverse());
        } catch {
          // Keep the previous event history on a malformed optional response.
        }
      }
      if(latestTelemetry?.source === 'measured') {
        const key = String(latestTelemetry.device_id)+':'+String(latestTelemetry.sequence)+':'+String(latestTelemetry.observed_at);
        if(key !== latestMeasuredPacketKey.current) {
          const first = latestMeasuredPacketKey.current === null;
          latestMeasuredPacketKey.current=key;
          const deviceAge=Date.now()-Date.parse(String(latestTelemetry.observed_at));
          // Let's not mark an old package as new when you first open it.
          // The next changed sequence number verifies the actual new telemetry.
          const initialAt = matchingServerReceiptAt ??
            (Number.isFinite(deviceAge) && deviceAge >= -2000 && deviceAge <= 6500 ? Date.now() : null);
          if(!first || initialAt !== null) setLatestMeasuredReceivedAt(first ? initialAt : Date.now());
        }
      }
      if(latestTelemetry) historical.push(mapApiTelemetry(latestTelemetry));
      if(historical.length) setApiSamples(current=>{
        const unique=new Map<string,Sample>();
        [...current,...historical].forEach(packet=>unique.set(packet.id,packet));
        return [...unique.values()].sort((a,b)=>new Date(a.observedAt).getTime()-new Date(b.observedAt).getTime()).slice(-150);
      });
    } finally {
      pollInFlight.current=false;
    }
  }, []);

  useEffect(() => {
    void refreshApi();
    const poll = setInterval(() => void refreshApi(), 2000);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(timer); };
  }, [refreshApi]);

  const step = useCallback(async () => {
    const number = ++seq.current;
    if (mode === 'api') {
      if (!backendOnline) { setNotice("Backend is offline. Select local simulation."); setRunning(false); return; }
      try {
        const response = await fetch(`${API}/api/v1/simulation/step`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({scenario,sequence:number}) });
        if (!response.ok) throw new Error('HTTP '+response.status);
        void refreshApi(); setNotice('');
      } catch { setNotice("Simulation API request failed."); setRunning(false); }
      return;
    }
    const packet = createDemoSample(scenario, number);
    if (packet) {
      setDemoSamples(s=>[...s,packet].slice(-150));
      setDemoLinkLost(false);
      setDemoEvents(s=>[{id:'demo-'+number, kind:'demo-packet',at:nowStamp(),
        detail:`Paket #${number} · ${SCENARIOS.find(s=>s.id===scenario)?.label}`,source:'simulated' as const},...s].slice(0,120));
    } else {
      setDemoLinkLost(true);
      setDemoEvents(s=>[{id:'loss-'+number, kind:'demo-no-signal',at:nowStamp(),
        detail:"No new measurements were produced; The old package will become outdated",source:'simulated' as const},...s].slice(0,120));
    }
  }, [mode,scenario,backendOnline,refreshApi]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void step(), 2000);
    return () => clearInterval(timer);
  }, [running,step]);
  const samples = mode === 'api' ? apiSamples : demoSamples;
  const rangeMinutes = timeRange === '5 dk' ? 5 : timeRange === '15 dk' ? 15 : timeRange === '1 saat' ? 60 : 1440;
  const visibleSamples = samples.filter(s => { const age = now - new Date(s.observedAt).getTime(); return age >= -2000 && age <= rangeMinutes * 60000; }).slice(-48);
  const chartSamples = frozenSamples ?? visibleSamples;
  // API's latest bundle, future-tuned demo from Black Box history
  // Do not be affected by your packages; Get live status directly from mission/status.
  const last = mode === 'api' && apiMission?.assessment?.telemetry
    ? mapApiTelemetry(apiMission.assessment.telemetry)
    : samples.at(-1) || null;
  const apiAssessment = apiMission?.assessment;
  const localAssessment = assessSample(last,null,now);
  // Flow connection depends on packet arrival time, medical data up-to-dateness
  // It is evaluated from the time of observation. These are not the same concept.
  const liveMeasured = mode === 'api' && isSensorStreamActive(last, latestMeasuredReceivedAt, now);
  const measurementTimestampFresh = isLiveMeasured(last,now);
  const apiPacketFresh = last?.source === 'measured'
    ? liveMeasured
    : Boolean(last && (now - new Date(last.observedAt).getTime() >= -2000) && (now - new Date(last.observedAt).getTime() <= 5000));
  const assessment: Assessment = mode === 'api' && apiAssessment && !apiPacketFresh ? {
    status: 'abstain', score: null, confidence: 0, usable: false,
    reasons: ["Latest telemetry package is out of date"],
    explanation: "The ESP32 data stream has been interrupted or the measurement has timed out. Check the connection."
  } : mode === 'api' && apiAssessment ? {
    status: apiAssessment.decision.status,
    score: apiAssessment.decision.score,
    confidence: apiAssessment.confidence.score,
    usable: apiAssessment.confidence.usable,
    reasons: apiAssessment.confidence.reasons.map(describeConfidenceReason),
    explanation: apiAssessment.decision.reason,
  } : mode === 'api' ? assessSample(null,null,now) : localAssessment;
  const calibration = apiMission?.calibration ?? null;
  // If the API, sensor flow, and session are not active, old candidates will not be alerted in the Overview.
  const missionAnalysis = selectOverviewMissionAnalysis(calibration,{
    mode, apiOnline: backendOnline, sensorStreamActive: liveMeasured,
    measurementUsable: assessment.usable,
  });
  const events = mode === 'api' ? apiEvents : demoEvents;
  const fromSensor = last?.source === 'measured';
  const sourceLabel = mode === 'sim' || last?.source === 'simulated' ? "SIMULATION"
    : liveMeasured ? "ESP32 LIVE MEASUREMENT" : fromSensor ? "OLD MEASUREMENT" : "NO DATA";
  const latestSeconds = last ? ageSeconds(last.observedAt,now) : null;
  // Only actual ESP32 packets may supply environment readings. Keep stale
  // measurements visible as the last reading, but label their freshness.
  const environmental = last?.source === 'measured' ? last : null;
  const envStatus = liveMeasured ? 'ESP32 CANLI' : environmental ? "LAST MEASUREMENT OLD" : "WAITING FOR MEASUREMENT";
  const temperatureText = environmental?.temperatureC == null ? "no measurement" : environmental.temperatureC.toFixed(1)+' °C';
  const pressureText = environmental?.pressureHpa == null ? "no measurement" : environmental.pressureHpa.toFixed(1)+' hPa';
  const altitudeText = environmental?.altitudeM == null ? "no measurement" : environmental.altitudeM.toFixed(0)+' m';
  const headingText = environmental?.headingDeg == null ? "no measurement" :
    environmental.headingDeg.toFixed(0)+'° '+compassDirection(environmental.headingDeg);
  // AstroNav estimated mode requires live calibrated heading + calibrated step/stride.
  const navTelemetry = apiMission?.assessment?.telemetry;
  const navCanEstimate = mode === 'api' && liveMeasured &&
    environmental?.headingCalibrated === true && environmental.headingDeg !== null &&
    typeof navTelemetry?.steps_total === 'number' &&
    typeof navTelemetry?.stride_length_m === 'number' &&
    navTelemetry.stride_length_m >= 0.3 && navTelemetry.stride_length_m <= 1.5;
  const navDeviceId = last?.source==='measured' ? last.deviceId : 'astrovital-esp32-01';
  // Automatically stop API simulation when real device starts sending data.
  useEffect(() => {
    if (mode === 'api' && liveMeasured && running) setRunning(false);
  }, [mode, liveMeasured, running]);
  const connected = mode === 'api' ? liveMeasured : !demoLinkLost;
  const invalidSpO2 = mode === 'api' && apiMission?.assessment?.telemetry.spo2_pct === 0;
  const statusCopy = statusText(assessment.status);
  const filteredEvents = events.filter(e => (logFilter==="all"|| e.kind.includes(logFilter)) && (eventName(e.kind)+' '+e.detail).toLocaleLowerCase('tr').includes(logQuery.toLocaleLowerCase('tr')));
  const latestPulse = samples.filter(s=>s.heartRate!==null).slice(-15).map(s=>s.heartRate as number);
  const latestOxygen = samples.filter(s=>s.spo2!==null).slice(-15).map(s=>s.spo2 as number);
  const latestMovement = samples.slice(-15).map(s=>s.acceleration);
  const metricCards = [
    { title:"Heart rate",value:last?.heartRate==null?'—':String(last.heartRate),unit:'BPM',note:last?.heartRate==null?"Measurement not available":"Last measurement taken",accent:'#39c8e8',chart:latestPulse,icon:'pulse' },
    { title:"Oxygen Saturation",value:last?.spo2==null?'—':String(last.spo2),unit:'%',note:invalidSpO2?"Sensor sending 0 invalid":last?.spo2==null?"Measurement not available":"Estimated SpO₂ · non-clinical",accent:invalidSpO2?'#ffbd59':'#32d6a0',chart:latestOxygen,icon:'activity' },
    { title:"Motion/Acceleration",value:last?last.acceleration.toFixed(2):'—',unit:'g',note:"Accelerometer telemetry",accent:'#ffbd59',chart:latestMovement,icon:'activity' },
    { title:"Sensor Reliability",value:last?String(Math.round(assessment.confidence*100)):'—',unit:'%',note:assessment.usable?"Available for evaluation":"Verification required",accent:assessment.usable?'#32d6a0':'#ff6474',chart:samples.slice(-15).map(s=>s.quality*100),icon:'shield' },
  ];

  const changeCalibration = async (action: 'start'|'stop'|'resume'|'disable-monitoring') => {
    setCalibrationActionError('');
    if(showHotspotOperatorField && !hotspotOperatorKey.trim()){
      const text="To check CSV via AstroHotspot, you must enter the Pi operator key.";
      setCalibrationActionError(text);
      setNotice(text);
      return;
    }
    if(mode!=='api' || !backendOnline) {
      setNotice("Calibration is only available in live FastAPI mode.");
      return;
    }
    if((action==='start'||action==='resume') && !calibrationConsent) {
      setNotice("You must verify the participant's informed consent.");
      return;
    }
    if(action==='resume' && !sameParticipant) {
      setNotice("You must verify that the same person is measured as the previous CSV.");
      return;
    }
    setCalibrationBusy(true);
    try {
      const calibrationPath='/api/v1/calibration/'+action;
      const calibrationOptions={
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          ...(hotspotOperatorKey.trim()?{'X-AstroVital-Operator-Key':hotspotOperatorKey.trim()}:{})
        },
        body:JSON.stringify(action==='start'?{consent:true}:
          action==='resume'?{consent:true,same_participant:true}:{}),
      };
      const hotspot=window.location.hostname==='192.168.4.1';
      // The main backend was not restarted while there was an active AstroNav task.
      // Gecici 8001 operator koprusu CSV komutlarini mevcut backend'e iletir.
      // Pi yeniden acildiginda backend dogrudan anahtar destekler; 8001 yoksa 8000'e don.
      let response:Response;
      if(hotspot){
        try{
          response=await fetch(window.location.protocol+'//192.168.4.1:8001'+calibrationPath,calibrationOptions);
        }catch{
          response=await fetch(API+calibrationPath,calibrationOptions);
        }
      }else{
        response=await fetch(API+calibrationPath,calibrationOptions);
      }
      if(!response.ok) {
        if(response.status===403){setShowHotspotOperatorField(true);throw new Error("An operator key is required for this connection. Check the key and try again.");}
        const body=await response.json().catch(()=>({detail:"The server rejected the request"}));
        throw new Error(typeof body.detail==='string'?body.detail:"Calibration request rejected");
      }
      setCalibrationActionError('');
      await refreshApi();
      setCalibrationConsent(false);
      setSameParticipant(false);
      setNotice(action==='start'
        ? "Approved CSV registration started; personal reference reset."
        : action==='stop' ? "CSV recording stopped. Personal analysis based on participant consent is ongoing."
        : action==='resume' ? "The previous CSV reference from the same participant was loaded; new CSV record was not opened."
        : "Personal analysis is terminated.");
    } catch(e) {
      const text=e instanceof Error?e.message:"Calibration connection error.";
      setCalibrationActionError(text);
      setNotice(text);
    } finally {setCalibrationBusy(false);}
  };

  const calibrationPanel = <div className="calibration-panel">
    <div className="calibration-info">
      <Pill tone={calibration?.active?'good':'neutral'}>{calibration?.active?"CSV RECORDING ON": "CSV logging is OFF"}</Pill>
      <Pill tone={calibration?.monitoring_enabled?'good':'neutral'}>{calibration?.monitoring_enabled?"PERSONAL ANALYSIS ON":"ANALYSIS OFF"}</Pill>
      <span>CSV recording and personal anomaly tracking are separate operations. The analysis opened with the participant's approval can continue even when the CSV is closed. It is not a medical diagnosis.</span>
    </div>
    <div className={'calibration-state calibration-state-'+missionAnalysis.state} role="status">
      <strong>{missionAnalysis.label}</strong>
      {missionAnalysis.category && <span>{missionAnalysis.category}</span>}
      <p><b>ASTRONAUUT / MISSION PROPOSAL:</b> {missionAnalysis.recommendation}</p>
      <small>Son karar: {calibration?.analysis_status??'inactive'} · Prototype with personal reference; It is not a clinical diagnosis.</small>
    </div>
    <div className="calibration-stats">
      <StatLine label="Stage" value={calibration?.phase==='baseline'?"Personal reference collection"
        :calibration?.phase==='monitoring'?"Comparison with reference"
        :calibration?.phase==='finished'?"Session completed":"Signed out"}/>
      <StatLine label="CSV sample count" value={calibration?calibration.sample_count+'/'+calibration.max_samples:'—'}/>
      <StatLine label="quality sample" value={calibration?String(calibration.quality_accepted_count):'—'}/>
      <StatLine label="pulse reference" value={calibration?.baseline?.heart_rate_bpm?.median!=null
        ?calibration.baseline.heart_rate_bpm.median.toFixed(1)+' BPM'
        :"Expected ("+(calibration?.baseline?.heart_rate_bpm?.count??0)+'/20)'}/>
      <StatLine label="SpO₂ reference" value={calibration?.baseline?.spo2_pct?.median!=null
        ?calibration.baseline.spo2_pct.median.toFixed(1)+' %'
        :"Expected ("+(calibration?.baseline?.spo2_pct?.count??0)+'/20)'}/>
      <StatLine label="Number of anomaly candidates" value={String(calibration?.anomaly_count??0)}/>
      <StatLine label="Anomali izleme durumu" value={missionAnalysis.label}/>
      <StatLine label="CSV file (on Pi)" value={calibration?.csv_filename??"Registration has not started"}/>
    </div>
    {(calibration?.current_anomaly||calibration?.last_anomaly)&&<div className="calibration-alert" role="status">
      <strong>{calibration.current_anomaly?"ANOMALY CANDIDATE THAT SHOULD BE EXAMINED":"LAST EXAMINED DEVIATION CANDIDATE"}</strong>
      <p>{(calibration.current_anomaly||calibration.last_anomaly)?.recommendation}</p>
      <small>Unconfirmed statistical bias. Assess data quality and self-report; It is not a clinical diagnosis.</small>
    </div>}
    {calibration?.quality_warning && calibration.active && <div className="calibration-quality">{calibration.quality_warning}</div>}
    {!calibration?.active && <>
      <label className="calibration-consent">
        <input type="checkbox" checked={calibrationConsent} onChange={e=>setCalibrationConsent(e.target.checked)} />
        <span>I obtained the participant's informed consent for personal data analysis.</span>
      </label>
      <label className="calibration-consent">
        <input type="checkbox" checked={sameParticipant} onChange={e=>setSameParticipant(e.target.checked)} />
        <span>If I was going to use the previous CSV data, I confirmed that it was from the same astronaut.</span>
      </label>
    </>}
    {showHotspotOperatorField && <div className="calibration-operator">
      <label htmlFor="astro-hotspot-operator-key">AstroHotspot operator key</label>
      <input id="astro-hotspot-operator-key" type="password" autoComplete="off"
        spellCheck={false} value={hotspotOperatorKey}
        onChange={e=>{setHotspotOperatorKey(e.target.value);setCalibrationActionError('');}}
        placeholder="Enter Raspberry Pi operator key" />
      <small>For wireless CSV control only. The key is not saved in the browser.</small>
    </div>}
    {calibrationActionError && <div className="calibration-quality" role="alert">{calibrationActionError}</div>}
    {!calibration?.active && !calibrationConsent &&
      <small>For the new CSV calibration, first check the participant confirmation box above.</small>}
    <div className="calibration-actions">
      {calibration?.active
        ? <button className="btn btn-secondary" onClick={()=>void changeCalibration('stop')} disabled={calibrationBusy}>Stop CSV recording, continue analysis</button>
        : <>
          {calibration?.monitoring_enabled && <button className="btn btn-secondary" onClick={()=>void changeCalibration('disable-monitoring')} disabled={calibrationBusy||mode!=='api'||!backendOnline}>End personal analysis</button>}
          {!calibration?.monitoring_enabled && <button className="btn btn-secondary" onClick={()=>void changeCalibration('resume')}
            disabled={calibrationBusy||!calibrationConsent||!sameParticipant||mode!=='api'||!backendOnline}>Start analysis from previous CSV</button>}
          <button className="btn btn-primary" onClick={()=>void changeCalibration('start')}
            disabled={calibrationBusy||!calibrationConsent||mode!=='api'||!backendOnline}>{calibration?.monitoring_enabled?"Create new personal reference":"Start New CSV Calibration"}</button>
        </>}
      <small>CSV record is opened only with confirmation. Analysis may take place in RAM; If the backend restarts, the previous CSV of the same person should be loaded again with confirmation.</small>
    </div>
  </div>;

  const records = <div className="event-list">
    {filteredEvents.length ? filteredEvents.slice(0,page==='overview'?5:80).map(ev=><button className="event" key={ev.id} onClick={()=>setExpandedEvent(expandedEvent===ev.id?null:ev.id)}>
      <div className="event-icon"><Icon name={ev.kind.includes('loss')?'alert':ev.kind.includes('self')||ev.kind.includes('check')?'clipboard':'activity'} size={16}/></div>
      <div className="event-text"><strong>{eventName(ev.kind)}</strong><span>{expandedEvent===ev.id?ev.detail:ev.source==='api'?"Backend recording · Click for details":ev.detail}</span></div>
      <div className="event-right"><time>{clockTime(ev.at)}</time><Icon name="chevron" size={15}/></div>
    </button>) : emptyLog("No records found for the selected filter")}
  </div>;

  const confidencePanel = <div className="confidence-card">
    <div className="confidence-top"><div className="score-circle" style={{'--score':`${Math.round(assessment.confidence*100)}%`} as CSSProperties}>
      <strong>{last?Math.round(assessment.confidence*100):'—'}</strong><span>{last?' / 100':"no data"}</span></div>
      <div><h4>Sensor Confidence Engine</h4><Pill tone={assessment.usable?'good':'warn'}>{assessment.usable?"Data available":"Data must be verified"}</Pill><p>Signal, motion and timestamp control</p></div></div>
    <Progress value={assessment.confidence*100} tone={assessment.usable?'green':'orange'}/>
    <div className="quality-list"><StatLine label="Signal quality" value={last?Math.round(last.quality*100)+'%':'—'}/>
      <StatLine label="Package age" value={latestSeconds===null?'—':latestSeconds+' sn'}/>
      <StatLine label="Source" value={sourceLabel}/></div>
    {assessment.reasons.length>0 && <div className="reason"><Icon name="alert" size={16}/><span>{assessment.reasons.join(' · ')}</span></div>}
  </div>;

  const hadsePanel = <div className="hadse-content">
    <div className={`hadse-status hadse-${assessment.status}`}><div className="hadse-symbol"><Icon name={assessment.status==='continue'?'check':'alert'} size={24}/></div>
      <div><span>CURRENT RATING</span><h3>{statusCopy}</h3><p>{assessment.explanation}</p></div></div>
    <div className="hadse-actions"><div><span className="eyebrow">{assessment.status==='abstain'?"SAFE MODE · NO SUGGESTIONS":"RECOMMENDED NEXT STEP"}</span>
      <strong>{!assessment.usable?"Verify measurement":assessment.status==='review'?"Contact mission control (demo)":"keep watching"}</strong>
      <small>HADSE is a rule-based prototype. It does not make a diagnosis and does not provide clinical instructions.</small></div>
      <button className="btn btn-secondary" onClick={()=>setPage(assessment.usable?'voice':'sensors')}>Review <Icon name="arrow" size={15}/></button></div>
  </div>;

  const topIntro:Record<Page,{eyebrow:string;title:string;subtitle:string}>={
    overview:{eyebrow:"MISSION CENTER / GENERAL SITUATION",title:"Task Overview",subtitle:"Monitor astronaut health and mission telemetry from a single center."},
    telemetry:{eyebrow:"REAL-TIME MONITORING",title:"Live Telemetry",subtitle:"Examine measurements, signal reliability, and changes over time."},
    hadse:{eyebrow:"DECISION SUPPORT SYSTEM",title:"Health Analysis and HADSE",subtitle:"Data quality checks and explainable operational evaluations."},
    astronav:{eyebrow:"ASTRONAV/LIVE RELATIVE POSITION",title:"AstroNav | Return to Base",subtitle:"Track tracking and base direction calculation with ESP32 step and compass telemetry. Simulation is not used."},
    voice:{eyebrow:"MISSION COMMUNICATION / LIVE PCM",title:"Voice Communication (Radio)",subtitle:"Listening and push-to-talk via 8 kHz WebSocket with ESP32; visual search demos are separate."},
    blackbox:{eyebrow:'MISSION BLACK BOX',title:"Mission Logs",subtitle:"Timeline of measurement, linkage and self-assessment events."},
    sensors:{eyebrow:"DEVICE STATUS",title:"Sensors and Connectivity",subtitle:"Monitor data flow, communication chain and hardware status."},
    notifications:{eyebrow:"TASK NOTIFICATIONS",title:'Bildirimler',subtitle:"Logs and system events that require attention."},
    settings:{eyebrow:"TASK CONFIGURATION",title:'Ayarlar / Oturum',subtitle:"Local display, data source, and task display preferences."},
  };
  const intro=topIntro[page];
  const metricStrip=<div className="metric-grid">{metricCards.map(card=><Metric key={card.title} {...card}/>)}</div>;
  const chartControls=<div className="chart-controls"><div className="segment">{SERIES.map(s=><button key={s.key} className={series===s.key?'selected':''} onClick={()=>setSeries(s.key)}>{s.name}</button>)}</div>
    <div className="chart-actions"><select value={timeRange} onChange={e=>setTimeRange(e.target.value)} aria-label="time range">
      {['5 dk','15 dk','1 saat','24 saat'].map(t=><option key={t}>{t}</option>)}</select>
      <button className="icon-button" onClick={()=>{if(paused){setPaused(false);setFrozenSamples(null);}else{setFrozenSamples(visibleSamples);setPaused(true);}}} title={paused?"Resume chart":"Pause chart"}><Icon name={paused?'play':'pause'} size={17}/></button></div></div>;

  return <div className="app-shell">
    {mobileNav && <button className="mobile-backdrop" aria-label="close menu" onClick={()=>setMobileNav(false)}/>}
    <aside className={`sidebar ${mobileNav?'sidebar-open':''}`}>
      <div className="brand"><div><strong>AstroVital X</strong><small>CREW HEALTH SYSTEM</small></div></div>
      <div className="figma-mission-box"><strong>{missionId}</strong><span>Mars research station</span></div>
      <div className="mission-label"><span className={backendOnline?'dot dot-good':'dot dot-warn'}/>{backendOnline?"LOCAL SYSTEM ENABLED":"WAITING FOR API CONNECTION"}</div>
      <nav className="side-nav">{NAV.map((item,i)=><div key={item.id}>
        {(i===0||NAV[i-1].section!==item.section)&&<div className="nav-heading">{item.section}</div>}
        <button className={`nav-item ${page===item.id?'active':''}`} onClick={()=>{setPage(item.id);setMobileNav(false);setNotice('');}}>
          <Icon name={item.icon} size={19}/><span>{item.label}</span>{page===item.id&&<span className="nav-active-dot"/>}</button>
      </div>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-card"><div className="mini-device"><Icon name="radio" size={17}/> <strong>Connection Status</strong><span className={`mini-dot ${connected?'on':'off'}`}/></div>
        <StatLine label="Data source" value={mode==='sim'?'Yerel demo':'FastAPI'}/>
        <StatLine label="Cihaz" value={liveMeasured?'ESP32 · CANLI':fromSensor?"ESP32 · DATA OLD":'Demo / Bekliyor'}/>
        <StatLine label="Device ID" value={mode==='api'?(last?.deviceId||'Waiting'):'ASTRO-X-DEMO'}/>
        <StatLine label="Sunucu" value={backendOnline?"online":"offline"}/>
      </div><div className="sidebar-disclaimer">It is not a NASA approved or clinical system.</div></div>
    </aside>

    <div className="main-column">
      <header className="topbar">
        <button className="mobile-menu" onClick={()=>setMobileNav(true)} aria-label="open menu"><Icon name="menu"/></button>
        <div className="figma-top-stats"><div><span>DUTY</span><strong>{missionId}</strong></div>
          <div><span>CREW</span><strong>ASTRO-01</strong></div>
          <div><span>TERM OF OFFICE</span><strong>YEREL OTURUM</strong></div></div>
        <div className="topbar-right">
          <div className="figma-connection-status"><span className={backendOnline?'live-dot':'live-dot muted-dot'}/>
            <div><strong>{backendOnline?"API connected":"API offline"}</strong>
              <span>{liveMeasured?"ESP32 streaming live":apiSyncDelayed?"Mission data is delayed":fromSensor?'ESP32 data is stale':"ESP32 is expected"} · Last telemetry: {last?clockTime(last.observedAt):'—'}</span></div></div>
          <button className="notification-button" onClick={()=>setPage('notifications')} aria-label="Turn on notifications"><Icon name="bell" size={19}/>{events.some(e=>e.kind.includes('loss'))&&<span/>}</button>
        </div>
      </header>

      <main className="content">
        <div className="page-heading"><div>
          {page!=='overview'&&<span className="eyebrow">{intro.eyebrow}</span>}
          <h1>{page==='overview'?"Overview":intro.title}</h1>
          <p>{page==='overview'?"Instant health view and priority mission actions.":intro.subtitle}</p></div>
          <div className="heading-status"><span>{new Intl.DateTimeFormat('en-US',{day:'2-digit',month:'short',year:'numeric',timeZone:'Europe/Istanbul'}).format(new Date(now)).toUpperCase()}</span><span>{sourceLabel}</span></div></div>
        {page==='overview'&&<div className="figma-overview-disclaimer"><strong>{mode==='sim'?"SIMULATION":fromSensor?"ESP32 TELEMETRY":"WAITING FOR MEASUREMENT"}</strong><span>{mode==='sim'?"This mode shows only synthetic sample data. It is not actual ESP32 measurement.":"ESP32 sensor measurements are displayed by indicating their source and current date. If the connection is lost, the last measurement is marked as old."} The prototype is not a clinical diagnosis or validated astronaut health standard.</span></div>}
        {page !== 'overview' && mode === 'api' && last?.source === 'measured' && <div className={liveMeasured?'device-live-banner':'device-live-banner device-stale-banner'}>
          <Icon name="radio" size={18}/><strong>{liveMeasured?"ESP32 LIVE CONNECTED":"ESP32 TELEMETRY IS NOT UPDATED"}</strong>
          <span>{last.deviceId} · Paket #{last.sequence} · {latestSeconds ?? '—'} seconds ago</span>
          {invalidSpO2 && <span className="invalid-measurement">SpO₂ = 0 invalid, not displayed</span>}
        </div>}
        {notice && <div className="notice" role="status"><Icon name="alert" size={18}/>{notice}<button onClick={()=>setNotice('')} aria-label="Bildirimi kapat">×</button></div>}


        {page==='overview' && <>
          <div className="figma-section-row"><h2>Astronaut Health Status</h2>
            <span className={liveMeasured?'figma-live-label':'figma-live-label demo-label'}><span className={liveMeasured?'live-dot':'live-dot muted-dot'}/>{liveMeasured?"LIVE VIEWING":mode==='sim'?"DEMO / SIMULATION":"WAITING FOR DATA"}</span>
          </div>
          {metricStrip}
          <section className="figma-telemetry-panel">
            <div className="figma-panel-top">
              <div><h3>Live Health Telemetry</h3><p>Source separated time series · Pulse, estimated SpO₂, movement</p></div>
              <div className="figma-panel-controls">
                <span className={liveMeasured?'figma-live-label':'figma-live-label demo-label'}><span className={liveMeasured?'live-dot':'live-dot muted-dot'}/>{liveMeasured?"Live":"impression"}</span>
                <select aria-label="Telemetry time interval" value={timeRange} onChange={e=>setTimeRange(e.target.value)}>{['5 dk','15 dk','1 saat','24 saat'].map(t=><option key={t}>{t}</option>)}</select>
                <button className="icon-button" onClick={()=>{if(paused){setPaused(false);setFrozenSamples(null);}else{setFrozenSamples(visibleSamples);setPaused(true);}}} title={paused?"Resume chart":"Pause chart"}><Icon name={paused?'play':'pause'} size={15}/></button>
              </div>
            </div>
            <OverviewTelemetryChart samples={chartSamples}/>
          </section>
          <div className="figma-middle-grid">
            <Panel title="HADSE | Health Evaluation System" className="figma-compact-panel">
              <div className="figma-hadse-compact">
                <div className="figma-hadse-status"><span className={assessment.usable?'dot dot-good':'dot dot-warn'}/><strong>HADSE: {statusCopy}</strong><small>{last?clockTime(last.observedAt):"Measurement pending"} · {sourceLabel}</small></div>
                <div className={'figma-mission-analysis figma-mission-analysis-'+missionAnalysis.state} role="status" aria-label="Personal anomaly monitoring status">
                  <div className="figma-mission-analysis-head"><Icon name={missionAnalysis.state==='normal'?'check':'alert'} size={16}/><strong>{missionAnalysis.label}</strong></div>
                  {missionAnalysis.category && <strong className="figma-mission-analysis-category">{missionAnalysis.category}</strong>}
                  {missionAnalysis.confirmation && <small>{missionAnalysis.confirmation}</small>}
                  <p><b>QUEST SUGGESTION:</b> {missionAnalysis.recommendation}</p>
                  <small>Personal reference research prototype · Not a clinical diagnosis or fitness for duty endorsement.</small>
                </div>
                <div><button className="btn btn-primary" onClick={()=>setPage('hadse')}>Examine HADSE and Suggestion</button><span className="figma-fineprint">The status is constantly displayed.</span></div>
              </div>
            </Panel>
            <Panel title="Live Voice Communication (Wireless)" className="figma-compact-panel" action={<Pill tone="info">8 kHz PCM</Pill>}>
              <LiveRadioSummary onOpen={()=>setPage('voice')}/>
            </Panel>
          </div>
          {<Panel title="AstroNav | Return to Base" subtitle="Relative position, 10 m route and clear operator confirmation" action={<Pill tone="info">SYNTHETIC MAP</Pill>}>
            <AstroNavSummary apiBase={API} onOpen={()=>setPage('astronav')}/>
          </Panel>}
          <div className="figma-bottom-grid">
            <Panel title="Environment and Compass" className="figma-bottom-panel" action={<span className={liveMeasured?'figma-live-label':'figma-env-source'}>{envStatus}</span>}>
              <div className="figma-detail-list">
                <p>ESP32 · BMP180 and magnetometer · Last measurement taken</p>
                <StatLine label="Heat" value={temperatureText}/>
                <StatLine label="Pressure" value={pressureText}/>
                <StatLine label="estimated altitude" value={altitudeText}/>
                <StatLine label="compass direction" value={headingText}/>
                <small className="figma-env-note">Altitude is calculated from pressure. {environmental?.headingDeg != null ? environmental.headingCalibrated ? "The compass has been calibrated." : "Compass calibration required." : "Compass measurement awaited."}</small>
              </div>
            </Panel>
            <Panel title="Mission Logs" className="figma-bottom-panel" action={<button className="text-button" onClick={()=>setPage('blackbox')}>All records <Icon name="arrow" size={13}/></button>}>{records}</Panel>
            <Panel title="Connection Architecture" className="figma-bottom-panel">
              <div className="figma-link-summary">
                <p>Wearable → Local station → World</p>
                <span><i className={liveMeasured?'dot dot-good':'dot dot-warn'}/>{liveMeasured?"ESP32 connected":"ESP32 is expected"} · {backendOnline?'Local system active':"API offline"}</span>
                <span><i className="dot dot-warn"/>World line: <strong>DEMO · not integrated</strong></span>
                <small>Local data streaming is provided via real API. Remote communication is a separate future feature.</small>
              </div>
            </Panel>
          </div>
          <div className="figma-reference-note"><span>NASA SPACE APPS / 2026</span><span>RESEARCH PROTOTYPE · NOT A CLINICAL SYSTEM</span></div>
        </>}

        {page==='telemetry' && <>{metricStrip}<Panel title="Health Data Stream" subtitle="Sensor measurements plotted by source and time" action={<Pill tone={connected?'good':'bad'}>{connected?"THERE IS CONNECTION":"NO CONNECTION"}</Pill>}>
          {chartControls}<TelemetryChart samples={chartSamples} selected={series} height={330}/>
          <div className="chart-footer"><span>Monitoring range: {timeRange} · Last 48 packages visible</span><span>{samples.length} paket / {sourceLabel}</span></div>
        </Panel><div className="two-col extra-space"><Panel title="Last Measurement" subtitle="Details of instant data package">
          <StatLine label="Device ID" value={last?.deviceId||'—'}/><StatLine label="package order" value={last?String(last.sequence):'—'}/>
          <StatLine label="measurement time" value={last?clockTime(last.observedAt):'—'}/><StatLine label="Data source" value={sourceLabel}/>
          <StatLine label="Hareket / ivme" value={last?last.acceleration.toFixed(3)+' g':'—'}/>
          <StatLine label="Heat" value={temperatureText}/><StatLine label="Pressure" value={pressureText}/>
          <StatLine label="estimated altitude" value={altitudeText}/><StatLine label="compass direction" value={headingText}/></Panel>
          <Panel title="Data Quality" subtitle="Error and missing measurement control">{confidencePanel}</Panel></div>
        </>}

        {page==='hadse' && <><div className="two-col hadse-page"><Panel title="Operational Evaluation" subtitle="Limited, explainable decision support system">{hadsePanel}</Panel>
          <Panel title="Measurement Reliability" subtitle="Quality gate before evaluation">{confidencePanel}</Panel></div>
          <Panel title="Personal Calibration and CSV Recording" subtitle="Participant confirmation · actual ESP32 measurements · candidates for explainable bias">{calibrationPanel}</Panel>
          <Panel title="Evaluation Process" subtitle="Monitor → Evaluate → Act"><div className="workflow">
            {[['01',"DATA COLLECTION","Heart rate, estimated SpO₂, movement and self-report"],['02',"VERIFICATION","Signal quality, motion and timestamp"],['03',"EVALUATION","Rule-based analysis, abstaining when necessary"],['04',"ACTION AND REGISTRATION","Human review and Mission Black Box"]].map(x=><div className="workflow-step" key={x[0]}><span>{x[0]}</span><strong>{x[1]}</strong><p>{x[2]}</p></div>)}</div></Panel>
          <div className="science-note"><Icon name="alert" size={18}/><div><strong>It is not a clinical system</strong><span>This tool does not produce a medical risk percentage, diagnosis, or treatment recommendation to replace a doctor. Mission health protocol should be followed if necessary.</span></div></div>
        </>}

        {page==='astronav' && <Panel title="AstroNav | Navigation and Return to Base" subtitle="Pitch and compass prediction · Synthetic A/B/C alternatives · Explicit confirmation" action={<Pill tone="warn">RELATIVE / DEMO</Pill>}>
          <AstroNavPanel apiBase={API} deviceId={navDeviceId}
            canEstimate={navCanEstimate} sensorHeading={environmental?.headingDeg??null}/>
        </Panel>}

        {page==='voice' && <>
          <Panel title="Live Voice Communication (Wireless)" subtitle="ESP32 ↔ Raspberry Pi ↔ Dashboard true 8 kHz PCM audio bridge" action={<Pill tone="good">CANLI WS</Pill>}>
            <LiveRadioPanel/>
          </Panel>
          <Panel title="Visual Search Simulation" subtitle="Separate popup demos that do not use a real microphone or radio connection" action={<Pill tone="info">DEMO</Pill>}>
            <VoiceCallPanel onStart={openVoiceCall}/>
          </Panel>
        </>}

        {page==='blackbox' && <Panel title="Mission Event Log" subtitle="Timestamped, source-separated events" action={<Pill tone="info">{filteredEvents.length} RECORD</Pill>}>
          <div className="filter-row"><label className="search-field"><Icon name="search" size={17}/><input value={logQuery} onChange={e=>setLogQuery(e.target.value)} placeholder="Search the records..."/></label>
            <select aria-label="Event filter" value={logFilter} onChange={e=>setLogFilter(e.target.value)}><option value="all">All events</option><option value="telemetry">Telemetry</option><option value="self">Self assessment</option><option value="loss">connection loss</option></select></div>
          {records}</Panel>}

        {page==='sensors' && <><Panel title="Communication Architecture" subtitle="Local processing and World connectivity are separate layers"><div className="connection-flow">
          <div className="connection-node"><div className="node-icon"><Icon name="activity" size={27}/></div><strong>Wearable Device</strong><span>ESP32 / MAX30102 / IMU</span><Pill tone={liveMeasured?'good':'warn'}>{liveMeasured?'ESP32 CANLI':fromSensor?"DATA OLD":"NOT AFFILIATE / DEMO"}</Pill></div>
          <div className="connection-arrow"><span>→</span><small>TELEMETRY</small></div>
          <div className="connection-node"><div className="node-icon"><Icon name="monitor" size={27}/></div><strong>Regional station</strong><span>FastAPI / HADSE / SQLite</span><Pill tone={backendOnline?'good':'warn'}>{backendOnline?"API DEPENDENT":"API OFFLINE"}</Pill></div>
          <div className="connection-arrow"><span>→</span><small>NEXT STAGE</small></div>
          <div className="connection-node"><div className="node-icon"><Icon name="radio" size={27}/></div><strong>World Control</strong><span>Remote connection prototype</span><Pill tone="neutral">DEMO · ENTEGRASYON YOK</Pill></div></div></Panel>
          <div className="two-col extra-space"><Panel title="Sensor Data and Environmental Measurements" subtitle="ESP32 sourced, timestamped telemetry">
            <StatLine label="Pulse (BPM)" value={last?.heartRate!=null?String(last.heartRate):"not available"}/>
            <StatLine label="Estimated SpO₂" value={last?.spo2!=null?last.spo2+'%':invalidSpO2?"Invalid (0)":"not available"}/>
            <StatLine label="IMU ivme" value={last?last.acceleration.toFixed(3)+' g':"not available"}/>
            <StatLine label="Temperature (BMP180)" value={temperatureText}/>
            <StatLine label="Atmospheric pressure" value={pressureText}/>
            <StatLine label="Estimated altitude from pressure" value={altitudeText}/>
            <StatLine label="compass direction" value={headingText}/>
            <StatLine label="Compass calibration" value={environmental?.headingDeg == null ? "no measurement" : environmental.headingCalibrated ? 'Kalibre' : 'Gerekli'}/>
            <StatLine label="Environmental data source" value={envStatus}/>
            <StatLine label="Radyasyon dozu" value="DEMO · No sensor"/><StatLine label="bone density" value="DEMO · Cannot be measured"/>
          </Panel><Panel title="Connection Diagnostics" subtitle="State of actual API and data sources">
            <StatLine label="Task synchronization" value={apiSyncDelayed?"Temporary delay / last data preserved":"Normal"}/>
            <StatLine label="FastAPI" value={backendOnline?"accessible":"Closed"}/>
            <StatLine label="ESP32 data stream" value={liveMeasured?'Yeni paketler geliyor':"New package is expected"}/>
            <StatLine label="Device timestamp" value={!last?'—':measurementTimestampFresh?"in 5 seconds":"Exceeded 5 second limit (check time difference)"}/>
            <StatLine label="Dashboard modu" value={mode==='sim'?"local simulation":'Backend telemetrisi'}/>
            <StatLine label="New packet flow" value={connected?'Active':'Interrupted'}/><StatLine label="Last packet" value={latestSeconds===null?'—':latestSeconds+" seconds ago"}/>
            <div className="row-button"><button className="btn btn-secondary" onClick={()=>void refreshApi()}><Icon name="refresh" size={16}/> Check Again</button></div>
          </Panel></div></>}

        {page==='notifications' && <Panel title="Task Statements" subtitle="Link and review events">
          <div className="notification-list">{events.filter(e=>e.kind.includes('loss')||e.kind.includes('check')||e.kind.includes('decision')).slice(0,20).map(e=><div className="notification-item" key={e.id}><Icon name="bell" size={19}/><div><strong>{eventName(e.kind)}</strong><p>{e.detail}</p></div><time>{clockTime(e.at)}</time></div>)}
            {!events.some(e=>e.kind.includes('loss')||e.kind.includes('check')||e.kind.includes('decision'))&&emptyLog('No system alerts require attention.')}</div></Panel>}

        {page==='settings' && <div className="two-col settings-page"><Panel title="Data Source" subtitle="Select the telemetry stream to show">
          <div className="mode-options"><button className={mode==='sim'?'mode-option active':'mode-option'} onClick={()=>{setMode('sim');setRunning(false);setPaused(false);setFrozenSamples(null)}}><Icon name="play"/><div><strong>Local Simulation</strong><span>Sample data working without backend</span></div>{mode==='sim'&&<Icon name="check" size={18}/>}</button>
            <button className={mode==='api'?'mode-option active':'mode-option'} onClick={()=>{setMode('api');setRunning(false);setPaused(false);setFrozenSamples(null)}}><Icon name="radio"/><div><strong>Live FastAPI</strong><span>Task data received via Pi/server</span></div>{mode==='api'&&<Icon name="check" size={18}/>}</button></div>
          <p className="small-copy">Simulated values ​​are not actual astronaut measurements. The LIVE API can also send simulation packets; Each package carries a source label.</p>
        </Panel><Panel title="Mission Information" subtitle="Local display preferences">
          <label className="field-label" htmlFor="missionid">Task ID</label><input id="missionid" className="text-input" value={missionId} maxLength={24} onChange={e=>setMissionId(e.target.value.toUpperCase())}/>
          <div className="setting-note">Astronaut: ASTRO-01 · Time zone: UTC · Interface: Turkish</div>
        </Panel></div>}

        <div className={page==='overview'?'demo-console overview-hide':'demo-console'}><div className="console-main"><div className="console-title"><span className="console-pulse"/><div><strong>Mission Simulator</strong><small>Test flow that does not require hardware</small></div></div>
          <div className="console-controls"><select value={scenario} aria-label="Simulation scenario" onChange={e=>setScenario(e.target.value as Scenario)}>{SCENARIOS.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select>
            <button className="btn btn-outline" onClick={()=>void step()} disabled={running||liveMeasured}><Icon name="arrow" size={15}/> One Step</button>
            <button className="btn btn-primary" disabled={liveMeasured} onClick={()=>setRunning(r=>!r)}><Icon name={running?'pause':'play'} size={17}/>{running?'Pause':"Start Simulation"}</button></div></div>
          <div className="console-bottom"><span>{running?"● ONE PACKAGE EVERY 2 SECONDS":"○ SIMULATION PAUSED"}</span><span>{liveMeasured?"API simulation is off when ESP32 is connected":SCENARIOS.find(s=>s.id===scenario)?.description}</span><strong>{mode==='sim'?'YEREL DEMO':'FASTAPI MODU'}</strong></div></div>

        <footer className="footer"><span>ASTROVITAL X / MARSUP-01</span><span>RESEARCH PROTOTYPE · NOT A CLINICAL SYSTEM</span><span>V 1.0.0</span></footer>
      </main>
    </div>
    {voiceCall && <VoiceCallModal key={voiceCall.target+voiceCall.direction} target={voiceCall.target}
      direction={voiceCall.direction} onClose={closeVoiceCall}/>}
  </div>;
}
