import { collection, deleteField, doc, getDocs, query, updateDoc, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from './firebase'
import { StaffRole, StaffUser } from '@/types'

export async function fetchStaffRoster(clubId: string): Promise<StaffUser[]> {
  const snap = await getDocs(query(collection(db, 'staff'), where('clubId', '==', clubId)))
  return snap.docs.map((d) => d.data() as StaffUser)
}

export async function updateStaffRole(uid: string, role: StaffRole): Promise<void> {
  await updateDoc(doc(db, 'staff', uid), { role })
}

// Grants or revokes trainer access independently of `role` — an account
// can hold both an ice-rink role (e.g. 'assistant') and isTrainer:true at
// once. Also clears pendingRole, since a granted/revoked account is no
// longer "awaiting trainer approval" either way.
export async function setTrainerAccess(uid: string, isTrainer: boolean): Promise<void> {
  await updateDoc(doc(db, 'staff', uid), { isTrainer, pendingRole: deleteField() })
}

// Deletes a staff account for real — Firestore doc AND the Firebase Auth
// account — unlike updateStaffRole('pending') ("Revoke"), which only zeroes
// out permissions but keeps the account able to sign in. Removing the Auth
// half needs the Admin SDK (a client can't delete another user's Auth
// account), so this goes through a Cloud Function — see
// functions/src/index.ts's deleteStaffAccount for the permission checks.
const deleteStaffAccountCallable = httpsCallable<{ uid: string }, void>(functions, 'deleteStaffAccount')

export async function deleteStaffAccount(uid: string): Promise<void> {
  await deleteStaffAccountCallable({ uid })
}
