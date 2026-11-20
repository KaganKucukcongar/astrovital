/* AstroVital X V3.1 - 3D printed demonstration enclosure, mm.
   V3.1 improvements: screw clamp mounts for OLED/touch, room for wiring and 85x67 breadboard, SINGLE centrally located continuous strap path.
   Correct hole centers are NOT known. PCB mounts use external M2 screw clips rather than assuming board-hole coordinates.
   Parts: assembly, main_base, main_lid, strap_bridge, board_clip, clips_8, battery_tray, fit_coupon.
   Test physically before full print, not medical, not moisture/heat rated.
*/
part = "assembly";
$fn=48;

// ---- Measured or stated equipment sizes (mm) ----
breadboard_x=85; breadboard_y=67; breadboard_z=10;  // treated as installed electronics footprint
wiring_gap_x=14; wiring_gap_y=16;                   // extra perimeter wire room per side
internal_h=40;                                    // height below faceplate for loose jumper wiring
wall=3.0; floor_t=6.0; lid_t=3.2; corner_r=7;

oled_x=38; oled_y=29; oled_pcb_t=1;
oled_window_x=35; oled_window_y=18;              // approximate ACTUAL visible window; measure before printing
oled_cx=-28; oled_cy=8;
touch_x=24; touch_y=24; touch_pcb_t=1;
touch_cx=30; touch_cy=8; touch_skin=0.8;

// Screw fasteners
case_boss_d=8.5; case_boss_inset=7.3; case_pilot_d=2.7;
case_clear_d=3.3;
pcb_boss_d=5.6; pcb_boss_depth=2.2; pcb_pilot_d=1.7;  // M2 self-threading pilot, check print
clip_thickness=1.3; clip_hole_d=2.25;             // M2 screws, washers via printed clips
pcb_screw_outset=4.5; pcb_screw_y_inset=6;

// Cable ports, positioned independently of specific installed USB/sensor
usb_y=-26; sensor_y=-26;
usb_slot_w=17; usb_slot_h=11; pulse_slot_w=15; pulse_slot_h=10;
spare_slot=true; spare_y=28; spare_slot_w=19; spare_slot_h=11;

// Single central strap, one continuous band; faceplate is NOT a watch-sized device
strap_w=32; strap_thick=5; strap_path_length=46;
strap_plate_t=2.5; strap_side_wall=4.5; strap_height=strap_thick+strap_plate_t;

// Powerbank detachable external holder. Verify actual 150x80x10 size.
powerbank_x=150; powerbank_y=80; powerbank_h=10;
tray_gap=1.8; tray_wall=2.6; tray_floor=3;
tray_h=16;

main_x=breadboard_x+2*wiring_gap_x+2*wall;
main_y=breadboard_y+2*wiring_gap_y+2*wall;
body_h=floor_t+internal_h;
tray_x=powerbank_x+2*(tray_gap+tray_wall);
tray_y=powerbank_y+2*(tray_gap+tray_wall);

module r2d(w,h,r) { offset(r=r) square([w-2*r,h-2*r],center=true); }
module prism(w,h,t,r){ linear_extrude(height=t) r2d(w,h,r); }

module case_boss_centers() {
  for (sx=[-1,1],sy=[-1,1])
    translate([sx*(main_x/2-case_boss_inset),sy*(main_y/2-case_boss_inset),0]) children();
}
module board_screw_centers(cx,cy,w,h){
  for(sx=[-1,1],sy=[-1,1])
    translate([cx+sx*(w/2+pcb_screw_outset),cy+sy*(h/2-pcb_screw_y_inset),0]) children();
}

// One underside strap tunnel, running front-to-back across the centre.
// The single passage takes ONE 32mm webbing strap; no 4 external ears.
module strap_bridge() {
  // Detachable single-belt tunnel: prints flat on its own, screws into blind
  // pilots under base. One continuous 32mm strap slides along Y direction.
  difference() {
    union() {
      prism(strap_w+2*strap_side_wall,strap_path_length,strap_plate_t,3);
      for(sx=[-1,1])
        translate([sx*(strap_w/2+strap_side_wall/2),0,strap_height/2+strap_plate_t/2])
          cube([strap_side_wall,strap_path_length,strap_height-strap_plate_t+0.04],center=true);
    }
    for(sx=[-1,1],sy=[-1,1])
      translate([sx*(strap_w/2+strap_side_wall/2),sy*16,-.2])
        cylinder(d=3.4,h=strap_height+.6);
  }
}

