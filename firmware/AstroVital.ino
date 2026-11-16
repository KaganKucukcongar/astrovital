/*
  AstroVital - Arduino Nano ESP32
  MAX30102 (nabiz + SpO2) + MPU6050 + DS1302 + SSD1306 + API Telemetry, Mesaj, Navigasyon ve Ses
  Offline / Online Uyumlu Gelismis OLED HUD Surumu (Deauth / Stale Session Korumali)

  Donanim Ses Yapilandirmasi:
  - Mikrofon (A0): KY-039 uzerindeki IR alici yerine bagli elektret/kulaklik mikrofonu (3.3V besleme)
  - Hoparlor (D5): 400 ohm direnc uzerinden kulaklik sol kanalina bagli 32 kHz PWM cikisi
*/

#include <Wire.h>
#include <WiFi.h>
#include <esp_wifi.h>
#include <esp_timer.h>
#include <HTTPClient.h>
#include <WebSocketsClient.h>
#include <Preferences.h>
#include <time.h>
#include <sys/time.h>
#include <ArduinoJson.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_BMP085.h>
#include <ThreeWire.h>
#include <RtcDS1302.h>
#include "MAX30105.h"
#include "spo2_algorithm.h"
#include "include/AstroSteps.h"

// ================== AYARLAR ==================
const bool    AUDIO_TEST_MODE       = false; // false: A0 gercek mikrofon (KY-039 modifiye), true: test melodisi
const int32_t AUDIO_MIC_GAIN        = 48;    // Preamfisiz mikrofon icin dijital kazanc carpani (16..64)
const int32_t AUDIO_NOISE_GATE      = 3;     // Sessizlikte arka plan hisirtisini kesen AC esik degeri

const char* WIFI_SSID   = "AstroHotspot";
const char* WIFI_PASS   = "astrovital26";
const int   WIFI_CH     = 6;

const char* PI_HOST     = "192.168.4.1";
const uint16_t PI_PORT  = 8000;
const char* API_URL     = "http://192.168.4.1:8000/api/v1/telemetry";
const char* HEALTH_URL  = "http://192.168.4.1:8000/health";
const char* MSG_GET_URL = "http://192.168.4.1:8000/api/v1/telemetry/message";
const char* MSG_RSP_URL = "http://192.168.4.1:8000/api/v1/telemetry/message/respond";
const char* NAV_GET_URL = "http://192.168.4.1:8000/api/v1/navigation/status";
const char* AUDIO_WS_PATH = "/ws/audio?role=esp32";

const bool ENABLE_MESSAGE_API    = false;
const bool ENABLE_NAV_API        = true;  // Canli Pi yonlendirmesi etkin
const bool ENABLE_AUDIO_WS       = true;
const uint32_t WIFI_RETRY_MS     = 15000;
const uint32_t CLOCK_RETRY_MS    = 15000;
const uint32_t CLOCK_REFRESH_MS  = 1800000;
const uint32_t INET_CHECK_MS     = 10000;
const char* API_KEY              = "";
const char* DEVICE_ID            = "astrovital-esp32-01";

const uint32_t SEND_INTERVAL_MS = 1000;
const float    MISSING          = 0.0f;
const bool     ENV_PAGE         = true;
const bool     NAV_PAGE         = true;
const int      LOCAL_UTC_OFFSET = 3;

// Ekran yenileme: animasyonlu ekranlarda akici, sakin ekranlarda islemciyi yormasin
const uint32_t FRAME_CALM_MS = 300;
const uint32_t FRAME_ANIM_MS = 100;
const uint32_t FRAME_HOLD_MS = 60;

// MAX30102 (nabiz + SpO2)
const uint32_t PPG_FINGER_MIN_IR    = 50000;
const uint32_t PPG_VALID_TIMEOUT_MS = 6000;
const byte     PPG_LED_BRIGHTNESS   = 60;
const bool     PPG_DEBUG            = true;

// Adim boyu kalibrasyonu
const float    STRIDE_CAL_DISTANCE_M = 10.0f;
const float    STRIDE_MIN_M          = 0.30f;
const float    STRIDE_MAX_M          = 1.50f;
const uint32_t STRIDE_CAL_TIMEOUT_MS = 120000;

// Yatay 2 eksenli pusula kalibrasyonu
const uint32_t MAG_CAL_DURATION_MS = 12000;
const uint32_t NAV_POLL_MS         = 1000;
const uint32_t NAV_STALE_MS        = 6500;

// Buton zamanlamalari (Basmadiginda LOW, dokununca HIGH)
const int      BTN_ACTIVE_LEVEL  = HIGH;
const uint32_t BTN_DEBOUNCE_MS   = 50;
const uint32_t BTN_LONG_MS       = 1000;
const uint32_t BTN_CAL_HOLD_MS   = 1500;
const uint32_t BTN_RING_DELAY_MS = 150;

// Pin Tanimlamalari
const int BTN_PIN       = D8;
const int RTC_CLK       = D2;
const int RTC_DAT       = D3;
const int RTC_RST       = D4;
const int AUDIO_MIC_PIN = A0;
const int AUDIO_SPK_PIN = D5;

// Ses ornekleme ayarlari (8 kHz, 8-bit Mono PCM)
const uint32_t AUDIO_SAMPLE_RATE = 8000;
const size_t   AUDIO_CHUNK_SIZE  = 256;   // 32 ms ses paketi
const size_t   AUDIO_RX_BUF_SIZE = 2048;  // 256 ms jitter tamponu
// =============================================

struct Reading {
  uint32_t sequence;
  char     iso[21];
  float    hr, accG, quality, spo2;
  bool     magOk, bmpOk;
  float    magX, magY, magZ, heading;
  float    tempC, pressHpa, altM;
  bool     stepsOk, headingCalibrated;
  uint32_t stepsTotal;
  bool     strideOk;
  float    strideM;
};

struct GuidanceState {
  bool valid;
  bool hasTurn;
  float remainingM;
  float turnDeg;
  uint32_t receivedAtMs;
  char mode[16];
  char nextWaypoint[24];
  char sessionStatus[16];
  bool demo;
  bool goalBase;
  char routeId[4];
  float routeA, routeB, routeC;
};

struct MessageTask {
  char id[64];
  char action[16];
  char respondedAt[21];
};

struct IncomingMessage {
  char id[64];
  char text[96];
};

enum ClockSource : uint8_t {
  CLK_NONE     = 0,
  CLK_RTC      = 1,
  CLK_PI_API   = 2,
  CLK_INTERNET = 3
};

Adafruit_SSD1306 display(128, 64, &Wire, -1);
Adafruit_MPU6050 mpu;
Adafruit_BMP085  bmp;
MAX30105         ppg;
ThreeWire        rtcWire(RTC_DAT, RTC_CLK, RTC_RST);
RtcDS1302<ThreeWire> Rtc(rtcWire);
Preferences      prefs;
QueueHandle_t    sendQueue;
QueueHandle_t    msgRespQueue;
QueueHandle_t    msgInQueue;
SemaphoreHandle_t rtcMutex = nullptr;
AstroSteps       pedometer;
portMUX_TYPE     guidanceMux = portMUX_INITIALIZER_UNLOCKED;
GuidanceState    lastGuidance = {};

volatile bool        netOk        = false;
volatile bool        apiUp        = false;
volatile bool        internetOk   = false;
volatile bool        piClockReady = false;
volatile ClockSource clockSource  = CLK_NONE;
uint32_t sequenceNo = 0;

// Ses sistemi durumu (8 kHz donanim zamanlayicisi + WebSocket koprusu)
WebSocketsClient audioWs;
esp_timer_handle_t audioTimer = nullptr;
uint8_t  audioTxBuf[2][AUDIO_CHUNK_SIZE];
volatile uint8_t  audioActiveTxBuf = 0;
volatile uint16_t audioTxIdx       = 0;
volatile int8_t   audioReadyTxBuf  = -1;

uint8_t  audioRxRing[AUDIO_RX_BUF_SIZE];
volatile uint16_t audioRxHead = 0;
volatile uint16_t audioRxTail = 0;

volatile bool     audioWsConnected = false;
volatile uint32_t audioTxPackets   = 0;
volatile uint32_t audioRxPackets   = 0;
volatile uint32_t audioLastRxMs    = 0;
volatile uint8_t  audioMicLevel    = 0;
uint8_t  audioMinSample = 255;
uint8_t  audioMaxSample = 0;

// Test melodisi sentezleyici tablolari (8000 Hz DDS)
static const int8_t SINE_LUT[64] = {
    0,   6,  12,  19,  24,  30,  36,  41,
   45,  49,  53,  56,  59,  61,  63,  64,
   64,  64,  63,  61,  59,  56,  53,  49,
   45,  41,  36,  30,  24,  19,  12,   6,
    0,  -6, -12, -19, -24, -30, -36, -41,
  -45, -49, -53, -56, -59, -61, -63, -64,
  -64, -64, -63,  -61, -59, -56, -53, -49,
  -45, -41, -36, -30, -24, -19, -12,  -6
};

// Mi Hicaz dizisi frekans adimlari: phaseStep = round(Hz * 65536 / 8000)
#define NOTE_REST 0
#define NOTE_E4   2700  // 329.63 Hz (Mi)
#define NOTE_F4   2861  // 349.23 Hz (Fa)
#define NOTE_GS4  3402  // 415.30 Hz (Sol#)
#define NOTE_A4   3604  // 440.00 Hz (La)
#define NOTE_B4   4046  // 493.88 Hz (Si)
#define NOTE_C5   4286  // 523.25 Hz (Do)
#define NOTE_D5   4811  // 587.33 Hz (Re)
#define NOTE_E5   5401  // 659.25 Hz (Mi5)

struct MelodyNote {
  uint16_t phaseStep;
  uint16_t durationMs;
};

// Ahmet Kaya - Kum Gibi (Mi Hicaz: Nakarat + Kita tam dongu)
static const MelodyNote TEST_MELODY[] = {
  {NOTE_A4, 220}, {NOTE_A4, 220}, {NOTE_A4, 220}, {NOTE_A4, 260},
  {NOTE_B4, 260}, {NOTE_C5, 500},
  {NOTE_C5, 220}, {NOTE_B4, 220}, {NOTE_A4, 220}, {NOTE_B4, 220}, {NOTE_GS4, 540},
  {NOTE_REST, 140},

  {NOTE_B4, 230}, {NOTE_A4, 230}, {NOTE_GS4, 330},
  {NOTE_B4, 230}, {NOTE_A4, 230}, {NOTE_GS4, 330},
  {NOTE_C5, 230}, {NOTE_B4, 230}, {NOTE_A4, 220}, {NOTE_GS4, 220}, {NOTE_F4, 540},
  {NOTE_REST, 140},

  {NOTE_F4, 220}, {NOTE_F4, 220}, {NOTE_F4, 220}, {NOTE_F4, 250},
  {NOTE_GS4, 250}, {NOTE_A4, 500},
  {NOTE_A4, 220}, {NOTE_GS4, 220}, {NOTE_A4, 220}, {NOTE_GS4, 220}, {NOTE_F4, 540},
  {NOTE_REST, 140},

  {NOTE_A4, 230}, {NOTE_GS4, 230}, {NOTE_F4, 330},
  {NOTE_A4, 230}, {NOTE_GS4, 230}, {NOTE_F4, 330},
  {NOTE_B4, 230}, {NOTE_A4, 230}, {NOTE_GS4, 230}, {NOTE_F4, 230}, {NOTE_E4, 720},
  {NOTE_REST, 300},

  {NOTE_A4, 230}, {NOTE_GS4, 230}, {NOTE_A4, 270},
  {NOTE_B4, 230}, {NOTE_B4, 230}, {NOTE_B4, 500},
  {NOTE_B4, 220}, {NOTE_D5, 260}, {NOTE_C5, 230}, {NOTE_B4, 230}, {NOTE_A4, 540},
  {NOTE_REST, 140},

  {NOTE_B4, 230}, {NOTE_B4, 230}, {NOTE_B4, 250}, {NOTE_E5, 360},
  {NOTE_D5, 230}, {NOTE_C5, 230}, {NOTE_B4, 230}, {NOTE_A4, 230}, {NOTE_B4, 600},
  {NOTE_REST, 160},

  {NOTE_B4, 220}, {NOTE_C5, 220}, {NOTE_B4, 220}, {NOTE_A4, 250},
  {NOTE_A4, 230}, {NOTE_B4, 230}, {NOTE_C5, 480},
  {NOTE_B4, 220}, {NOTE_C5, 220}, {NOTE_B4, 220}, {NOTE_A4, 220},
  {NOTE_GS4, 230}, {NOTE_F4, 520},
  {NOTE_REST, 140},

  {NOTE_F4, 230}, {NOTE_F4, 230}, {NOTE_GS4, 250}, {NOTE_B4, 300},
  {NOTE_A4, 230}, {NOTE_GS4, 230}, {NOTE_F4, 230}, {NOTE_E4, 740},
  {NOTE_REST, 450}
};
static const size_t TEST_MELODY_LEN = sizeof(TEST_MELODY) / sizeof(TEST_MELODY[0]);

