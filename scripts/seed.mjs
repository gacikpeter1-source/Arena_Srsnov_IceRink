// Seeds a starter club/zones/timeSlotConfig into Firestore.
//
// PLACEHOLDER DATA: branding (name/colors) is real Arena Sršňov, but the
// zone layout and operating hours below are guesses, not confirmed
// business data. Edit them (or the docs directly in Firestore) once real
// values are known — this script is safe to re-run, it just overwrites
// the same doc IDs.
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

  // PLACEHOLDER zone layout: a full rink split into two halves, each half
  // split into two thirds-of-a-half. Replace with the real layout —
  // in particular, confirm which sub-zones are physically independent
  // vs. overlapping so `conflictsWith` is accurate.
  const zones = [
    { id: 'full', name: 'Full Rink', type: 'full', sortOrder: 0, conflictsWith: ['full', 'half-a', 'half-b'] },
    { id: 'half-a', name: 'Half A', type: 'half', sortOrder: 1, conflictsWith: ['full', 'half-a'] },
    { id: 'half-b', name: 'Half B', type: 'half', sortOrder: 2, conflictsWith: ['full', 'half-b'] }
  ]
  for (const zone of zones) {
    await db.doc(`zones/${zone.id}`).set({
      clubId: CLUB_ID,
      name: zone.name,
      type: zone.type,
      conflictsWith: zone.conflictsWith,
      sortOrder: zone.sortOrder,
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

  console.log(`Seeded placeholder club config for "${CLUB_ID}". Edit zones/hours before going live.`)
}

seed().then(() => process.exit(0)).catch((err) => {
  console.error(err)
  process.exit(1)
})
