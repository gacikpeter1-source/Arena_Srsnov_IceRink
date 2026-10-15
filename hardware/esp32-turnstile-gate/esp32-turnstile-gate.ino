// ESP32 turnstile-gate controller — polls the gateStatus Cloud Function
// (functions/src/gate.ts) over HTTPS and swings a servo arm open for a
// few seconds whenever a staff member successfully scans a valid ticket
// on QrScanPage.tsx (src/lib/gate.ts writes the trigger that function
// reads). See README.md in this same folder for wiring and setup.
//
// Required Arduino IDE libraries (Library Manager):
//   - "ESP32Servo" by Kevin Harrington / John K. Bennett
// Everything else (WiFi, HTTPClient, WiFiClientSecure) ships with the
// "esp32" board package itself.

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ESP32Servo.h>

// ---- Fill these in ----
const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
// From the Firebase console (Functions) or the `firebase deploy` output
// after deploying gateStatus — looks like
// https://REGION-PROJECT_ID.cloudfunctions.net/gateStatus?clubId=YOUR_CLUB_ID
// (clubId is the same Firestore doc id this club's whole app already uses —
// ask if unsure, it's visible in the Firebase console under `clubs`).
const char* GATE_STATUS_URL = "https://us-central1-arena-srsnov-reservation.cloudfunctions.net/gateStatus?clubId=YOUR_CLUB_ID";

// ---- Pins (see README.md for the matching breadboard wiring) ----
const int SERVO_PIN = 13;       // signal wire to the servo (orange/white)
const int STATUS_LED_PIN = 12;  // through a resistor to GND

// ---- Behaviour ----
const int CLOSED_ANGLE = 0;     // degrees — turnstile arm locked/blocking
const int OPEN_ANGLE = 90;      // degrees — turnstile arm released
const unsigned long OPEN_DURATION_MS = 4000;  // how long the arm stays released
const unsigned long POLL_INTERVAL_MS = 1000;  // how often to ask the server

Servo turnstileServo;

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

// Polls gateStatus and returns true exactly once per real scan — the
// Cloud Function itself marks each trigger "consumed" the first time it's
// read, so a dropped response here just means this one poll missed it;
// nothing is lost since the trigger doc would still read as unconsumed on
// the IMMEDIATELY NEXT poll unless THIS poll's read already consumed it.
// In the rare case this poll's HTTPS response never reaches the device at
// all (true network failure after the server already consumed it), that
// one scan's gate-open is simply missed — acceptable for a first
// prototype; a production install would want the server to retry
// delivery instead of consume-on-first-read.
bool checkGateTrigger() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
    return false;
  }

  WiFiClientSecure client;
  // Skips certificate validation — acceptable for a prototype on a
  // trusted local network; Google's own certs are still used for the TLS
  // handshake itself, this only skips the ESP32 verifying the chain
  // against a bundled root CA, which the Arduino core doesn't ship by
  // default. For a permanent installation, pin Google's root CA instead.
  client.setInsecure();

  HTTPClient http;
  http.begin(client, GATE_STATUS_URL);
  int code = http.GET();
  bool shouldOpen = false;
  if (code == 200) {
    String body = http.getString();
    body.trim();
    shouldOpen = (body == "1");
  } else {
    Serial.println("gateStatus request failed, HTTP code: " + String(code));
  }
  http.end();
  return shouldOpen;
}

void loop() {
  if (checkGateTrigger()) {
    openGateOnce();
  }
  delay(POLL_INTERVAL_MS);
}
