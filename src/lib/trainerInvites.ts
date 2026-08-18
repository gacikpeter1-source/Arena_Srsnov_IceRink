import { collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, runTransaction, serverTimestamp, setDoc, where } from 'firebase/firestore'
import { db } from './firebase'
import { generateToken } from './utils'
import { StaffUser, TrainerInviteCode } from '@/types'

const INVITE_CODE_LENGTH = 12

/**
 * Owner/superadmin-only: generates a single-use code and hands it to one
 * specific person, so trainer accounts can't be created uncontrolled by
 * anyone who finds the signup URL — see firestore.rules for the
 * corresponding isOwnerOrAbove()-gated create rule.
 */
export async function generateTrainerInviteCode(clubId: string, createdBy: string): Promise<string> {
  const code = generateToken(INVITE_CODE_LENGTH)
  await setDoc(doc(db, 'trainerInviteCodes', code), {
    clubId,
    createdBy,
    used: false,
    createdAt: serverTimestamp()
  })
  return code
}

export async function fetchTrainerInviteCodes(clubId: string): Promise<(TrainerInviteCode & { id: string })[]> {
  const snap = await getDocs(query(collection(db, 'trainerInviteCodes'), where('clubId', '==', clubId), orderBy('createdAt', 'desc')))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TrainerInviteCode & { id: string })
}

export async function revokeTrainerInviteCode(code: string): Promise<void> {
  await deleteDoc(doc(db, 'trainerInviteCodes', code))
}

export class InvalidInviteCodeError extends Error {
  constructor() {
    super('This invite code is invalid or has already been used.')
    this.name = 'InvalidInviteCodeError'
  }
}

/**
 * Fast-fail check before even creating the Firebase Auth account — read
 * only, not the actual redemption (see redeemTrainerInviteCode).
 */
export async function checkTrainerInviteCode(code: string): Promise<boolean> {
  const snap = await getDoc(doc(db, 'trainerInviteCodes', code))
  return snap.exists() && snap.data().used === false
}

/**
 * Atomically writes the new trainer's `staff` doc (role stays 'pending'
 * with pendingRole:'trainer' until an owner approves it — see StaffUser)
 * and marks the invite code used, together. Must run AFTER
 * createUserWithEmailAndPassword (Firebase Auth isn't part of a Firestore
 * transaction), which is why AuthContext.signupTrainer deletes the
 * just-created Auth account if this throws — the code lost the race, and
 * a real error should never leave an orphaned account with no staff doc.
 */
export async function redeemTrainerInviteCode(
  code: string,
  staff: Pick<StaffUser, 'uid' | 'clubId' | 'email' | 'name'>
): Promise<void> {
  const codeRef = doc(db, 'trainerInviteCodes', code)
  const staffRef = doc(db, 'staff', staff.uid)

  await runTransaction(db, async (tx) => {
    const codeSnap = await tx.get(codeRef)
    if (!codeSnap.exists() || codeSnap.data().used) {
      throw new InvalidInviteCodeError()
    }

    tx.set(staffRef, {
      uid: staff.uid,
      clubId: staff.clubId,
      email: staff.email,
      name: staff.name,
      role: 'pending',
      pendingRole: 'trainer',
      createdAt: serverTimestamp()
    })

    tx.update(codeRef, {
      used: true,
      usedBy: staff.uid,
      usedAt: serverTimestamp()
    })
  })
}
