# AstroVital X V3.1 | Revize kasa, montaj ve baskı notları

**Durum:** Parametrik prototip. Sayısal STL geometrileri kontrol edildi; fiziksel baskı ve montaj henüz doğrulanmadı. Tasarım **PLA** içindir ve tıbbi cihaz değildir.

## Ne değişti?

- Ana elektronik gövdesine 85 × 67 mm orta boy breadboard / elektronik tabanı ve **yanlarda 14–16 mm kablo güzergâhı** ayrıldı.
- Kapak altına **OLED için dört M2 vida yuvası**, **dokunmatik kart için dört M2 vida yuvası** eklendi. Modüllerin kendi PCB vida deliklerinin koordinatları bilinmediği için **PCB deliklerini kullanmıyoruz**: yanlarından kavrayan baskı klipsleriyle sabitliyoruz. Kartların delikleriyle birebir hizalı standoff istiyorsanız merkezler arası X/Y mesafesini ve delik çapını ölçmelisiniz.
- Her iki modül için 4'er baskı klipsi (toplam **8**) var. `clips_8.stl` içerisinde ilk sıradaki **4 kısa klips OLED**, ikinci sıradaki **4 yüksek klips dokunmatik sensör** içindir.
- Ana gövde kapağı 4 adet M3 vida ile sökülür.
- Altta **tek bir merkezî kayış geçişi** bulunur. Kayış için ayrı basılan `strap_bridge.stl`, ana gövdenin altındaki 4 kör deliğe M3 vida ile bağlanır. Önceki dört dış kulak tamamen kaldırıldı. Kayış ölçüsü için hedef 32 mm genişlik ve 5 mm tünel boşluğudur.
- Powerbank ayrı ve açık tepsidedir. Tepside **tek bir kayışın geçeceği iki yarık** bulunmaktadır. Powerbanki açıp yeniden paketlemeyin.
- Üç Pulse Sensor jumper kablosu, USB ve ek kablolar için ayrı duvar açıklıkları mevcut. Montaj kablolarını keskin PLA kenarlarından koruyun.

## Doğrulanmamış varsayımlar

| Parça | CAD ölçüsü (mm) | Not |
|---|---:|---|
| Orta boy breadboard/elektronik ayak izi | 85 × 67 × 10 | Kullanıcının verdiği değer; gerçek kartı cetvelle kontrol edin |
| Kablolara ayrılan yan pay | X yönünde 14, Y yönünde 16 | Birim başına her kenarda |
| Ana gövde dış eni ve boyu | **119 × 105** | Kayış ayrı STL |
| Ana gövde yüksekliği | **46,0** | Kapak ve kayış hariç |
| Kapak üstü takıldığında | **49,2** | Kayış kanalı hariç, yaklaşık |
| Tek kayış geçişi | 32 mm genişlik, 5 mm yükseklik | Kasa altında çıkarılabilir parça |
| Powerbank | 150 × 80 × 10 | cm kabul edilen ölçüden dönüştürüldü, kontrol edin |
| Powerbank tepsisi | **158,8 × 88,8 × 16** | Kapağı yok, geniş kayış yarıkları mevcut |
| OLED PCB | 38 × 29 × 1 | Görüntü penceresi 35 × 18 **tahmini** |
| Dokunmatik PCB | 24 × 24 × 1 | PLA dış yüzeyinde 0,8 mm kalınlık **test edilmeli** |
| Gövde | PLA | Nem/ısı koruması veya sertifika yok |

**Önemli:** OLED üzerinde 4 delik olduğunu ve bunların kenara yakın olduğunu belirttiniz. Yalnızca 1 mm kenar mesafesi yeterli değil: vida deliklerinin **merkezler arası uzaklığı ve çapı** bilinmiyor. Bu tasarımda buna güvenmek yerine *PCB dışındaki* vida yuvaları ve klipsler kullanılıyor. Yani ekranda vida yerleri vardır ama kartın orijinal deliklerine doğrudan geçmez.

## Yazdırılacak parçalar

