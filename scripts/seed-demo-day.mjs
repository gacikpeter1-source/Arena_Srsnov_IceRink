// One-off: seeds a realistic-looking full day of rink-schedule bookings
// across both rinks, for a live customer demo (rozvrh ihriska + /book +
// TV board). Writes real bookings/slotLocks/rinkScheduleEntries docs the
// exact same shape createRinkScheduleEntry (lib/rinkSchedule.ts) would —
// this is PRODUCTION data, visible on the live public site immediately.
//
// Also writes one `scheduleOverrides` doc per rink for this date, since
// the public /book page only ever offers whichever division mode (full/
// half/third) that date+time's override says (see lib/schedule.ts) — a
// booking made on a "half"/"third" zone the override doesn't also mark
// split for that exact slot would show as phantom availability on /book
// (the picker would only offer the "full" zone, which isn't the one
// actually locked). Every slot lines up on a clean hour boundary
// specifically so the override's slot list and the bookings below never
// disagree about timing.
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

// One entry per rink: 14 clean hourly slots (08:00-21:00), each declaring
// its division mode and which of that mode's zones are actually booked —
// any zone of that mode left out of `bookings` stays free, on purpose, so
// the demo also shows partial availability (e.g. 2 of 3 thirds taken).
const RINK_PLANS = {
  'main-hall': [
    { start: '08:00', mode: 'full', bookings: [] },
    { start: '09:00', mode: 'third', bookings: [
      { zoneId: 'main-hall-third-1', team: 'HK Zvolen U10 – tréning' },
      { zoneId: 'main-hall-third-2', team: 'HK Zvolen U12 – tréning' }
    ] },
    { start: '10:00', mode: 'full', bookings: [
      { zoneId: 'main-hall-full', team: 'Firemná akcia – XY s.r.o.' }
    ] },
    { start: '11:00', mode: 'half', bookings: [
      { zoneId: 'main-hall-half-a', team: 'Krasokorčuľovanie – mladší dorast' },
      { zoneId: 'main-hall-half-b', team: 'Škôlka Osloboditeľov – korčuľovací kurz' }
    ] },
    { start: '12:00', mode: 'full', bookings: [] },
    { start: '13:00', mode: 'full', bookings: [] },
    { start: '14:00', mode: 'full', bookings: [] },
    { start: '15:00', mode: 'full', bookings: [] },
    { start: '16:00', mode: 'third', bookings: [
      { zoneId: 'main-hall-third-1', team: 'HK Zvolen U10 – tréning' },
      { zoneId: 'main-hall-third-2', team: 'HK Zvolen U12 – tréning' },
      { zoneId: 'main-hall-third-3', team: 'HK Zvolen dorast – tréning' }
    ] },
    { start: '17:00', mode: 'third', bookings: [
      { zoneId: 'main-hall-third-1', team: 'HK Zvolen prípravka – tréning' }
    ] },
    { start: '18:00', mode: 'full', bookings: [
      { zoneId: 'main-hall-full', team: 'Liga: HK Zvolen – HK Poprad' }
    ] },
    { start: '19:00', mode: 'half', bookings: [
      { zoneId: 'main-hall-half-a', team: 'Verejné korčuľovanie' },
      { zoneId: 'main-hall-half-b', team: 'HK Zvolen dorast – tréning' }
    ] },
    { start: '20:00', mode: 'full', bookings: [] },
    { start: '21:00', mode: 'full', bookings: [] }
  ],
  'small-hall': [
    { start: '08:00', mode: 'third', bookings: [
      { zoneId: 'small-hall-third-1', team: 'HK Zvolen mladšie žiactvo – tréning' },
      { zoneId: 'small-hall-third-2', team: 'HK Zvolen staršie žiactvo – tréning' }
    ] },
    { start: '09:00', mode: 'full', bookings: [
      { zoneId: 'small-hall-full', team: 'Krasokorčuľovanie – veľká skupina' }
    ] },
    { start: '10:00', mode: 'half', bookings: [
      { zoneId: 'small-hall-half-a', team: 'Škôlka Osloboditeľov – kurz (2. skupina)' }
    ] },
    { start: '11:00', mode: 'full', bookings: [] },
    { start: '12:00', mode: 'full', bookings: [] },
    { start: '13:00', mode: 'full', bookings: [] },
    { start: '14:00', mode: 'full', bookings: [] },
    { start: '15:00', mode: 'third', bookings: [
      { zoneId: 'small-hall-third-1', team: 'HK Zvolen dorast B – tréning' },
      { zoneId: 'small-hall-third-2', team: 'HK Zvolen dorast A – tréning' },
      { zoneId: 'small-hall-third-3', team: 'HK Zvolen juniori – tréning' }
    ] },
    { start: '16:00', mode: 'full', bookings: [
      { zoneId: 'small-hall-full', team: 'Firemná akcia – firemný večierok' }
    ] },
    { start: '17:00', mode: 'full', bookings: [] },
    { start: '18:00', mode: 'half', bookings: [
      { zoneId: 'small-hall-half-a', team: 'Verejné korčuľovanie' },
      { zoneId: 'small-hall-half-b', team: 'Krasokorčuľovanie – dorast' }
    ] },
    { start: '19:00', mode: 'full', bookings: [
      { zoneId: 'small-hall-full', team: 'Liga: HK Zvolen B – HK Detva' }
    ] },
    { start: '20:00', mode: 'full', bookings: [] },
    { start: '21:00', mode: 'full', bookings: [] }
  ]
}

