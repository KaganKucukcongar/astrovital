// AstroNav uses only relative positions. No GPS, actual terrain or safe EVA path.
export type NavMode='simulation'|'estimated'|'unavailable';
export type NavSessionStatus='idle'|'active'|'completed';

export type NavRoute={
  id:'A'|'B'|'C';
  label:string;
  distance_m:number;
  waypoints_m:[number,number][];
};

export type NavStatus={
  session_status:NavSessionStatus;
  mode:NavMode;
  device_id:string|null;
  demo:boolean;
  goal_type:'tracking'|'target'|'base';
  position_source:string;
  position_m:[number,number]|null;
  base_m:[number,number];
  goal_m:[number,number]|null;
  target_m?:[number,number]|null;
  target_heading_deg?:number|null;
  track_m:[number,number][];
  distance_walked_m:number;
  routes:NavRoute[];
  active_route_id:'A'|'B'|'C'|null;
  pending_route_id:'A'|'B'|'C'|null;
  remaining_m:number|null;
  turn_deg:number|null;
  heading_deg:number|null;
  target_bearing_deg?:number|null;
  next_waypoint:string;
  warnings:string[];
  terrain_source:'synthetic_fixture'|'none';
  sensor_ready?:boolean;
  sensor_age_s?:number|null;
  steps_total?:number|null;
  stride_length_m?:number|null;
  sensor_device_id?:string|null;
};

export function metres(v:number|null|undefined):string{
  return typeof v==='number'&&Number.isFinite(v)
    ?v.toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1})+' m'
    :'—';
}

export function turnInstruction(v:number|null):string{
  if(v===null||!Number.isFinite(v))return "Direction could not be verified";
  const abs=Math.abs(v);
  if(abs<=18)return "Continue straight";
  if(abs>=150)return "Check reverse direction";
  if(v>0)return abs<=75?"Turn slightly right":"Turn right";
  return abs<=75?"Turn slightly left":"Turn left";
}

export function navStatusLabel(s:NavStatus|null):string{
  if(!s)return "Waiting for server";
  if(s.session_status==='idle')return "Mission not started";
  if(s.session_status==='completed')return s.goal_type==='base'
    ?"Base proximity was estimated; not verified"
    :"Estimated arrival at target 10 m; not verified";
  if(s.mode==='unavailable')return "Live sensor data expected";
  return s.goal_type==='base'?"Showing base direction (estimated)":"10 m target tracked with live telemetry";
}

export type Point=[number,number];
export function createNavProjector(points:Point[]){
  const all=points.filter(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite));
  const xs=all.map(p=>p[0]),ys=all.map(p=>p[1]);
  const minX=Math.min(-3,...xs),maxX=Math.max(3,...xs);
  const minY=Math.min(-3,...ys),maxY=Math.max(3,...ys);
  const centerX=(minX+maxX)/2,centerY=(minY+maxY)/2;
  const scale=Math.max(1,Math.min(430/(maxX-minX+6),220/(maxY-minY+6)));
  return (p:Point):Point=>[250+(p[0]-centerX)*scale,135-(p[1]-centerY)*scale];
}

// Sensor bearing conventions: 0°=north, 90°=east, clockwise positive.
// Relative OLED turn is target magnetic bearing minus the current device bearing.
// North-up world axes remain east=X and magnetic-north=Y.
export function normalizeBearing(deg:number):number{
  return ((deg%360)+360)%360;
}
export function relativeTurn(targetBearing:number,deviceHeading:number):number{
  return normalizeBearing(targetBearing-deviceHeading+180)-180;
}
export function rotateWorldToDeviceUp(point:Point,origin:Point,viewHeadingDeg:number):Point{
  const dx=point[0]-origin[0],dy=point[1]-origin[1];
  const rad=viewHeadingDeg*Math.PI/180;
  const c=Math.cos(rad),s=Math.sin(rad);
  return [dx*c-dy*s,dx*s+dy*c];
}
export function bearingFromWorldPoints(origin:Point,target:Point):number|null{
  const east=target[0]-origin[0],north=target[1]-origin[1];
  if(!Number.isFinite(east)||!Number.isFinite(north)||Math.hypot(east,north)<1e-8)return null;
  return normalizeBearing(Math.atan2(east,north)*180/Math.PI);
}