- `main_base.stl`: Ana geniş elektronik kasa, breadboard durdurucular, 4 köşe M3 boss ve kablo çıkışları.
- `main_lid.stl`: OLED penceresi, dokunmatik gömme yüzeyi, **8 M2 montaj boss'u** ve 4 kapak deliği.
- `clips_8.stl`: Modül kenarlarını vidalı klipsle tutmak için 8 ayrı baskı parçası. İlk dört kısa klips OLED, son dört uzun klips dokunmatik kart.
- `strap_bridge.stl`: Tek merkezî kayış yolu, 4 M3 montaj deliği.
- `battery_tray.stl`: Powerbank için ayrı tepsi ve 1 sürekli kayış yolu.
- `fit_coupon.stl`: Küçük ekran/touch/vida deliği numune baskısı.
- `AstroVital_X_V3_1_Parametrik.scad`: Ölçüleri değiştirmeye uygun asıl kaynak dosya.

## Yaklaşık vida ihtiyacı

- Ana kapak: **4 × M3×10 mm**, baskı boss'larına pilot delik. PLA'da aşırı sıkmayın.
- Tek kayış köprüsü: **4 × M3×12 mm**, ana gövde altındaki kör pilot deliklere.
- OLED klipsleri: **4 × M2×5 mm** (ilk fiziksel baskıda kontrol edin).
- Dokunmatik klipsleri: **4 × M2×8 mm** (ilk fiziksel baskıda kontrol edin).

Vida boyları baskı toleransı / fiili modül kalınlığına göre uyarlanmalıdır. Yuvayı zorlayıp çatlatmayın. Klipsler kartın optik görüntü/touch kısmına değil **PCB kenarına** basmalıdır.

## Baskı sırası

1. **İlk önce `fit_coupon.stl`**: görüntü penceresi, M2 vida girişi, touch kalınlığı.
2. `main_lid.stl` ve `clips_8.stl`: gerçek PCB'ler sığıyor mu? PCB üstüne baskı uygulamadan sabitleniyor mu?
3. `main_base.stl`: orta boy breadboard ve jumper kablo düzeni; USB fişinin yönü.
4. `strap_bridge.stl`: tek kayıştaki kullanım rahatlığı; bağlantı vidaları ve basma dayanımı.
5. `battery_tray.stl`: tepsi ve powerbank sıkışma testi.

İlk PLA ayarları olarak 0,20 mm katman ve 3–4 çevre kullanılabilir; 0,3–0,5 mm toleransları gerçek yazıcıya göre ayarlayın. `main_lid.stl`, dış yüzü zemine gelecek şekilde çevrilmiş STL olarak oluşturuldu. `main_base.stl` alt tabanı düz; kayış parçası ayrı basılır ve böylece gereksiz geniş destek ihtiyacı azalır.

## Parametreler

OpenSCAD'de `part = "assembly"` genel görünüm içindir; `main_base`, `main_lid`, `strap_bridge`, `clips_8`, `battery_tray`, `fit_coupon` tek tek çıktı verir. `breadboard_x/y`, `wiring_gap_x/y`, `internal_h`, `oled_window_x/y`, `oled_cx/cy`, `touch_cx/cy`, `strap_w` değişkenlerini değiştirerek tasarımı güncelleyin.

## Güvenlik / konfor

Kasa ebatı bir saatten çok önkol elektronik modülü boyutundadır. Güç kaynağı (powerbank) ayrı; erişilebilir ve havalandırılmış bölümde kalmalı. Kayış çok sıkılmamalı, PLA köşeleri zımparalanmalı; cilde temas alanında yumuşak ped kullanın. Powerbankin kablosu ile cilt arasında boşta metal uç bırakmayın. Kısa devre, terleme ve ısınma açısından prototip kontrol edilmeli.

## Dijital kontrol

OpenSCAD 2021.01 ile 6 STL üretildi, `trimesh` ile kapalı manifold oldukları doğrulandı. `clips_8.stl` kasten 8 ayrı klips içerir; diğer STL'ler tek parça kapalı geometriye sahiptir. Bu kontrol gerçek baskı uyumunu garanti etmez.
