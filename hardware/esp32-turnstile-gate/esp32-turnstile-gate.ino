// ESP32 turnstile-gate controller — two independent ways to trigger the
// same servo-driven gate:
//   1. PRIMARY: a GM65 barcode/QR module wired to the ESP32's own UART2
//      reads a customer's ticket QR directly at the turnstile and the
//      scanned text is forwarded to the gateScanCheckIn Cloud Function
//      (functions/src/gate.ts), which does the real validation itself
//      (no human involved at all).
//   2. FALLBACK: the existing phone-camera flow on QrScanPage.tsx, for
//      when the turnstile hardware is down — a staff member scans with
//      their own phone, the web app marks the ticket checked in AND
//      writes a trigger doc gateStatus (also in gate.ts) polls for, so
//      the SAME physical gate still opens from a phone-confirmed scan.
// Both paths run every loop() iteration, independent of each other.
//
// A small SPI OLED shows live status (WiFi connected / QR read / approved
// / rejected) — added specifically so this is debuggable once mounted at
// the real turnstile and running off a wall adapter with no PC/Serial
// Monitor attached at all.
//
// See README.md in this same folder for wiring (servo, LED, GM65, OLED)
// and setup instructions.
//
// Required Arduino IDE libraries (Library Manager):
//   - "ESP32Servo" by Kevin Harrington / John K. Bennett
//   - "Adafruit SH110X" (pulls in "Adafruit GFX Library" as a dependency —
//     accept installing it too when prompted). Most cheap 7-pin SPI OLEDs
//     bigger than 0.96" (1.3"/1.5", ~3.5cm wide) are driven by an SH1106
//     controller, not SSD1306, despite looking identical and having the
//     same GND/VCC/SCK/SDA/RES/DC/CS pinout — a real unit's screen stayed
//     completely black with correctly verified wiring and no reported
//     error (SPI has no handshake, so a wrong-driver `begin()` call still
//     "succeeds") until this was swapped in.
// Everything else (WiFi, HTTPClient, WiFiClientSecure, HardwareSerial, SPI)
// ships with the "esp32" board package itself.

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ESP32Servo.h>
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SH110X.h>

// ---- Fill these in ----
const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
// clubId is the same Firestore clubs/{id} doc id this club's whole app
// already uses — visible in the Firebase console under the `clubs`
// collection (it's the document's own name, not a field inside it).
const char* CLUB_ID = "YOUR_CLUB_ID";
// From the Firebase console (Functions) or the `firebase deploy` output —
// looks like https://REGION-PROJECT_ID.cloudfunctions.net/FUNCTION_NAME
const char* GATE_STATUS_BASE_URL = "https://us-central1-arena-srsnov-reservation.cloudfunctions.net/gateStatus";
const char* GATE_SCAN_CHECKIN_BASE_URL = "https://us-central1-arena-srsnov-reservation.cloudfunctions.net/gateScanCheckIn";

// ---- Pins (see README.md for the matching breadboard wiring) ----
const int SERVO_PIN = 13;        // signal wire to the servo (orange/white)
const int STATUS_LED_PIN = 12;   // through a resistor to GND
// Deliberately NOT GPIO16/17: on an ESP32-WROVER module (the variant with
// built-in PSRAM), those two pins are wired internally to the PSRAM chip
// and aren't available as general-purpose UART pins at all — connecting
// anything there can silently receive zero bytes no matter how correctly
// it's wired, which is exactly the symptom a real build hit (GM65 beeped
// on every scan, but literally nothing ever arrived on UART2). GPIO18/19
// have no such conflict on any common ESP32 dev board.
const int GM65_RX_PIN = 18;      // ESP32 RX2 <- GM65 TX
const int GM65_TX_PIN = 19;      // ESP32 TX2 -> GM65 RX
const long GM65_BAUD_RATE = 9600;  // GM65's own default — see README if yours differs