// Mesaj durumu
bool hasActiveMessage = false;
char activeMsgId[64]   = "";
char activeMsgText[96] = "";

char    handledIds[4][64] = {};
uint8_t handledNext = 0;

// Gecici ekran mesaji ve basili tutma ilerlemesi
char     flashA[24] = "", flashB[24] = "";
uint32_t flashUntil = 0;
float    holdProgress = 0.0f;

// Sayfa sistemi
enum UiPage : uint8_t {
  PAGE_CLOCK,
  PAGE_HEALTH,
  PAGE_ENV,
  PAGE_NAV,
  PAGE_AUDIO,
  PAGE_NET,
  PAGE_CAL_MAG,
  PAGE_CAL_STRIDE,
  PAGE_COUNT
};
const char* const PAGE_NAMES[PAGE_COUNT] = {
  "SAAT", "SAGLIK", "ORTAM", "NAV", "SES", "AG", "KAL.PUSULA", "KAL.ADIM"
};
UiPage uiPage   = PAGE_CLOCK;
bool   uiRedraw = false;

enum PressCtx : uint8_t { CTX_IGNORE, CTX_MESSAGE, CTX_STRIDE_RUN, CTX_CAL_PAGE, CTX_PAGE };

// Turkce kisa gun / ay adlari (OLED fontu Turkce karakter icermez)
const char* const DOW_TR[7]  = {"PAZ", "PZT", "SAL", "CAR", "PER", "CUM", "CMT"};
const char* const MON_TR[12] = {"OCA", "SUB", "MAR", "NIS", "MAY", "HAZ",
                                "TEM", "AGU", "EYL", "EKI", "KAS", "ARA"};

// MAX30102 durumu
bool     ppgOk = false;
const uint16_t PPG_BUF  = 100;
const uint16_t PPG_STEP = 25;
uint32_t ppgIrBuf[PPG_BUF], ppgRedBuf[PPG_BUF];
uint16_t ppgCount = 0;
uint32_t ppgIr = 0, ppgRed = 0;
bool     ppgFinger = false;
uint32_t ppgLowSince = 0;
float    ppgHr = 0, ppgSpo2 = 0;
uint32_t ppgHrMs = 0, ppgSpo2Ms = 0;

// Ivme penceresi
float accSum = 0, accDevMax = 0;
uint16_t accCnt = 0;
float lastAccG = 1.0f;

// Sensor Durumlari
enum MagType { MAG_NONE, MAG_HMC, MAG_QMC, MAG_QMCP };
MagType magType = MAG_NONE;
bool magValid   = false;
bool bmpOk      = false;
bool mpuOk      = false;
float magX = 0, magY = 0, magZ = 0, heading = 0;
float tempC = 0, pressHpa = 0, altM = 0;

// Yatay pusula kalibrasyonu
bool magHeadingReady = false, magCalibrating = false;
uint32_t magCalStart = 0;
float magMinX = 99999, magMaxX = -99999, magMinY = 99999, magMaxY = -99999;
float magOffsetX = 0, magOffsetY = 0, magScaleX = 1, magScaleY = 1;

// Adim boyu kalibrasyonu
bool     strideCalibrated    = false;
float    strideLengthM       = 0.0f;
bool     strideCalibrating   = false;
uint32_t strideStartSteps    = 0;
uint32_t strideCalStart      = 0;

Reading cur = {0, "", 0, 1.0f, 0};

// ---------- RGB LED ----------
void setRgbColor(bool red, bool green, bool blue) {
  digitalWrite(LED_RED,   red   ? LOW : HIGH);
  digitalWrite(LED_GREEN, green ? LOW : HIGH);
  digitalWrite(LED_BLUE,  blue  ? LOW : HIGH);
}

// ---------- Gecici ekran mesaji ----------
void setFlash(const char* a, const char* b, uint32_t ms = 1500) {
  strlcpy(flashA, a, sizeof(flashA));
  strlcpy(flashB, b, sizeof(flashB));
  flashUntil = millis() + ms;
  uiRedraw = true;
}

// ---------- Ses PWM & 8 kHz Zamanlayici ----------
inline void writeSpeakerPwm(uint8_t duty) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(AUDIO_SPK_PIN, duty);
#else
  ledcWrite(0, duty);
#endif
}

uint8_t nextMelodySample() {
  static size_t   noteIdx       = 0;
  static uint32_t noteSampleIdx = 0;
  static uint16_t phase         = 0;

  const MelodyNote& note = TEST_MELODY[noteIdx];
  uint32_t totalSamples = (uint32_t)note.durationMs * (AUDIO_SAMPLE_RATE / 1000);
  uint32_t muteTail     = (totalSamples > 1200) ? 180 : (totalSamples / 6);

  uint8_t out = 128;
  if (note.phaseStep > 0 && noteSampleIdx + muteTail < totalSamples) {
    phase += note.phaseStep;
    uint16_t env = 255 - (uint16_t)((noteSampleIdx * 95UL) / totalSamples);
    int16_t fund = SINE_LUT[phase >> 10];
    int16_t harm = SINE_LUT[(uint16_t)(phase << 1) >> 10] >> 2;
    int16_t wave = ((fund + harm) * (int16_t)env) >> 8;
    out = (uint8_t)constrain(128 + wave, 0, 255);
  }

  if (++noteSampleIdx >= totalSamples) {
    noteSampleIdx = 0;
    noteIdx = (noteIdx + 1) % TEST_MELODY_LEN;
    if (TEST_MELODY[noteIdx].phaseStep == 0) phase = 0;
  }
  return out;
}

void IRAM_ATTR onAudioSampleTimer(void* arg) {
  // 1. Gelen ses tamponunda veri varsa kulaklik PWM cikisini guncelle (yoksa sessizlik = 128)
  uint16_t tail = audioRxTail;
  if (tail != audioRxHead) {
    writeSpeakerPwm(audioRxRing[tail]);
    audioRxTail = (tail + 1) % AUDIO_RX_BUF_SIZE;
  } else {
    writeSpeakerPwm(128);
  }

  // 2. Dashboard bagliysa test melodisi veya A0 mikrofon verisini 8-bit PCM ornekle
  if (!audioWsConnected) return;

  uint8_t sample = 128;
  if (AUDIO_TEST_MODE) {
    sample = nextMelodySample();
  } else {
    static int32_t dcBaseline = 0;
    static bool dcInit = false;
    int32_t raw = (int32_t)analogRead(AUDIO_MIC_PIN); // 0..4095

    if (!dcInit) {
      dcBaseline = raw << 8;
      dcInit = true;
    } else {
      dcBaseline += ((raw << 8) - dcBaseline) >> 6; // ~20 Hz yuksek geciren DC filtresi
    }

    int32_t ac = raw - (dcBaseline >> 8);
    if (ac > -AUDIO_NOISE_GATE && ac < AUDIO_NOISE_GATE) ac = 0;

    int32_t out = 128 + ((ac * AUDIO_MIC_GAIN) >> 2);
    if (out < 0) out = 0;
    else if (out > 255) out = 255;
    sample = (uint8_t)out;
  }

  if (sample < audioMinSample) audioMinSample = sample;
  if (sample > audioMaxSample) audioMaxSample = sample;

  uint8_t bufIdx = audioActiveTxBuf;
  uint16_t idx   = audioTxIdx;
  audioTxBuf[bufIdx][idx++] = sample;

  if (idx >= AUDIO_CHUNK_SIZE) {
    audioMicLevel = audioMaxSample - audioMinSample;
    audioMinSample = 255;
    audioMaxSample = 0;

    audioReadyTxBuf  = (int8_t)bufIdx;
    audioActiveTxBuf = bufIdx ^ 1;
    audioTxIdx       = 0;
  } else {
    audioTxIdx = idx;
  }
}

void onAudioWsEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      if (audioWsConnected) Serial.println("[AUDIO] WebSocket baglantisi kesildi");
      audioWsConnected = false;
      audioRxHead = audioRxTail = 0;
      break;

    case WStype_CONNECTED:
      audioWsConnected = true;
      audioTxIdx = 0;
      audioReadyTxBuf = -1;
      Serial.printf("[AUDIO] WebSocket baglandi (mod=%s)\n", AUDIO_TEST_MODE ? "KUM_GIBI_TEST" : "MIC_A0");
      break;

    case WStype_BIN:
      audioRxPackets++;
      audioLastRxMs = millis();
      for (size_t i = 0; i < length; i++) {
        uint16_t next = (audioRxHead + 1) % AUDIO_RX_BUF_SIZE;
        if (next != audioRxTail) {
          audioRxRing[audioRxHead] = payload[i];
          audioRxHead = next;
        }
      }
      break;

    default:
      break;
  }
}

void initAudioHardware() {
  pinMode(AUDIO_MIC_PIN, INPUT);
  analogReadResolution(12);

#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(AUDIO_SPK_PIN, 32000, 8);
#else
  ledcSetup(0, 32000, 8);
  ledcAttachPin(AUDIO_SPK_PIN, 0);
#endif
  writeSpeakerPwm(128);

  if (!ENABLE_AUDIO_WS) return;

  esp_timer_create_args_t timerArgs = {};
  timerArgs.callback = &onAudioSampleTimer;
  timerArgs.dispatch_method = ESP_TIMER_TASK;
  timerArgs.name = "astro_audio";
  if (esp_timer_create(&timerArgs, &audioTimer) == ESP_OK) {
    esp_timer_start_periodic(audioTimer, 1000000ULL / AUDIO_SAMPLE_RATE); // 125 us = 8000 Hz
  }
}

void audioNetTask(void*) {
  bool wsStarted = false;
  for (;;) {
    if (!ENABLE_AUDIO_WS) {
      vTaskDelay(pdMS_TO_TICKS(1000));
      continue;
    }

    if (WiFi.status() != WL_CONNECTED) {
      audioWsConnected = false;
      vTaskDelay(pdMS_TO_TICKS(200));
      continue;
    }

    if (!wsStarted) {
      audioWs.begin(PI_HOST, PI_PORT, AUDIO_WS_PATH);
      audioWs.onEvent(onAudioWsEvent);
      audioWs.setReconnectInterval(2500);
      wsStarted = true;
    }

    audioWs.loop();

    int8_t readyBuf = audioReadyTxBuf;
    if (readyBuf >= 0) {
      audioReadyTxBuf = -1;
      if (audioWsConnected) {
        audioWs.sendBIN(audioTxBuf[readyBuf], AUDIO_CHUNK_SIZE);
        audioTxPackets++;
      }
    }

    vTaskDelay(pdMS_TO_TICKS(2));
  }
}

// ---------- I2C Yardimcilari ----------
void i2cWrite(uint8_t addr, uint8_t reg, uint8_t val) {
  Wire.beginTransmission(addr); Wire.write(reg); Wire.write(val); Wire.endTransmission();
}
bool i2cPresent(uint8_t addr) {
  Wire.beginTransmission(addr); return Wire.endTransmission() == 0;
}
bool i2cReadBytes(uint8_t addr, uint8_t reg, uint8_t* buf, uint8_t n) {
  Wire.beginTransmission(addr); Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if ((uint8_t)Wire.requestFrom(addr, n) != n) return false;
  for (uint8_t i = 0; i < n; i++) buf[i] = Wire.read();
  return true;
}

// ---------- Manyetometre ----------
void magInit() {
  i2cWrite(0x68, 0x6A, 0x00); i2cWrite(0x68, 0x37, 0x02); delay(10);
  if (i2cPresent(0x1E)) {
    i2cWrite(0x1E, 0x00, 0x70); i2cWrite(0x1E, 0x01, 0x20); i2cWrite(0x1E, 0x02, 0x00); magType = MAG_HMC;
  } else if (i2cPresent(0x0D)) {
    i2cWrite(0x0D, 0x0B, 0x01); i2cWrite(0x0D, 0x09, 0x1D); magType = MAG_QMC;
  } else if (i2cPresent(0x2C)) {
    i2cWrite(0x2C, 0x0B, 0x80); delay(10); i2cWrite(0x2C, 0x0B, 0x08); i2cWrite(0x2C, 0x0A, 0x0B); magType = MAG_QMCP;
  }
}

