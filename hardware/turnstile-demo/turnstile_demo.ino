// ESP32 turnstile-entry PROTOTYPE — demonstrates the full intended flow
// (app sells a ticket -> QR code -> scan at entry -> server marks it
// used-once -> physical unlock) to a customer whose real turnstile
// already does its own scanning/unlocking, so this rig only has to prove
// the SERVER SIDE works: "scan a code, ask the backend if it's valid,
// get a yes/no, react accordingly." A real turnstile controller would
// ask the exact same question before releasing its own brake.
//
// Hardware (see hardware/turnstile-demo/README.md for the full wiring
// writeup):
//   GM65 / GM67 barcode+QR scanner module -> Serial2 (RX2=GPIO16, TX2=GPIO17)
//   Micro servo (SG90) simulating the turnstile arm -> GPIO18 (own 5V supply!)
//   Push button simulating "visitor completed one manual turn" -> GPIO4 (INPUT_PULLUP)
//   Green LED (unlocked/valid) -> GPIO19
//   Red LED (locked/invalid) -> GPIO21
//   Buzzer -> GPIO22
//
// Libraries needed (Arduino IDE -> Library Manager):
//   "ArduinoJson" (by Benoit Blanchon)
//   ESP32 board support already includes WiFi.h, HTTPClient.h, ESP32Servo
//   (install "ESP32Servo" by Kevin Harrington/John K. Bennett if the
//   standard Servo.h doesn't work on your ESP32 core version)

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>

// ---- fill in before flashing ----
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
// Exact URL from `firebase deploy --only functions` output for
// validateTurnstileDemoTicket (2nd-gen functions also answer at the
// stable https://REGION-PROJECT.cloudfunctions.net/NAME form — confirm
// the real one from your own deploy output rather than trusting this).
const char* VALIDATE_URL = "https://us-central1-arena-srsnov-reservation.cloudfunctions.net/validateTurnstileDemoTicket";

// ---- pins ----
const int SCANNER_RX_PIN = 16; // ESP32 RX2 <- scanner TX
const int SCANNER_TX_PIN = 17; // ESP32 TX2 -> scanner RX (not strictly needed, wired anyway)
const int SERVO_PIN = 18;
const int BUTTON_PIN = 4;
const int LED_GREEN_PIN = 19;
const int LED_RED_PIN = 21;
const int BUZZER_PIN = 22;

// ---- servo angles: pick whatever two positions make the arm visibly
// swing between "blocking" and "clear" on your bench rig ----
const int SERVO_LOCKED_ANGLE = 0;
const int SERVO_UNLOCKED_ANGLE = 90;

// How long we wait for the button (simulated turn) before auto-relocking
// anyway — a real turnstile just waits forever, but a bench demo
// shouldn't be able to get stuck open if nobody presses it.
const unsigned long TURN_TIMEOUT_MS = 8000;

struct ValidationResult {
  bool valid;
  String reason;
};

Servo turnstileServo;
String scanBuffer = "";

void setup() {
  Serial.begin(115200);
  Serial2.begin(9600, SERIAL_8N1, SCANNER_RX_PIN, SCANNER_TX_PIN); // GM65/GM67 default baud is 9600

  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_GREEN_PIN, OUTPUT);
  pinMode(LED_RED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  turnstileServo.attach(SERVO_PIN);
  turnstileServo.write(SERVO_LOCKED_ANGLE);

  connectWifi();
  Serial.println("Ready. Scan a demo ticket QR code...");
}

void loop() {
  while (Serial2.available()) {
    char c = Serial2.read();
    if (c == '\n' || c == '\r') {
      if (scanBuffer.length() > 0) {
        handleScannedCode(scanBuffer);
        scanBuffer = "";
      }
    } else {
      scanBuffer += c;
    }
  }
}

void connectWifi() {
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    Serial.print(".");
  }
  Serial.println(" connected: " + WiFi.localIP().toString());
}

void handleScannedCode(String code) {
  code.trim();
  if (code.length() == 0) return;

  Serial.println("Scanned: " + code);
  ValidationResult result = validateTicket(code);

  if (result.valid) {
    Serial.println("-> VALID. Unlocking.");
    unlockAndWaitForTurn();
  } else {
    Serial.println("-> INVALID (" + result.reason + "). Staying locked.");
    flashInvalid();
  }
}

ValidationResult validateTicket(const String& code) {
  ValidationResult result = { false, "request_failed" };

  if (WiFi.status() != WL_CONNECTED) {
    result.reason = "wifi_disconnected";
    return result;
  }

  HTTPClient http;
  String url = String(VALIDATE_URL) + "?code=" + code;
  http.begin(url); // prototype only: plain HTTPS cert validation is skipped by the
                    // ESP32 core's default client here for simplicity — fine on a
                    // closed demo WiFi, NOT something to ship as-is to production.
  int httpCode = http.GET();

  if (httpCode == 200) {
    String body = http.getString();
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, body);
    if (!err) {
      result.valid = doc["valid"] | false;
      result.reason = doc["reason"] | "";
    } else {
      result.reason = "bad_json";
    }
  } else {
    result.reason = "http_" + String(httpCode);
  }

  http.end();
  return result;
}

void unlockAndWaitForTurn() {
  digitalWrite(LED_GREEN_PIN, HIGH);
  beep(1, 150);
  turnstileServo.write(SERVO_UNLOCKED_ANGLE);

  unsigned long start = millis();
  bool turned = false;
  while (millis() - start < TURN_TIMEOUT_MS) {
    if (digitalRead(BUTTON_PIN) == LOW) { // simulated "visitor turned the arm"
      turned = true;
      break;
    }
    delay(20);
  }

  if (!turned) {
    Serial.println("   (no turn detected within timeout, re-locking anyway)");
  }

  turnstileServo.write(SERVO_LOCKED_ANGLE);
  digitalWrite(LED_GREEN_PIN, LOW);
}

void flashInvalid() {
  digitalWrite(LED_RED_PIN, HIGH);
  beep(2, 100);
  delay(400);
  digitalWrite(LED_RED_PIN, LOW);
}

void beep(int times, int durationMs) {
  for (int i = 0; i < times; i++) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(durationMs);
    digitalWrite(BUZZER_PIN, LOW);
    if (i < times - 1) delay(durationMs);
  }
}