// ---- OLED (SPI) — pins chosen to avoid every pin already used above.
// Standard 7-pin SPI OLED module labeling: GND, VCC, D0/SCK/CLK, D1/MOSI/
// DIN, RES/RST, DC, CS. If your module has only 6 pins (no CS — tied to
// GND internally), just leave OLED_CS_PIN's wire disconnected; the
// firmware still works, it only ever drives that pin, nothing reads it.
const int OLED_SCLK_PIN = 14;   // OLED D0 / SCK / CLK
const int OLED_MOSI_PIN = 27;   // OLED D1 / MOSI / DIN / SDA
const int OLED_DC_PIN = 25;     // OLED DC
const int OLED_RST_PIN = 33;    // OLED RES / RST
const int OLED_CS_PIN = 26;     // OLED CS (leave unconnected if your module has none)
const int OLED_WIDTH = 128;
const int OLED_HEIGHT = 64;

// ---- Behaviour ----
const int CLOSED_ANGLE = 0;      // degrees — turnstile arm locked/blocking
const int OPEN_ANGLE = 90;       // degrees — turnstile arm released
const unsigned long OPEN_DURATION_MS = 4000;   // how long the arm stays released
const unsigned long POLL_INTERVAL_MS = 1000;   // how often to check the phone-fallback trigger
const unsigned long REJECT_DISPLAY_MS = 2000;  // how long the OLED shows a rejection before returning to idle

Servo turnstileServo;
HardwareSerial gm65(2);  // UART2
SPIClass oledSPI(VSPI);
Adafruit_SH1106G display(OLED_WIDTH, OLED_HEIGHT, &oledSPI, OLED_DC_PIN, OLED_RST_PIN, OLED_CS_PIN);

String gm65Buffer = "";
unsigned long lastPollMs = 0;

// Every on-screen status is exactly two short lines — this is the one
// place that ever writes to the OLED, so every message in the whole
// sketch goes through here and stays visually consistent.
void showStatus(const String& line1, const String& line2) {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SH110X_WHITE);
  display.setCursor(0, 0);
  display.println(line1);
  display.setCursor(0, 16);
  display.println(line2);
  display.display();
}

void showIdle() {
  showStatus("Pripravene", "Naskenujte listok");
}

void connectWifi() {
  showStatus("Pripajam sa", "na WiFi...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    digitalWrite(STATUS_LED_PIN, !digitalRead(STATUS_LED_PIN));  // blink while connecting
    Serial.print(".");
  }
  Serial.println(" connected, IP: " + WiFi.localIP().toString());
  digitalWrite(STATUS_LED_PIN, LOW);
  showStatus("WiFi pripojene", WiFi.localIP().toString());
  delay(1500);
  showIdle();
}

void setup() {
  Serial.begin(115200);
  gm65.begin(GM65_BAUD_RATE, SERIAL_8N1, GM65_RX_PIN, GM65_TX_PIN);
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW);

  oledSPI.begin(OLED_SCLK_PIN, -1, OLED_MOSI_PIN, OLED_CS_PIN);
  if (!display.begin(0, true)) {
    Serial.println("OLED init failed — check wiring");
  }
  display.setRotation(0);
  showStatus("Startujem...", "");

  // Standard hobby servos expect a 50Hz signal with a 1000-2000us pulse
  // width — these are the library defaults ESP32Servo's attach() uses
  // when called with just a pin, no need to override them here.
  turnstileServo.attach(SERVO_PIN);
  turnstileServo.write(CLOSED_ANGLE);

  connectWifi();
}

void openGateOnce() {
  Serial.println("Trigger received — opening gate");
  digitalWrite(STATUS_LED_PIN, HIGH);
  turnstileServo.write(OPEN_ANGLE);
  delay(OPEN_DURATION_MS);
  turnstileServo.write(CLOSED_ANGLE);
  digitalWrite(STATUS_LED_PIN, LOW);
  showIdle();
}

