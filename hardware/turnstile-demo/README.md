# Turnstile entry — prototype

Bench demo proving the intended production flow end-to-end: **appka vygeneruje
jednorazový QR kód → zariadenie pri vstupe ho naskenuje → server overí a
oznaÄí ako použitý → fyzicky odblokuje**. Zákaznícky turniket si skenovanie aj
odblokovanie brzdy rieši sám — toto rigo len dokazuje, že server dokáže
správne odpovedať "platný/neplatný" presne na tú istú otázku, akú by položil
reálny turniket.

## Časti

| Časť | Čo robí |
|---|---|
| GM65 / GM67 skener | čítanie QR/čiarového kódu z lístka |
| ESP32 | WiFi + volanie backendu + ovládanie demo-turniketu |
| Servo (SG90) | simuluje ramienko turniketu (otočí sa a vráti späť) |
| Tlačidlo | simuluje senzor "návštevník otočil turniketom" |
| 2× LED + bzučiak | vizuálna/zvuková spätná väzba |

## Zapojenie

```
GM65/GM67 TX  -> ESP32 GPIO16 (RX2)
GM65/GM67 RX  -> ESP32 GPIO17 (TX2)
GM65/GM67 VCC -> 5V, GND -> GND

Servo signal  -> ESP32 GPIO18
Servo VCC     -> vlastný 5V zdroj (NIE z USB/5V pinu ESP32 — servo si vie
                 pri pohybe pýtať viac prúdu, než ESP32 dokáže dať)
Servo GND     -> spoločný GND s ESP32

Tlačidlo      -> GPIO4 a GND (INPUT_PULLUP, stlačené = LOW)
Zelená LED    -> GPIO19 (cez ~220Ω) -> GND
Červená LED   -> GPIO21 (cez ~220Ω) -> GND
Bzučiak       -> GPIO22 -> GND
```

## Nasadenie backendu

Cloud Function `validateTurnstileDemoTicket` je už v `functions/src/index.ts`.
Nasadiť:

```
firebase deploy --only functions:validateTurnstileDemoTicket
```

Po nasadení skopíruj presnú URL z výstupu konzoly do `VALIDATE_URL` v
`turnstile_demo.ino` (zvyčajne `https://us-central1-arena-srsnov-reservation.cloudfunctions.net/validateTurnstileDemoTicket`, ale potvrď si to z reálneho výstupu).

## Vytvorenie testovacích lístkov (QR kódov)

```
GOOGLE_APPLICATION_CREDENTIALS=/cesta/k/service-account.json node scripts/create-turnstile-demo-tickets.mjs 5
```

Vygeneruje 5 jednorazových kódov, zapíše ich do Firestore (`turnstileDemoTickets`)
a uloží QR PNG do `turnstile-demo-qrcodes/` — vytlač alebo zobraz na telefóne
na naskenovanie počas demo.

## Flashnutie ESP32

1. Arduino IDE → Library Manager → nainštaluj `ArduinoJson` a `ESP32Servo`
2. V `turnstile_demo.ino` vyplň `WIFI_SSID`, `WIFI_PASSWORD`, `VALIDATE_URL`
3. Flash, otvor Serial Monitor (115200 baud) na sledovanie priebehu

## Priebeh demo

1. Naskenuj QR kód z vytlačeného lístka → servo sa otočí, zelená LED, pípne
2. Stlač tlačidlo (simulácia otočenia turniketom) → servo sa vráti, pripravené na ďalší sken
3. Naskenuj **ten istý** kód znova → červená LED, dvojité pípnutie, servo sa nehýbe (`already_used`)

## Hranice tohto prototypu

- Žiadna platobná brána — lístky vytvára priamo skript, nie reálna platba
- ESP32 si TLS certifikát backendu neoveruje (zjednodušené pre demo na uzavretej WiFi — **nie** pre produkčné nasadenie)
- `turnstileDemoTickets` je samostatná kolekcia, oddelená od reálnych dát klubu — bezpečné na vymazanie po demo
