# AstroVital X V3.3 - alt bilek tipi optik sensor yuvasi

**Bu revizyon yalnizca ana kasanin ALT yuzeyini degistirir.** OLED + 15x15 mm dokunmatik pencere + yatay erisim rampasi bulunan onceki kapak aynen korunmustur.

## Fotoğraftan çıkan geçici ölçü

- Fotoğraftaki cetvele gore sensor PCB'si **yaklasik 15,5 x 20,0 mm** gorunuyor (kesin değil).
- PCB kalinligi, sensor optiginin kart yuzeyinden yuksekligi, vida delikleri ve kablo cikisi **bilinmiyor**.
- Sensor gelince gercek kumpas olculeri ile `AstroVital_V3_3_Sensor_Yuvasi_Parametrik.scad` icindeki parametreleri tekrar dogrula.

## Bu CAD dosyasinda hazirlananlar

- Ana kasa dis boyutu ayni: ~111 x 93 x 41,5 mm (kayis kulaklari haric).
- Bilek tarafinin MERKEZINDE, alttan acik **18,2 x 22,8 mm** sensor yerlestirme cebi, 1,65 mm derinlik.
- Kasa icine gecen **5,2 x 7,2 mm** kablo gecisi. Breadboard'un kablonun uzerine baski yapmadigini kontrol et.
- Sensoru sertlik/dogal temastan korumayi hedefleyen **35 x 40 mm** vidali SO KULEBILIR tutucu, merkezinde **8,5 x 8,5 mm** optik aciklik.
- Tutucu ile kasa arasinda 4 adet M2 baglanti. Delikler **KASAYA** aittir, sensor PCB'sine AIT DEGIL. Merkezler x = +/-14, y = +/-16 mm.
- M2 havsa basli vidalar icin tutucuda gomulu bas yuvalari (vida basi bilegi surtmemeli).
- Opsiyonel 0,8 mm ara parca (`sensor_spacer_optional.stl`), fiziksel temas kontrolunden sonra gerekirse kullan.
- Sensor gecikirse acik optik pencere birakmayan `sensor_blank_cover_if_delayed.stl`. Bu parca SU GECIRMEZLIK SAGLAMAZ.

## Dosya listesi

- `electronics_base_sensor_pocket.stl` - DEGISTIRILMIS ana kasa, sadece bunu ana kasa icin bas.
- `electronics_lid_ramp_UNCHANGED.stl` - onceden onaylanan OLED + dokunmatik rampali kapak, DEGISTIRILMEDI.
- `sensor_retainer_bezel.stl` - sensor geldiginde acik pencereli alt tutucu.
- `sensor_blank_cover_if_delayed.stl` - sensor gelmezse geceici alt kapak.
- `sensor_spacer_optional.stl` - sensor derinligi ayari icin opsiyonel ara halka.
- `sensor_fit_coupon.stl` - sadece sensor cebi ve vida baglantilari icin hizli baski testi.
- `AstroVital_V3_3_Sensor_Yuvasi_Parametrik.scad` - tum boyutlarin degistirilebildigi OpenSCAD kaynak.

## Onemli fiziksel dogrulama

1. Sensor eline gecmeden PCB'nin vidalarina gore DELIK BASMA. Tasarim bunun yerine kasaya vidalanan tutucu kullanir.
2. Sensor kartindaki acik elektronikler, sivri lehimler, vidalar ve kablolar dogrudan cilde temas ETMEMELI. Optik yuzey cilde yeterince yakin olmali; optik uzerindeki derinlik boslugu ve isik sizmasi cihazla kontrol edilmeli. Gerekirse tutucunun kalinligi/yuksekligi tekrar revize edilmeli.
3. Kartin gercek PCB olcusu, optik yuzeyin yuksekligi ve kenar elemanlari gorulmedigi icin sensorun hem MEKANIK UYUMU hem de GERCEK NABIZ OLCUMU simdilik dogrulanmadi. Asiri baski uygulama.
4. Breadboard'u kase tabanina sabitlerken kablo gecisini kapatma, sensor kablosunu sikistirma. Gerekirse breadboard icin ince mesafe parcasi kullan.
5. Giyilebilir optik nabiz sensoru tıbbi ölçüm amaçlı değildir. Degerleri fiziksel testle karşılaştırmadan HADSE uyarilarinda kullanma.

## Baskı önerisi

- Ilk baski: `sensor_fit_coupon.stl` + `sensor_retainer_bezel.stl` (veya sensor gelmezse koruma kapagi).
- Kasa: PLA, 0,28 mm katman, 3 duvar, %10-15 doluluk. Sensor cebi tabana baktigi icin 18 mm civarindaki cebin TAVANINDA bridging / yerel destek gerekebilir. Dilimleyicinin katman önizlemesini kontrol et.
- Küçük detaylar: 0,20 mm katman, 3 duvar. M2 vida delikleri baskıcı tarafından kontrol edilmeli.
- Kapak onceki baskida uyduysa yeniden basmana gerek yok.
