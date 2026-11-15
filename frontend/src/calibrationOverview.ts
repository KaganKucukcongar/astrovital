// It shows the personal HADSE status both in alarm and normal state.
// “Normal” is reported only with a certified reference and quality, live sensor measurement.
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
  heart_rate_up: "Increased heart rate deviation",
  heart_rate_down: "Decrease in heart rate",
  spo2_down: "Estimated SpO₂ drop",
};
const fallbacks: Record<string,string> = {
  normal: "According to the astronaut's personal reference, there are no candidates for permanent drift in the final quality measurements. Maintain monitoring and team communication within mission protocol. This is not an endorsement of medical fitness.",
  anomaly: "Astronaut: Safely pause non-critical mission, notify mission control, and reverify sensor measurement.",
  quality_issue: "Astronaut: Check sensor contact, signal and motion conditions. Make health decisions with this package; If data problem persists, notify mission control.",
  calibrating: "Astronaut: Collect quality reference measurements during a safe and calm mission phase.",
  inactive: "Personal analysis is off. Create reference with participant approval or load previous CSV reference of the same astronaut with explicit approval.",
  waiting: "Wait for the new ESP32 telemetry and do not make a personal health assessment before the measurement arrives.",
  offline: "Verify astronaut's sensor and communications link, notify mission control; count old measurement as live.",
  demo: "Generating personal health decisions for real astronauts from simulation packages.",
};
export function selectOverviewMissionAnalysis(
  calibration: CalibrationSummary | null | undefined,
  context: {mode:'api'|'sim';apiOnline:boolean;sensorStreamActive:boolean;measurementUsable:boolean},
): OverviewMissionAnalysis {
  if(context.mode==='sim') return {state:'demo',label:"SIMULATION · NO REAL ANALYSIS",recommendation:fallbacks.demo};
  if(!context.apiOnline) return {state:'offline',label:"NO API CONNECTION",recommendation:fallbacks.offline};
  if(!context.sensorStreamActive) return {state:'offline',label:"ESP32 NO DATA STREAM",recommendation:fallbacks.offline};
  if(!context.measurementUsable) return {state:'quality_issue',label:"MEASUREMENT IS NOT RELIABLE",recommendation:fallbacks.quality_issue};
  if(!calibration?.monitoring_enabled) return {state:'inactive',label:"PERSONAL ANALYSIS IS NOT ACTIVE",recommendation:fallbacks.inactive};
  const status=calibration.analysis_status;
  if(status==='anomaly' && calibration.current_anomaly) {
    const candidate=calibration.current_anomaly;
    return {
      state:'anomaly',label:"ANOMALY CANDIDATE HAS BEEN DETECTED",
      category:anomalyNames[candidate.type]||"Deviation from personal reference",
      confirmation:candidate.confirmation,
      recommendation:candidate.recommendation?.trim()||fallbacks.anomaly
    };
  }
  if(status==='normal') return {state:'normal',label:"NO CANDIDATE FOR PERMANENT DEVIATION HAS BEEN SEEN",
    recommendation:calibration.mission_recommendation||fallbacks.normal};
  if(status==='quality_issue') return {state:'quality_issue',label:"MEASUREMENT IS NOT RELIABLE",
    recommendation:calibration.mission_recommendation||fallbacks.quality_issue};
  if(status==='sensor_offline') return {state:'offline',label:"SENSOR DATA IS NOT UPDATED",
    recommendation:calibration.mission_recommendation||fallbacks.offline};
  if(status==='waiting') return {state:'waiting',label:"SENSOR PACKAGE IS EXPECTED",
    recommendation:calibration.mission_recommendation||fallbacks.waiting};
  return {state:'calibrating',label:"PERSONAL REFERENCES ARE COLLECTED",
    recommendation:calibration.mission_recommendation||fallbacks.calibrating};
}
