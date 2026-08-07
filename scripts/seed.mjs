// Seeds a starter club/zones/timeSlotConfig/divisionRules into Firestore.
//
// PLACEHOLDER DATA: branding (name/colors) is real Arena Sršňov, but the
// zone layout, operating hours, and division schedule below are guesses,
// not confirmed business data. Edit them (or the docs directly in
// Firestore) once real values are known — this script is safe to re-run,
// it just overwrites the same doc IDs.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node scripts/seed.mjs
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const CLUB_ID = process.env.VITE_CLUB_ID || 'arena-srsnov'

initializeApp({
  credential: process.env.GOOGLE_APPLICATION_CREDENTIALS ? applicationDefault() : cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
})
const db = getFirestore()

async function seed() {
  await db.doc(`clubs/${CLUB_ID}`).set({
    name: 'Aréna Sršňov',
    colors: { primary: '#FDB913', background: '#0a0a0a' },
    contact: {
      // PLACEHOLDER — replace with the club's real contact details.
      email: 'gacikpeter1@gmail.com',
      phone: '',
      address: ''
    },
    timezone: 'Europe/Bratislava',
    paymentsEnabled: false,
    createdAt: new Date()
  })

  // Zone definitions: the rink as a whole, as two halves, and as three
  // thirds. Which of these is actually offered for a given date/time is
  // decided by the divisionRules schedule below — 'full' is always the
  // fallback when no rule applies. PLACEHOLDER naming/count — confirm the
  // real split (e.g. is a "third" along the boards or across the ice?).
  const zones = [
    { id: 'full', name: 'Full Rink', mode: 'full', slotIndex: 0 },
    { id: 'half-a', name: 'Half A', mode: 'half', slotIndex: 0 },
    { id: 'half-b', name: 'Half B', mode: 'half', slotIndex: 1 },
    { id: 'third-1', name: 'Third 1', mode: 'third', slotIndex: 0 },
    { id: 'third-2', name: 'Third 2', mode: 'third', slotIndex: 1 },
    { id: 'third-3', name: 'Third 3', mode: 'third', slotIndex: 2 }
  ]
  for (const zone of zones) {
    await db.doc(`zones/${zone.id}`).set({
      clubId: CLUB_ID,
      name: zone.name,
      mode: zone.mode,
      slotIndex: zone.slotIndex,
      active: true
    })
  }

  // PLACEHOLDER hours: 08:00–22:00 every day, 60-minute slots.
  const allDays = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek,
    openTime: '08:00',
    closeTime: '22:00'
  }))
  await db.doc(`timeSlotConfig/${CLUB_ID}-default`).set({
    clubId: CLUB_ID,
    slotDurationMinutes: 60,
    hours: allDays
  })

  // PLACEHOLDER division schedule, just to demonstrate the feature end to
  // end: weekday evenings offered as halves, Saturday morning as thirds.
  // Everything else defaults to whole-rink (no rule needed).
  const divisionRules = [
    { id: 'weekday-evening-half', dayOfWeek: [1, 2, 3, 4, 5], startTime: '18:00', endTime: '20:00', mode: 'half' },
    { id: 'saturday-morning-third', dayOfWeek: [6], startTime: '08:00', endTime: '10:00', mode: 'third' }
  ]
  for (const rule of divisionRules) {
    for (const dayOfWeek of rule.dayOfWeek) {
      await db.doc(`divisionRules/${rule.id}-${dayOfWeek}`).set({
        clubId: CLUB_ID,
        dayOfWeek,
        startTime: rule.startTime,
        endTime: rule.endTime,
        mode: rule.mode
      })
    }
  }

  console.log(`Seeded placeholder club config for "${CLUB_ID}". Edit zones/hours/divisionRules before going live.`)
}

seed().then(() => process.exit(0)).catch((err) => {
  console.error(err)
  process.exit(1)
})