bool magRead() {
  uint8_t b[6]; float x, y, z;
  if (magType == MAG_HMC) {
    if (!i2cReadBytes(0x1E, 0x03, b, 6)) return false;
    x = (int16_t)((b[0] << 8) | b[1]) / 1090.0f * 100.0f;
    z = (int16_t)((b[2] << 8) | b[3]) / 1090.0f * 100.0f;
    y = (int16_t)((b[4] << 8) | b[5]) / 1090.0f * 100.0f;
  } else if (magType == MAG_QMC) {
    if (!i2cReadBytes(0x0D, 0x00, b, 6)) return false;
    x = (int16_t)((b[1] << 8) | b[0]) / 3000.0f * 100.0f;
    y = (int16_t)((b[3] << 8) | b[2]) / 3000.0f * 100.0f;
    z = (int16_t)((b[5] << 8) | b[4]) / 3000.0f * 100.0f;
  } else if (magType == MAG_QMCP) {
    if (!i2cReadBytes(0x2C, 0x01, b, 6)) return false;
    x = (int16_t)((b[1] << 8) | b[0]) / 3750.0f * 100.0f;
    y = (int16_t)((b[3] << 8) | b[2]) / 3750.0f * 100.0f;
    z = (int16_t)((b[5] << 8) | b[4]) / 3750.0f * 100.0f;
  } else return false;
  magX = x; magY = y; magZ = z;
  float hx = (x - magOffsetX) * magScaleX;
  float hy = (y - magOffsetY) * magScaleY;
  float h = atan2f(hy, hx) * 180.0f / PI; if (h < 0) h += 360.0f; heading = h;
  return isfinite(h) && isfinite(x) && isfinite(y) && isfinite(z);
}

// ---------- Yatay pusula kalibrasyonu ----------
void startMagCalibration() {
  if (magType == MAG_NONE) { setFlash("PUSULA BULUNAMADI", "Sensor yok", 2000); return; }
  magCalibrating = true;
  magHeadingReady = false;
  prefs.putBool("magReady", false);
  magCalStart = millis();
  magMinX = magMinY = 99999; magMaxX = magMaxY = -99999;
  uiRedraw = true;
  Serial.println("Pusula: 12 saniye yatay, yavas tam tur cevirin.");
}

void updateMagCalibration(uint32_t now) {
  if (!magCalibrating) return;
  if (magValid) {
    magMinX = min(magMinX, magX); magMaxX = max(magMaxX, magX);
    magMinY = min(magMinY, magY); magMaxY = max(magMaxY, magY);
  }
  if (now - magCalStart < MAG_CAL_DURATION_MS) return;
  magCalibrating = false;

  float sx = (magMaxX > magMinX) ? (magMaxX - magMinX) * 0.5f : 0.0f;
  float sy = (magMaxY > magMinY) ? (magMaxY - magMinY) * 0.5f : 0.0f;
  char info[24];
  snprintf(info, sizeof(info), "dX:%.1f dY:%.1f uT", sx, sy);

  if (sx < 4.0f || sy < 4.0f || sx > 400.0f || sy > 400.0f) {
    magHeadingReady = false;
    Serial.printf("Pusula kalibrasyonu basarisiz (%s). Modulu yere paralel cevirin.\n", info);
    setFlash("PUSULA BASARISIZ", info, 3000);
    return;
  }

  magOffsetX = (magMaxX + magMinX) * 0.5f;
  magOffsetY = (magMaxY + magMinY) * 0.5f;
  float average = (sx + sy) * 0.5f;
  magScaleX = average / sx;
  magScaleY = average / sy;
  magHeadingReady = true;

  prefs.putFloat("magOX", magOffsetX); prefs.putFloat("magOY", magOffsetY);
  prefs.putFloat("magSX", magScaleX); prefs.putFloat("magSY", magScaleY);
  prefs.putBool("magReady", true);
  Serial.printf("Yatay pusula kalibrasyonu kaydedildi (%s).\n", info);
  setFlash("PUSULA HAZIR", info, 2500);
}

// ---------- Adim boyu kalibrasyonu ----------
void startStrideCalibration() {
  if (!mpuOk) { setFlash("MPU6050 YOK", "Adim sayilamaz", 2000); return; }
  strideCalibrating = true;
  strideStartSteps = pedometer.steps();
  strideCalStart = millis();
  uiRedraw = true;
  Serial.printf("Adim kalibrasyonu basladi: %.0f m duz yuruyun, bitince kisa basin.\n", STRIDE_CAL_DISTANCE_M);
}

void cancelStrideCalibration(const char* why) {
  strideCalibrating = false;
  Serial.printf("Adim kalibrasyonu iptal: %s\n", why);
  setFlash("ADIM KALIBRASYON", why, 2000);
}

void finishStrideCalibration() {
  strideCalibrating = false;
  uint32_t steps = pedometer.steps() - strideStartSteps;
  float stride = steps ? STRIDE_CAL_DISTANCE_M / (float)steps : 0.0f;
  char line[24];
  if (steps > 0 && stride >= STRIDE_MIN_M && stride <= STRIDE_MAX_M) {
    strideLengthM = stride;
    strideCalibrated = true;
    prefs.putFloat("strideM", strideLengthM);
    prefs.putBool("strideOk", true);
    snprintf(line, sizeof(line), "%.2f m (%lu adim)", stride, (unsigned long)steps);
    Serial.printf("Adim boyu kaydedildi: %.3f m (%lu adim / %.0f m)\n", stride, (unsigned long)steps, STRIDE_CAL_DISTANCE_M);
    setFlash("ADIM BOYU KAYDEDILDI", line, 2500);
  } else {
    snprintf(line, sizeof(line), "%lu adim sayildi", (unsigned long)steps);
    Serial.printf("Adim kalibrasyonu gecersiz: %lu adim\n", (unsigned long)steps);
    setFlash("GECERSIZ, TEKRARLA", line, 2500);
  }
}

void updateStrideCalibration(uint32_t now) {
  if (strideCalibrating && now - strideCalStart > STRIDE_CAL_TIMEOUT_MS) cancelStrideCalibration("Sure doldu");
}

// ---------- UTC Zaman (Pi API Date header + Internet NTP + DS1302 RTC) ----------
time_t makeUtcEpoch(int year, int month, int day, int hour, int minute, int second) {
  if (year < 2024 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31 ||
      hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 60) {
    return 0;
  }
  struct tm utc = {};
  utc.tm_year = year - 1900;
  utc.tm_mon  = month - 1;
  utc.tm_mday = day;
  utc.tm_hour = hour;
  utc.tm_min  = minute;
  utc.tm_sec  = second;
  setenv("TZ", "UTC0", 1);
  tzset();
  time_t epoch = mktime(&utc);
  return (epoch > 1700000000) ? epoch : 0;
}

time_t getRtcEpoch() {
  if (rtcMutex) xSemaphoreTake(rtcMutex, portMAX_DELAY);
  bool valid = Rtc.IsDateTimeValid();
  RtcDateTime n = Rtc.GetDateTime();
  if (rtcMutex) xSemaphoreGive(rtcMutex);

  if (!valid || n.Year() < 2024 || n.Year() >= 2100) return 0;
  return makeUtcEpoch(n.Year(), n.Month(), n.Day(), n.Hour(), n.Minute(), n.Second());
}

void setRtcFromEpoch(time_t epoch) {
  if (epoch <= 1700000000) return;
  struct tm utc;
  gmtime_r(&epoch, &utc);
  RtcDateTime dt(utc.tm_year + 1900, utc.tm_mon + 1, utc.tm_mday,
                 utc.tm_hour, utc.tm_min, utc.tm_sec);

  if (rtcMutex) xSemaphoreTake(rtcMutex, portMAX_DELAY);
  if (Rtc.GetIsWriteProtected()) Rtc.SetIsWriteProtected(false);
  if (!Rtc.GetIsRunning())       Rtc.SetIsRunning(true);
  Rtc.SetDateTime(dt);
  if (rtcMutex) xSemaphoreGive(rtcMutex);
}

time_t getInternalEpoch() {
  time_t sys = time(nullptr);
  if (sys <= 1700000000) sys = 0;
  time_t rtc = getRtcEpoch();
  return (rtc > sys) ? rtc : sys;
}

bool syncClockFromPi() {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  if (!http.begin(HEALTH_URL)) {
    Serial.println("[TIME] HTTP begin basarisiz");
    return false;
  }
  const char* dateKeys[] = {"Date"};
  http.collectHeaders(dateKeys, 1);
  http.setConnectTimeout(1500);
  http.setTimeout(2000);
  int code = http.GET();
  String date = (code == 200) ? http.header("Date") : "";
  http.end();
  if (code != 200 || date.length() < 25) {
    Serial.printf("[TIME] Pi /health HTTP %d; Date basligi yok veya erisilemiyor\n", code);
    return false;
  }

  char week[4] = {}, month[4] = {}, zone[4] = {};
  int day = 0, year = 0, hour = 0, minute = 0, second = 0;
  if (sscanf(date.c_str(), "%3s, %d %3s %d %d:%d:%d %3s",
             week, &day, month, &year, &hour, &minute, &second, zone) != 8 ||
      strcmp(zone, "GMT") != 0) {
    Serial.println("[TIME] Pi Date basligi okunamadi");
    return false;
  }
  const char* months[] = {"Jan","Feb","Mar","Apr","May","Jun", "Jul","Aug","Sep","Oct","Nov","Dec"};
  int mi = -1;
  for (int i = 0; i < 12; ++i) if (strcmp(month, months[i]) == 0) {mi = i; break;}
  if (mi < 0) return false;

  time_t piEpoch = makeUtcEpoch(year, mi + 1, day, hour, minute, second);
  if (piEpoch <= 1700000000) return false;

  time_t internalEpoch = getInternalEpoch();

  // Dahili saat (DS1302 RTC veya sistem saati) sunucu saatinden ilerideyse
  // Pi kapandiginda olusan geri kalmayi asmak icin dahili saati guncel kabul et.
  if (internalEpoch > piEpoch) {
    time_t sys = time(nullptr);
    if (internalEpoch > sys) {
      struct timeval tv = {};
      tv.tv_sec = internalEpoch;
      settimeofday(&tv, nullptr);
    }
    if (clockSource == CLK_NONE || clockSource == CLK_PI_API) {
      clockSource = (getRtcEpoch() > piEpoch) ? CLK_RTC : CLK_INTERNET;
    }
    piClockReady = true;
    Serial.printf("[TIME] Dahili saat sunucudan %ld sn ileride; dahili saat guncel kabul edildi (Pi: %s)\n",
                  (long)(internalEpoch - piEpoch), date.c_str());
    return true;
  }

  struct timeval tv = {};
  tv.tv_sec = piEpoch;
  if (settimeofday(&tv, nullptr) != 0) return false;

  // Sunucu saati daha ilerideyse DS1302 donanim saatini de guncelle
  if (piEpoch > getRtcEpoch() + 2) {
    setRtcFromEpoch(piEpoch);
    Serial.println("[TIME] DS1302 RTC sunucu saatine guncellendi");
  }

  piClockReady = true;
  clockSource  = CLK_PI_API;
  Serial.printf("[TIME] Pi UTC senkron: %s\n", date.c_str());
  return true;
}

bool checkInternetAccess() {
  if (WiFi.status() != WL_CONNECTED) return false;
  WiFiClient probe;
  bool ok = probe.connect(IPAddress(1, 1, 1, 1), 80, 300);
  if (ok) probe.stop();
  return ok;
}

void timestampIso(char* buf) {
  time_t sys = time(nullptr);
  if (sys > 1700000000) {
    struct tm utc;
    gmtime_r(&sys, &utc);
    strftime(buf, 21, "%Y-%m-%dT%H:%M:%SZ", &utc);
    return;
  }
  time_t rtcEpoch = getRtcEpoch();
  if (rtcEpoch > 1700000000) {
    if (clockSource == CLK_NONE) clockSource = CLK_RTC;
    struct tm utc;
    gmtime_r(&rtcEpoch, &utc);
    strftime(buf, 21, "%Y-%m-%dT%H:%M:%SZ", &utc);
  } else {
    strcpy(buf, "1970-01-01T00:00:00Z");
  }
}

void localTimeStr(const char* iso, char* out) {
  int h, m, s;
  if (iso[0] && sscanf(iso + 11, "%d:%d:%d", &h, &m, &s) == 3) {
    h = ((h + LOCAL_UTC_OFFSET) % 24 + 24) % 24;
    snprintf(out, 9, "%02d:%02d:%02d", h, m, s);
  } else strcpy(out, "--:--:--");
}

int daysInMonth(int y, int m) {
  static const uint8_t dm[12] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
  if (m == 2 && ((y % 4 == 0 && y % 100 != 0) || y % 400 == 0)) return 29;
  return dm[(m - 1) % 12];
}

int dayOfWeek(int y, int m, int d) {
  static const int t[12] = {0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4};
  if (m < 3) y -= 1;
  return (y + y / 4 - y / 100 + y / 400 + t[m - 1] + d) % 7;
}

