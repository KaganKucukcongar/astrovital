/*
 AstroVital X V3.2 - tek ana kasa, M2 dogrudan PCB sabitlemeli kapak, mm
 A: 85x67 orta boy breadboard. OLED 28x28x1 ve touch 24x24x1 PCB icin M2 ayakli kapak.
 ONEMLI: Delik merkezinin PCB kenarindan 1mm oldugu bildirildi;
 fiziki M2 vida deligi bunu tasiyabilir mi dogrulanmadi. Tam baskidan once test edin.
 Ana kasada iki kayis yuvası var. Powerbank kasasi bu pakete dahil degil.
 part: main_assembly, electronics_base, electronics_lid,
       oled_mount_test, touch_mount_test, fit_coupon
 Not: Vida ayaklari PCB deliklerinin altina gecmistir; kartlarda delik yoksa
 bu sistem kullanilamaz. Delik koordinatlarini olcerek degistirin.
 OLED gorunur pencere 28x20 mm, OLED cikinti kalinligi 1 mm (referans).
 Dokunmatik bolgesi 15x15 mm TAM ACIK penceredir; uzerinde plastik yok.
*/
part="front_lid_preview";
$fn=44;

// V3.3 user corrections:
// OLED visible panel: 28 x 20 mm, 4mm above and below PCB, flush left/right.
// Touch sensitive zone: 15 x 15mm, centered X, 9mm below PCB TOP,
// flush with PCB BOTTOM. Thumb approach ramp is BELOW the touch zone (-Y).
// These are within the PCB outlines; not to be confused with case margins.
// ===== Gercek olculeri baskidan once kontrol edin =====
breadboard=[85,67,10];
powerbank=[150,80,10];
oled=[28,28,1.0];         // KULLANICININ VERDIGI OLED PCB DIS OLCUSU
oled_window=[28,20];     // KULLANICI: OLED gorunur pencere acikligi (mm)
touch=[24,24,1.0];       // KULLANICININ VERDIGI DOKUNMATIK PCB DIS OLCUSU

wall=3.0; floor_thick=3.5; lid_thick=3.2;
inner_wire_clearance=[10,10];
inner_height=38;        // Breadboard+Nano+jumper icin; yedek alan
corner_radius=7;
main_w=breadboard[0]+2*inner_wire_clearance[0]+2*wall; // 111
main_d=breadboard[1]+2*inner_wire_clearance[1]+2*wall; // 93
main_h=floor_thick+inner_height;
power_clearance=1.5; power_wall=2.8; power_floor=3.2;
power_w=powerbank[0]+2*power_clearance+2*power_wall; // 158.6
power_d=powerbank[1]+2*power_clearance+2*power_wall; // 88.6
power_h=power_floor+powerbank[2]+1.0;                  // 14.2

// Aradaki bant yuvalari icin fiziksel bosluk.
link_gap=29; // 2 * ~12 mm kayis kulagi + 5 mm aralik
power_cy=main_d/2+link_gap+power_d/2;
strap_width=32; strap_slot_y=5.2;
strap_lug_extra=12.5;
strap_lug_width=44;
strap_lug_height=7.4;

m3_pilot=2.7; m3_clear=3.4;
case_boss_d=8.2;
case_boss_inset=8;
connector_x=41;
connector_pad_offset=10.0;
connector_pad_d=11;
connector_pad_h=12;
conn_y1=main_d/2+connector_pad_offset;
conn_y2=main_d/2+link_gap-connector_pad_offset;
connector_hole_distance=conn_y2-conn_y1;

