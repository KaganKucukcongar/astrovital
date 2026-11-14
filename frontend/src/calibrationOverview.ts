// Kişisel HADSE durumunu alarmda da normalken de gösterir.
// "Normal" yalnızca onaylı referans ve kaliteli, canlı sensör ölçümüyle raporlanır.
export type CalibrationAnomaly = {
  type: string; recommendation: string; confirmation?: string; verified?: boolean;
};
export type CalibrationSummary = {
  active: boolean; monitoring_enabled?: boolean;
  analysis_status?: string; mission_recommendation?: string;
  phase: string; current_anomaly: CalibrationAnomaly | null;
};
export type OverviewMissionAnalysis = {
  state: 'normal'|'anomaly'|'quality_issue'|'calibrating'|'inactive'|'waiting'|'offline'|'demo';
  label: string; recommendation: string; category?: string; confirmation?: string;
};
const anomalyNames: Record<string,string> = {
  heart_rate_up: 'Nabızda artış sapması',
  heart_rate_down: 'Nabızda düşüş sapması',
  spo2_down: 'Tahmini SpO₂ düşüşü',
};
const fallbacks: Record<string,string> = {
  normal: 'Astronotun kişisel referansına göre son kaliteli ölçümlerde kalıcı sapma adayı yok. Görev protokolü kapsamında izlemeyi ve ekip iletişimini sürdür. Bu tıbbi uygunluk onayı değildir.',
  anomaly: 'Astronot: Kritik olmayan görevi güvenli biçimde duraklat, görev kontrolüne haber ver ve sensör ölçümünü tekrar doğrula.',
  quality_issue: 'Astronot: Sensör teması, sinyal ve hareket koşullarını kontrol et. Bu paketle sağlık kararı verme; veri sorunu sürerse görev kontrolüne bildir.',
  calibrating: 'Astronot: Güvenli ve sakin görev aşamasında kaliteli referans ölçümleri topla.',
  inactive: 'Kişisel analiz kapalı. Katılımcı onayıyla referans oluştur veya aynı astronotun önceki CSV referansını açık onayla yükle.',
  waiting: 'Yeni ESP32 telemetrisini bekle ve ölçüm gelmeden kişisel sağlık değerlendirmesi yapma.',
  offline: 'Astronotun sensör ve iletişim bağlantısını doğrula, görev kontrolüne haber ver; eski ölçümü canlı sayma.',
  demo: 'Simülasyon paketlerinden gerçek astronota yönelik kişisel sağlık kararı üretme.',
};
export function selectOverviewMissionAnalysis(
  calibration: CalibrationSummary | null | undefined,
  context: {mode:'api'|'sim';apiOnline:boolean;sensorStreamActive:boolean;measurementUsable:boolean},
): OverviewMissionAnalysis {
  if(context.mode==='sim') return {state:'demo',label:'SİMÜLASYON · GERÇEK ANALİZ YOK',recommendation:fallbacks.demo};
  if(!context.apiOnline) return {state:'offline',label:'API BAĞLANTISI YOK',recommendation:fallbacks.offline};
  if(!context.sensorStreamActive) return {state:'offline',label:'ESP32 VERİ AKIŞI YOK',recommendation:fallbacks.offline};
  if(!context.measurementUsable) return {state:'quality_issue',label:'ÖLÇÜM GÜVENİLİR DEĞİL',recommendation:fallbacks.quality_issue};
  if(!calibration?.monitoring_enabled) return {state:'inactive',label:'KİŞİSEL ANALİZ ETKİN DEĞİL',recommendation:fallbacks.inactive};
  const status=calibration.analysis_status;
  if(status==='anomaly' && calibration.current_anomaly) {
    const candidate=calibration.current_anomaly;
    return {
      state:'anomaly',label:'ANOMALİ ADAYI TESPİT EDİLDİ',
      category:anomalyNames[candidate.type]||'Kişisel referanstan sapma',
      confirmation:candidate.confirmation,
      recommendation:candidate.recommendation?.trim()||fallbacks.anomaly
    };
  }
  if(status==='normal') return {state:'normal',label:'KALICI SAPMA ADAYI GÖRÜLMEDİ',
    recommendation:calibration.mission_recommendation||fallbacks.normal};
  if(status==='quality_issue') return {state:'quality_issue',label:'ÖLÇÜM GÜVENİLİR DEĞİL',
    recommendation:calibration.mission_recommendation||fallbacks.quality_issue};
  if(status==='sensor_offline') return {state:'offline',label:'SENSÖR VERİSİ GÜNCEL DEĞİL',
    recommendation:calibration.mission_recommendation||fallbacks.offline};
  if(status==='waiting') return {state:'waiting',label:'SENSÖR PAKETİ BEKLENİYOR',
    recommendation:calibration.mission_recommendation||fallbacks.waiting};
  return {state:'calibrating',label:'KİŞİSEL REFERANS TOPLANIYOR',
    recommendation:calibration.mission_recommendation||fallbacks.calibrating};
}
