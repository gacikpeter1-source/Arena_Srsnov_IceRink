// Bootstraps (or fixes up) the first superadmin account: a Firebase Auth
// user + matching `staff` Firestore doc with role 'superadmin'. Needed
// once per club, since firestore.rules only lets an existing superadmin
// grant roles to anyone else — this script uses the Admin SDK, which
// bypasses rules, to break that chicken-and-egg problem.
//
// Idempotent by email: if the Auth user already exists (e.g. this is
// re-run to promote an account created under the old 'admin' role, or
// to fix a role that was set some other way), it reuses that user and
// just corrects the `staff` doc's role rather than failing.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
//   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... ADMIN_NAME="Your Name" \
//   node scripts/create-superadmin.mjs
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
  let user
  try {
    user = await auth.getUserByEmail(email)
    console.log(`Found existing Auth user for ${email} (uid: ${user.uid}).`)
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err
    user = await auth.createUser({ email, password, displayName: name })
    console.log(`Created new Auth user for ${email} (uid: ${user.uid}).`)
  }

  await db.doc(`staff/${user.uid}`).set({
    uid: user.uid,
    clubId: CLUB_ID,
    email,
    name,
    role: 'superadmin',
    createdAt: new Date()
  }, { merge: true })

  console.log(`${email} is now superadmin for club "${CLUB_ID}". Sign in at /admin/login.`)
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