bool localDateTime(const char* iso, int* y, int* mo, int* d, int* h, int* mi, int* s) {
  if (!iso[0] || strncmp(iso, "1970", 4) == 0) return false;
  if (sscanf(iso, "%d-%d-%dT%d:%d:%d", y, mo, d, h, mi, s) != 6) return false;
  if (*mo < 1 || *mo > 12 || *d < 1 || *d > 31) return false;
  *h += LOCAL_UTC_OFFSET;
  while (*h >= 24) {
    *h -= 24; (*d)++;
    if (*d > daysInMonth(*y, *mo)) { *d = 1; if (++(*mo) > 12) { *mo = 1; (*y)++; } }
  }
  while (*h < 0) {
    *h += 24; (*d)--;
    if (*d < 1) { if (--(*mo) < 1) { *mo = 12; (*y)--; } *d = daysInMonth(*y, *mo); }
  }
  return true;
}

// ---------- MAX30102: nabiz + SpO2 ----------
void computePpg(uint32_t now) {
  int32_t spo2 = 0, hr = 0;
  int8_t  spo2Valid = 0, hrValid = 0;
  maxim_heart_rate_and_oxygen_saturation(ppgIrBuf, PPG_BUF, ppgRedBuf, &spo2, &spo2Valid, &hr, &hrValid);

  if (hrValid && hr >= 40 && hr <= 180) {
    ppgHr = (ppgHr > 0.0f) ? (0.6f * ppgHr + 0.4f * (float)hr) : (float)hr;
    ppgHrMs = now;
  }
  if (spo2Valid && spo2 >= 70 && spo2 <= 100) {
    ppgSpo2 = (ppgSpo2 > 0.0f) ? (0.7f * ppgSpo2 + 0.3f * (float)spo2) : (float)spo2;
    ppgSpo2Ms = now;
  }
}

void processPpg(uint32_t now) {
  static uint32_t tPpg = 0;
  if (!ppgOk || now - tPpg < 20) return;
  tPpg = now;

  ppg.check();
  while (ppg.available()) {
    uint32_t red = ppg.getFIFORed();
    uint32_t ir  = ppg.getFIFOIR();
    ppg.nextSample();
    ppgIr = ir; ppgRed = red;

    if (ir < PPG_FINGER_MIN_IR) {
      if (ppgLowSince == 0) ppgLowSince = now ? now : 1;
      if (ppgFinger && now - ppgLowSince > 800) {
        ppgFinger = false;
        ppgCount = 0;
        ppgHr = 0.0f;
        ppgSpo2 = 0.0f;
      }
      continue;
    }
    ppgLowSince = 0;
    ppgFinger = true;

    ppgIrBuf[ppgCount]  = ir;
    ppgRedBuf[ppgCount] = red;
    if (++ppgCount >= PPG_BUF) {
      computePpg(now);
      memmove(ppgIrBuf,  ppgIrBuf  + PPG_STEP, (PPG_BUF - PPG_STEP) * sizeof(uint32_t));
      memmove(ppgRedBuf, ppgRedBuf + PPG_STEP, (PPG_BUF - PPG_STEP) * sizeof(uint32_t));
      ppgCount = PPG_BUF - PPG_STEP;
    }
  }
}

// =====================================================================
//                        GOSTERISLI OLED ARAYUZU
// =====================================================================

void polarLine(int cx, int cy, float angleRad, int r0, int r1) {
  float s = sinf(angleRad), c = cosf(angleRad);
  display.drawLine(cx + (int)roundf(s * r0), cy - (int)roundf(c * r0),
                   cx + (int)roundf(s * r1), cy - (int)roundf(c * r1), SSD1306_WHITE);
}

void printCentered(const char* s, int y) {
  int w = (int)strlen(s) * 6;
  display.setCursor(max(2, (128 - w) / 2), y);
  display.print(s);
}

void drawPager() {
  const int top = 15, seg = 6;
  for (int i = 0; i < (int)PAGE_COUNT; i++) {
    int y = top + i * seg;
    if (i == (int)uiPage) display.fillRect(125, y, 3, seg - 1, SSD1306_WHITE);
    else                  display.drawPixel(126, y + 2, SSD1306_WHITE);
  }
}

void drawSignalBars(int x, int y, int rssi, bool connected) {
  if (!connected) {
    display.drawLine(x + 2, y + 1, x + 10, y + 7, SSD1306_WHITE);
    display.drawLine(x + 10, y + 1, x + 2, y + 7, SSD1306_WHITE);
    return;
  }
  int bars = (rssi >= -55) ? 4 : (rssi >= -67) ? 3 : (rssi >= -78) ? 2 : 1;
  for (int i = 0; i < 4; i++) {
    int h = (i + 1) * 2;
    int bx = x + i * 4;
    int by = y + (8 - h);
    if (i < bars) display.fillRect(bx, by, 3, h, SSD1306_WHITE);
    else          display.drawRect(bx, by, 3, h, SSD1306_WHITE);
  }
}

void drawHeader(const char* title, const char* badge = "", bool showWifi = true) {
  int tw = (int)strlen(title) * 6;
  display.fillRoundRect(-4, 0, tw + 11, 11, 3, SSD1306_WHITE);
  display.setTextSize(1);
  display.setTextColor(SSD1306_BLACK);
  display.setCursor(3, 2);
  display.print(title);
  display.setTextColor(SSD1306_WHITE);

  int rightEdge = showWifi ? 110 : 128;
  if (badge && badge[0]) {
    int w = (int)strlen(badge) * 6;
    int bx = rightEdge - w - 2;
    if (bx > tw + 12) {
      display.setCursor(bx, 2);
      display.print(badge);
    }
  }
  if (showWifi) drawSignalBars(113, 0, WiFi.RSSI(), WiFi.status() == WL_CONNECTED);
  display.drawFastHLine(tw + 7, 10, 128 - (tw + 7), SSD1306_WHITE);
}

void drawHeartIcon(int x, int y, bool big) {
  if (!big) {
    display.fillCircle(x + 2, y + 2, 2, SSD1306_WHITE);
    display.fillCircle(x + 6, y + 2, 2, SSD1306_WHITE);
    display.fillTriangle(x, y + 3, x + 8, y + 3, x + 4, y + 8, SSD1306_WHITE);
  } else {
    display.fillCircle(x + 3, y + 3, 3, SSD1306_WHITE);
    display.fillCircle(x + 9, y + 3, 3, SSD1306_WHITE);
    display.fillTriangle(x, y + 4, x + 12, y + 4, x + 6, y + 12, SSD1306_WHITE);
  }
}

const char* cardinalDir(float deg) {
  static const char* const DIRS[8] = {"K", "KD", "D", "GD", "G", "GB", "B", "KB"};
  int idx = ((int)roundf(deg / 45.0f)) & 7;
  return DIRS[idx];
}

const char* clockSourceLabel() {
  switch (clockSource) {
    case CLK_PI_API:   return "PI API";
    case CLK_INTERNET: return "INTERNET";
    case CLK_RTC:      return "RTC DONANIM";
    default:           return "AYARLANMADI";
  }
}

const char* clockSourceShort() {
  switch (clockSource) {
    case CLK_PI_API:   return "PI";
    case CLK_INTERNET: return "NET";
    case CLK_RTC:      return "RTC";
    default:           return "--";
  }
}

void drawCompass(int cx, int cy, int r, float headingDeg, bool valid) {
  display.drawCircle(cx, cy, r, SSD1306_WHITE);
  display.setTextSize(1);
  if (!valid) {
    display.setCursor(cx - 9, cy - 3);
    display.print("N/A");
    return;
  }
  float rot = -headingDeg * (PI / 180.0f);
  for (int i = 0; i < 8; i++) {
    float a = rot + i * (PI / 4.0f);
    polarLine(cx, cy, a, (i % 2 == 0) ? r - 6 : r - 3, r - 1);
  }
  int nx = cx + (int)roundf(sinf(rot) * (r - 11));
  int ny = cy - (int)roundf(cosf(rot) * (r - 11));
  display.setCursor(nx - 2, ny - 3);
  display.print('N');
  display.fillTriangle(cx - 3, cy - r - 3, cx + 3, cy - r - 3, cx, cy - r + 3, SSD1306_WHITE);
  display.fillCircle(cx, cy, 1, SSD1306_WHITE);
}

void drawPpgWave(int x0, int y0, int w, int h) {
  int n = ppgCount;
  if (n < 8) {
    display.drawFastHLine(x0, y0 + h / 2, w, SSD1306_WHITE);
    return;
  }
  uint32_t mn = 0xFFFFFFFFu, mx = 0;
  for (int i = 0; i < n; i++) {
    uint32_t v = ppgIrBuf[i];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  float span = (float)(mx - mn);
  if (span < 1.0f) span = 1.0f;
  int px = -1, py = 0;
  for (int i = 0; i < n; i++) {
    int x = x0 + (w - 1) - (int)((long)(n - 1 - i) * (w - 1) / (PPG_BUF - 1));
    int y = y0 + (int)(((float)(ppgIrBuf[i] - mn) / span) * (h - 1));
    if (px >= 0) display.drawLine(px, py, x, y, SSD1306_WHITE);
    px = x; py = y;
  }
}

void drawNoFingerAnim() {
  uint32_t t = millis() % 1800;
  int r1 = 5 + (int)(t * 15 / 1800);
  int r2 = 5 + (int)(((t + 900) % 1800) * 15 / 1800);
  display.drawCircle(64, 29, r1, SSD1306_WHITE);
  display.drawCircle(64, 29, r2, SSD1306_WHITE);
  display.fillCircle(64, 29, 3, SSD1306_WHITE);
  display.setTextSize(1);
  printCentered("PARMAGINI KOY", 53);
}

void drawBigNotice(const char* a, const char* b) {
  display.drawRoundRect(10, 18, 108, 34, 5, SSD1306_WHITE);
  display.setTextSize(1);
  printCentered(a, 26);
  printCentered(b, 38);
}

void showMsg(const char* a, const char* b = "") {
  int kind = 0;
  if (strstr(a, "BASARISIZ") || strstr(a, "GECERSIZ") || strstr(a, "YOK") ||
      strstr(a, "BULUNAMADI") || strstr(a, "BAGLANAMADI")) kind = 2;
  else if (strstr(a, "HAZIR") || strstr(a, "KAYDEDILDI") ||
           strstr(a, "GONDERILDI") || strstr(a, "Baglandi")) kind = 1;

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setTextWrap(false);
  display.drawRoundRect(1, 4, 126, 56, 6, SSD1306_WHITE);
  display.drawRoundRect(3, 6, 122, 52, 4, SSD1306_WHITE);

  const int cx = 64, cy = 20;
  display.drawCircle(cx, cy, 9, SSD1306_WHITE);
  if (kind == 1) {
    display.drawLine(cx - 5, cy, cx - 2, cy + 4, SSD1306_WHITE);
    display.drawLine(cx - 2, cy + 4, cx + 5, cy - 4, SSD1306_WHITE);
    display.drawLine(cx - 5, cy + 1, cx - 2, cy + 5, SSD1306_WHITE);
    display.drawLine(cx - 2, cy + 5, cx + 5, cy - 3, SSD1306_WHITE);
  } else if (kind == 2) {
    display.drawLine(cx - 4, cy - 4, cx + 4, cy + 4, SSD1306_WHITE);
    display.drawLine(cx + 4, cy - 4, cx - 4, cy + 4, SSD1306_WHITE);
  } else {
    display.fillRect(cx - 1, cy - 1, 2, 6, SSD1306_WHITE);
    display.fillRect(cx - 1, cy - 5, 2, 2, SSD1306_WHITE);
  }
  printCentered(a, 34);
  printCentered(b, 45);
  display.setTextWrap(true);
  display.display();
}

void drawBootScreen(const char* stage, int pct) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  float ph = millis() / 650.0f;
  const int cx = 64, cy = 13, rx = 28, ry = 8;
  for (int a = 0; a < 360; a += 10) {
    float r = a * (PI / 180.0f);
    display.drawPixel(cx + (int)(rx * cosf(r)), cy + (int)(ry * sinf(r)), SSD1306_WHITE);
  }
  display.fillCircle(cx, cy, 4, SSD1306_WHITE);
  display.fillCircle(cx + (int)(rx * cosf(ph)), cy + (int)(ry * sinf(ph)), 2, SSD1306_WHITE);

  display.setTextSize(2);
  display.setCursor(4, 27);
  display.print("ASTROVITAL");
  display.setTextSize(1);
  printCentered(stage, 46);
  display.drawRect(14, 57, 100, 5, SSD1306_WHITE);
  display.fillRect(14, 57, (100 * constrain(pct, 0, 100)) / 100, 5, SSD1306_WHITE);
  display.display();
}