// ===== PCB hole placement by distance from PCB corners =====
// Given offset: 0.1 cm == 1.0 mm.
// It is NOT confirmed whether you measured to the hole CENTER or to the
// nearest HOLE EDGE. Two alternative exported models are provided.
// This is PCB coordinate distance from BOTH outer PCB edges, NOT the
// distance from the outer corner diagonally.
// WARNING: An M2-sized hole whose center is 1 mm from BOTH PCB edges may
// break through the board perimeter. Verify true hole centers on real boards.
// OLED 28x28x1 mm ve touch 24x24x1 mm PCB dis olculeri kullanicidan alindi.
screen_pos=[-24,13]; touch_pos=[29,13];
pcb_hole_corner_offset=1.0; // for both X and Y edge insets
// Coordinates auto-derived from width/height and the stated edge inset.
oled_mount_holes=[
  for(sx=[-1,1], sy=[-1,1]) [sx*(oled[0]/2-pcb_hole_corner_offset),sy*(oled[1]/2-pcb_hole_corner_offset)]
];
touch_mount_holes=[
  for(sx=[-1,1], sy=[-1,1]) [sx*(touch[0]/2-pcb_hole_corner_offset),sy*(touch[1]/2-pcb_hole_corner_offset)]
];
pcb_boss_h=4.4;
pcb_boss_d=5.0;
pcb_m2_pilot=1.7;      // Pilot hole for M2 plastic screw; adjust for printer.
pcb_pilot_depth=3.5;   // Blind hole, does not pierce visible face.
touch_window=[15,15]; // KULLANICI: 15x15 open; within 24x24 PCB
// Touch zone starts 9mm from TOP, so its center is -4.5mm in Y.
// It ends flush with bottom edge of 24mm PCB.
touch_window_in_pcb=[0,-4.5];
// Entry ramp in -Y direction makes it possible to approach from below
// instead of pressing vertically into a straight wall.
ramp_length=13.0;        // mm before the bottom edge of touch opening
ramp_width_outer=22.0;   // fingertip approach width
ramp_width_inner=15.6;   // narrow near opening, avoids lower PCB screw mounts
ramp_inner_height=1.2;  // remaining plastic at touch aperture edge
touch_boss_h=1.2;       // bring touch PCB near aperture; verify component clearance

oled_screen_thickness=1.0; // KULLANICI: OLED ekran cikintisi/kalinligi, aciklik derinligi degil.
touch_membrane_thickness=0.0; // KULLANICI: dokunmatik yuzde plastik OLMAYACAK.


// geometry
module rounded2(w,d,r) { offset(r=r) square([w-2*r,d-2*r],center=true); }
module plate(w,d,h,r){ linear_extrude(height=h) rounded2(w,d,r); }
module boss_centers(w,d,inset){
  for (sx=[-1,1],sy=[-1,1])
    translate([sx*(w/2-inset), sy*(d/2-inset),0]) children();
}
module pcb_screw_positions(c,holes) {
  for(p=holes)
    translate([c[0]+p[0],c[1]+p[1],0]) children();
}
module pcb_mount_bosses(c,holes,h=pcb_boss_h) {
  pcb_screw_positions(c,holes)
    translate([0,0,-h]) cylinder(d=pcb_boss_d,h=h+0.02);
}
module pcb_mount_pilots(c,holes,h=pcb_boss_h) {
  pcb_screw_positions(c,holes)
    translate([0,0,-h-0.1])
      cylinder(d=pcb_m2_pilot,h=min(pcb_pilot_depth,h+lid_thick-1.0)+0.1);
}

