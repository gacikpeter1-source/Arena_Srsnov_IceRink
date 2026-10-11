// One-off helper for the turnstile-entry PROTOTYPE (see
// functions/src/index.ts's validateTurnstileDemoTicket doc comment) — NOT
// part of the real ticketing/payment product, which doesn't exist yet.
// Creates N `turnstileDemoTickets` docs (each a single-use code) and
// renders each one as a printable/scannable QR PNG, so a bench demo has
// something real to scan: ESP32 reads the QR -> calls
// validateTurnstileDemoTicket -> gets {valid:true} once, {valid:false,
// reason:'already_used'} on every scan after that.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node scripts/create-turnstile-demo-tickets.mjs [count]
//
// Writes QR PNGs to ./turnstile-demo-qrcodes/<code>.png (gitignored —
// these are throwaway demo artifacts, not app assets).
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import QRCode from 'qrcode'
import { mkdirSync } from 'fs'
import { randomBytes } from 'crypto'

const CLUB_ID = process.env.VITE_CLUB_ID || 'arena-srsnov'
const COUNT = Number(process.argv[2]) || 5
const OUT_DIR = 'turnstile-demo-qrcodes'

initializeApp({
  credential: process.env.GOOGLE_APPLICATION_CREDENTIALS ? cert(process.env.GOOGLE_APPLICATION_CREDENTIALS) : applicationDefault()
})
const db = getFirestore()

function generateCode(length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I, easier to read if ever hand-typed
  const bytes = randomBytes(length)
  let code = ''
  for (let i = 0; i < length; i++) code += chars[bytes[i] % chars.length]
  return code
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  console.log(`Creating ${COUNT} demo ticket(s) for club "${CLUB_ID}"...\n`)

  for (let i = 0; i < COUNT; i++) {
    const code = generateCode()
    await db.collection('turnstileDemoTickets').add({
      clubId: CLUB_ID,
      code,
      used: false,
      createdAt: Timestamp.now()
    })
    const filePath = `${OUT_DIR}/${code}.png`
    await QRCode.toFile(filePath, code, { width: 512, margin: 2 })
    console.log(`  ${code}  ->  ${filePath}`)
  }

  console.log(`\nDone. Print or display these QR codes to scan during the demo.`)
  console.log(`Each one works exactly ONCE — scanning it again returns {valid:false, reason:'already_used'}.`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