const DURATION_MINUTES = 60

async function createBookingDoc(rinkId, zoneId, start, team) {
  const lockId = `${CLUB_ID}__${zoneId}__${DATE}__${start}`
  const lockRef = db.doc(`slotLocks/${lockId}`)
  const existing = await lockRef.get()
  if (existing.exists) {
    console.log(`  [skip] ${rinkId}/${zoneId} ${start} — already booked (not overwriting a real reservation)`)
    return false
  }

  const bookingRef = db.collection('bookings').doc()
  const entryRef = db.collection('rinkScheduleEntries').doc()

  await lockRef.set({
    clubId: CLUB_ID,
    zoneId,
    date: DATE,
    startTime: start,
    bookingId: bookingRef.id,
    demoSeed: true,
    createdAt: Timestamp.now()
  })

  await bookingRef.set({
    clubId: CLUB_ID,
    rinkId,
    zoneId,
    date: DATE,
    startTime: start,
    durationMinutes: DURATION_MINUTES,
    name: team,
    email: 'demo-seed@arenasrsnov.local',
    phone: '',
    confirmationCode: randomConfirmationCode(),
    cancellationToken: randomToken(),
    tokenExpiresAt: Timestamp.fromDate(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)),
    startAtUtc: Timestamp.fromDate(new Date(`${DATE}T${start}:00${UTC_OFFSET}`)),
    status: 'confirmed',
    demoSeed: true,
    createdAt: Timestamp.now()
  })

  await entryRef.set({
    clubId: CLUB_ID,
    rinkId,
    zoneId,
    teamName: team,
    createdBy: 'demo-seed-script',
    createdByName: 'Demo Seed',
    date: DATE,
    startTime: start,
    durationMinutes: DURATION_MINUTES,
    bookingId: bookingRef.id,
    demoSeed: true,
    createdAt: Timestamp.now()
  })

  console.log(`  ${rinkId}/${zoneId} ${start} — ${team}`)
  return true
}

async function writeOverride(rinkId, slots) {
  const overrideId = `${CLUB_ID}__${rinkId}__${DATE}`
  await db.doc(`scheduleOverrides/${overrideId}`).set({
    clubId: CLUB_ID,
    rinkId,
    date: DATE,
    slots: slots.map((s) => ({ startTime: s.start, durationMinutes: DURATION_MINUTES, mode: s.mode })),
    demoSeed: true,
    updatedAt: Timestamp.now()
  })
  console.log(`  scheduleOverrides/${overrideId} written (${slots.length} slots)`)
}

async function run() {
  console.log(`Seeding demo schedule for ${DATE} (club "${CLUB_ID}"):`)
  let created = 0
  let skipped = 0

  for (const [rinkId, slots] of Object.entries(RINK_PLANS)) {
    for (const slot of slots) {
      for (const b of slot.bookings) {
        const ok = await createBookingDoc(rinkId, b.zoneId, slot.start, b.team)
        if (ok) created++
        else skipped++
      }
    }
  }

  console.log('Writing per-day schedule overrides (so /book offers the right split at each slot):')
  for (const [rinkId, slots] of Object.entries(RINK_PLANS)) {
    await writeOverride(rinkId, slots)
  }

  console.log(`Done. ${created} bookings created, ${skipped} skipped (slot already taken).`)
  console.log('Run scripts/remove-demo-day.mjs afterwards to clean everything back out.')
}

run().then(() => process.exit(0)).catch((err) => {
  console.error(err)
  process.exit(1)
})
