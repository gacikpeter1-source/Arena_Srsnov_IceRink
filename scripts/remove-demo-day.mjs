// Companion to scripts/seed-demo-day.mjs — deletes every doc that script
// tagged `demoSeed: true` across bookings/slotLocks/rinkScheduleEntries,
// and nothing else. Safe to run even if some docs were already removed
// manually (e.g. by cancelling one from the admin UI during the demo).
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node scripts/remove-demo-day.mjs
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

initializeApp({
  credential: process.env.GOOGLE_APPLICATION_CREDENTIALS ? applicationDefault() : cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
})
const db = getFirestore()

const COLLECTIONS = ['bookings', 'slotLocks', 'rinkScheduleEntries']

async function deleteTagged(collectionName) {
  const snap = await db.collection(collectionName).where('demoSeed', '==', true).get()
  if (snap.empty) {
    console.log(`${collectionName}: nothing to delete`)
    return
  }
  const batch = db.batch()
  snap.docs.forEach((d) => batch.delete(d.ref))
  await batch.commit()
  console.log(`${collectionName}: deleted ${snap.size} doc(s)`)
}

async function run() {
  console.log('Removing demo-seeded data...')
  for (const collectionName of COLLECTIONS) {
    await deleteTagged(collectionName)
  }
  console.log('Done.')
}

run().then(() => process.exit(0)).catch((err) => {
  console.error(err)
  process.exit(1)
})
