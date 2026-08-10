// Seeds starter club/rinks/zones/timeSlotConfig/divisionRules into Firestore.
//
// PLACEHOLDER DATA: branding (name/colors) is real Arena Sršňov, but the
// rink names, zone layout, operating hours, and division schedule below are
// guesses, not confirmed business data. Edit them (or the docs directly in
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
    // PLACEHOLDER — unset until the sibling apps are live; the hub home
    // screen shows those cards as "coming soon" until these are filled in.
    integrations: {
      trainingReservationsUrl: '',
      tournamentsUrl: ''
    },
    createdAt: new Date()
  })

  // The club's two physical ice surfaces. Each has its own zones/hours/
  // division schedule below.
  const rinks = [
    { id: 'main-hall', name: 'Main Hall', sortOrder: 0 },
    { id: 'small-hall', name: 'Small Hall', sortOrder: 1 }
  ]
  for (const rink of rinks) {
    await db.doc(`rinks/${rink.id}`).set({
      clubId: CLUB_ID,
      name: rink.name,
      sortOrder: rink.sortOrder,
      active: true
    })
  }

  // Zone definitions per rink: the rink as a whole, as two halves, and as
  // three thirds. Which of these is actually offered for a given date/time
  // is decided by that rink's divisionRules schedule below — 'full' is
  // always the fallback when no rule applies. PLACEHOLDER naming/count —
  // confirm the real split (e.g. is a "third" along the boards or across
  // the ice?).
  for (const rink of rinks) {
    const zones = [
      { id: `${rink.id}-full`, name: 'Full Rink', mode: 'full', slotIndex: 0 },
      { id: `${rink.id}-half-a`, name: 'Half A', mode: 'half', slotIndex: 0 },
      { id: `${rink.id}-half-b`, name: 'Half B', mode: 'half', slotIndex: 1 },
      { id: `${rink.id}-third-1`, name: 'Third 1', mode: 'third', slotIndex: 0 },
      { id: `${rink.id}-third-2`, name: 'Third 2', mode: 'third', slotIndex: 1 },
      { id: `${rink.id}-third-3`, name: 'Third 3', mode: 'third', slotIndex: 2 }
    ]
    for (const zone of zones) {
      await db.doc(`zones/${zone.id}`).set({
        clubId: CLUB_ID,
        rinkId: rink.id,
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
    await db.doc(`timeSlotConfig/${rink.id}-default`).set({
      clubId: CLUB_ID,
      rinkId: rink.id,
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
        await db.doc(`divisionRules/${rink.id}-${rule.id}-${dayOfWeek}`).set({
          clubId: CLUB_ID,
          rinkId: rink.id,
          dayOfWeek,
          startTime: rule.startTime,
          endTime: rule.endTime,
          mode: rule.mode
        })
      }
    }
  }

  console.log(`Seeded placeholder club config for "${CLUB_ID}" with rinks: ${rinks.map((r) => r.name).join(', ')}. Edit rinks/zones/hours/divisionRules before going live.`)
}

seed().then(() => process.exit(0)).catch((err) => {
  console.error(err)
  process.exit(1)
})