void drawHoldRing() {
  if (holdProgress <= 0.0f) return;
  const int cx = 64, cy = 32, rMax = 22;
  display.fillCircle(cx, cy, rMax + 3, SSD1306_BLACK);
  display.drawCircle(cx, cy, rMax, SSD1306_WHITE);
  int r = (int)(rMax * holdProgress);
  if (r > 0) display.fillCircle(cx, cy, r, SSD1306_WHITE);
}

// ---------- Sayfalar ----------
void drawMessageScreen() {
  bool blink = ((millis() / 450) & 1) != 0;
  uint16_t fg = blink ? SSD1306_BLACK : SSD1306_WHITE;

  display.clearDisplay();
  if (blink) display.fillRect(0, 0, 128, 12, SSD1306_WHITE);
  else       display.drawRect(0, 0, 128, 12, SSD1306_WHITE);
  display.drawRect(3, 2, 11, 8, fg);
  display.drawLine(3, 2, 8, 6, fg);
  display.drawLine(13, 2, 8, 6, fg);
  display.setTextSize(1);
  display.setTextColor(fg);
  display.setCursor(19, 2);
  display.print("!! GELEN MESAJ !!");

  display.setTextColor(SSD1306_WHITE);
  display.setCursor(2, 16);
  display.println(activeMsgText);

  display.drawFastHLine(0, 49, 128, SSD1306_WHITE);
  display.setCursor(0, 53);
  display.print("Kisa:KABUL  Uzun:RED");

  drawHoldRing();
  display.display();
}