module main_base() {
  difference() {
    union() {
      difference(){
        prism(main_x,main_y,body_h,corner_r);
        translate([0,0,floor_t])
          prism(main_x-2*wall,main_y-2*wall,body_h-floor_t+0.3,corner_r-wall);
      }
      // Four body lid screw towers, not confused with PCB fasteners
      case_boss_centers() translate([0,0,floor_t])
        cylinder(h=body_h-floor_t,d=case_boss_d);
      // Anti-slip stops for a medium breadboard; fix board with removable tape or Velcro
      for(sx=[-1,1],yy=[-21,21])
        translate([sx*(breadboard_x/2+1.4),yy,floor_t+2])
          cube([2.5,10,4],center=true);
      for(sy=[-1,1],xx=[-25,25])
        translate([xx,sy*(breadboard_y/2+1.4),floor_t+2])
          cube([10,2.5,4],center=true);
      // Four low wire tie posts at edges, away from the PCB footprint
      for(sx=[-1,1],yy=[-23,23])
        translate([sx*(main_x/2-wall-6.2),yy,floor_t-0.35])
          difference() { cylinder(h=5.35,d=5); translate([0,0,2.85]) rotate([90,0,0]) cylinder(d=2.5,h=8,center=true); }
      // One external strap bracket is a separate printable part.
    }
    // Case M3 pilots from top (9mm thread depth)
    case_boss_centers() translate([0,0,body_h-10]) cylinder(h=10.5,d=case_pilot_d);
    // Four BLIND M3 pilot holes to mount the single-strap bridge underneath.
    for(sx=[-1,1],sy=[-1,1])
      translate([sx*(strap_w/2+strap_side_wall/2),sy*16,-.1])
        cylinder(d=case_pilot_d,h=floor_t-1.0);
    // Left side USB cable access
    translate([-main_x/2,usb_y,13]) cube([wall*3.2,usb_slot_w,usb_slot_h],center=true);
    // Right side: three Pulse Sensor jumper leads
    translate([main_x/2,sensor_y,13]) cube([wall*3.2,pulse_slot_w,pulse_slot_h],center=true);
    // Extra replaceable panel/cables option, avoids cramped cables
    if (spare_slot) translate([main_x/2,spare_y,15]) cube([wall*3.2,spare_slot_w,spare_slot_h],center=true);
  }
}

// Lid top is z=lid_t. OLED board presses to the underside z=0 with 4 small M2 clamping tabs.
// Screw centres are OUTSIDE the PCBs, since actual manufacturer's 4-hole coordinates are unknown.
module pcb_bosses(cx,cy,w,h){
  board_screw_centers(cx,cy,w,h)
    translate([0,0,-pcb_boss_depth]) cylinder(d=pcb_boss_d,h=pcb_boss_depth+0.08);
}
module main_lid(){
  difference(){
    union(){
      prism(main_x,main_y,lid_t,corner_r);
      pcb_bosses(oled_cx,oled_cy,oled_x,oled_y);
      pcb_bosses(touch_cx,touch_cy,touch_x,touch_y);
    }
    // Window: OPEN over active OLED screen, not whole PCB footprint
    translate([oled_cx,oled_cy,-0.2]) prism(oled_window_x,oled_window_y,lid_t+0.6,1.2);
    // Touch pocket: front retains a thin capacitive-sensitive PLA skin
    translate([touch_cx,touch_cy,-0.01]) prism(touch_x+0.8,touch_y+0.8,lid_t-touch_skin+0.02,2);
    // Eight M2 retention-clamp pilots: 4 OLED + 4 touch
    board_screw_centers(oled_cx,oled_cy,oled_x,oled_y)
      translate([0,0,-pcb_boss_depth-0.05]) cylinder(d=pcb_pilot_d,h=pcb_boss_depth+lid_t-0.6);
    board_screw_centers(touch_cx,touch_cy,touch_x,touch_y)
      translate([0,0,-pcb_boss_depth-0.05]) cylinder(d=pcb_pilot_d,h=pcb_boss_depth+lid_t-0.6);
    // Four M3 lid screw holes
    case_boss_centers() {
      translate([0,0,-0.2]) cylinder(d=case_clear_d,h=lid_t+0.5);
      translate([0,0,lid_t-1.1]) cylinder(d=6.1,h=1.3);
    }
  }
}

