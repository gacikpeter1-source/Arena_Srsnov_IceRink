// One-off: adds a `room` field to the demo rinkScheduleEntries docs that
// scripts/seed-demo-day.mjs already created (before it also wrote rooms) —
// patches them in place rather than re-seeding, so existing bookingIds/
// confirmation codes/tokens stay untouched. Safe to re-run.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node scripts/patch-demo-rooms.mjs
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const CLUB_ID = process.env.VITE_CLUB_ID || 'arena-srsnov'
const DATE = '2026-09-30'

initializeApp({
  credential: process.env.GOOGLE_APPLICATION_CREDENTIALS ? applicationDefault() : cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
})
const db = getFirestore()

// Keyed by `${rinkId}__${zoneId}__${startTime}` — matches RINK_PLANS in
// scripts/seed-demo-day.mjs.
const ROOM_BY_KEY = {
  'main-hall__main-hall-third-1__09:00': 'Šatňa 1',
  'main-hall__main-hall-third-2__09:00': 'Šatňa 2',
  'main-hall__main-hall-full__10:00': 'Šatňa VIP',
  'main-hall__main-hall-half-a__11:00': 'Šatňa 3',
  'main-hall__main-hall-half-b__11:00': 'Šatňa 4',
  'main-hall__main-hall-third-1__16:00': 'Šatňa 1',
  'main-hall__main-hall-third-2__16:00': 'Šatňa 2',
  'main-hall__main-hall-third-3__16:00': 'Šatňa 3',
  'main-hall__main-hall-third-1__17:00': 'Šatňa 1',
  'main-hall__main-hall-full__18:00': 'Šatňa domácich',
  'main-hall__main-hall-half-a__19:00': 'Šatňa 3',
  'main-hall__main-hall-half-b__19:00': 'Šatňa 2',
  'small-hall__small-hall-third-1__08:00': 'Šatňa 1',
  'small-hall__small-hall-third-2__08:00': 'Šatňa 2',
  'small-hall__small-hall-full__09:00': 'Šatňa 3',
  'small-hall__small-hall-half-a__10:00': 'Šatňa 4',
  'small-hall__small-hall-third-1__15:00': 'Šatňa 1',
  'small-hall__small-hall-third-2__15:00': 'Šatňa 2',
  'small-hall__small-hall-third-3__15:00': 'Šatňa 3',
  'small-hall__small-hall-full__16:00': 'Šatňa VIP',
  'small-hall__small-hall-half-a__18:00': 'Šatňa 3',
  'small-hall__small-hall-half-b__18:00': 'Šatňa 4',
  'small-hall__small-hall-full__19:00': 'Šatňa domácich'
}

async function run() {
  const snap = await db.collection('rinkScheduleEntries')
    .where('clubId', '==', CLUB_ID)
    .where('date', '==', DATE)
    .where('demoSeed', '==', true)
    .get()

  let updated = 0
  let skipped = 0
  const batch = db.batch()
  for (const doc of snap.docs) {
    const e = doc.data()
    const key = `${e.rinkId}__${e.zoneId}__${e.startTime}`
    const room = ROOM_BY_KEY[key]
    if (!room) {
      console.log(`  [skip] ${key} — no room mapping (probably not one of the seeded entries)`)
      skipped++
      continue
    }
    batch.update(doc.ref, { room })
    console.log(`  ${key} -> ${room}`)
    updated++
  }
  await batch.commit()
  console.log(`Done. ${updated} updated, ${skipped} skipped.`)
}

run().then(() => process.exit(0)).catch((err) => {
  console.error(err)
  process.exit(1)
})