// Beveled downward approach at bottom (-Y) of touch aperture.
// Cutting this sloped wedge FROM THE TOP FACE creates an open ramp.
// The ramp widens for the fingertip then narrows at PCB contact area.
module touch_entry_ramp_cut(c) {
  let(x=c[0], y0=c[1]-touch[1]/2-ramp_length,
      y1=c[1]-touch[1]/2+0.65,
      z0=lid_thick+0.03, z1=ramp_inner_height,
      ztop=lid_thick+1.1,
      a=ramp_width_outer/2, b=ramp_width_inner/2)
  polyhedron(
    points=[
      [x-a,y0,z0], [x+a,y0,z0], [x+b,y1,z1], [x-b,y1,z1],
      [x-a,y0,ztop], [x+a,y0,ztop], [x+b,y1,ztop], [x-b,y1,ztop]
    ],
    faces=[ [0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7] ],
    convexity=5
  );
}
// Explicitly TWO edge slots per module; +Y and -Y.
// These are printed ears that leave the interior floor unpierced.
module strap_ears(w,d){
  for(s=[-1,1])
    translate([0,s*(d/2+strap_lug_extra/2-0.7),0])
      plate(strap_lug_width,strap_lug_extra+1.5,strap_lug_height,4);
}
module strap_slot_cuts(d){
  for(s=[-1,1])
    translate([0,s*(d/2+strap_lug_extra*0.55),-0.25])
      plate(strap_width+1.5,strap_slot_y,strap_lug_height+0.7,2.3);
}
// connector pads outside facing sides, X = +/-41 to avoid middle strap slot
module connector_pads(d,side){
  for(x=[-connector_x,connector_x]) {
    translate([x,side*(d/2+connector_pad_offset/2),connector_pad_h/2])
      cube([connector_pad_d*0.82,connector_pad_offset+2,connector_pad_h],center=true);
    translate([x,side*(d/2+connector_pad_offset),0])
      cylinder(d=connector_pad_d,h=connector_pad_h);
  }
}
module connector_holes(d,side){
  for(x=[-connector_x,connector_x])
    translate([x,side*(d/2+connector_pad_offset),connector_pad_h-9])
      cylinder(d=m3_pilot,h=10);
}

module electronics_base(){
  difference(){
    union(){
      difference(){
        plate(main_w,main_d,main_h,corner_radius);
        translate([0,0,floor_thick])
          plate(main_w-2*wall,main_d-2*wall,inner_height+0.6,corner_radius-wall);
      }
      // four lid screw turrets
      boss_centers(main_w,main_d,case_boss_inset)
        translate([0,0,floor_thick]) cylinder(d=case_boss_d,h=inner_height);
      // Two integrated strap slots in ear lugs
      strap_ears(main_w,main_d);
      // Bridging pads only on +Y seam. Threaded from above (M3 pilots)
      connector_pads(main_d,+1);
      // breadboard retaining ledges are low, removable double sided tape advised
      for(s=[-1,1])
        for(xx=[-22,22])
          translate([xx,s*(breadboard[1]/2+1.2),floor_thick+1.5])
            cube([14,2.5,3.0],center=true);
      for(s=[-1,1])
        for(yy=[-19,19])
          translate([s*(breadboard[0]/2+1.2),yy,floor_thick+1.5])
            cube([2.5,10,3.0],center=true);
    }
    strap_slot_cuts(main_d);
    // lid screws: 9 mm deep blind pilot holes from top
    boss_centers(main_w,main_d,case_boss_inset)
      translate([0,0,main_h-9.5]) cylinder(h=10,d=m3_pilot);
    connector_holes(main_d,+1);
    // Nano USB access; verify position once mounted
    translate([-main_w/2,0,16]) cube([wall*3,23,14],center=true);
    // PulseSensor exterior lead (unplug cable before removal)
    translate([main_w/2,-20,16]) cube([wall*3,15,11],center=true);
    // powerbank cable entry between adjacent modules, outside strap slot zone
    translate([28,main_d/2,16]) cube([17,wall*3,12],center=true);
    // air/sensor vent on far wall, not a waterproof enclosure
    for (x=[-30,-22,-14])
      translate([x,-main_d/2,19]) cube([3,wall*3,10],center=true);
  }
}

