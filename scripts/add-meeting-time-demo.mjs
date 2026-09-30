// One-off: adds two more demo bookings at 11:30 (60 min) on 2026-09-30,
// one per rink, so something's showing during the presenter's own 11:30-
// 12:30 meeting. The Small Hall one is a "match" with separate home/away
// locker rooms to also demo that feature. Same demoSeed-tagged pattern as
// scripts/seed-demo-day.mjs, safe to clean up with remove-demo-day.mjs
// (which already deletes anything demoSeed:true).
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node scripts/add-meeting-time-demo.mjs
import { randomBytes } from 'node:crypto'
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

const CLUB_ID = process.env.VITE_CLUB_ID || 'arena-srsnov'
const DATE = '2026-09-30'
const START = '11:30'
const DURATION_MINUTES = 60
const UTC_OFFSET = '+02:00'

initializeApp({
  credential: process.env.GOOGLE_APPLICATION_CREDENTIALS ? applicationDefault() : cert(JSON.parse(await (await import('node:fs/promises')).readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8')))
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

const ENTRIES = [
  { rinkId: 'main-hall', zoneId: 'main-hall-full', team: 'HK Zvolen – doplnkový tréning', room: 'Šatňa 2' },
  { rinkId: 'small-hall', zoneId: 'small-hall-full', team: 'Prípravný zápas: HK Zvolen – HK Žilina', room: 'Šatňa domácich', awayRoom: 'Šatňa hostí' }
]

async function createEntry(e) {
  const lockId = `${CLUB_ID}__${e.zoneId}__${DATE}__${START}`
  const lockRef = db.doc(`slotLocks/${lockId}`)
  const existing = await lockRef.get()
  if (existing.exists) {
    console.log(`  [skip] ${e.rinkId}/${e.zoneId} ${START} — already booked`)
    return
  }

  const bookingRef = db.collection('bookings').doc()
  const entryRef = db.collection('rinkScheduleEntries').doc()

  await lockRef.set({
    clubId: CLUB_ID,
    zoneId: e.zoneId,
    date: DATE,
    startTime: START,
    bookingId: bookingRef.id,
    demoSeed: true,
    createdAt: Timestamp.now()
  })

  await bookingRef.set({
    clubId: CLUB_ID,
    rinkId: e.rinkId,
    zoneId: e.zoneId,
    date: DATE,
    startTime: START,
    durationMinutes: DURATION_MINUTES,
    name: e.team,
    email: 'demo-seed@arenasrsnov.local',
    phone: '',
    confirmationCode: randomConfirmationCode(),
    cancellationToken: randomToken(),
    tokenExpiresAt: Timestamp.fromDate(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)),
    startAtUtc: Timestamp.fromDate(new Date(`${DATE}T${START}:00${UTC_OFFSET}`)),
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
    startTime: START,
    durationMinutes: DURATION_MINUTES,
    bookingId: bookingRef.id,
    demoSeed: true,
    createdAt: Timestamp.now(),
    ...(e.room ? { room: e.room } : {}),
    ...(e.awayRoom ? { awayRoom: e.awayRoom } : {})
  })

  console.log(`  ${e.rinkId}/${e.zoneId} ${START} — ${e.team}${e.awayRoom ? ` (${e.room} / ${e.awayRoom})` : e.room ? ` (${e.room})` : ''}`)
}

async function run() {
  console.log(`Adding ${START} bookings for ${DATE}:`)
  for (const e of ENTRIES) await createEntry(e)
  console.log('Done.')
}

run().then(() => process.exit(0)).catch((err) => {
  console.error(err)
  process.exit(1)
})
