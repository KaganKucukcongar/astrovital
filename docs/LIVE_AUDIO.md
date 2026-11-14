# AstroVital X · Canlı WebSocket telsizi

## Ses formatı ve köprü
- WebSocket: `ws://<Pi-IP>:8000/ws/audio?role=esp32` ve `?role=dashboard`.
- İkili ses: 8000 Hz, 8-bit unsigned mono PCM, 256 bayt (32 ms), sessizlik 128.
- FastAPI köprüsü asenkrondur; yeniden bağlanan cihaz eski rol soketini devralır. Yavaş alıcıda eski bloklar atılır.
- `GET /api/v1/audio/status` bağlantı durumlarını döndürür. Ses sunucu tarafında kaydedilmez.
- `backend/pyproject.toml` gerekli `websockets>=14,<17` bağımlılığını içerir.

## Dashboard ve PTT
- **Sesli İletişim (Telsiz)** ekranından **Sesi Aç** ile WebSocket ve AudioContext başlatılır.
- Gelen PCM blokları Float32'ye çevrilir, hoparlöre zamanlanır ve VU metrede gösterilir.
- **PTT** basılıyken mikrofon akışı 8 kHz PCM bloklarına dönüşür; bırakılınca mikrofon kapanır.
- Görsel arama popup'ları ayrı demodur.

## HTTP yerel ağda mikrofon
Chrome genellikle `http://192.168.4.1:5173` üzerinde `getUserMedia` erişimini engeller. Sadece demo için ayrı bir Chrome profili/kısayolu oluşturabilirsiniz:
```powershell
powershell -File .\tools\create_radio_chrome_shortcut.ps1
```
Yalnızca `http://192.168.10.1:5173` ve `http://192.168.4.1:5173` adreslerini o Chrome oturumunda güvenilir kabul ettirir. **Mikrofon iznini otomatik vermez.** Kullanıcı panelde **Mikrofon İznini İste** seçeneğine basarak Chrome iznini onaylar. Kontrol için açılan geçici mikrofon akışı hemen durur; gerçek yayın yalnızca PTT basılıyken yapılır.

**Güvenlik:** `--unsafely-treat-insecure-origin-as-secure` tarayıcı korumasını gevşetir. Sadece kontrollü yerel ağ demosunda kullanın. Üretim sistemi için HTTPS/WSS, kimlik doğrulaması ve ağ erişim kontrolü gerekir. Bu `ws://` kanalı şifresiz ve kimlik doğrulamasızdır; port 8000 internete açılmamalı.

## Donanım ve doğrulama
- ESP32'nin ses WebSocket'i bağlansa bile A0 mikrofon ve D5 hoparlörün fiziksel kalitesi doğrulanmış sayılmaz. A0 girişinde güçlü ofset/parazit gözlemlendi; ses seviyesini düşük tutun.
- `cd frontend && npm test && npm run build` (40 test başarılı).
- `backend/tests/audio_integration_checks.py`, yalnızca izole `127.0.0.1:18084` test sunucusunda karşılıklı ses, bağlantı devralma ve ses sırasında HTTP/telemetri kontrollerini yapar. Üretim veritabanına karşı çalıştırmayın.
- Bu değişiklik, ESP32 firmware'ini düzenlemedi; kullanıcıya ait yerel Wi-Fi kimlik bilgilerini kaynak depoya eklemeyin.
