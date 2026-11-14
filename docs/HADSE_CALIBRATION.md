# AstroVital X · HADSE Kalibrasyon ve CSV Toplama

## Nasıl başlatılır?
1. Katılımcıdan açık, bilgilendirilmiş onay al. Katılımcı veya sensör kullanıcısı yetişkin değilse bir ebeveyn/yetkili yetişkinin de onayını al.
2. Bilgisayarda Ethernet üzerinden `http://192.168.10.1:5173/` sayfasını aç.
3. **Sağlık Analizi ve HADSE → Kişisel Kalibrasyon ve CSV Kaydı** bölümüne git.
4. Sensörün ve ESP32 veri bağlantısının çalıştığını doğrula.
5. Onay kutusunu işaretle ve **Onaylı kalibrasyonu başlat** düğmesine bas.
6. İlk aşamada kişi rahat ve hareketsiz durumda ölçülmeli. Her kanal için 20 kaliteli örnek gerektiğini unutma. Nabız ve SpO₂ kanalları ayrı kalibre edilir.
7. Referans oluşunca sistem sonraki ölçümleri bu referansla karşılaştırır. Anomali yalnızca ardışık 3 kaliteli ölçümde sapma varsa aday olarak işaretlenir.
8. İş bitince **CSV kaydını durdur**. Onay verilmeyen kişi için başlatma.

## Ne kaydediliyor?
Yeni CSV kaydı onay verilene kadar **kapalıdır**. Kayıt açıldığında yalnızca `source=measured` paketleri kaydedilir. CSV sütunları arasında UTC cihaz/alış zamanı, sıra numarası, nabız, tahmini SpO₂, hareket (g), sinyal kalitesi, sıcaklık, basınç, tahmini irtifa, pusula, bazal referanslar, anomali adayı ve öneri bulunur.

CSV'de isim, telefon, açık kimlik veya adres bulunmaz. `verified_label` ve `reviewer_notes` sütunları boş bırakılır: algoritmanın kendi tahmini **doğru etiket** diye kullanılamaz.

## CSV nerede?
Pi: `/home/mustafa/astrovital/backend/data/calibration_sessions/session_...csv`
Dosya izinleri: 0600; klasör izinleri: 0700.
Otomatik internete yükleme veya dashboard üzerinden herkese açık CSV indirme API'si yoktur.

Oturum bittikten sonra bilgisayarda şu komutu çalıştır:
`python tools/calibration_csv_to_windows.py`

Dosyalar `~/Downloads/AstroVital_Kalibrasyon_CSV` klasörüne SSH ile aktarılır.

## Anomali algoritması nasıl çalışır?
- Başlangıç referansı, en az 20 sakin ve kaliteli sensör değerinin medyanıdır.
- Sağlıklı kalibrasyon için sinyal kalitesi en az 0,75 ve ivme yaklaşık 1g yakınında olmalı.
- Nabızda referanstan `max(12 BPM, 4 × MAD)` kadar sapma; tahmini SpO₂'de aşağı yönde `max(4 yüzde puan, 4 × MAD)` sapma incelenmeye aday olabilir.
- Sapma **3 ardışık geçerli** pakette sürmeden anomali adayı oluşturulmaz.
- Hareket/sinyal sorunu varsa kişisel sağlık anomalisi değil, **ölçüm doğrulama uyarısı** gösterilir.
- Bağlantı yoksa yeni sonuç üretilmez. Önceki olay zaman damgasıyla kalır.
- Her oturum en fazla 1.800 paket toplar; sonra CSV kaydı otomatik durur.

Bunlar **kişisel referansa dayalı prototip kurallardır**, klinik normlar, eğitimli ML modeli veya doğrulanmış tıbbi eşikler değildir. Özellikle optik sensör ve kalibrasyon hataları yanlış alarm veya kaçırılan anomaliye sebep olabilir. Uygulama kişiye sağlık güvencesi vermez; gerçek belirtiler varsa uygun sağlık desteğine başvurulmalı.

## Gizlilik
- Katılımcının izni olmadan kayıt başlatma.
- CSV sağlık ölçümü içerir: izinsiz paylaşma, açık GitHub deposuna koyma veya internete yükleme.
- Mevcut AstroVital **Mission Black Box SQLite kayıtları**, bu yeni CSV modundan ayrı olarak telemetri kaydetmeye devam eder. Katılımcıya bunu da önceden açıkla.
- CSV oturumu kapatılınca otomatik silinmez; gerekli süre sonunda Pi ve varsa bilgisayar kopyalarını güvenli şekilde sil.
- CSV başlatma/durdurma yalnızca Pi'nin **Ethernet operatör ağı (192.168.10.0/24)** üzerinden kabul edilir. Hotspot'tan veya internetten açılmaz.
