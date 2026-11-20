# AstroVital X V3.2 - rampali yatay dokunmatik kapak (mm)

Bu dosya V3.2 ana kasa tasariminin PCB pencere yerlesimi revizyonudur.
Ana kasa alt govdesi aynen korunmustur. Powerbank kasasi dahil degildir.

## PCB ve pencere olculeri (kullanicidan)
- OLED PCB: 28 x 28 x 1 mm.
- OLED on pencere: 28 x 20 mm. PCB'ye gore X ekseninde sag/sol 0 mm; Y ekseninde ust/alt 4'er mm.
- Dokunmatik PCB: 24 x 24 x 1 mm.
- Dokunmatik aktif alan: 15 x 15 mm. PCB'ye gore ust bosluk 9 mm, alt 0 mm, sag/sol 4.5'er mm.
- PCB delik merkezlerinin dis kenardan 1 mm icerde oldugu varsayildi; M2 icin cok dar olabilir. Kart deliklerini test edin.

## Dokunmatik yatay erisim rampasi
- Kapagin DIS/ON yuzeyinde dokunmatik acikligin ALT (-Y) yonunde egimli bir giris var.
- Rampanin yaklasik uzunlugu 13 mm; giriste genisligi 22 mm, acikliga yaklasirken 15.6 mm.
- Kesit, 3.2 mm on yuz kalinligindan pencere kenarinda 1.2 mm kalan et kalinligina dogru incelir.
- 15 x 15 mm aktif alan tamamen acik, ustunde plastik zar bulunmuyor.
- Parmak alt taraftan kaydirilarak temas bolgesine yaklasabilir; gercek ergonomi fiziksel test gerektirir.
- Touch PCB'yi acikliga yaklastirmak icin alt vida ayak yuksekligi 1.2 mm'ye dusuruldu.
  UYARI: Karttaki elektronik bilesenlerin bu yukseklige sigip sigmadigi bilinmiyor.
  Parcalar birbirine bastirilmamali, temas ve yalitim kontrol edilmeli.

## Dosyalar
- electronics_base.stl : onceden olusturulan, DEGISTIRILMEYEN ana kasa.
- electronics_lid_ramp.stl : OLED ve yatay erisim rampali dokunmatik pencereyi iceren GUNCEL kapak.
- oled_mount_test.stl : 28x28 PCB, 28x20 OLED penceresi icin kisa montaj testi.
- touch_mount_ramp_test.stl : 24x24 PCB, 15x15 alt hizali dokunmatik ve rampanin kisa montaj testi.
- AstroVital_V3_2_Yatay_Erisim_Rampali.scad : tum parametreler OpenSCAD ile degistirilebilir.
- Kapak_Rampa_3D_Onizleme.png : guncel kapagin 3D gorunumu.
- PCB_Yerlesim_Olculeri.png : PCB ici aciklik yerlesim semasi.

## Baskidan once
1. Once kucuk touch_mount_ramp_test.stl parcasini basilip parmak erisimi ve PCB uyumu kontrol edin.
2. OLED'in 28mm acikligi PCB genisligiyle esittir; gevsek/ince kenarlar olusabilir.
3. PCB delik merkezlerinin kenardan 1mm olması 2mm çapinda montaj deliği için fiziksel olarak
   sinirda olabilir. Gercek PCB delikleri 4 koseden es aralikli mi dogrulayin.
4. Rampanin alt kismi 1.2mm'e kadar inceliyor. 0.4mm nozzle ile testte kirilma veya
   dilimleme problemi olursa ramp_inner_height artirilabilir (SCAD parametresi).
5. Kapak STL'si dis yuzu tabana bakacak sekilde eksport edildi; rampa bolgesinde
   dilimleyicinin destek / first-layer onizlemesini inceleyin. Baskiyi dogrudan baslatmayin.
6. Dokunmatik kartin yuzeyindeki iletkenlerin acikta kalmadigini, kasayla temasini,
   kayis/USB acikliklarini ve kol ustunde surtmeyi kontrol edin.

## Dogrulama
STL mesh'ler OpenSCAD CGAL ile yeniden üretildi; watertight ve tek bagli parca.
Bu kontroller fiziksel montaj, 3D yazici dilimleme ve dokunmatik algilama testi yerine gecmez.
