# ESP32 turnstile-gate controller

A first breadboard prototype that opens a turnstile arm (via a servo)
whenever a staff member scans a valid ticket on the admin QR-scan page
(`/admin/treningy/scan-qr`). See CLAUDE.md's "Entrance QR-scan check-in"
section for how the scan itself works; this hardware is the next step
("Planned next: an ESP32-driven ... lock triggered by a valid scan").

## How it talks to the app

1. A staff member scans a ticket and taps "Mark present" on
   `QrScanPage.tsx`.
2. The app writes a small trigger doc (`gateTriggers/{clubId}`) to
   Firestore (`src/lib/gate.ts`) — fire-and-forget, never blocks the
   check-in itself.
3. The ESP32 polls a Cloud Function, `gateStatus`
   (`functions/src/gate.ts`), roughly once a second, over HTTPS.
4. The first poll to see a fresh trigger gets `"1"` back and the function
   marks it consumed (so a second poll a moment later gets `"0"`, even for
   the same scan) — on `"1"`, the ESP32 swings the servo open, waits a
   few seconds, and swings it back.

No new Firebase product is needed — this reuses the same Firestore
project/rules every other feature in this app already does; the one new
piece is the `gateStatus` Cloud Function and the `gateTriggers`
collection.

## One-time server setup (someone with Firebase CLI access to this
project needs to run these — not done automatically by this commit)

```bash
firebase deploy --only firestore:rules
firebase deploy --only functions:gateStatus
```

After deploying, find `gateStatus`'s URL either in the `firebase deploy`
output or in the Firebase Console under Functions — it looks like
`https://REGION-PROJECT_ID.cloudfunctions.net/gateStatus`. Append
`?clubId=<your club's Firestore doc id>` (visible under the `clubs`
collection in the Firebase Console) and paste the whole thing into
`GATE_STATUS_URL` in `esp32-turnstile-gate.ino`.

## Breadboard wiring

Parts used: ESP32 dev board, servo motor, LED, resistor, breadboard,
jumper wires, an adjustable (4-24V) bench power supply.

**Check your servo's rated voltage first** (printed on the servo label or
its datasheet) — a standard hobby servo (e.g. SG90, MG90S, MG995) wants
**4.8-6V**, not anywhere near 24V. Set the adjustable power supply to
that rated voltage, never just turn it up — overvolting a small servo
will damage or destroy it.

```
Adjustable power supply (+) ──────────────┬──────────────► Servo red wire (power)
                                           │
Adjustable power supply (-) ──────────────┼──────────────► Servo black/brown wire (ground)
                                           │
ESP32 GND ─────────────────────────────────┘   (ALL THREE grounds must be
                                                 tied together — this is the
                                                 most common wiring mistake)

ESP32 GPIO13 ──────────────────────────────────► Servo orange/yellow wire (signal)

ESP32 GPIO12 ──[ resistor, 220-330Ω ]──────────► LED anode (long leg)
LED cathode (short leg) ───────────────────────► ESP32 GND
```

Key points:
- **Never power the servo from the ESP32's own 3.3V/5V pin** — a servo
  moving under load can draw a current spike the ESP32 board's regulator
  isn't built for, which can brown out (reset) the whole board. Power the
  servo from the adjustable supply instead.
- **Shared ground is required** even though the servo and the ESP32 are
  powered from different sources — the ESP32's GND pin, the power
  supply's negative terminal, and the servo's ground wire must all be
  connected to the same breadboard ground rail. Without this, the servo's
  PWM signal from the ESP32 has no common reference and will behave
  erratically or not move at all.
- The servo's signal wire (GPIO13 above) connects straight to an ESP32
  GPIO pin — no resistor needed there, servos read this as a logic-level
  PWM signal.
- The LED does need a resistor (220-330Ω is a safe standard value for a
  red/green/yellow LED at 3.3V logic) to limit current — wiring it
  directly to a GPIO pin with no resistor can burn out the LED or the pin.

## Flashing the firmware

1. Arduino IDE → Boards Manager → install "esp32" (by Espressif Systems).
2. Library Manager → install "ESP32Servo".
3. Open `esp32-turnstile-gate.ino`, fill in `WIFI_SSID`, `WIFI_PASSWORD`,
   and `GATE_STATUS_URL` (see above).
4. Select your exact ESP32 board under Tools → Board, plug it in via USB,
   select the right port, and Upload.
5. Open the Serial Monitor (115200 baud) to watch it connect to WiFi and
   log each poll/trigger — useful for the first test before anything is
   physically attached to the turnstile.

## What this prototype deliberately doesn't do yet

- No certificate pinning (uses `setInsecure()` — fine for a bench test on
  a trusted network, worth revisiting for a permanent installation).
- No retry if a poll's HTTPS response is lost after the server already
  marked the trigger consumed — see the comment above `checkGateTrigger()`
  in the `.ino` file.
- `OPEN_ANGLE`/`CLOSED_ANGLE`/`OPEN_DURATION_MS` are placeholder values —
  tune them once the servo is actually mounted to the real turnstile arm.