// Percent-encodes a string for safe embedding as one query-parameter VALUE
// inside another URL — the GM65 hands us a whole URL (full of /, :, ?, =)
// that would otherwise break the outer gateScanCheckIn request's own query
// string if pasted in raw. No external library needed for this, just the
// standard reserved-character rule.
String urlEncode(const String& value) {
  String encoded = "";
  char buf[4];
  for (size_t i = 0; i < value.length(); i++) {
    char c = value.charAt(i);
    if (isalnum((unsigned char)c) || c == '-' || c == '_' || c == '.' || c == '~') {
      encoded += c;
    } else {
      snprintf(buf, sizeof(buf), "%%%02X", (unsigned char)c);
      encoded += buf;
    }
  }
  return encoded;
}

// Shared by both trigger paths below — same WiFiClientSecure.setInsecure()
// trade-off as the original prototype (see its own comment further down).
bool httpGetReturnsOne(const String& url) {
  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
    return false;
  }
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.begin(client, url);
  int code = http.GET();
  bool result = false;
  if (code == 200) {
    String body = http.getString();
    body.trim();
    result = (body == "1");
  } else {
    Serial.println("Request failed, HTTP code: " + String(code));
  }
  http.end();
  return result;
}

// PRIMARY path: forwards whatever the GM65 just decoded to gateScanCheckIn,
// which does the real validation (token match, not cancelled, ticket not
// already used) server-side and tells us whether to open the gate.
void checkInScannedTicket(const String& scannedText) {
  Serial.println("GM65 scanned: " + scannedText);
  showStatus("QR kod precitany", "Overujem...");
  String url = String(GATE_SCAN_CHECKIN_BASE_URL) + "?clubId=" + CLUB_ID + "&data=" + urlEncode(scannedText);
  if (httpGetReturnsOne(url)) {
    showStatus("QR schvaleny", "Vstup povoleny");
    openGateOnce();
  } else {
    Serial.println("Scan rejected (invalid, already used, or not confirmed)");
    showStatus("QR kod nie je platny", "Skuste znova");
    delay(REJECT_DISPLAY_MS);
    showIdle();
  }
}

// Reads whatever the GM65 has sent so far over UART2, one character at a
// time, accumulating into a line buffer until the module's own line
// terminator — this runs on every loop() iteration with no blocking delay,
// so a scan is never missed while the fallback poll below is also running.
// Treats EITHER \r or \n as a terminator (not just \n): a real unit of this
// module was confirmed, via a raw byte dump during bring-up, to end its
// output in just \r with no trailing \n at all — requiring \n specifically
// would have silently swallowed every single scan. Flushing on \r AND \n
// still handles a module that sends the more common \r\n pair safely: the
// second character arrives with the buffer already empty, so the
// length()>0 guard skips firing a duplicate check-in for the same scan.
void pollGm65() {
  while (gm65.available()) {
    char c = gm65.read();
    if (c == '\r' || c == '\n') {
      if (gm65Buffer.length() > 0) {
        checkInScannedTicket(gm65Buffer);
        gm65Buffer = "";
      }
    } else {
      gm65Buffer += c;
    }
  }
}

// FALLBACK path: polls gateStatus and returns true exactly once per real
// phone-confirmed scan — the Cloud Function itself marks each trigger
// "consumed" the first time it's read, so a dropped response here just
// means this one poll missed it; nothing is lost since the trigger doc
// would still read as unconsumed on the IMMEDIATELY NEXT poll unless THIS
// poll's read already consumed it. In the rare case this poll's HTTPS
// response never reaches the device at all (true network failure after
// the server already consumed it), that one scan's gate-open is simply
// missed — acceptable for a first prototype; a production install would
// want the server to retry delivery instead of consume-on-first-read.
void pollFallbackTrigger() {
  unsigned long now = millis();
  if (now - lastPollMs < POLL_INTERVAL_MS) return;
  lastPollMs = now;
  String url = String(GATE_STATUS_BASE_URL) + "?clubId=" + CLUB_ID;
  if (httpGetReturnsOne(url)) {
    showStatus("Telefon potvrdeny", "Vstup povoleny");
    openGateOnce();
  }
}

void loop() {
  pollGm65();
  pollFallbackTrigger();
}
