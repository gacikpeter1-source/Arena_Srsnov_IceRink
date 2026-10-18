# ESP32 turnstile-gate controller

Opens a turnstile arm (via a servo) at the entrance. Two independent
trigger paths feed the same physical gate:

- **Primary — GM65 barcode/QR module wired straight to the ESP32.**
  A customer scans their own ticket's QR directly at the turnstile; no
  staff member or phone is involved. Every ticket is its own QR code
  covering exactly one person (see CLAUDE.md's per-ticket QR notes) —
  there is no "group" code, so each person in a party scans their own
  code and passes through one at a time.
- **Fallback — the existing staff phone-camera flow**
  (`/admin/treningy/scan-qr`, `QrScanPage.tsx`), for when the turnstile
  hardware itself is down. A staff member scans with their own phone and
  taps "Mark present" — this still opens the *same* physical gate via a
  second, independent path (see below), it just needs a human there to
  do it.

A small SPI OLED shows live status (connecting to WiFi, QR read,
approved/rejected) — added specifically so the whole thing is debuggable
once it's mounted at the real turnstile and running off a wall adapter,
with no PC/Serial Monitor attached at all.

See CLAUDE.md's "Entrance QR-scan check-in" section for how the ticket
QR codes themselves are generated and what they encode.

## How each path talks to the app

**GM65 (primary):**
1. Customer scans their ticket's QR directly at the GM65 module mounted
   on the turnstile.
2. The GM65 decodes it and sends the raw text (which is the exact same
   URL the ticket's own confirmation PDF/email QR encodes) to the ESP32
   over a wired UART connection — no WiFi/Bluetooth on the GM65 side at
   all, it's a direct serial link to the ESP32 sitting right next to it.
3. The ESP32 forwards that text as-is to the `gateScanCheckIn` Cloud
   Function (`functions/src/gate.ts`), which does the real validation
   itself (this ticket exists, its token matches, the registration is
   confirmed, and this specific ticket hasn't already been used) and
   replies `"1"` (open) or `"0"` (deny) — plain text, no JSON needed on
   the device.
4. On `"1"`, the ESP32 swings the servo open, waits a few seconds, and
   swings it back.

**Phone (fallback):**
1. A staff member scans a ticket and taps "Mark present" on
   `QrScanPage.tsx`.
2. The app writes a small trigger doc (`gateTriggers/{clubId}`) to
   Firestore (`src/lib/gate.ts`) — fire-and-forget, never blocks the
   check-in itself.
3. The *same* ESP32 also polls a second Cloud Function, `gateStatus`
   (`functions/src/gate.ts`), roughly once a second, over HTTPS,
   independent of whatever the GM65 is doing.
4. The first poll to see a fresh trigger gets `"1"` back and the function
   marks it consumed (so a second poll a moment later gets `"0"`, even
   for the same scan) — on `"1"`, same servo-open behavior as above.

No new Firebase product is needed for either path — this reuses the same
Firestore project/rules every other feature in this app already does.

## One-time server setup (someone with Firebase CLI access to this
project needs to run these — not done automatically by this commit)

```bash
firebase deploy --only firestore:rules
firebase deploy --only functions:gateStatus,functions:gateScanCheckIn
```

After deploying, find each function's URL either in the `firebase deploy`
output or in the Firebase Console under Functions — looks like
`https://REGION-PROJECT_ID.cloudfunctions.net/FUNCTION_NAME`. Paste both
base URLs into `GATE_STATUS_BASE_URL`/`GATE_SCAN_CHECKIN_BASE_URL` in
`esp32-turnstile-gate.ino` (the `?clubId=...` part is added by the
firmware itself from the separate `CLUB_ID` constant — just the base URL
goes here, no query string).

## Breadboard wiring

Parts used: ESP32 dev board, servo motor, LED, resistor, GM65 barcode/QR
module, breadboard, jumper wires, an adjustable (4-24V, or a breadboard
power-supply module set to 5V) power supply.

**Check your servo's rated voltage first** (printed on the servo label or
its datasheet) — a standard hobby servo (e.g. SG90, MG90S, MG995) wants
**4.8-6V**, not anywhere near 24V. Set the supply to that rated voltage,
never just turn it up — overvolting a small servo will damage or destroy
it.

```
Power supply (+) ──────────────────────────┬──────────────► Servo red wire (power)
                                            │
Power supply (-) ───────────────────────────┼──────────────► Servo black/brown wire (ground)
                                            │
ESP32 GND ───────────────────────────────────┘   (ALL grounds — ESP32, power
                                                   supply, servo, GM65 — must be
                                                   tied together — this is the
                                                   most common wiring mistake)

ESP32 GPIO13 ───────────────────────────────────► Servo orange/yellow wire (signal)

ESP32 GPIO12 ──[ resistor, 220-330Ω ]───────────► LED anode (long leg)
LED cathode (short leg) ────────────────────────► ESP32 GND

ESP32 GPIO18 (RX2) ◄────────────────────────────  GM65 TX
ESP32 GPIO19 (TX2) ─────────────────────────────► GM65 RX
GM65 VCC ────────────────────────────────────────  check the module's own
                                                    label/datasheet — most
                                                    common GM65 breakouts
                                                    accept 3.3-5V directly
GM65 GND ────────────────────────────────────────  same common ground as above

ESP32 GPIO14 ────────────────────────────────────► OLED D0 / SCK / CLK
ESP32 GPIO27 ────────────────────────────────────► OLED D1 / MOSI / DIN / SDA
ESP32 GPIO25 ────────────────────────────────────► OLED DC
ESP32 GPIO33 ────────────────────────────────────► OLED RES / RST
ESP32 GPIO26 ────────────────────────────────────► OLED CS (skip this wire
                                                    if your module has no
                                                    CS pin at all — a 6-pin
                                                    module ties it to GND
                                                    internally instead)
OLED VCC ────────────────────────────────────────  3.3V (check your module's
                                                    own rating first — most
                                                    small SPI OLEDs are 3.3V
                                                    only, NOT 5V-tolerant)
OLED GND ────────────────────────────────────────  same common ground as above
```

Key points:
- **Never power the servo from the ESP32's own 3.3V/5V pin** — a servo
  moving under load can draw a current spike the ESP32 board's regulator
  isn't built for, which can brown out (reset) the whole board. Power the
  servo from a separate supply instead.
- **Shared ground is required** even though the servo/GM65 and the ESP32
  may be powered from different sources — every ground (ESP32, power
  supply, servo, GM65) must be tied to the same rail. Without this, the
  servo's PWM signal and the GM65's serial data have no common reference
  and will behave erratically or not work at all.
- **GM65 wiring is crossed** (TX-to-RX, RX-to-TX) — a very common first
  mistake is wiring TX-to-TX/RX-to-RX, which looks "matched" by name but
  means neither side can hear the other.
- **Avoid GPIO16/17 on an ESP32-WROVER board (the variant with built-in
  PSRAM)** — those two pins are wired internally to the PSRAM chip and
  aren't real general-purpose pins on that variant, so anything connected
  there can receive zero bytes no matter how correctly it's wired. This
  firmware defaults to GPIO18/19 specifically to sidestep that — if you
  ever repurpose other pins, avoid 16/17 unless you've confirmed your
  exact board has no PSRAM.
- **GM65 baud rate**: `GM65_BAUD_RATE` in the firmware defaults to the
  module's own common factory default, 9600. If scans don't produce
  readable text in the Serial Monitor, check the GM65's own
  documentation/configuration barcodes — some units ship set to a
  different rate and need either a config scan to change it, or the
  firmware constant updated to match.
- **A real unit shipped configured for USB output (keyboard/virtual COM
  port), not TTL serial, and produced zero bytes on UART2 no matter how
  correctly it was wired or what baud rate was tried** — confirmed via a
  temporary raw-byte Serial dump in `pollGm65()` (print every received
  byte's hex value, with no line-terminator logic, before falling back to
  the real parsing). The fix is a one-time configuration scan: the
  manufacturer's own manual (Hangzhou Grow Technology, "GM65 Bar Code
  Reader Module User Manual") has a "Series Output"/TTL-232 setup barcode
  under its "Communication interface" section — scan that once with the
  GM65 itself (not with a phone) to switch it into real UART mode. Search
  for the exact manual PDF matching your unit's silkscreen/labeling if the
  one above doesn't match, since OEM manual revisions vary.
- **The module's own line terminator may be a bare `\r` with no trailing
  `\n`** — confirmed via the same raw-byte dump above. `pollGm65()`
  deliberately flushes on either `\r` or `\n` for this reason (see its own
  comment) rather than requiring `\n` specifically, which would otherwise
  silently discard every scan from a unit like this.
- The servo's signal wire (GPIO13) and the LED's resistor leg (GPIO12)
  are unchanged from the original prototype — see their own notes above.
- **OLED pins (14/27/25/33/26) were chosen specifically to avoid every pin
  already used above** (servo, LED, GM65) — if you ever remap any of these
  pins, double-check the new choice doesn't collide with GPIO18/19 (GM65)
  the same way the earlier GPIO16/17 PSRAM conflict did. Any free GPIO
  works for SPI on the ESP32 since the pin matrix lets you remap it in
  software (unlike boards with fixed hardware SPI pins).

## Flashing the firmware

1. Arduino IDE → Boards Manager → install "esp32" (by Espressif Systems).
2. Library Manager → install "ESP32Servo".
3. Library Manager → install "Adafruit SSD1306" — when prompted to also
   install its dependency "Adafruit GFX Library", accept that too.
4. Open `esp32-turnstile-gate.ino`, fill in `WIFI_SSID`, `WIFI_PASSWORD`,
   `CLUB_ID`, and both base URLs (see "One-time server setup" above).
5. Select your exact ESP32 board under Tools → Board, plug it in via USB,
   select the right port, and Upload.
6. Open the Serial Monitor (115200 baud) to watch it connect to WiFi and
   log each GM65 scan / fallback poll trigger — useful for testing before
   anything is physically mounted on the turnstile. A scan prints
   `"GM65 scanned: <the decoded URL>"` followed by either `"Trigger
   received — opening gate"` or `"Scan rejected (invalid, already used,
   or not confirmed)"`. The OLED shows the same story in two short lines
   (`"QR kod precitany"` → `"QR schvaleny"`/`"QR kod nie je platny"`) —
   once this all works once over USB, the OLED alone is enough to debug
   it later when running off a wall adapter with no PC attached at all.

## Testing without a real ticket in hand

Before wiring the GM65 at all, you can confirm the WiFi + servo + Cloud
Function chain works by simulating the phone-fallback trigger directly in
the Firebase Console: Firestore Database → create (or open) collection
`gateTriggers` → document with the exact id of your club → fields
`openedAt` (timestamp, now) and `consumed` (boolean, `false`). The ESP32
should pick this up within `POLL_INTERVAL_MS` (1s) and open the gate.

To test the GM65 path itself without a mounted turnstile, scan any real
ticket's QR code (from a confirmation email/PDF) directly at the GM65 —
the Serial Monitor will show exactly what it decoded and whether the
server accepted or rejected it.

## What this prototype deliberately doesn't do yet

- No certificate pinning (uses `setInsecure()` — fine for a bench test on
  a trusted network, worth revisiting for a permanent installation).
- No retry if a poll/scan's HTTPS response is lost after the server
  already committed its side (consumed the trigger, or marked a ticket
  checked in) — see the comments above `pollFallbackTrigger()`/
  `checkInScannedTicket()` in the `.ino` file.
- Bundle ("kurz") registrations are not supported by the GM65/
  `gateScanCheckIn` path at all — a bundle covers many real sessions, and
  with no human to ask "which one", an unattended scan can't resolve that
  ambiguity the way `QrScanPage.tsx`'s own UI (a dropdown) can. A bundle
  customer still needs the staff phone-camera fallback for now.
- `OPEN_ANGLE`/`CLOSED_ANGLE`/`OPEN_DURATION_MS` are placeholder values —
  tune them once the servo is actually mounted to the real turnstile arm.
