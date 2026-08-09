// Bootstraps the first admin account: a Firebase Auth user + matching
// `staff` Firestore doc with role 'admin'. Needed once per club, since
// firestore.rules requires an existing admin to create new `staff` docs —
// this script uses the Admin SDK, which bypasses rules, to break that
// chicken-and-egg problem.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
//   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... ADMIN_NAME="Your Name" \
//   node scripts/create-admin.mjs
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const CLUB_ID = process.env.VITE_CLUB_ID || 'arena-srsnov'
const email = process.env.ADMIN_EMAIL
const password = process.env.ADMIN_PASSWORD
const name = process.env.ADMIN_NAME || 'Admin'

if (!email || !password) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD env vars.')
  process.exit(1)
}

initializeApp({
  credential: process.env.GOOGLE_APPLICATION_CREDENTIALS ? applicationDefault() : cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
})
const auth = getAuth()
const db = getFirestore()

async function run() {
  const user = await auth.createUser({ email, password, displayName: name })

  await db.doc(`staff/${user.uid}`).set({
    clubId: CLUB_ID,
    email,
    name,
    role: 'admin',
    createdAt: new Date()
  })

  console.log(`Created admin ${email} (uid: ${user.uid}) for club "${CLUB_ID}". Sign in at /admin/login.`)
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