// Printed tiny clamping tab, 8 copies: M2 hole offset from middle.
// Outer screw sits 4.5 mm away from PCB; the longer tab end overlaps PCB edge.
module board_clip(t=clip_thickness){
  difference(){
    prism(15,7,t,2.3);
    translate([3.4,0,-0.2]) cylinder(h=t+0.4,d=clip_hole_d);
  }
}
// OLED clip t=1.3mm; touch clip t=3.6mm reaches INTO the touch pocket.
module clips_8(){for(i=[0:7]) translate([(i%4)*19,floor(i/4)*12,0]) board_clip(i<4 ? clip_thickness : pcb_boss_depth+lid_t-touch_skin-touch_pcb_t);}

// Separate powerbank tray: top stays open and there are NO extra four webbing ears.
// Two transverse floor slits hold one continuous centred strap (single belt path).
module battery_tray(){
  difference(){
    prism(tray_x,tray_y,tray_h,6);
    translate([0,0,tray_floor]) prism(tray_x-2*tray_wall,tray_y-2*tray_wall,tray_h+0.5,3.3);
    // USB cable access at ends
    for(s=[-1,1]) translate([s*tray_x/2,0,tray_floor+5.7])
      cube([tray_wall*3,25,11.5],center=true);
    // Two openings for ONE 32mm strap only. Strap runs underneath battery.
    for(s=[-1,1]) translate([0,s*(powerbank_y/2-6),-0.1])
      prism(strap_w+1.0,5.0,tray_floor+0.3,1.5);
  }
}

module fit_coupon(){
  // Screw-clamp locations / window / touch responsiveness test before full print
  difference(){
    prism(95,47,lid_t,4);
    translate([-24,0,-.1]) prism(oled_window_x,oled_window_y,lid_t+.3,1.2);
    translate([25,0,-.1]) prism(touch_x+.8,touch_y+.8,lid_t-touch_skin+.1,1.8);
  }
  // M2 printed pilot sample, use a spare clamp and fastener
  translate([0,-17,lid_t-0.3]) difference(){cylinder(d=pcb_boss_d,h=3.3);cylinder(d=pcb_pilot_d,h=3.4);}
}

module assembly(){
  color([0.16,0.21,0.29]) main_base();
  translate([0,0,-strap_height]) color([0.32,0.36,0.41]) strap_bridge();
  translate([0,0,body_h+8]) color([0.30,0.36,0.44,0.9]) main_lid();
  // Ghosted medium breadboard / electronic footprint
  translate([0,0,floor_t+1]) color([0.9,0.9,0.75,0.22])
    %translate([-breadboard_x/2,-breadboard_y/2,0]) cube([breadboard_x,breadboard_y,breadboard_z]);
  // PCB outlines near underside of floating lid
  translate([0,0,body_h+7]){
    color([0.1,0.55,0.34])
      translate([oled_cx-oled_x/2,oled_cy-oled_y/2,0]) cube([oled_x,oled_y,1]);
    color([0.1,0.45,0.3])
      translate([touch_cx-touch_x/2,touch_cy-touch_y/2,0]) cube([touch_x,touch_y,1]);
  }
  translate([main_x/2+tray_x/2+30,0,0]) {
    color([0.20,0.25,0.30]) battery_tray();
    translate([-powerbank_x/2,-powerbank_y/2,tray_floor]) %cube([powerbank_x,powerbank_y,powerbank_h]);
  }
}

if(part=="main_base") main_base();
else if(part=="strap_bridge") strap_bridge();
else if(part=="main_lid") translate([0,0,lid_t]) mirror([0,0,1]) main_lid();
else if(part=="board_clip") board_clip();
else if(part=="clips_8") clips_8();
else if(part=="battery_tray") battery_tray();
else if(part=="fit_coupon") fit_coupon();
else assembly();