// Main removable cover. M2 screws go through ACTUAL PCB mounting holes
// and into the blind pilot holes of the underside printed posts.
module electronics_lid(){
  difference(){
    union(){
      plate(main_w,main_d,lid_thick,corner_radius);
      pcb_mount_bosses(screen_pos,oled_mount_holes);
      pcb_mount_bosses(touch_pos,touch_mount_holes,touch_boss_h);
    }
    // OLED: 28x20 within 28x28 PCB -> L/R flush, 4mm top and bottom.
    // 1mm represents the screen protrusion, not a blind pocket.
    translate([screen_pos[0],screen_pos[1],-.2])
      plate(oled_window[0],oled_window[1],lid_thick+.4,0.7);
    // Touch: 24x24 PCB; 15x15 opening centered left/right,
    // 9mm from PCB upper edge, FLUSH WITH BOTTOM (-Y).
    translate([touch_pos[0]+touch_window_in_pcb[0],
               touch_pos[1]+touch_window_in_pcb[1],-.2])
      plate(touch_window[0],touch_window[1],lid_thick+.4,0.6);
    // Ergonomic ramp to guide finger horizontally into touch zone.
    touch_entry_ramp_cut(touch_pos);
    // M2 blind holes, independent of four M3 case lid screw holes.
    pcb_mount_pilots(screen_pos,oled_mount_holes);
    pcb_mount_pilots(touch_pos,touch_mount_holes,touch_boss_h);
    boss_centers(main_w,main_d,case_boss_inset){
      translate([0,0,-.25]) cylinder(d=m3_clear,h=lid_thick+.5);
      translate([0,0,lid_thick-1.2]) cylinder(d=6.0,h=1.5);
    }
  }
}

// Quick fit check before printing full cover. Actual PCB holes must match.
module mount_sample(w,d,window,holes,window_radius=2){
  difference(){
    union(){
      plate(w,d,lid_thick,3.0);
      pcb_mount_bosses([0,0],holes);
    }
    translate([0,0,-.2]) plate(window[0],window[1],lid_thick+.4,window_radius);
    pcb_mount_pilots([0,0],holes);
  }
}
module oled_mount_test(){ mount_sample(oled[0]+8,oled[1]+8,oled_window,oled_mount_holes,0.7); }
// Smaller touch mounting/ramp test piece, with extra room on bottom for ramp.
module touch_mount_test(){
  c=[0,7];
  difference(){
    union(){
      plate(touch[0]+8,touch[1]+8+ramp_length,lid_thick,3.0);
      pcb_mount_bosses(c,touch_mount_holes,touch_boss_h);
    }
    translate([c[0]+touch_window_in_pcb[0],
               c[1]+touch_window_in_pcb[1],-0.2])
      plate(touch_window[0],touch_window[1],lid_thick+0.4,0.6);
    touch_entry_ramp_cut(c);
    pcb_mount_pilots(c,touch_mount_holes,touch_boss_h);
  }
}


// PCB mock-ups for fit preview, not part of printable STL.
module electronics_preview() {
  color([0.17,0.20,0.25]) electronics_base();
  translate([0,0,main_h+9]) {
    color([0.25,0.44,0.52]) electronics_lid();
    %translate([screen_pos[0],screen_pos[1],-pcb_boss_h-oled[2]/2])
      cube([oled[0],oled[1],oled[2]], center=true);
    %translate([touch_pos[0],touch_pos[1],-touch_boss_h-touch[2]/2])
      cube([touch[0],touch[1],touch[2]], center=true);
  }
}
if (part=="electronics_base") electronics_base();
else if(part=="electronics_lid") translate([0,0,lid_thick]) mirror([0,0,1]) electronics_lid();
else if(part=="oled_mount_test") translate([0,0,lid_thick]) mirror([0,0,1]) oled_mount_test();
else if(part=="touch_mount_test") translate([0,0,lid_thick]) mirror([0,0,1]) touch_mount_test();
else if(part=="front_lid_preview") electronics_lid();
else if(part=="bottom_lid_preview") translate([0,0,lid_thick]) mirror([0,0,1]) electronics_lid();
else electronics_preview();
