// One-off migration converting every pre-existing BOUNDED recurring
// RinkScheduleEntry (seriesId set, created via the old count/until-date
// recurrence before the "Donekonečna" feature existed) into the new
// indefinite ("repeatForever") recurrence shape — per explicit club
// request: the owner has only ever used the repeat checkbox for
// genuinely long-term standing bookings, so every existing recurring
// entry should behave as a never-ending repeat going forward.
//
// What this changes, per qualifying entry doc:
//   - sets repeatForever: true
//   - sets frequency: <read from its own bookingSeries doc via seriesId>
//     (the entry doc itself never stored `frequency` under the old
//     creation path — only the separate BookingSeries doc did)
//
// What this deliberately leaves alone:
//   - the entry's existing bookingSeries doc (left as a harmless orphan —
//     nothing reads it back for a RinkScheduleEntry any more, same
//     "orphaned docs left in place" precedent used elsewhere in this
//     codebase, e.g. old divisionRules docs)
//   - every existing Booking occurrence (even a series with MORE than
//     RINK_SCHEDULE_FOREVER_WINDOW (8) future active occurrences is left
//     exactly as-is — topUpForeverRinkScheduleEntries only ever ADDS more
//     once the active count drops below the window, it never removes
//     anything)
//
// Safe to re-run: an entry that already has repeatForever === true is
// skipped.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node scripts/convert-entries-to-forever.mjs          (dry run)
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node scripts/convert-entries-to-forever.mjs --apply  (writes)
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const CLUB_ID = process.env.VITE_CLUB_ID || 'arena-srsnov'
const APPLY = process.argv.includes('--apply')

initializeApp({
  credential: process.env.GOOGLE_APPLICATION_CREDENTIALS ? applicationDefault() : cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
})
const db = getFirestore()

async function run() {
  const entriesSnap = await db.collection('rinkScheduleEntries').where('clubId', '==', CLUB_ID).get()
  const candidates = entriesSnap.docs.filter(d => typeof d.data().seriesId === 'string' && d.data().repeatForever !== true)

  if (candidates.length === 0) {
    console.log('No bounded recurring entries found — nothing to convert.')
    return
  }

  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${candidates.length} bounded recurring entr${candidates.length === 1 ? 'y' : 'ies'} found:\n`)

  let converted = 0
  let skippedNoSeries = 0

  for (const entryDoc of candidates) {
    const entry = entryDoc.data()
    const seriesSnap = await db.doc(`bookingSeries/${entry.seriesId}`).get()
    if (!seriesSnap.exists) {
      console.log(`  SKIP ${entryDoc.id} (${entry.teamName}) — no bookingSeries doc for seriesId ${entry.seriesId}, can't determine frequency`)
      skippedNoSeries++
      continue
    }
    const frequency = seriesSnap.data().frequency
    if (frequency !== 'daily' && frequency !== 'weekly') {
      console.log(`  SKIP ${entryDoc.id} (${entry.teamName}) — bookingSeries has unexpected frequency "${frequency}"`)
      skippedNoSeries++
      continue
    }

    console.log(`  ${entryDoc.id} (${entry.teamName}) -> repeatForever: true, frequency: "${frequency}"`)
    if (APPLY) {
      await entryDoc.ref.update({ repeatForever: true, frequency })
    }
    converted++
  }

  console.log(`\n${APPLY ? 'Converted' : 'Would convert'} ${converted} entr${converted === 1 ? 'y' : 'ies'}.${skippedNoSeries > 0 ? ` Skipped ${skippedNoSeries}.` : ''}`)
  if (!APPLY) console.log('Re-run with --apply to write these changes.')
}

run().then(() => process.exit(0)).catch(err => {
  console.error(err)
  process.exit(1)
})
