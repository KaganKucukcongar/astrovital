import { useCallback, useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import {
  SCENARIOS, assessSample, ageSeconds, clockTime, createDemoSample, describeConfidenceReason, isLiveMeasured, mapApiTelemetry, nowStamp,
  type Assessment, type CheckStatus, type LogEvent, type Page, type Sample, type Scenario
} from './domain';

const API = import.meta.env.VITE_API_BASE || `${window.location.protocol}//${window.location.hostname}:8000`;

type ApiMission = {
  assessment: {
    telemetry: Record<string, unknown>;
    confidence: { score: number; usable: boolean; reasons: string[] };
    decision: { status: Assessment['status']; score: number | null; reason: string };
  } | null;
  self_check: { status: CheckStatus; recorded_at: string } | null;
  link_status: 'connected' | 'lost' | 'unknown';
};
const NAV: { id: Page; label: string; icon: string; section: string }[] = [
  { id: 'overview', label: 'Genel Bakış', icon: 'grid', section: 'İZLEME' },
  { id: 'telemetry', label: 'Canlı Telemetri', icon: 'activity', section: 'İZLEME' },
  { id: 'hadse', label: 'Sağlık Analizi', icon: 'pulse', section: 'İZLEME' },
  { id: 'selfcheck', label: 'Astronot Kontrolü', icon: 'clipboard', section: 'İZLEME' },
  { id: 'blackbox', label: 'Görev Kayıtları', icon: 'database', section: 'SİSTEM' },
  { id: 'sensors', label: 'Sensörler ve Bağlantı', icon: 'radio', section: 'SİSTEM' },
  { id: 'notifications', label: 'Bildirimler', icon: 'bell', section: 'SİSTEM' },
  { id: 'settings', label: 'Ayarlar / Oturum', icon: 'settings', section: 'SİSTEM' }
];

const ICON_PATHS: Record<string, ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  activity: <path d="M2 12h4l3-7 4 14 3-7h6"/>,
  pulse: <><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0l-1 1-1-1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/><path d="M4 12h4l2-3 3 6 2-3h4"/></>,
  clipboard: <><rect x="5" y="4" width="14" height="18" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="m9 14 2 2 4-5"/></>,
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
  return <svg viewBox="0 0 124 52" className="tiny-chart" aria-label="Ölçüm eğilimi">
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
  { key: 'heartRate', name: 'Nabız', unit: 'BPM', color: '#39c8e8' },
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
    <svg viewBox="0 0 840 274" role="img" aria-label={`${series.name} zaman içindeki ölçümler`} style={{ height }}>
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
    {data.length < 2 && <div className="chart-empty">Grafik için en az iki geçerli ölçüm gerekiyor</div>}
  </div>;
}
function StatLine({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div className="stat-line"><span>{label}</span><strong className={tone || ''}>{value}</strong></div>;
}
function Progress({ value, tone = 'cyan' }: { value: number; tone?: string }) {
  return <div className="progress"><div className={`progress-${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }}/></div>;
}
function emptyLog(text: string) { return <div className="empty-state"><Icon name="database" size={30}/><strong>Henüz kayıt yok</strong><span>{text}</span></div>; }
function statusText(s: Assessment['status']) {
  return s === 'continue' ? 'İzleme sürüyor' : s === 'review' ? 'İnsan değerlendirmesi gerekli' : 'Öneri üretilmedi';
}
function statusTone(s: Assessment['status']): 'good'|'warn'|'bad' { return s==='continue'?'good':s==='review'?'warn':'bad'; }
function eventName(kind: string) {
  const names: Record<string,string> = { telemetry_assessed:'Telemetri değerlendirildi', route_plan_changed:'Rota değerlendirmesi güncellendi',
    self_check:'Astronot öz değerlendirmesi', decision_updated:'HADSE yeniden değerlendirildi', simulation_link_loss:'Bağlantı kaybı',
    'demo-start':'Demo oturumu açıldı', 'demo-packet':'Simülasyon telemetrisi', 'demo-no-signal':'Simüle bağlantı kaybı',
    'demo-check':'Öz değerlendirme kaydedildi' };
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
  const [demoEvents, setDemoEvents] = useState<LogEvent[]>([{ id:'start',kind:'demo-start',at:nowStamp(),detail:'Yerel örnek oturumu başlatıldı',source:'simulated' as const }]);
  const [check, setCheck] = useState<CheckStatus | null>(null);
  const [checkAnswers, setCheckAnswers] = useState<Record<string,string>>({});
  const [apiCheck, setApiCheck] = useState<CheckStatus | null>(null);
  const [lastCheckAt, setLastCheckAt] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [series, setSeries] = useState<SeriesKey>('heartRate');
  const [timeRange, setTimeRange] = useState('15 dk');
  const [paused, setPaused] = useState(false);
  const [frozenSamples, setFrozenSamples] = useState<Sample[] | null>(null);
  const [logQuery, setLogQuery] = useState('');
  const [logFilter, setLogFilter] = useState('tümü');
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);
  const [missionId, setMissionId] = useState('MARSUP-01');
  const [mobileNav, setMobileNav] = useState(false);
  const [demoLinkLost, setDemoLinkLost] = useState(false);
  const seq = useRef(18);

  const refreshApi = useCallback(async () => {
    try {
      const [health, mission, events] = await Promise.all([
        fetch(`${API}/health`), fetch(`${API}/api/v1/mission/status`), fetch(`${API}/api/v1/events?limit=80`)
      ]);
      if (!health.ok || !mission.ok || !events.ok) throw new Error('API yanıt vermiyor');
      const data = await mission.json() as ApiMission;
      const log = await events.json() as { events: { id:number; kind:string; occurred_at:string; payload:Record<string,unknown> }[] };
      setBackendOnline(true); setApiMission(data);
      setApiCheck(data.self_check?.status ?? null);
      setApiEvents(log.events.map(e => ({ id:String(e.id), kind:e.kind, at:e.occurred_at,
        detail:e.kind==='telemetry_assessed'?'FastAPI tarafından değerlendirildi':e.kind==='simulation_link_loss'?'Simülasyon bağlantısı kesildi':'Görev olayı kaydedildi', source:'api' })));
      // API'nin Mission Black Box kayıtları gerçek sensör geçmişini de içerir.
      // Sayfa yenilendiğinde grafik sıfırdan başlamasın.
      const historical = log.events
        .filter(e => e.kind === 'telemetry_assessed' && e.payload?.telemetry && typeof e.payload.telemetry === 'object')
        .map(e => mapApiTelemetry(e.payload.telemetry as Record<string, unknown>))
        .reverse();
      if (data.assessment?.telemetry) historical.push(mapApiTelemetry(data.assessment.telemetry));
      if (historical.length) setApiSamples(current => {
        const unique = new Map<string, Sample>();
        [...current, ...historical].forEach(packet => unique.set(packet.id, packet));
        return [...unique.values()]
          .sort((a,b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime())
          .slice(-150);
      });
    } catch { setBackendOnline(false); }
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
      if (!backendOnline) { setNotice('Backend çevrimdışı. Yerel simülasyonu seçin.'); setRunning(false); return; }
      try {
        const response = await fetch(`${API}/api/v1/simulation/step`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({scenario,sequence:number}) });
        if (!response.ok) throw new Error('HTTP '+response.status);
        void refreshApi(); setNotice('');
      } catch { setNotice('Simülasyon API isteği başarısız.'); setRunning(false); }
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
        detail:'Yeni ölçüm üretilmedi; eski paket güncelliğini kaybedecek',source:'simulated' as const},...s].slice(0,120));
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
  const last = samples.at(-1) || null;
  const apiAssessment = apiMission?.assessment;
  const localAssessment = assessSample(last,check,now);
  const liveMeasured = mode === 'api' && isLiveMeasured(last, now);
  const apiPacketFresh = last && (now - new Date(last.observedAt).getTime() >= -2000) && (now - new Date(last.observedAt).getTime() <= 5000);
  const assessment: Assessment = mode === 'api' && apiAssessment && !apiPacketFresh ? {
    status: 'abstain', score: null, confidence: 0, usable: false,
    reasons: ['Son telemetri paketi güncel değil'],
    explanation: 'ESP32 veri akışı kesilmiş veya ölçüm zaman aşımına uğramış. Bağlantıyı kontrol edin.'
  } : mode === 'api' && apiAssessment ? {
    status: apiAssessment.decision.status,
    score: apiAssessment.decision.score,
    confidence: apiAssessment.confidence.score,
    usable: apiAssessment.confidence.usable,
    reasons: apiAssessment.confidence.reasons.map(describeConfidenceReason),
    explanation: apiAssessment.decision.reason,
  } : mode === 'api' ? assessSample(null,apiCheck,now) : localAssessment;
  const events = mode === 'api' ? apiEvents : demoEvents;
  const fromSensor = last?.source === 'measured';
  const sourceLabel = mode === 'sim' || last?.source === 'simulated' ? 'SİMÜLASYON'
    : liveMeasured ? 'ESP32 CANLI ÖLÇÜM' : fromSensor ? 'ESKİ ÖLÇÜM' : 'VERİ YOK';
  const latestSeconds = last ? ageSeconds(last.observedAt,now) : null;
  // Gerçek cihaz veri göndermeye başladığında API simülasyonunu otomatik durdur.
  useEffect(() => {
    if (mode === 'api' && liveMeasured && running) setRunning(false);
  }, [mode, liveMeasured, running]);
  const connected = mode === 'api' ? liveMeasured : !demoLinkLost;
  const invalidSpO2 = mode === 'api' && apiMission?.assessment?.telemetry.spo2_pct === 0;
  const selectedCheck = mode === 'api' ? apiCheck : check;
  const statusCopy = statusText(assessment.status);
  const filteredEvents = events.filter(e => (logFilter==='tümü'|| e.kind.includes(logFilter)) && (eventName(e.kind)+' '+e.detail).toLocaleLowerCase('tr').includes(logQuery.toLocaleLowerCase('tr')));
  const latestPulse = samples.filter(s=>s.heartRate!==null).slice(-15).map(s=>s.heartRate as number);
  const latestOxygen = samples.filter(s=>s.spo2!==null).slice(-15).map(s=>s.spo2 as number);
  const latestMovement = samples.slice(-15).map(s=>s.acceleration);
  const metricCards = [
    { title:'Kalp Atış Hızı',value:last?.heartRate==null?'—':String(last.heartRate),unit:'BPM',note:last?.heartRate==null?'Ölçüm mevcut değil':'Son alınan ölçüm',accent:'#39c8e8',chart:latestPulse,icon:'pulse' },
    { title:'Oksijen Satürasyonu',value:last?.spo2==null?'—':String(last.spo2),unit:'%',note:invalidSpO2?'Sensör 0 gönderiyor · geçersiz':last?.spo2==null?'Ölçüm mevcut değil':'Tahmini SpO₂ · klinik değil',accent:invalidSpO2?'#ffbd59':'#32d6a0',chart:latestOxygen,icon:'activity' },
    { title:'Hareket / İvme',value:last?last.acceleration.toFixed(2):'—',unit:'g',note:'İvmeölçer telemetrisi',accent:'#ffbd59',chart:latestMovement,icon:'activity' },
    { title:'Sensör Güvenilirliği',value:last?String(Math.round(assessment.confidence*100)):'—',unit:'%',note:assessment.usable?'Değerlendirmeye uygun':'Doğrulama gerekli',accent:assessment.usable?'#32d6a0':'#ff6474',chart:samples.slice(-15).map(s=>s.quality*100),icon:'shield' },
  ];

  const submitCheck = async () => {
    const currentStatus = checkAnswers.feeling === 'yardim' || checkAnswers.dizziness === 'evet' ? 'needs_help'
      : checkAnswers.feeling === 'yorgun' || checkAnswers.sleep === 'zayif' ? 'fatigued' : 'okay';
    if (!checkAnswers.feeling || !checkAnswers.sleep || !checkAnswers.stress || !checkAnswers.dizziness) {
      setNotice('Lütfen dört öz değerlendirme sorusunu da yanıtlayın.'); return;
    }
    setBusy(true);
    try {
      if (mode === 'api') {
        if (!backendOnline) throw new Error('API çevrimdışı');
        const res = await fetch(`${API}/api/v1/self-check`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:currentStatus})});
        if (!res.ok) throw new Error('Kaydetme başarısız');
        setApiCheck(currentStatus); await refreshApi();
      } else {
        setCheck(currentStatus);
        setDemoEvents(s=>[{id:'check-'+Date.now(),kind:'demo-check',at:nowStamp(),
          detail:'Öz değerlendirme: '+ (currentStatus==='okay'?'İyi':currentStatus==='fatigued'?'Yorgun':'Destek gerekli'),
          source:'local' as const},...s].slice(0,120));
      }
      setLastCheckAt(nowStamp());
      setNotice('Öz değerlendirme kaydedildi. Bu bir tıbbi tanı değildir.');
    } catch { setNotice('Öz değerlendirme kaydedilemedi. Bağlantıyı kontrol edin.'); }
    finally { setBusy(false); }
  };

  const records = <div className="event-list">
    {filteredEvents.length ? filteredEvents.slice(0,page==='overview'?5:80).map(ev=><button className="event" key={ev.id} onClick={()=>setExpandedEvent(expandedEvent===ev.id?null:ev.id)}>
      <div className="event-icon"><Icon name={ev.kind.includes('loss')?'alert':ev.kind.includes('self')||ev.kind.includes('check')?'clipboard':'activity'} size={16}/></div>
      <div className="event-text"><strong>{eventName(ev.kind)}</strong><span>{expandedEvent===ev.id?ev.detail:ev.source==='api'?'Backend kaydı · Ayrıntılar için tıklayın':ev.detail}</span></div>
      <div className="event-right"><time>{clockTime(ev.at)}</time><Icon name="chevron" size={15}/></div>
    </button>) : emptyLog('Seçili filtre için kayıt bulunamadı')}
  </div>;

  const confidencePanel = <div className="confidence-card">
    <div className="confidence-top"><div className="score-circle" style={{'--score':`${Math.round(assessment.confidence*100)}%`} as CSSProperties}>
      <strong>{last?Math.round(assessment.confidence*100):'—'}</strong><span>{last?' / 100':'veri yok'}</span></div>
      <div><h4>Sensor Confidence Engine</h4><Pill tone={assessment.usable?'good':'warn'}>{assessment.usable?'Veri kullanılabilir':'Veri doğrulanmalı'}</Pill><p>Sinyal, hareket ve zaman damgası kontrolü</p></div></div>
    <Progress value={assessment.confidence*100} tone={assessment.usable?'green':'orange'}/>
    <div className="quality-list"><StatLine label="Sinyal kalitesi" value={last?Math.round(last.quality*100)+'%':'—'}/>
      <StatLine label="Paket yaşı" value={latestSeconds===null?'—':latestSeconds+' sn'}/>
      <StatLine label="Kaynak" value={sourceLabel}/></div>
    {assessment.reasons.length>0 && <div className="reason"><Icon name="alert" size={16}/><span>{assessment.reasons.join(' · ')}</span></div>}
  </div>;

  const hadsePanel = <div className="hadse-content">
    <div className={`hadse-status hadse-${assessment.status}`}><div className="hadse-symbol"><Icon name={assessment.status==='continue'?'check':'alert'} size={24}/></div>
      <div><span>MEVCUT DEĞERLENDİRME</span><h3>{statusCopy}</h3><p>{assessment.explanation}</p></div></div>
    <div className="hadse-actions"><div><span className="eyebrow">{assessment.status==='abstain'?'GÜVENLİ MOD · ÖNERİ YOK':'ÖNERİLEN SONRAKİ ADIM'}</span>
      <strong>{!assessment.usable?'Ölçümü doğrula':assessment.status==='review'?'Öz değerlendirmeyi tamamla':'İzlemeyi sürdür'}</strong>
      <small>HADSE kural tabanlı prototiptir. Tanı koymaz ve klinik talimat vermez.</small></div>
      <button className="btn btn-secondary" onClick={()=>setPage(assessment.usable?'selfcheck':'sensors')}>İncele <Icon name="arrow" size={15}/></button></div>
  </div>;

  const topIntro:Record<Page,{eyebrow:string;title:string;subtitle:string}>={
    overview:{eyebrow:'GÖREV MERKEZİ / GENEL DURUM',title:'Görev Genel Bakış',subtitle:'Astronot sağlığı ve görev telemetrisini tek merkezden izleyin.'},
    telemetry:{eyebrow:'GERÇEK ZAMANLI İZLEME',title:'Canlı Telemetri',subtitle:'Ölçümleri, sinyal güvenilirliğini ve zaman içindeki değişimleri inceleyin.'},
    hadse:{eyebrow:'KARAR DESTEK SİSTEMİ',title:'Sağlık Analizi ve HADSE',subtitle:'Veri kalite kontrolleri ve açıklanabilir operasyonel değerlendirmeler.'},
    selfcheck:{eyebrow:'KİŞİSEL SAĞLIK KONTROLÜ',title:'Astronot Kontrolü',subtitle:'Kendi durumunuzu kaydedin; fizyolojik verileri öz bildirimle tamamlayın.'},
    blackbox:{eyebrow:'MISSION BLACK BOX',title:'Görev Kayıtları',subtitle:'Ölçüm, bağlantı ve öz değerlendirme olaylarının zaman çizelgesi.'},
    sensors:{eyebrow:'CİHAZ DURUMU',title:'Sensörler ve Bağlantı',subtitle:'Veri akışı, haberleşme zinciri ve donanım durumunu izleyin.'},
    notifications:{eyebrow:'GÖREV BİLDİRİMLERİ',title:'Bildirimler',subtitle:'Dikkat gerektiren kayıtlar ve sistem olayları.'},
    settings:{eyebrow:'GÖREV YAPILANDIRMASI',title:'Ayarlar / Oturum',subtitle:'Yerel gösterim, veri kaynağı ve görev ekranı tercihleri.'},
  };
  const intro=topIntro[page];
  const metricStrip=<div className="metric-grid">{metricCards.map(card=><Metric key={card.title} {...card}/>)}</div>;
  const chartControls=<div className="chart-controls"><div className="segment">{SERIES.map(s=><button key={s.key} className={series===s.key?'selected':''} onClick={()=>setSeries(s.key)}>{s.name}</button>)}</div>
    <div className="chart-actions"><select value={timeRange} onChange={e=>setTimeRange(e.target.value)} aria-label="Zaman aralığı">
      {['5 dk','15 dk','1 saat','24 saat'].map(t=><option key={t}>{t}</option>)}</select>
      <button className="icon-button" onClick={()=>{if(paused){setPaused(false);setFrozenSamples(null);}else{setFrozenSamples(visibleSamples);setPaused(true);}}} title={paused?'Grafiği sürdür':'Grafiği duraklat'}><Icon name={paused?'play':'pause'} size={17}/></button></div></div>;

  return <div className="app-shell">
    {mobileNav && <button className="mobile-backdrop" aria-label="Menüyü kapat" onClick={()=>setMobileNav(false)}/>}
    <aside className={`sidebar ${mobileNav?'sidebar-open':''}`}>
      <div className="brand"><div className="brand-mark"><Icon name="activity" size={24}/></div>
        <div><strong>ASTROVITAL <em>X</em></strong><small>MISSION HEALTH SYSTEM</small></div></div>
      <div className="mission-label"><span className="dot dot-good"/> SİSTEM HAZIR <small>PROTOTYPE / V1.0</small></div>
      <nav className="side-nav">{NAV.map((item,i)=><div key={item.id}>
        {(i===0||NAV[i-1].section!==item.section)&&<div className="nav-heading">{item.section}</div>}
        <button className={`nav-item ${page===item.id?'active':''}`} onClick={()=>{setPage(item.id);setMobileNav(false);setNotice('');}}>
          <Icon name={item.icon} size={19}/><span>{item.label}</span>{page===item.id&&<span className="nav-active-dot"/>}</button>
      </div>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-card"><div className="mini-device"><Icon name="radio" size={17}/> <strong>Bağlantı Durumu</strong><span className={`mini-dot ${connected?'on':'off'}`}/></div>
        <StatLine label="Veri kaynağı" value={mode==='sim'?'Yerel demo':'FastAPI'}/>
        <StatLine label="Cihaz" value={liveMeasured?'ESP32 · CANLI':fromSensor?'ESP32 · VERİ ESKİ':'Demo / Bekliyor'}/>
        <StatLine label="Cihaz ID" value={mode==='api'?(last?.deviceId||'Bekleniyor'):'ASTRO-X-DEMO'}/>
        <StatLine label="Sunucu" value={backendOnline?'Çevrimiçi':'Çevrimdışı'}/>
      </div><div className="sidebar-disclaimer">NASA onaylı veya klinik sistem değildir.</div></div>
    </aside>

    <div className="main-column">
      <header className="topbar"><div className="breadcrumb"><button className="mobile-menu" onClick={()=>setMobileNav(true)} aria-label="Menüyü aç"><Icon name="menu"/></button>
        <span className="crumb-muted">GÖREV KONTROL</span><Icon name="chevron" size={14}/><strong>{NAV.find(n=>n.id===page)?.label}</strong></div>
        <div className="topbar-right"><div className="header-time"><Icon name="clock" size={15}/>{clockTime(new Date(now).toISOString())}</div>
          <Pill tone={backendOnline?'good':'warn'}><span className="pill-dot"/>{backendOnline?'API BAĞLI':'API ÇEVRİMDIŞI'}</Pill>
          <button className="notification-button" onClick={()=>setPage('notifications')} aria-label="Bildirimleri aç"><Icon name="bell" size={19}/>{events.some(e=>e.kind.includes('loss'))&&<span/>}</button>
          <div className="profile-badge">A1</div></div></header>

      <main className="content">
        <div className="page-heading"><div><span className="eyebrow"><span className="cyan-slash">//</span> {intro.eyebrow}</span>
          <h1>{intro.title}</h1><p>{intro.subtitle}</p></div>
          <div className="heading-status"><div className="heading-line"><span className={connected?'live-dot':'live-dot muted-dot'}/> {sourceLabel}</div><span>{last?.deviceId ?? 'Cihaz bekleniyor'}</span><span>{missionId} <span className="separator">/</span> ASTRO-01</span></div></div>
        {mode === 'api' && last?.source === 'measured' && <div className={liveMeasured?'device-live-banner':'device-live-banner device-stale-banner'}>
          <Icon name="radio" size={18}/><strong>{liveMeasured?'ESP32 CANLI BAĞLI':'ESP32 TELEMETRİSİ GÜNCEL DEĞİL'}</strong>
          <span>{last.deviceId} · Paket #{last.sequence} · {latestSeconds ?? '—'} sn önce</span>
          {invalidSpO2 && <span className="invalid-measurement">SpO₂ = 0 geçersiz, gösterilmiyor</span>}
        </div>}
        {notice && <div className="notice" role="status"><Icon name="alert" size={18}/>{notice}<button onClick={()=>setNotice('')} aria-label="Bildirimi kapat">×</button></div>}

        {page==='overview' && <>
          <div className="overview-banner"><div className="banner-left"><span className="eyebrow">ASTRONAUT HEALTH STATUS</span>
            <h2>{statusCopy}</h2><p>{assessment.usable?'Kalite kontrolleri geçen son ölçüme göre operasyonel durum':'Veri güvenilirliği kontrol ediliyor. Bu sonuç tıbbi tanı değildir.'}</p>
            <div className="banner-meta"><Pill tone={statusTone(assessment.status)}>{assessment.status.toUpperCase()}</Pill><span>SON VERİ: {last?clockTime(last.observedAt):'Bekleniyor'}</span></div></div>
            <div className="banner-right"><div className="orbital-ring"><Icon name="pulse" size={38}/><span className="ring-dot"/></div><span>HADSE / STATUS ENGINE</span></div></div>
          {metricStrip}
          <div className="dashboard-grid"><Panel title="Canlı Sağlık Telemetrisi" subtitle="Zaman içinde izlenen fizyolojik göstergeler" className="wide" action={<button className="text-button" onClick={()=>setPage('telemetry')}>Detaylar <Icon name="arrow" size={15}/></button>}>
              {chartControls}<TelemetryChart samples={chartSamples} selected={series}/><div className="chart-footer"><span><i className="legend-dot" style={{background:SERIES.find(s=>s.key===series)?.color}}/>{SERIES.find(s=>s.key===series)?.name} verisi</span><span>{samples.length} ölçüm · {sourceLabel}</span></div>
            </Panel>
            <Panel title="HADSE Değerlendirmesi" subtitle="Açıklanabilir, kural tabanlı karar desteği" className="side-evaluation">{hadsePanel}</Panel>
            <Panel title="Sensör Güvenilirliği" subtitle="Sensor Confidence Engine" className="half">{confidencePanel}</Panel>
            <Panel title="Son Görev Olayları" subtitle="Mission Black Box / olay geçmişi" className="half" action={<button className="text-button" onClick={()=>setPage('blackbox')}>Tüm kayıtlar <Icon name="arrow" size={15}/></button>}>{records}</Panel></div>
          <div className="science-note"><Icon name="shield" size={19}/><div><strong>Bilimsel temelli izleme prototipi</strong><span>NASA HRP araştırmaları temel alınmıştır. Tıbbi tanı, doğrudan radyasyon veya kemik kaybı ölçümü yapılmaz.</span></div><a href="https://www.nasa.gov/hrp/hazards/" target="_blank" rel="noreferrer">NASA HRP ↗</a></div>
        </>}

        {page==='telemetry' && <>{metricStrip}<Panel title="Sağlık Veri Akışı" subtitle="Kaynağa ve zamana göre işaretlenmiş sensör ölçümleri" action={<Pill tone={connected?'good':'bad'}>{connected?'BAĞLANTI VAR':'BAĞLANTI YOK'}</Pill>}>
          {chartControls}<TelemetryChart samples={chartSamples} selected={series} height={330}/>
          <div className="chart-footer"><span>İzleme aralığı: {timeRange} · Görünür son 48 paket</span><span>{samples.length} paket / {sourceLabel}</span></div>
        </Panel><div className="two-col extra-space"><Panel title="Son Ölçüm" subtitle="Anlık veri paketinin ayrıntıları">
          <StatLine label="Cihaz kimliği" value={last?.deviceId||'—'}/><StatLine label="Paket sırası" value={last?String(last.sequence):'—'}/>
          <StatLine label="Ölçüm zamanı" value={last?clockTime(last.observedAt):'—'}/><StatLine label="Veri kaynağı" value={sourceLabel}/>
          <StatLine label="Hareket / ivme" value={last?last.acceleration.toFixed(3)+' g':'—'}/></Panel>
          <Panel title="Veri Kalitesi" subtitle="Hata ve eksik ölçüm kontrolü">{confidencePanel}</Panel></div>
        </>}

        {page==='hadse' && <><div className="two-col hadse-page"><Panel title="Operasyonel Değerlendirme" subtitle="Sınırlı, açıklanabilir karar destek sistemi">{hadsePanel}</Panel>
          <Panel title="Ölçüm Güvenilirliği" subtitle="Değerlendirme öncesi kalite kapısı">{confidencePanel}</Panel></div>
          <Panel title="Değerlendirme Süreci" subtitle="Monitor → Evaluate → Act"><div className="workflow">
            {[['01','VERİ TOPLAMA','Nabız, tahmini SpO₂, hareket ve öz bildirim'],['02','DOĞRULAMA','Sinyal kalitesi, hareket ve zaman damgası'],['03','DEĞERLENDİRME','Kural tabanlı analiz, gerektiğinde çekimser kalma'],['04','EYLEM VE KAYIT','İnsan değerlendirmesi ve Mission Black Box']].map(x=><div className="workflow-step" key={x[0]}><span>{x[0]}</span><strong>{x[1]}</strong><p>{x[2]}</p></div>)}</div></Panel>
          <div className="science-note"><Icon name="alert" size={18}/><div><strong>Klinik sistem değildir</strong><span>Bu araç tıbbi risk yüzdesi, tanı veya doktor yerine geçecek tedavi önerisi üretmez. İhtiyaç durumunda görev sağlık protokolü izlenmelidir.</span></div></div>
        </>}

        {page==='selfcheck' && <div className="two-col selfcheck-page"><Panel title="Astronot Öz Değerlendirmesi" subtitle="Kısa, gönüllü sağlık kontrol formu"><div className="question-form">
          {[
            {id:'feeling',title:'Bugün genel olarak nasıl hissediyorsunuz?',opts:[['iyi','İyi'],['yorgun','Yorgun'],['yardim','Desteğe ihtiyacım var']]},
            {id:'sleep',title:'Son uyku kaliteniz nasıldı?',opts:[['iyi','İyi'],['orta','Orta'],['zayif','Yetersiz']]},
            {id:'stress',title:'Algıladığınız stres düzeyi?',opts:[['dusuk','Düşük'],['orta','Orta'],['yuksek','Yüksek']]},
            {id:'dizziness',title:'Baş dönmesi veya olağan dışı rahatsızlık var mı?',opts:[['hayir','Hayır'],['evet','Evet']]},
          ].map((q,i)=><fieldset className="question" key={q.id}><legend><span>{String(i+1).padStart(2,'0')}</span> {q.title}</legend><div className="option-row">{q.opts.map(([v,label])=><label className={checkAnswers[q.id]===v?'option selected':'option'} key={v}>
            <input type="radio" name={q.id} checked={checkAnswers[q.id]===v} onChange={()=>setCheckAnswers(a=>({...a,[q.id]:v}))}/>{label}</label>)}</div></fieldset>)}
          <button className="btn btn-primary save-check" disabled={busy} onClick={()=>void submitCheck()}><Icon name="check" size={17}/>{busy?'Kaydediliyor...':'Kontrolü Kaydet'}</button></div>
          </Panel><div className="stack"><Panel title="Son Kontrol Durumu" subtitle="Kullanıcı tarafından bildirilen durum">
            <div className="check-summary"><div className="summary-icon"><Icon name="clipboard" size={25}/></div>
              <strong>{selectedCheck===null?'Henüz değerlendirme yok':selectedCheck==='okay'?'Genel durum: İyi':selectedCheck==='fatigued'?'Yorgunluk bildirildi':'Destek ihtiyacı bildirildi'}</strong>
              <span>{lastCheckAt?clockTime(lastCheckAt):mode==='api'&&apiMission?.self_check?clockTime(apiMission.self_check.recorded_at):'Öz değerlendirme bekleniyor'}</span></div>
            <p className="small-copy">Yalnızca genel durum backend'e gönderilir. Ek anket cevapları bu sürümde sunucuya kaydedilmez.</p></Panel>
            <Panel title="Kişisel Sağlık Geçmişi" subtitle="Bireysel referans verisi"><div className="empty-reference"><Icon name="activity" size={26}/><strong>Kişisel referans henüz yok</strong><p>Uzun vadeli karşılaştırma için yeterli, doğrulanmış geçmiş ölçümü gerekli. Mevcut demo verileri klinik referans oluşturmaz.</p></div></Panel></div></div>}

        {page==='blackbox' && <Panel title="Görev Olay Günlüğü" subtitle="Zaman damgalı, kaynak bilgisiyle ayrılmış olaylar" action={<Pill tone="info">{filteredEvents.length} KAYIT</Pill>}>
          <div className="filter-row"><label className="search-field"><Icon name="search" size={17}/><input value={logQuery} onChange={e=>setLogQuery(e.target.value)} placeholder="Kayıtlarda ara..."/></label>
            <select aria-label="Olay filtresi" value={logFilter} onChange={e=>setLogFilter(e.target.value)}><option value="tümü">Tüm olaylar</option><option value="telemetry">Telemetri</option><option value="self">Öz değerlendirme</option><option value="loss">Bağlantı kaybı</option></select></div>
          {records}</Panel>}

        {page==='sensors' && <><Panel title="İletişim Mimarisi" subtitle="Yerel işleme ve Dünya bağlantısı ayrı katmanlardır"><div className="connection-flow">
          <div className="connection-node"><div className="node-icon"><Icon name="activity" size={27}/></div><strong>Giyilebilir Cihaz</strong><span>ESP32 / MAX30102 / IMU</span><Pill tone={liveMeasured?'good':'warn'}>{liveMeasured?'ESP32 CANLI':fromSensor?'VERİ ESKİ':'BAĞLI DEĞİL / DEMO'}</Pill></div>
          <div className="connection-arrow"><span>→</span><small>TELEMETRİ</small></div>
          <div className="connection-node"><div className="node-icon"><Icon name="monitor" size={27}/></div><strong>Yerel İstasyon</strong><span>FastAPI / HADSE / SQLite</span><Pill tone={backendOnline?'good':'warn'}>{backendOnline?'API BAĞLI':'API ÇEVRİMDIŞI'}</Pill></div>
          <div className="connection-arrow"><span>→</span><small>GELECEK AŞAMA</small></div>
          <div className="connection-node"><div className="node-icon"><Icon name="radio" size={27}/></div><strong>Dünya Kontrol</strong><span>Uzak bağlantı prototipi</span><Pill tone="neutral">ENTEGRASYON YOK</Pill></div></div></Panel>
          <div className="two-col extra-space"><Panel title="Sensör Verileri" subtitle="Doğrulanmış ve beklenen veri kanalları">
            <StatLine label="Nabız (BPM)" value={last?.heartRate!=null?String(last.heartRate):'Mevcut değil'}/>
            <StatLine label="Tahmini SpO₂" value={last?.spo2!=null?last.spo2+'%':invalidSpO2?'Geçersiz (0)':'Mevcut değil'}/>
            <StatLine label="IMU ivme" value={last?last.acceleration.toFixed(3)+' g':'Mevcut değil'}/>
            <StatLine label="Radyasyon dozu" value="Sensör bulunmuyor"/><StatLine label="Kemik yoğunluğu" value="Ölçülemiyor"/>
          </Panel><Panel title="Bağlantı Tanılaması" subtitle="Gerçek API ve veri kaynaklarının durumu">
            <StatLine label="FastAPI" value={backendOnline?'Erişilebilir':'Kapalı'}/><StatLine label="Dashboard modu" value={mode==='sim'?'Yerel simülasyon':'Backend telemetrisi'}/>
            <StatLine label="Yeni paket akışı" value={connected?'Mevcut':'Kesildi'}/><StatLine label="Son paket" value={latestSeconds===null?'—':latestSeconds+' saniye önce'}/>
            <div className="row-button"><button className="btn btn-secondary" onClick={()=>void refreshApi()}><Icon name="refresh" size={16}/> Yeniden Kontrol Et</button></div>
          </Panel></div></>}

        {page==='notifications' && <Panel title="Görev Bildirimleri" subtitle="Bağlantı ve değerlendirme olayları">
          <div className="notification-list">{events.filter(e=>e.kind.includes('loss')||e.kind.includes('check')||e.kind.includes('decision')).slice(0,20).map(e=><div className="notification-item" key={e.id}><Icon name="bell" size={19}/><div><strong>{eventName(e.kind)}</strong><p>{e.detail}</p></div><time>{clockTime(e.at)}</time></div>)}
            {!events.some(e=>e.kind.includes('loss')||e.kind.includes('check')||e.kind.includes('decision'))&&emptyLog('Dikkat gerektiren sistem bildirimi yok.')}</div></Panel>}

        {page==='settings' && <div className="two-col settings-page"><Panel title="Veri Kaynağı" subtitle="Gösterilecek telemetri akışını seçin">
          <div className="mode-options"><button className={mode==='sim'?'mode-option active':'mode-option'} onClick={()=>{setMode('sim');setRunning(false);setPaused(false);setFrozenSamples(null)}}><Icon name="play"/><div><strong>Yerel Simülasyon</strong><span>Backend olmadan çalışan örnek veriler</span></div>{mode==='sim'&&<Icon name="check" size={18}/>}</button>
            <button className={mode==='api'?'mode-option active':'mode-option'} onClick={()=>{setMode('api');setRunning(false);setPaused(false);setFrozenSamples(null)}}><Icon name="radio"/><div><strong>Canlı FastAPI</strong><span>127.0.0.1:8000 adresindeki görev verileri</span></div>{mode==='api'&&<Icon name="check" size={18}/>}</button></div>
          <p className="small-copy">Simüle edilmiş değerler gerçek astronot ölçümü değildir. CANLI API de simülasyon paketleri gönderebilir; her paket kaynak etiketi taşır.</p>
        </Panel><Panel title="Görev Bilgisi" subtitle="Yerel gösterim tercihleri">
          <label className="field-label" htmlFor="missionid">Görev kimliği</label><input id="missionid" className="text-input" value={missionId} maxLength={24} onChange={e=>setMissionId(e.target.value.toUpperCase())}/>
          <div className="setting-note">Astronot: ASTRO-01 · Saat dilimi: UTC · Arayüz: Türkçe</div>
        </Panel></div>}

        <div className="demo-console"><div className="console-main"><div className="console-title"><span className="console-pulse"/><div><strong>Görev Simülatörü</strong><small>Donanım gerektirmeyen test akışı</small></div></div>
          <div className="console-controls"><select value={scenario} aria-label="Simülasyon senaryosu" onChange={e=>setScenario(e.target.value as Scenario)}>{SCENARIOS.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select>
            <button className="btn btn-outline" onClick={()=>void step()} disabled={running||liveMeasured}><Icon name="arrow" size={15}/> Tek Adım</button>
            <button className="btn btn-primary" disabled={liveMeasured} onClick={()=>setRunning(r=>!r)}><Icon name={running?'pause':'play'} size={17}/>{running?'Durdur':'Simülasyonu Başlat'}</button></div></div>
          <div className="console-bottom"><span>{running?'● 2 SANİYEDE BİR PAKET':'○ SİMÜLASYON DURAKLATILDI'}</span><span>{liveMeasured?'ESP32 bağlıyken API simülasyonu kapalıdır':SCENARIOS.find(s=>s.id===scenario)?.description}</span><strong>{mode==='sim'?'YEREL DEMO':'FASTAPI MODU'}</strong></div></div>

        <footer className="footer"><span>ASTROVITAL X / MARSUP-01</span><span>ARAŞTIRMA PROTOTİPİ · KLİNİK SİSTEM DEĞİL</span><span>V 1.0.0</span></footer>
      </main>
    </div>
  </div>;
}
