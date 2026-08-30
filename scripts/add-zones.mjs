// One-off helper to add zone documents for a division mode that isn't part
// of the original seed.mjs — e.g. 'halfLengthwise' (added after the club
// went live, see CLAUDE.md's "Tournaments" section). Zones have no admin UI
// (they're set up once and rarely change), so this follows the same
// Admin-SDK-script pattern as seed.mjs/create-superadmin.mjs rather than a
// throwaway Firestore console edit — safe to re-run, it just overwrites the
// same doc IDs.
//
// Reads every active rink for the club and writes a left/right
// 'halfLengthwise' zone pair for each one. Edit MODE/ZONE_NAMES below to
// seed a different mode instead.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node scripts/add-zones.mjs
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const CLUB_ID = process.env.VITE_CLUB_ID || 'arena-srsnov'
const MODE = 'halfLengthwise'
const ZONE_NAMES = ['Half – Left', 'Half – Right'] // slotIndex 0, 1

initializeApp({
  credential: process.env.GOOGLE_APPLICATION_CREDENTIALS ? applicationDefault() : cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
})
const db = getFirestore()

async function addZones() {
  const rinksSnap = await db.collection('rinks').where('clubId', '==', CLUB_ID).where('active', '==', true).get()
  if (rinksSnap.empty) {
    console.log(`No active rinks found for club "${CLUB_ID}" — nothing to do.`)
    return
  }

  for (const rinkDoc of rinksSnap.docs) {
    const rink = rinkDoc.data()
    for (let slotIndex = 0; slotIndex < ZONE_NAMES.length; slotIndex++) {
      const zoneId = `${rinkDoc.id}-${MODE.toLowerCase()}-${slotIndex}`
      await db.doc(`zones/${zoneId}`).set({
        clubId: CLUB_ID,
        rinkId: rinkDoc.id,
        name: ZONE_NAMES[slotIndex],
        mode: MODE,
        slotIndex,
        active: true
      })
      console.log(`  zones/${zoneId} — "${ZONE_NAMES[slotIndex]}" on ${rink.name}`)
    }
  }

  console.log(`Done. Added "${MODE}" zones for ${rinksSnap.size} rink(s). Rename zones/adjust ZONE_NAMES and re-run if needed.`)
}

addZones().then(() => process.exit(0)).catch((err) => {
  console.error(err)
  process.exit(1)
})