void drawClockScreen() {
  int y = 0, mo = 0, d = 0, h = 0, mi = 0, s = 0;
  bool valid = localDateTime(cur.iso, &y, &mo, &d, &h, &mi, &s);
  const char* apiBadge = (WiFi.status() != WL_CONNECTED) ? "NO WIFI" :
                         netOk ? "API:OK" : apiUp ? "API:UP" : "API:--";

  display.clearDisplay();
  drawHeader("ASTRO", clockSourceShort(), true);

  const int cx = 29, cy = 38, R = 23;
  display.drawCircle(cx, cy, R, SSD1306_WHITE);
  for (int i = 0; i < 12; i++) {
    polarLine(cx, cy, i * (PI / 6.0f), (i % 3 == 0) ? R - 5 : R - 3, R - 1);
  }
  if (valid) {
    float aS = s * (PI / 30.0f);
    float aM = (mi + s / 60.0f) * (PI / 30.0f);
    float aH = ((h % 12) + mi / 60.0f) * (PI / 6.0f);
    polarLine(cx, cy, aH, 0, 10);
    polarLine(cx + 1, cy, aH, 0, 10);
    polarLine(cx, cy, aM, 0, 16);
    polarLine(cx, cy, aS, -4, 20);
    display.fillCircle(cx, cy, 2, SSD1306_WHITE);
  }

  display.setTextSize(2);
  display.setCursor(58, 14);
  if (valid) display.printf("%02d:%02d", h, mi); else display.print("--:--");

  display.drawRect(58, 33, 50, 5, SSD1306_WHITE);
  if (valid) display.fillRect(58, 33, 1 + (s * 48) / 59, 5, SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(111, 32);
  if (valid) display.printf("%02d", s);

  display.setCursor(58, 43);
  if (valid) display.printf("%s %02d %s", DOW_TR[dayOfWeek(y, mo, d)], d, MON_TR[mo - 1]);
  else       display.print("SAAT YOK");
  display.setCursor(58, 54);
  display.print(apiBadge);

  drawPager();
  display.display();
}

void drawScreen(bool finger) {
  const char* apiBadge = (WiFi.status() != WL_CONNECTED) ? "NO WIFI" :
                         netOk ? "API:OK" : apiUp ? "API:UP" : "API:--";
  display.clearDisplay();
  drawHeader("SAGLIK", apiBadge, true);

  if (!ppgOk) {
    drawBigNotice("MAX30102", "SENSOR BULUNAMADI");
  } else if (!finger) {
    drawNoFingerAnim();
  } else {
    bool beat = false;
    if (cur.hr > 0.0f) {
      uint32_t period = (uint32_t)(60000.0f / cur.hr);
      beat = (millis() % period) < 140;
    }
    drawHeartIcon(3, 16, beat);

    display.setTextSize(3);
    display.setCursor(20, 13);
    if (cur.hr > 0.0f) display.printf("%d", (int)roundf(cur.hr)); else display.print("--");
    display.setTextSize(1);
    display.setCursor(20, 39);
    display.print("BPM");

    display.setCursor(84, 13);
    display.print("SpO2");
    display.setTextSize(2);
    display.setCursor(84, 23);
    if (cur.spo2 > 0.0f) display.printf("%d%%", (int)roundf(cur.spo2)); else display.print("--");
    display.drawRect(84, 41, 36, 6, SSD1306_WHITE);
    if (cur.spo2 > 0.0f) {
      float f = constrain((cur.spo2 - 80.0f) / 20.0f, 0.0f, 1.0f);
      display.fillRect(84, 41, 1 + (int)(34 * f), 6, SSD1306_WHITE);
    }

    display.drawFastHLine(0, 49, 124, SSD1306_WHITE);
    drawPpgWave(2, 51, 120, 11);
  }

  drawPager();
  display.display();
}

void drawEnvScreen() {
  char clk[9];
  localTimeStr(cur.iso, clk);

  display.clearDisplay();
  drawHeader("ORTAM", clk, false);

  drawCompass(27, 34, 19, heading, magValid);
  display.setTextSize(1);
  display.setCursor(4, 55);
  if (magValid) display.printf("%3.0f %s", heading, cardinalDir(heading));
  else          display.print("--");

  if (bmpOk) {
    display.setTextSize(2);
    display.setCursor(56, 14);
    display.printf("%.1f", tempC);
    display.setTextSize(1);
    display.print("C");
    display.setCursor(56, 34);
    display.printf("%.1f hPa", pressHpa);
    display.setCursor(56, 44);
    display.printf("ALT %.0f m", altM);
  } else {
    display.setTextSize(1);
    display.setCursor(56, 20);
    display.print("BMP180 YOK");
  }
  display.setTextSize(1);
  display.setCursor(56, 54);
  if (magValid) display.printf("|B| %.0f uT", sqrtf(magX * magX + magY * magY + magZ * magZ));

  drawPager();
  display.display();
}

// SES: Iki yonlu WebSocket ses durumu ve canli cikis seviye cubugu
void drawAudioScreen() {
  const char* wsBadge = !ENABLE_AUDIO_WS ? "KAPALI" :
                        (WiFi.status() != WL_CONNECTED) ? "NO WIFI" :
                        audioWsConnected ? "WS:OK" : "WS:--";
  display.clearDisplay();
  drawHeader("SES", wsBadge, true);
  display.setTextSize(1);

  display.setCursor(0, 15);
  display.print(AUDIO_TEST_MODE ? "MELODI:" : "MIC A0:");
  display.drawRect(44, 14, 78, 8, SSD1306_WHITE);
  int barW = audioWsConnected ? constrain((int)((audioMicLevel * 76) / 255), 1, 76) : 0;
  if (barW > 0) display.fillRect(45, 15, barW, 6, SSD1306_WHITE);

  bool receiving = audioWsConnected && audioLastRxMs > 0 && (millis() - audioLastRxMs) < 350;
  display.setCursor(0, 28);
  display.print("SPK D5:");
  if (receiving) {
    display.fillRoundRect(44, 26, 78, 11, 2, SSD1306_WHITE);
    display.setTextColor(SSD1306_BLACK);
    display.setCursor(50, 28);
    display.print("GELEN SES!");
    display.setTextColor(SSD1306_WHITE);
  } else {
    display.setCursor(44, 28);
    display.print(audioWsConnected ? "DINLEMEDE" : "BEKLIYOR");
  }

  display.setCursor(0, 41);
  display.printf("TX:%lu  RX:%lu", (unsigned long)audioTxPackets, (unsigned long)audioRxPackets);

  display.drawFastHLine(0, 51, 124, SSD1306_WHITE);
  display.setCursor(0, 54);
  display.print(AUDIO_TEST_MODE ? "TEST: KUM GIBI" : "8kHz PCM  A0/D5");

  drawPager();
  display.display();
}

void drawStatusRow(int y, const char* label, const char* value, bool ok) {
  if (ok) display.fillCircle(4, y + 3, 3, SSD1306_WHITE);
  else    display.drawCircle(4, y + 3, 3, SSD1306_WHITE);
  display.setCursor(12, y);
  display.print(label);
  display.setCursor(56, y);
  display.print(value);
}

void drawNetworkScreen() {
  bool wifiConn = (WiFi.status() == WL_CONNECTED);
  char ipBadge[18];
  if (wifiConn) strlcpy(ipBadge, WiFi.localIP().toString().c_str(), sizeof(ipBadge));
  else          strlcpy(ipBadge, "OFFLINE", sizeof(ipBadge));

  display.clearDisplay();
  drawHeader("AG", ipBadge, true);
  display.setTextSize(1);

  char wifiVal[16];
  if (wifiConn) snprintf(wifiVal, sizeof(wifiVal), "%d dBm", WiFi.RSSI());
  else          strlcpy(wifiVal, "KOPUK", sizeof(wifiVal));
  drawStatusRow(14, "WiFi", wifiVal, wifiConn);
  drawStatusRow(26, "Inet", (wifiConn && internetOk) ? "VAR" : "YOK (OFFLINE)", wifiConn && internetOk);

  const char* apiVal = !wifiConn ? "AG BEKLENIYOR" : netOk ? "ERISIM VAR" : apiUp ? "SUNUCU VAR" : "ERISIM YOK";
  drawStatusRow(38, "API", apiVal, wifiConn && netOk);
  drawStatusRow(50, "Saat", clockSourceLabel(), clockSource != CLK_NONE);

  drawPager();
  display.display();
}

void drawMagCalibrationScreen() {
  float sx = (magMaxX > magMinX) ? (magMaxX - magMinX) * 0.5f : 0.0f;
  float sy = (magMaxY > magMinY) ? (magMaxY - magMinY) * 0.5f : 0.0f;
  uint32_t el  = min((uint32_t)(millis() - magCalStart), MAG_CAL_DURATION_MS);
  uint32_t rem = (MAG_CAL_DURATION_MS - el) / 1000;

  display.clearDisplay();
  drawHeader("PUSULA KAL.", "", false);
  display.setTextSize(1);
  display.setCursor(0, 14); display.print("Yatay tam tur");
  display.setCursor(0, 24); display.print("cevirin");
  display.setTextSize(2);
  display.setCursor(0, 36); display.printf("%lus", (unsigned long)rem);
  display.setTextSize(1);
  display.setCursor(0, 50); display.printf("X%.0f Y%.0f", sx, sy);

  const int cx = 98, cy = 34, R = 20;
  display.drawCircle(cx, cy, R, SSD1306_WHITE);
  int hw = min((int)sx, R), hh = min((int)sy, R);
  display.drawRect(cx - hw, cy - hh, 2 * hw + 1, 2 * hh + 1, SSD1306_WHITE);
  display.drawFastHLine(cx - 3, cy, 7, SSD1306_WHITE);
  display.drawFastVLine(cx, cy - 3, 7, SSD1306_WHITE);

  display.drawRect(0, 58, 128, 5, SSD1306_WHITE);
  display.fillRect(0, 58, (int)((128UL * el) / MAG_CAL_DURATION_MS), 5, SSD1306_WHITE);
  display.display();
}

void drawStrideRunScreen() {
  uint32_t steps = pedometer.steps() - strideStartSteps;
  char num[12];
  snprintf(num, sizeof(num), "%lu", (unsigned long)steps);

  display.clearDisplay();
  drawHeader("ADIM KAL.", "", false);
  display.setTextSize(1);
  display.setCursor(0, 14);
  display.printf("%.0f m duz yuruyun", STRIDE_CAL_DISTANCE_M);

  int nw = (int)strlen(num) * 18;
  display.setTextSize(3);
  display.setCursor(6, 25);
  display.print(num);
  display.setTextSize(1);
  display.setCursor(6 + nw + 4, 42);
  display.print("adim");

  for (int i = 0; i < 3; i++) {
    int cxp = 104 + i * 8;
    if ((int)((millis() / 300) % 3) == i) display.fillCircle(cxp, 18, 3, SSD1306_WHITE);
    else                                  display.drawCircle(cxp, 18, 3, SSD1306_WHITE);
  }

  display.drawFastHLine(0, 50, 128, SSD1306_WHITE);
  display.setCursor(0, 54);
  display.print("Bitir:KISA Iptal:TUT");
  drawHoldRing();
  display.display();
}

void drawCalMagPage() {
  display.clearDisplay();
  drawHeader("KAL. PUSULA", magHeadingReady ? "[HAZIR]" : "[YOK]", false);
  drawCompass(24, 32, 17, magValid ? heading : 0.0f, magValid);

  display.setTextSize(1);
  display.setCursor(50, 15);
  if (magType == MAG_NONE) display.print("Sensor YOK");
  else display.print("Durum:");
  display.setCursor(50, 25);
  if (magType != MAG_NONE) display.print(magHeadingReady ? "GECERLI" : "GEREKLI");
  display.setCursor(50, 36);
  display.printf("Yatay %lu sn", (unsigned long)(MAG_CAL_DURATION_MS / 1000));
  display.setCursor(50, 46);
  display.print("tam tur");

  display.drawFastHLine(0, 51, 124, SSD1306_WHITE);
  display.setCursor(0, 54);
  display.print("Tut:BASLAT Kisa:GEC");
  drawPager();
  drawHoldRing();
  display.display();
}

void drawCalStridePage() {
  display.clearDisplay();
  drawHeader("KAL. ADIM", strideCalibrated ? "[HAZIR]" : "[YOK]", false);

  display.drawFastHLine(4, 34, 42, SSD1306_WHITE);
  for (int i = 0; i <= 6; i++) {
    int x = 4 + i * 7;
    display.drawFastVLine(x, (i == 0 || i == 6) ? 28 : 31, (i == 0 || i == 6) ? 12 : 6, SSD1306_WHITE);
  }
  display.setTextSize(1);
  display.setCursor(15, 42);
  display.printf("%.0f m", STRIDE_CAL_DISTANCE_M);

  display.setCursor(56, 15);
  display.print("Adim boyu:");
  display.setTextSize(2);
  display.setCursor(56, 26);
  if (strideCalibrated) display.printf("%.2f", strideLengthM);
  else                  display.print("---");
  display.setTextSize(1);
  display.print(" m");
  display.setCursor(56, 44);
  display.print("duz yuruyus");

  display.drawFastHLine(0, 51, 124, SSD1306_WHITE);
  display.setCursor(0, 54);
  display.print("Tut:BASLAT Kisa:GEC");
  drawPager();
  drawHoldRing();
  display.display();
}

void drawBaseDirectionArrow(float turnDeg) {
  if (!isfinite(turnDeg) || turnDeg < -180.0f || turnDeg > 180.0f) return;
  const int16_t cx = 25, cy = 32;
  const float radians = turnDeg * PI / 180.0f;
  const float fx = sinf(radians), fy = -cosf(radians);
  const float sx = -fy, sy = fx;
  auto ix = [](float v) -> int16_t { return (int16_t)lroundf(v); };
  display.drawCircle(cx, cy, 20, SSD1306_WHITE);
  const int16_t tipX = cx + ix(fx * 17), tipY = cy + ix(fy * 17);
  const int16_t midX = cx + ix(fx * 6), midY = cy + ix(fy * 6);
  const int16_t leftX = midX + ix(sx * 7), leftY = midY + ix(sy * 7);
  const int16_t rightX = midX - ix(sx * 7), rightY = midY - ix(sy * 7);
  display.drawLine(cx - ix(fx * 13), cy - ix(fy * 13), midX, midY, SSD1306_WHITE);
  display.fillTriangle(tipX, tipY, leftX, leftY, rightX, rightY, SSD1306_WHITE);
  display.fillCircle(cx, cy, 2, SSD1306_BLACK);
}

void drawNavUnknown() {
  display.drawCircle(25, 32, 20, SSD1306_WHITE);
  display.setTextSize(2);
  display.setCursor(20, 24);
  display.print('?');
  display.setTextSize(1);
}

void drawNavBaseIcon() {
  display.drawCircle(25, 32, 20, SSD1306_WHITE);
  display.drawLine(12, 30, 25, 19, SSD1306_WHITE);
  display.drawLine(25, 19, 38, 30, SSD1306_WHITE);
  display.drawRect(16, 29, 18, 15, SSD1306_WHITE);
  display.drawRect(23, 36, 5, 8, SSD1306_WHITE);
}

void drawNavTargetIcon() {
  display.drawCircle(25, 32, 20, SSD1306_WHITE);
  display.drawCircle(25, 32, 9, SSD1306_WHITE);
  display.drawFastHLine(8, 32, 34, SSD1306_WHITE);
  display.drawFastVLine(25, 15, 34, SSD1306_WHITE);
  display.fillCircle(25, 32, 3, SSD1306_BLACK);
}

void drawNavigationScreen() {
  GuidanceState nav;
  portENTER_CRITICAL(&guidanceMux);
  nav = lastGuidance;
  portEXIT_CRITICAL(&guidanceMux);

  const bool wifi = WiFi.status() == WL_CONNECTED;
  const bool fresh = ENABLE_NAV_API && wifi && nav.valid &&
                     (uint32_t)(millis() - nav.receivedAtMs) <= NAV_STALE_MS;
  const bool active = fresh && strcmp(nav.sessionStatus, "active") == 0;
  const bool complete = fresh && strcmp(nav.sessionStatus, "completed") == 0;
  const bool idle = fresh && strcmp(nav.sessionStatus, "idle") == 0;
  const bool goodSource = active && !nav.demo && strcmp(nav.mode, "estimated") == 0;
  const bool directionArrow = goodSource && nav.hasTurn && nav.remainingM > 0.85f;
  const bool nearGoal = goodSource && nav.remainingM >= 0.0f && nav.remainingM <= 0.85f;
  const bool showBase = nav.goalBase;

  const char* badge = !ENABLE_NAV_API ? "KAPALI" : !wifi ? "NO WIFI" :
                      !fresh ? "OFFLINE" : complete ? "BTT" :
                      idle ? "HAZIR" : goodSource ? "CANLI" : "SENSOR";
  display.clearDisplay();
  drawHeader("ASTRONAV", badge, true);

  if (directionArrow) {
    drawBaseDirectionArrow(nav.turnDeg);
    display.setTextSize(1);
    display.setCursor(53, 13); display.print(showBase ? "US YONU" : "HEDEF YON");
    display.setTextSize(2);
    display.setCursor(52, 23);
    if (nav.remainingM < 100.0f) display.printf("%.1fm", nav.remainingM);
    else display.printf("%.0fm", nav.remainingM);
    display.setTextSize(1);
    display.setCursor(52, 43);
    if (fabsf(nav.turnDeg) <= 18.0f) display.print("DUZ ILERI");
    else if (fabsf(nav.turnDeg) >= 150.0f) display.print("GERI DON");
    else if (nav.turnDeg > 0.0f) display.printf("SAG %.0f", fabsf(nav.turnDeg));
    else display.printf("SOL %.0f", fabsf(nav.turnDeg));
  } else {
    if (idle || (complete && showBase)) drawNavBaseIcon();
    else if (complete || nearGoal) drawNavTargetIcon();
    else drawNavUnknown();
    display.setTextSize(1);
    display.setCursor(52, 15);
    if (idle) {
      display.println("PANELDEN");
      display.setCursor(52, 27); display.println("GOREV BASLAT");
      display.setCursor(52, 39); display.println("HEDEF 10M");
    } else if (complete) {
      display.println(showBase ? "US YAKINI" : "HEDEF YAKIN");
      display.setCursor(52, 29); display.println("TAHMINI");
      display.setCursor(52, 41); display.println("DOGRULA");
    } else if (nearGoal) {
      display.println(showBase ? "US YAKINI" : "HEDEF YAKIN");
      display.setCursor(52, 29); display.println("OLCUM");
      display.setCursor(52, 41); display.println("BEKLENIYOR");
    } else if (active && !goodSource) {
      display.println("OLCUM ESKI");
      display.setCursor(52, 29); display.println("KALIBRASYON");
      display.setCursor(52, 41); display.println("KONTROL ET");
    } else if (!wifi) {
      display.println("PI BAGLANTI");
      display.setCursor(52, 29); display.println("KESILDI");
    } else if (!fresh) {
      display.println("YON API");
      display.setCursor(52, 29); display.println("BEKLENIYOR");
    } else {
      display.println("CANLI VERI");
      display.setCursor(52, 29); display.println("GEREKLI");
    }
  }

  display.drawFastHLine(0, 51, 124, SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 54);
  if (active && goodSource) {
    display.print(showBase ? "USSE DON / TAHMINI" : "HEDEF 10M / TAHMINI");
  } else if (active) {
    display.print("YON YOK: SENSOR");
  } else if (complete) {
    display.print("YENI GOREV: PANELDEN");
  } else {
    display.print("KISA: SONRAKI SAYFA");
  }
  drawPager();
  display.display();
}

// ---------- Hareket kalitesi ----------
float motionQuality(float devMax) { return constrain(1.0f - devMax / 0.6f, 0.0f, 1.0f); }

// ---------- Sayfa gecisi ----------
bool pageEnabled(UiPage p) {
  if (p == PAGE_ENV)   return ENV_PAGE;
  if (p == PAGE_NAV)   return NAV_PAGE;
  if (p == PAGE_AUDIO) return ENABLE_AUDIO_WS;
  return true;
}

void nextPage() {
  do {
    uiPage = (UiPage)((uiPage + 1) % PAGE_COUNT);
  } while (!pageEnabled(uiPage));
  uiRedraw = true;
  Serial.printf("Sayfa: %s\n", PAGE_NAMES[uiPage]);
}

// ---------- Buton & RGB LED Yonetimi ----------
void sendButtonResponse(const char* action, uint32_t heldMs) {
  MessageTask t = {};
  strlcpy(t.id, activeMsgId, sizeof(t.id));
  strlcpy(t.action, action, sizeof(t.action));
  timestampIso(t.respondedAt);
  xQueueSend(msgRespQueue, &t, 0);
  Serial.printf("Buton: %s (%lu ms) id=%s\n", action, (unsigned long)heldMs, t.id);

  setFlash("YANIT GONDERILDI", strcmp(action, "accepted") == 0 ? "[ KABUL ]" : "[ RED ]", 1500);

  hasActiveMessage = false;
  activeMsgId[0]   = '\0';
  activeMsgText[0] = '\0';
}

PressCtx ctxNow() {
  if (hasActiveMessage)  return CTX_MESSAGE;
  if (magCalibrating)    return CTX_IGNORE;
  if (strideCalibrating) return CTX_STRIDE_RUN;
  if (uiPage == PAGE_CAL_MAG || uiPage == PAGE_CAL_STRIDE) return CTX_CAL_PAGE;
  return CTX_PAGE;
}

uint32_t holdTarget(PressCtx c) {
  if (c == CTX_MESSAGE) return BTN_LONG_MS;
  if (c == CTX_STRIDE_RUN || c == CTX_CAL_PAGE) return BTN_CAL_HOLD_MS;
  return 0;
}

void onHoldComplete(PressCtx c, uint32_t held) {
  switch (c) {
    case CTX_MESSAGE:    sendButtonResponse("rejected", held); break;
    case CTX_STRIDE_RUN: cancelStrideCalibration("Iptal edildi"); break;
    case CTX_CAL_PAGE:
      if (uiPage == PAGE_CAL_MAG) startMagCalibration(); else startStrideCalibration();
      break;
    default: break;
  }
}

void processButton() {
  static uint32_t pressStart = 0;
  static PressCtx pressCtx = CTX_IGNORE;
  static bool longFired = false;

  bool down = (digitalRead(BTN_PIN) == BTN_ACTIVE_LEVEL);
  uint32_t now = millis();

  setRgbColor(false, false, down);

  if (down) {
    if (pressStart == 0) {
      pressStart = now;
      pressCtx = ctxNow();
      longFired = false;
      holdProgress = 0.0f;
      return;
    }
    if (pressCtx != CTX_IGNORE && pressCtx != ctxNow()) { pressCtx = CTX_IGNORE; holdProgress = 0.0f; }

    uint32_t target = holdTarget(pressCtx);
    if (target && !longFired) {
      uint32_t held = now - pressStart;
      if (held >= target) {
        longFired = true;
        holdProgress = 0.0f;
        onHoldComplete(pressCtx, held);
      } else {
        holdProgress = (held >= BTN_RING_DELAY_MS) ? (float)held / (float)target : 0.0f;
      }
    }
    return;
  }

  holdProgress = 0.0f;
  if (pressStart != 0 && !longFired) {
    if (pressCtx != ctxNow()) pressCtx = CTX_IGNORE;
    uint32_t held = now - pressStart;
    if (pressCtx != CTX_IGNORE && held >= BTN_DEBOUNCE_MS) {
      switch (pressCtx) {
        case CTX_MESSAGE:
          sendButtonResponse(held >= BTN_LONG_MS ? "rejected" : "accepted", held);
          break;
        case CTX_STRIDE_RUN:
          if (held < BTN_CAL_HOLD_MS) finishStrideCalibration();
          break;
        case CTX_CAL_PAGE:
        case CTX_PAGE:
          if (held < BTN_CAL_HOLD_MS) nextPage();
          break;
        default: break;
      }
    }
  }
  pressStart = 0;
  longFired = false;
  pressCtx = CTX_IGNORE;
}

// ---------- HTTP / Ag Gorevleri (Core 0) ----------
bool isHandledId(const char* id) {
  for (uint8_t i = 0; i < 4; i++)
    if (handledIds[i][0] && strcmp(handledIds[i], id) == 0) return true;
  return false;
}

void rememberHandledId(const char* id) {
  strlcpy(handledIds[handledNext], id, sizeof(handledIds[0]));
  handledNext = (handledNext + 1) % 4;
}

bool checkIncomingMessage() {
  if (!ENABLE_MESSAGE_API || WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  String url = String(MSG_GET_URL) + "?device_id=" + DEVICE_ID;
  http.begin(url);
  http.setConnectTimeout(1500);
  http.setTimeout(2000);

  bool queued = false;
  int code = http.GET();
  if (code == 200) {
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, http.getString());

    if (!err && (doc["has_message"] | false)) {
      String idStr   = doc["message_id"].isNull() ? String("") : doc["message_id"].as<String>();
      String textStr = doc["text"].isNull()       ? String("") : doc["text"].as<String>();

      IncomingMessage m = {};
      strlcpy(m.id,   idStr.c_str(),   sizeof(m.id));
      strlcpy(m.text, textStr.c_str(), sizeof(m.text));

      if (m.id[0] && !isHandledId(m.id)) {
        if (xQueueSend(msgInQueue, &m, 0) == pdTRUE) {
          queued = true;
          Serial.printf("Yeni Mesaj Alindi: %s\n", m.text);
        }
      }
    }
  }
  http.end();
  return queued;
}

bool sendMsgResponse(const MessageTask& task) {
  if (!ENABLE_MESSAGE_API || WiFi.status() != WL_CONNECTED) return false;

  JsonDocument doc;
  doc["device_id"]    = DEVICE_ID;
  doc["message_id"]   = task.id;
  doc["action"]       = task.action;
  doc["responded_at"] = task.respondedAt;

  String body;
  serializeJson(doc, body);

  HTTPClient http;
  http.begin(MSG_RSP_URL);
  http.setConnectTimeout(1500);
  http.setTimeout(2500);
  http.addHeader("Content-Type", "application/json");

  int code = http.POST(body);
  http.end();
  Serial.printf("Mesaj Yanit POST -> HTTP %d\n", code);
  return (code >= 200 && code < 300);
}

bool postTelemetry(const Reading& r) {
  if (WiFi.status() != WL_CONNECTED || (!piClockReady && getInternalEpoch() <= 1700000000)) return false;

  JsonDocument doc;
  doc["device_id"]      = DEVICE_ID;
  doc["sequence"]       = r.sequence;
  doc["observed_at"]    = r.iso;
  doc["source"]         = "measured";
  doc["heart_rate_bpm"] = (int)roundf(r.hr);
  doc["spo2_pct"]       = roundf(r.spo2 * 10.0f) / 10.0f;
  doc["acceleration_g"] = roundf(r.accG * 100.0f) / 100.0f;
  doc["signal_quality"] = roundf(r.quality * 100.0f) / 100.0f;
  doc["mag_x_ut"]       = roundf(r.magX * 10.0f) / 10.0f;
  doc["mag_y_ut"]       = roundf(r.magY * 10.0f) / 10.0f;
  doc["mag_z_ut"]       = roundf(r.magZ * 10.0f) / 10.0f;
  doc["heading_deg"]    = roundf(r.heading * 10.0f) / 10.0f;
  doc["temperature_c"]  = roundf(r.tempC * 10.0f) / 10.0f;
  doc["pressure_hpa"]   = roundf(r.pressHpa * 100.0f) / 100.0f;
  doc["altitude_m"]     = roundf(r.altM * 10.0f) / 10.0f;

  if (r.stepsOk) doc["steps_total"] = r.stepsTotal;
  if (r.stepsOk && r.strideOk) doc["stride_length_m"] = roundf(r.strideM * 1000.0f) / 1000.0f;
  doc["heading_calibrated"] = r.headingCalibrated;

  String body;
  serializeJson(doc, body);

  HTTPClient http;
  http.begin(API_URL);
  http.setConnectTimeout(1500);
  http.setTimeout(2500);
  http.addHeader("Content-Type", "application/json");

  int code = http.POST(body);
  apiUp = (code > 0);
  if (code >= 200 && code < 300) {
    static uint32_t lastGoodLog = 0;
    if (lastGoodLog == 0 || millis() - lastGoodLog >= 10000) {
      lastGoodLog = millis();
      Serial.printf("[API] POST /telemetry: HTTP %d, seq=%lu, ESP=%s\n",
                    code, (unsigned long)r.sequence, WiFi.localIP().toString().c_str());
    }
  } else {
    Serial.printf("[API] POST basarisiz: HTTP %d, %s\n",
                  code, http.errorToString(code).c_str());
    if (code > 0) {
      String reply = http.getString();
      if (reply.length() > 240) reply = reply.substring(0, 240);
      Serial.printf("[API] Yanit: %s\n", reply.c_str());
    }
  }
  http.end();
  return (code >= 200 && code < 300);
}

void pollNavigationGuidance() {
  if (!ENABLE_NAV_API || WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(NAV_GET_URL);
  http.setConnectTimeout(1200);
  http.setTimeout(1800);
  const int code = http.GET();
  if (code == 200) {
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, http.getStream());
    if (!err) {
      const char* mode = doc["mode"] | "";
      const char* status = doc["session_status"] | "";
      const char* source = doc["position_source"] | "";
      const char* device = doc["device_id"] | "";
      const bool isActive = strcmp(status, "active") == 0;
      const bool stateOk = isActive || strcmp(status, "idle") == 0 ||
                           strcmp(status, "completed") == 0;
      const bool sourceOk = strcmp(mode, "estimated") == 0 ||
                            strcmp(mode, "unavailable") == 0;
      const bool demo = doc["demo"] | false;
      const bool sensorReady = doc["sensor_ready"] | false;
      const bool matched = !isActive || strcmp(device, DEVICE_ID) == 0;
      const bool measuredSource = strcmp(source, "pedometer_dead_reckoning") == 0;
      if (stateOk && sourceOk && !demo && matched) {
        GuidanceState update = {};
        update.valid = true;
        update.receivedAtMs = millis();
        strlcpy(update.mode, mode, sizeof(update.mode));
        strlcpy(update.sessionStatus, status, sizeof(update.sessionStatus));
        strlcpy(update.nextWaypoint, doc["next_waypoint"] | "", sizeof(update.nextWaypoint));
        update.goalBase = strcmp(doc["goal_type"] | "tracking", "base") == 0;

        const bool haveDistance = !doc["remaining_m"].isNull();
        update.remainingM = haveDistance ? doc["remaining_m"].as<float>() : -1.0f;
        const bool validDistance = !haveDistance ||
          (isfinite(update.remainingM) && update.remainingM >= 0.0f && update.remainingM <= 1000000.0f);

        const bool live = isActive && sensorReady && measuredSource &&
                          strcmp(mode, "estimated") == 0 && haveDistance;
        float turn = 0.0f;
        bool hasTurn = false;
        if (live && !doc["turn_deg"].isNull()) {
          turn = doc["turn_deg"].as<float>();
          hasTurn = isfinite(turn) && turn >= -180.0f && turn <= 180.0f;
        }
        if (live && !hasTurn && !doc["heading_deg"].isNull()) {
          JsonArrayConst pos = doc["position_m"].as<JsonArrayConst>();
          JsonArrayConst goal = doc["goal_m"].as<JsonArrayConst>();
          const float heading = doc["heading_deg"].as<float>();
          if (!pos.isNull() && pos.size() == 2 && !goal.isNull() && goal.size() == 2 &&
              !pos[0].isNull() && !pos[1].isNull() && !goal[0].isNull() && !goal[1].isNull() &&
              isfinite(heading)) {
            const float dx = goal[0].as<float>() - pos[0].as<float>();
            const float dy = goal[1].as<float>() - pos[1].as<float>();
            const float dist = hypotf(dx, dy);
            if (isfinite(dist) && dist > 0.85f) {
              const float targetBearing = atan2f(dx, dy) * 180.0f / PI;
              turn = fmodf(targetBearing - heading + 540.0f, 360.0f);
              if (turn < 0.0f) turn += 360.0f;
              turn -= 180.0f;
              hasTurn = isfinite(turn);
            }
          }
        }
        update.hasTurn = hasTurn;
        update.turnDeg = hasTurn ? turn : 0.0f;
        if (validDistance) {
          portENTER_CRITICAL(&guidanceMux);
          lastGuidance = update;
          portEXIT_CRITICAL(&guidanceMux);
        }
      }
    }
  }
  http.end();
}

void netTask(void*) {
  Reading r;
  MessageTask pending;
  bool     hasPending   = false;
  uint8_t  pendingTries = 0;
  uint32_t nextTryMs    = 0;
  bool     msgBusy      = false;
  uint32_t lastPoll     = 0;
  uint32_t lastNavPoll  = 0;
  uint32_t lastWifiTry  = 0;
  int      lastWifiStatus = -1;
  uint32_t lastTimeTry  = 0;
  uint32_t lastInetTry  = 0;
  bool prevConnected = false;
  bool ntpConfigured = false;

  for (;;) {
    int status = (int)WiFi.status();
    if (status != lastWifiStatus) {
      Serial.printf("[WiFi-STATE] status=%d (1=SSID yok, 3=bagli, 4=reddedildi, 6=bagli degil)\n", status);
      lastWifiStatus = status;
    }
    if (status != WL_CONNECTED) {
      if (prevConnected) Serial.println("[WiFi] Baglanti koptu, tekrar denenecek");
      prevConnected = false;
      netOk      = false;
      apiUp      = false;
      internetOk = false;
      if (millis() - lastWifiTry >= WIFI_RETRY_MS) {
        lastWifiTry = millis();
        Serial.printf("[WiFi] Baglanti yeniden deneniyor: status=%d, SSID=%s\n", status, WIFI_SSID);
        WiFi.disconnect(false, false);
        vTaskDelay(pdMS_TO_TICKS(150));
        WiFi.begin(WIFI_SSID, WIFI_PASS);
      }
      vTaskDelay(pdMS_TO_TICKS(200));
      continue;
    }

    if (!prevConnected) {
      prevConnected = true;
      lastTimeTry = 0;
      lastInetTry = 0;
      Serial.printf("[WiFi] BAGLANDI, IP=%s, GW=%s, RSSI=%d dBm\n",
                    WiFi.localIP().toString().c_str(),
                    WiFi.gatewayIP().toString().c_str(), WiFi.RSSI());
    }

    if (lastInetTry == 0 || (uint32_t)(millis() - lastInetTry) >= INET_CHECK_MS) {
      lastInetTry = millis();
      internetOk = checkInternetAccess();
      if (internetOk && clockSource != CLK_PI_API) {
        if (!ntpConfigured) {
          configTime(0, 0, "pool.ntp.org", "time.google.com");
          ntpConfigured = true;
        }
        time_t sysNow = time(nullptr);
        time_t rtcNow = getRtcEpoch();
        if (sysNow > 1700000000 && (rtcNow == 0 || labs((long)(sysNow - rtcNow)) > 2)) {
          if (sysNow > rtcNow) {
            setRtcFromEpoch(sysNow);
          }
          clockSource = CLK_INTERNET;
        }
      }
    }

    if (lastTimeTry == 0 || (uint32_t)(millis() - lastTimeTry) >=
         (piClockReady ? CLOCK_REFRESH_MS : CLOCK_RETRY_MS)) {
      lastTimeTry = millis();
      bool firstSync = !piClockReady;
      if (syncClockFromPi() && firstSync) {
        Reading discard;
        while (xQueueReceive(sendQueue, &discard, 0) == pdTRUE) {}
      }
    }
    if (!piClockReady && getInternalEpoch() <= 1700000000) {
      Reading discard;
      while (xQueueReceive(sendQueue, &discard, 0) == pdTRUE) {}
      vTaskDelay(pdMS_TO_TICKS(200));
      continue;
    }

    if (!hasPending && xQueueReceive(msgRespQueue, &pending, 0) == pdTRUE) {
      hasPending = true; pendingTries = 0; nextTryMs = 0;
      rememberHandledId(pending.id);
    }
    if (hasPending && (int32_t)(millis() - nextTryMs) >= 0) {
      bool ok = sendMsgResponse(pending);
      pendingTries++;
      if (ok || pendingTries >= 5) {
        hasPending = false;
        msgBusy = false;
      } else {
        nextTryMs = millis() + 2000;
      }
    }

    if (xQueueReceive(sendQueue, &r, pdMS_TO_TICKS(100)) == pdTRUE) {
      netOk = postTelemetry(r);
    }

    if (!msgBusy && !hasPending && millis() - lastPoll >= 3000) {
      lastPoll = millis();
      if (checkIncomingMessage()) msgBusy = true;
    }
    if (millis() - lastNavPoll >= NAV_POLL_MS) {
      lastNavPoll = millis();
      pollNavigationGuidance();
    }
  }
}

// ---------- Setup ----------
void setup() {
  Serial.begin(115200);
  pinMode(BTN_PIN, BTN_ACTIVE_LEVEL == LOW ? INPUT_PULLUP : INPUT_PULLDOWN);

  pinMode(LED_RED, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_BLUE, OUTPUT);
  setRgbColor(false, false, false);

  Wire.begin();
  Wire.setClock(400000);

  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) Serial.println("OLED yok!");
  drawBootScreen("Baslatiliyor", 5);

  rtcMutex = xSemaphoreCreateMutex();
  Rtc.Begin();
  if (Rtc.GetIsWriteProtected()) Rtc.SetIsWriteProtected(false);
  if (!Rtc.GetIsRunning())       Rtc.SetIsRunning(true);
  drawBootScreen("Saat modulu", 15);

  time_t rtcEpoch = getRtcEpoch();
  if (rtcEpoch > 1700000000) {
    struct timeval tv = {};
    tv.tv_sec = rtcEpoch;
    settimeofday(&tv, nullptr);
    clockSource = CLK_RTC;
    Serial.printf("[TIME] Dahili RTC saati yuklendi (epoch=%ld)\n", (long)rtcEpoch);
  }

  WiFi.persistent(false);
  WiFi.onEvent([](WiFiEvent_t event, WiFiEventInfo_t info) {
    if (event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) {
      Serial.printf("[WiFi-EVT] Baglanti kesildi, reason=%u\n",
                    (unsigned int)info.wifi_sta_disconnected.reason);
    } else if (event == ARDUINO_EVENT_WIFI_STA_CONNECTED) {
      Serial.println("[WiFi-EVT] Erisim noktasina iliskilendirildi");
    } else if (event == ARDUINO_EVENT_WIFI_STA_GOT_IP) {
      Serial.println("[WiFi-EVT] DHCP IP alindi");
    }
  });
  WiFi.mode(WIFI_STA);

  // Pi brcmfmac eski oturum (deauth) kilidine takilmamak icin her acilista temiz MAC ata
  uint8_t freshMac[6] = {
    0x02, 0xA5, 0x7E, 0x01,
    (uint8_t)(esp_random() & 0xFF),
    (uint8_t)(esp_random() & 0xFF)
  };
  esp_wifi_set_mac(WIFI_IF_STA, freshMac);

  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.setMinSecurity(WIFI_AUTH_WPA2_PSK);
  WiFi.setTxPower(WIFI_POWER_17dBm);
  WiFi.setHostname("astrovital-esp32");

  Serial.printf("[WiFi] %s (MAC=%s, gateway %s) WPA2 baglantisi baslatiliyor...\n",
                WIFI_SSID, WiFi.macAddress().c_str(), PI_HOST);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) {
    drawBootScreen("WiFi baglaniyor", 20 + (int)((millis() - t0) * 35UL / 20000UL));
    delay(100);
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WiFi] BAGLANDI: IP=%s, GW=%s, RSSI=%d dBm\n",
                  WiFi.localIP().toString().c_str(), WiFi.gatewayIP().toString().c_str(), WiFi.RSSI());
    String ip = WiFi.localIP().toString();
    drawBootScreen(ip.c_str(), 55);
    delay(500);
  } else {
    Serial.printf("[WiFi] ILK BAGLANTI BASARISIZ: status=%d\n", (int)WiFi.status());
    Serial.println("[WiFi] Olay kayitlarindaki [WiFi-EVT] reason degerini kontrol et; yeniden baglanti deneniyor.");
    showMsg("WIFI BAGLANAMADI", "Seri portu ac");
    delay(1200);
  }

  drawBootScreen("Sensorler", 62);
  mpuOk = mpu.begin(0x68, &Wire);
  if (mpuOk) {
    mpu.setAccelerometerRange(MPU6050_RANGE_4_G);
    mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
  }
  magInit();
  bmpOk = bmp.begin(BMP085_STANDARD);

  drawBootScreen("MAX30102", 78);
  ppgOk = ppg.begin(Wire, I2C_SPEED_FAST);
  if (ppgOk) ppg.setup(PPG_LED_BRIGHTNESS, 4, 2, 100, 411, 4096);
  Serial.printf("MAX30102: %s\n", ppgOk ? "ok" : "YOK (HR/SpO2 = 0 gonderilecek)");

  drawBootScreen("Ses modulu", 86);
  initAudioHardware();

  drawBootScreen("Ayarlar", 94);
  prefs.begin("astro", false);
  magOffsetX = prefs.getFloat("magOX", 0.0f);
  magOffsetY = prefs.getFloat("magOY", 0.0f);
  magScaleX  = prefs.getFloat("magSX", 1.0f);
  magScaleY  = prefs.getFloat("magSY", 1.0f);
  magHeadingReady = prefs.getBool("magReady", false);

  strideLengthM    = prefs.getFloat("strideM", 0.0f);
  strideCalibrated = prefs.getBool("strideOk", false) &&
                     strideLengthM >= STRIDE_MIN_M && strideLengthM <= STRIDE_MAX_M;

  sequenceNo = prefs.getUInt("seq", 0) + 50;
  prefs.putUInt("seq", sequenceNo);

  sendQueue    = xQueueCreate(10, sizeof(Reading));
  msgRespQueue = xQueueCreate(5, sizeof(MessageTask));
  msgInQueue   = xQueueCreate(2, sizeof(IncomingMessage));
  xTaskCreatePinnedToCore(netTask, "net", 8192, nullptr, 1, nullptr, 0);
  xTaskCreatePinnedToCore(audioNetTask, "audio_ws", 6144, nullptr, 2, nullptr, 0);

  drawBootScreen("Hazir", 100);
  delay(400);
}

