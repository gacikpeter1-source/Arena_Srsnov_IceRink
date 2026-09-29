// One-off: seeds a realistic-looking full day of rink-schedule bookings
// across both rinks, for a live customer demo (rozvrh ihriska + /book +
// TV board). Writes real bookings/slotLocks/rinkScheduleEntries docs the
// exact same shape createRinkScheduleEntry (lib/rinkSchedule.ts) would —
// this is PRODUCTION data, visible on the live public site immediately.
//
// Every doc this writes is tagged `demoSeed: true` so scripts/
// remove-demo-day.mjs can find and delete exactly these and nothing else.
// Skips (and logs) any slot that's already locked, rather than
// overwriting a real booking that might already be there.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node scripts/seed-demo-day.mjs
import { randomBytes } from 'node:crypto'
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

const CLUB_ID = process.env.VITE_CLUB_ID || 'arena-srsnov'
const DATE = '2026-09-30'
// Europe/Bratislava is CEST (UTC+2) in late September — fixed offset is
// fine for one specific known demo date, no need for full DST logic.
const UTC_OFFSET = '+02:00'

initializeApp({
  credential: process.env.GOOGLE_APPLICATION_CREDENTIALS ? applicationDefault() : cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
})
const db = getFirestore()

function randomConfirmationCode() {
  const n = randomBytes(4).readUInt32BE(0)
  return `${String(n % 1000).padStart(3, '0')}-${String(Math.floor(n / 1000) % 1000).padStart(3, '0')}`
}

function randomToken(length = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = randomBytes(length)
  let token = ''
  for (let i = 0; i < length; i++) token += chars[bytes[i] % chars.length]
  return token
}

