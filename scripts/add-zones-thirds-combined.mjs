// One-off helper adding the 'thirdsCombined' zone pair — two adjacent
// 'third' zones booked as one larger unit — alongside the existing
// full/half/third zones. See DivisionMode's own doc comment in
// src/types/index.ts for why this needed a real cross-mode overlap check
// in lib/rinkConflicts.ts (these two zones physically overlap the plain
// 'third' zones they cover, and each other, in the shared middle third).
// Same Admin-SDK, safe-to-re-run pattern as add-zones.mjs (overwrites the
// same doc ids) — zones have no admin UI, see that script's own comment.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node scripts/add-zones-thirds-combined.mjs
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const CLUB_ID = process.env.VITE_CLUB_ID || 'arena-srsnov'
const MODE = 'thirdsCombined'
// slotIndex 0 covers 'third' slotIndex 0+1 (the časomiera-side pair),
// slotIndex 1 covers 'third' slotIndex 1+2 (the rolbovňa-side pair) — see
// thirdsCombinedCoverage in lib/rinkConflicts.ts, which this must match.
const ZONES = [
  { name: 'Two Thirds – Timer Side', sk: 'Dve tretiny k časomiere' },
  { name: 'Two Thirds – Resurfacer Side', sk: 'Dve tretiny k rolbovni' }
]

initializeApp({
  credential: process.env.GOOGLE_APPLICATION_CREDENTIALS ? applicationDefault() : cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
})
const db = getFirestore()

async function run() {
  const rinksSnap = await db.collection('rinks').where('clubId', '==', CLUB_ID).where('active', '==', true).get()
  if (rinksSnap.empty) {
    console.log(`No active rinks found for club "${CLUB_ID}" — nothing to do.`)
    return
  }

  for (const rinkDoc of rinksSnap.docs) {
    const rink = rinkDoc.data()
    for (let slotIndex = 0; slotIndex < ZONES.length; slotIndex++) {
      const zoneId = `${rinkDoc.id}-thirdscombined-${slotIndex}`
      await db.doc(`zones/${zoneId}`).set({
        clubId: CLUB_ID,
        rinkId: rinkDoc.id,
        name: ZONES[slotIndex].name,
        translations: { sk: ZONES[slotIndex].sk },
        mode: MODE,
        slotIndex,
        active: true
      })
      console.log(`  zones/${zoneId} — "${ZONES[slotIndex].name}" / "${ZONES[slotIndex].sk}" on ${rink.name}`)
    }
  }

  console.log(`Done. Added "${MODE}" zones for ${rinksSnap.size} rink(s).`)
}

run().then(() => process.exit(0)).catch((err) => {
  console.error(err)
  process.exit(1)
})