// ---------- Loop ----------
void loop() {
  static uint32_t tMpu = 0, tMag = 0, tEnv = 0, tSend = 0, tDisp = 0, tDbg = 0;
  static bool prevNavActive = false;
  static bool prevBaseGuidance = false;

  processPpg(millis());

  if (!hasActiveMessage) {
    IncomingMessage m;
    if (xQueueReceive(msgInQueue, &m, 0) == pdTRUE) {
      strlcpy(activeMsgId,   m.id,   sizeof(activeMsgId));
      strlcpy(activeMsgText, m.text, sizeof(activeMsgText));
      hasActiveMessage = true;
    }
  }

  processButton();

  uint32_t now = millis();

  if (mpuOk && now - tMpu >= 20) {
    tMpu = now;
    sensors_event_t a, g, t;
    mpu.getEvent(&a, &g, &t);
    float mag = sqrtf(a.acceleration.x * a.acceleration.x +
                      a.acceleration.y * a.acceleration.y +
                      a.acceleration.z * a.acceleration.z) / 9.80665f;
    lastAccG = mag;
    pedometer.ingest(mag, now);
    accSum += mag; accCnt++;
    accDevMax = max(accDevMax, fabsf(mag - 1.0f));
  }

  if (now - tMag >= 100) {
    tMag = now;
    magValid = (magType != MAG_NONE) && magRead();
    updateMagCalibration(now);
    updateStrideCalibration(now);
  }

  if (bmpOk && now - tEnv >= 1000) {
    tEnv = now;
    tempC    = bmp.readTemperature();
    pressHpa = bmp.readPressure() / 100.0f;
    altM     = 44330.0f * (1.0f - powf(pressHpa / 1013.25f, 0.1903f));
  }

  if (now - tSend >= SEND_INTERVAL_MS) {
    tSend = now;

    bool hrFresh   = ppgOk && ppgFinger && ppgHr   > 0.0f && (now - ppgHrMs   <= PPG_VALID_TIMEOUT_MS);
    bool spo2Fresh = ppgOk && ppgFinger && ppgSpo2 > 0.0f && (now - ppgSpo2Ms <= PPG_VALID_TIMEOUT_MS);

    Reading r;
    r.sequence = ++sequenceNo;
    timestampIso(r.iso);

    r.hr        = hrFresh   ? ppgHr   : MISSING;
    r.spo2      = spo2Fresh ? ppgSpo2 : MISSING;
    r.quality   = (hrFresh || spo2Fresh) ? motionQuality(accDevMax) : MISSING;
    r.accG      = !mpuOk ? MISSING : (accCnt ? accSum / accCnt : lastAccG);
    r.magOk     = magValid;
    r.bmpOk     = bmpOk;
    r.magX      = magValid ? magX    : MISSING;
    r.magY      = magValid ? magY    : MISSING;
    r.magZ      = magValid ? magZ    : MISSING;
    r.heading   = magValid ? heading : MISSING;
    r.tempC     = bmpOk ? tempC      : MISSING;
    r.pressHpa  = bmpOk ? pressHpa   : MISSING;
    r.altM      = bmpOk ? altM       : MISSING;
    r.stepsOk   = mpuOk;
    r.stepsTotal = pedometer.steps();
    r.strideOk  = strideCalibrated;
    r.strideM   = strideLengthM;
    r.headingCalibrated = magValid && magHeadingReady && !magCalibrating;

    accSum = 0; accCnt = 0; accDevMax = 0;

    if (xQueueSend(sendQueue, &r, 0) != pdTRUE) {
      Reading old;
      xQueueReceive(sendQueue, &old, 0);
      xQueueSend(sendQueue, &r, 0);
    }
    cur = r;
    if (sequenceNo % 50 == 0) prefs.putUInt("seq", sequenceNo);
  }

  if (PPG_DEBUG && ppgOk && now - tDbg >= 2000) {
    tDbg = now;
    Serial.printf("PPG IR=%lu RED=%lu parmak=%d HR=%.0f SpO2=%.0f\n",
                  (unsigned long)ppgIr, (unsigned long)ppgRed, ppgFinger ? 1 : 0, ppgHr, ppgSpo2);
  }

  bool flashing = (int32_t)(flashUntil - now) > 0;
  bool animated = flashing || hasActiveMessage || magCalibrating || strideCalibrating ||
                  uiPage == PAGE_HEALTH || uiPage == PAGE_AUDIO;
  uint32_t frameMs = (holdProgress > 0.0f) ? FRAME_HOLD_MS : (animated ? FRAME_ANIM_MS : FRAME_CALM_MS);

  if (uiRedraw || now - tDisp >= frameMs) {
    tDisp = now;
    uiRedraw = false;

    GuidanceState localNav;
    portENTER_CRITICAL(&guidanceMux);
    localNav = lastGuidance;
    portEXIT_CRITICAL(&guidanceMux);
    const bool navFresh = ENABLE_NAV_API && localNav.valid &&
      WiFi.status() == WL_CONNECTED &&
      (uint32_t)(now - localNav.receivedAtMs) <= NAV_STALE_MS;
    if (navFresh) {
      const bool activeNav = !localNav.demo &&
        strcmp(localNav.sessionStatus, "active") == 0;
      const bool baseNav = activeNav && localNav.goalBase;
      if ((activeNav && !prevNavActive) || (baseNav && !prevBaseGuidance)) {
        if (!hasActiveMessage && !magCalibrating && !strideCalibrating) {
          uiPage = PAGE_NAV;
          uiRedraw = true;
        }
      }
      prevNavActive = activeNav;
      prevBaseGuidance = baseNav;
    }

    if (flashing) {
      showMsg(flashA, flashB);
    } else if (hasActiveMessage) {
      drawMessageScreen();
    } else if (magCalibrating) {
      drawMagCalibrationScreen();
    } else if (strideCalibrating) {
      drawStrideRunScreen();
    } else {
      switch (uiPage) {
        case PAGE_CLOCK:      drawClockScreen();                  break;
        case PAGE_HEALTH:     drawScreen(ppgOk && ppgFinger);     break;
        case PAGE_ENV:        drawEnvScreen();                    break;
        case PAGE_NAV:        drawNavigationScreen();             break;
        case PAGE_AUDIO:      drawAudioScreen();                  break;
        case PAGE_NET:        drawNetworkScreen();                break;
        case PAGE_CAL_MAG:    drawCalMagPage();                   break;
        case PAGE_CAL_STRIDE: drawCalStridePage();                break;
        default: break;
      }
    }
  }
}
