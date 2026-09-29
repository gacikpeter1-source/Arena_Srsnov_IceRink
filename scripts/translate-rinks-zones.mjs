// One-off helper that adds a Slovak `translations.sk` override on top of
// every Rink/Zone's existing (English) `name` — see CLAUDE.md's "Bilingual
// rink/zone names" note. Rinks/zones have no admin UI (see add-zones.mjs's
// own comment), so this follows the same Admin-SDK-script pattern rather
// than a throwaway Firestore console edit. Safe to re-run — it only ever
// sets `translations.sk`, never touches `name` or any other field, and a
// name with no entry in the map below is left completely untouched (logged
// as skipped) rather than guessed at.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node scripts/translate-rinks-zones.mjs
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const CLUB_ID = process.env.VITE_CLUB_ID || 'arena-srsnov'

// Keyed by the current English `name` exactly as seeded (see seed.mjs /
// add-zones.mjs) — matched, not assumed by doc id, so this still works if
// a name was ever hand-edited in the console.
const RINK_TRANSLATIONS = {
  'Main Hall': 'Hlavná hala',
  'Small Hall': 'Malá hala'
}

const ZONE_TRANSLATIONS = {
  'Full Rink': 'Celá ľadová plocha',
  'Half A': 'Polovica A',
  'Half B': 'Polovica B',
  'Third 1': 'Tretina 1',
  'Third 2': 'Tretina 2',
  'Third 3': 'Tretina 3',
  'Half – Left': 'Polovica – vľavo',
  'Half – Right': 'Polovica – vpravo'
}

initializeApp({
  credential: process.env.GOOGLE_APPLICATION_CREDENTIALS ? applicationDefault() : cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
})
const db = getFirestore()

async function translateCollection(collectionName, translations) {
  const snap = await db.collection(collectionName).where('clubId', '==', CLUB_ID).get()
  let updated = 0
  let skipped = 0
  for (const doc of snap.docs) {
    const name = doc.data().name
    const sk = translations[name]
    if (!sk) {
      console.log(`  [skip] ${collectionName}/${doc.id} — no translation mapped for "${name}"`)
      skipped++
      continue
    }
    await doc.ref.update({ translations: { sk } })
    console.log(`  ${collectionName}/${doc.id} — "${name}" -> "${sk}"`)
    updated++
  }
  return { updated, skipped }
}

async function run() {
  console.log('Rinks:')
  const rinkResult = await translateCollection('rinks', RINK_TRANSLATIONS)
  console.log('Zones:')
  const zoneResult = await translateCollection('zones', ZONE_TRANSLATIONS)
  console.log(
    `Done. Rinks: ${rinkResult.updated} updated, ${rinkResult.skipped} skipped. ` +
      `Zones: ${zoneResult.updated} updated, ${zoneResult.skipped} skipped.`
  )
}

run().then(() => process.exit(0)).catch((err) => {
  console.error(err)
  process.exit(1)
})
