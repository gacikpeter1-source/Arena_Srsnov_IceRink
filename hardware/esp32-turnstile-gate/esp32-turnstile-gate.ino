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
// See README.md in this same folder for wiring (servo, LED, GM65) and
// setup instructions.
//
// Required Arduino IDE library (Library Manager):
//   - "ESP32Servo" by Kevin Harrington / John K. Bennett
// Everything else (WiFi, HTTPClient, WiFiClientSecure, HardwareSerial)
// ships with the "esp32" board package itself.

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ESP32Servo.h>

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
const int GM65_RX_PIN = 16;      // ESP32 RX2 <- GM65 TX
const int GM65_TX_PIN = 17;      // ESP32 TX2 -> GM65 RX
const long GM65_BAUD_RATE = 9600;  // GM65's own default — see README if yours differs

// ---- Behaviour ----
const int CLOSED_ANGLE = 0;      // degrees — turnstile arm locked/blocking
const int OPEN_ANGLE = 90;       // degrees — turnstile arm released
const unsigned long OPEN_DURATION_MS = 4000;   // how long the arm stays released
const unsigned long POLL_INTERVAL_MS = 1000;   // how often to check the phone-fallback trigger

Servo turnstileServo;
HardwareSerial gm65(2);  // UART2

String gm65Buffer = "";
unsigned long lastPollMs = 0;

void connectWifi() {
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
}

void setup() {
  Serial.begin(115200);
  gm65.begin(GM65_BAUD_RATE, SERIAL_8N1, GM65_RX_PIN, GM65_TX_PIN);
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW);

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
  String url = String(GATE_SCAN_CHECKIN_BASE_URL) + "?clubId=" + CLUB_ID + "&data=" + urlEncode(scannedText);
  if (httpGetReturnsOne(url)) {
    openGateOnce();
  } else {
    Serial.println("Scan rejected (invalid, already used, or not confirmed)");
  }
}

// Reads whatever the GM65 has sent so far over UART2, one character at a
// time, accumulating into a line buffer until the module's own line
// terminator (\n, possibly preceded by \r) — this runs on every loop()
// iteration with no blocking delay, so a scan is never missed while the
// fallback poll below is also running.
void pollGm65() {
  while (gm65.available()) {
    char c = gm65.read();
    if (c == '\r') continue;
    if (c == '\n') {
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
    openGateOnce();
  }
}

void loop() {
  pollGm65();
  pollFallbackTrigger();
}
