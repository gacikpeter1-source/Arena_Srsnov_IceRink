// One-off helper renaming the "k Tabuli" (towards the scoreboard) zones to
// "k časomiere" (towards the timer/game clock) per a follow-up club
// request — same rename-in-place pattern as the earlier Rolbovňa/Tabuľa
// zone rename documented in CLAUDE.md's "Tournaments" section. Updates
// both the canonical English `name` and the Slovak `translations.sk`
// override, on both rinks (main-hall, small-hall) — the physical
// orientation is identical on both, same as the earlier rename. Zones have
// no admin UI, so this follows the same Admin-SDK-script pattern as
// add-zones.mjs/translate-rinks-zones.mjs rather than a throwaway Firestore
// console edit. Safe to re-run — it only ever writes the mapped doc ids
// below, matched by their current `translations.sk` value so it no-ops
// (and says so) if already renamed.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node scripts/rename-zones-casomiera.mjs        # dry run
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node scripts/rename-zones-casomiera.mjs --apply
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const CLUB_ID = process.env.VITE_CLUB_ID || 'arena-srsnov'
const APPLY = process.argv.includes('--apply')

// zoneId -> { fromSk, toName, toSk } — matched by the zone's CURRENT
// translations.sk so this is a no-op (and logs as such) if already applied.
const RENAMES = {
  'main-hall-third-1': { fromSk: 'Tretina k Tabuli', toName: 'Third – Timer Side', toSk: 'Tretina k časomiere' },
  'small-hall-third-1': { fromSk: 'Tretina k Tabuli', toName: 'Third – Timer Side', toSk: 'Tretina k časomiere' },
  'main-hall-half-b': { fromSk: 'Polovica k Tabuli', toName: 'Half – Timer Side', toSk: 'Polovica k časomiere' },
  'small-hall-half-b': { fromSk: 'Polovica k Tabuli', toName: 'Half – Timer Side', toSk: 'Polovica k časomiere' }
}

initializeApp({
  credential: process.env.GOOGLE_APPLICATION_CREDENTIALS ? applicationDefault() : cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
})
const db = getFirestore()

async function run() {
  console.log(APPLY ? 'Applying renames...' : 'Dry run (pass --apply to write) —')
  for (const [zoneId, { fromSk, toName, toSk }] of Object.entries(RENAMES)) {
    const ref = db.doc(`zones/${zoneId}`)
    const snap = await ref.get()
    if (!snap.exists) {
      console.log(`  [skip] ${zoneId} — doc not found`)
      continue
    }
    const data = snap.data()
    if (data.clubId !== CLUB_ID) {
      console.log(`  [skip] ${zoneId} — clubId mismatch ("${data.clubId}")`)
      continue
    }
    if (data.translations?.sk !== fromSk) {
      console.log(`  [skip] ${zoneId} — current sk is "${data.translations?.sk}", expected "${fromSk}" (already renamed?)`)
      continue
    }
    console.log(`  ${zoneId} — "${data.name}" / "${data.translations.sk}" -> "${toName}" / "${toSk}"`)
    if (APPLY) {
      await ref.update({ name: toName, translations: { ...data.translations, sk: toSk } })
    }
  }
  console.log(APPLY ? 'Done.' : 'Dry run complete — re-run with --apply to write these changes.')
}

run().then(() => process.exit(0)).catch((err) => {
  console.error(err)
  process.exit(1)
})