function addMinutes(startTime, minutes) {
  const [h, m] = startTime.split(':').map(Number)
  const total = h * 60 + m + minutes
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

// rinkId / zoneId use this club's real seeded ids (main-hall / small-hall,
// each with -full / -half-a / -half-b / -third-1/2/3).
const ENTRIES = [
  // --- Hlavná hala (main-hall) ---
  { rinkId: 'main-hall', zoneId: 'main-hall-third-1', start: '07:00', duration: 60, team: 'HK Zvolen U10 – tréning' },
  { rinkId: 'main-hall', zoneId: 'main-hall-third-2', start: '07:00', duration: 60, team: 'HK Zvolen U12 – tréning' },
  { rinkId: 'main-hall', zoneId: 'main-hall-third-2', start: '09:00', duration: 60, team: 'Krasokorčuľovanie – deti' },
  { rinkId: 'main-hall', zoneId: 'main-hall-full', start: '10:00', duration: 60, team: 'Firemná akcia – XY s.r.o.' },
  { rinkId: 'main-hall', zoneId: 'main-hall-half-a', start: '11:15', duration: 60, team: 'Krasokorčuľovanie – mladší dorast' },
  { rinkId: 'main-hall', zoneId: 'main-hall-half-b', start: '11:15', duration: 60, team: 'Škôlka Osloboditeľov – korčuľovací kurz' },
  { rinkId: 'main-hall', zoneId: 'main-hall-third-1', start: '16:00', duration: 60, team: 'HK Zvolen U10 – tréning' },
  { rinkId: 'main-hall', zoneId: 'main-hall-third-2', start: '16:00', duration: 60, team: 'HK Zvolen U12 – tréning' },
  { rinkId: 'main-hall', zoneId: 'main-hall-third-3', start: '16:00', duration: 60, team: 'HK Zvolen dorast – tréning' },
  { rinkId: 'main-hall', zoneId: 'main-hall-third-1', start: '17:00', duration: 60, team: 'HK Zvolen prípravka – tréning' },
  { rinkId: 'main-hall', zoneId: 'main-hall-full', start: '18:00', duration: 90, team: 'Liga: HK Zvolen – HK Poprad' },
  { rinkId: 'main-hall', zoneId: 'main-hall-half-a', start: '19:30', duration: 60, team: 'Verejné korčuľovanie' },
  { rinkId: 'main-hall', zoneId: 'main-hall-half-b', start: '19:30', duration: 60, team: 'HK Zvolen dorast – tréning' },

  // --- Malá hala (small-hall) ---
  { rinkId: 'small-hall', zoneId: 'small-hall-third-1', start: '08:00', duration: 60, team: 'HK Zvolen mladšie žiactvo – tréning' },
  { rinkId: 'small-hall', zoneId: 'small-hall-third-2', start: '08:00', duration: 60, team: 'HK Zvolen staršie žiactvo – tréning' },
  { rinkId: 'small-hall', zoneId: 'small-hall-full', start: '09:15', duration: 60, team: 'Krasokorčuľovanie – veľká skupina' },
  { rinkId: 'small-hall', zoneId: 'small-hall-half-a', start: '10:30', duration: 60, team: 'Škôlka Osloboditeľov – kurz (2. skupina)' },
  { rinkId: 'small-hall', zoneId: 'small-hall-third-1', start: '15:00', duration: 60, team: 'HK Zvolen dorast B – tréning' },
  { rinkId: 'small-hall', zoneId: 'small-hall-third-2', start: '15:00', duration: 60, team: 'HK Zvolen dorast A – tréning' },
  { rinkId: 'small-hall', zoneId: 'small-hall-third-3', start: '15:00', duration: 60, team: 'HK Zvolen juniori – tréning' },
  { rinkId: 'small-hall', zoneId: 'small-hall-full', start: '16:30', duration: 60, team: 'Firemná akcia – firemný večierok' },
  { rinkId: 'small-hall', zoneId: 'small-hall-half-a', start: '18:00', duration: 60, team: 'Verejné korčuľovanie' },
  { rinkId: 'small-hall', zoneId: 'small-hall-half-b', start: '18:00', duration: 60, team: 'Krasokorčuľovanie – dorast' },
  { rinkId: 'small-hall', zoneId: 'small-hall-full', start: '19:15', duration: 90, team: 'Liga: HK Zvolen B – HK Detva' }
]

async function createEntry(e) {
  const lockId = `${CLUB_ID}__${e.zoneId}__${DATE}__${e.start}`
  const lockRef = db.doc(`slotLocks/${lockId}`)
  const existing = await lockRef.get()
  if (existing.exists) {
    console.log(`  [skip] ${e.rinkId}/${e.zoneId} ${e.start} — already booked (not overwriting a real reservation)`)
    return false
  }

  const bookingRef = db.collection('bookings').doc()
  const entryRef = db.collection('rinkScheduleEntries').doc()
  const endTime = addMinutes(e.start, e.duration)

  await lockRef.set({
    clubId: CLUB_ID,
    zoneId: e.zoneId,
    date: DATE,
    startTime: e.start,
    bookingId: bookingRef.id,
    demoSeed: true,
    createdAt: Timestamp.now()
  })

  await bookingRef.set({
    clubId: CLUB_ID,
    rinkId: e.rinkId,
    zoneId: e.zoneId,
    date: DATE,
    startTime: e.start,
    durationMinutes: e.duration,
    name: e.team,
    email: 'demo-seed@arenasrsnov.local',
    phone: '',
    confirmationCode: randomConfirmationCode(),
    cancellationToken: randomToken(),
    tokenExpiresAt: Timestamp.fromDate(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)),
    startAtUtc: Timestamp.fromDate(new Date(`${DATE}T${e.start}:00${UTC_OFFSET}`)),
    status: 'confirmed',
    demoSeed: true,
    createdAt: Timestamp.now()
  })

  await entryRef.set({
    clubId: CLUB_ID,
    rinkId: e.rinkId,
    zoneId: e.zoneId,
    teamName: e.team,
    createdBy: 'demo-seed-script',
    createdByName: 'Demo Seed',
    date: DATE,
    startTime: e.start,
    durationMinutes: e.duration,
    bookingId: bookingRef.id,
    demoSeed: true,
    createdAt: Timestamp.now()
  })

  console.log(`  ${e.rinkId}/${e.zoneId} ${e.start}–${endTime} — ${e.team}`)
  return true
}

async function run() {
  console.log(`Seeding demo schedule for ${DATE} (club "${CLUB_ID}"):`)
  let created = 0
  let skipped = 0
  for (const entry of ENTRIES) {
    const ok = await createEntry(entry)
    if (ok) created++
    else skipped++
  }
  console.log(`Done. ${created} created, ${skipped} skipped (slot already taken).`)
  console.log('Run scripts/remove-demo-day.mjs afterwards to clean everything back out.')
}

run().then(() => process.exit(0)).catch((err) => {
  console.error(err)
  process.exit(1)
})
