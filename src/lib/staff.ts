import { collection, deleteField, doc, getDocs, query, updateDoc, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from './firebase'
import { StaffRole, StaffUser } from '@/types'

// Shared with the header's signed-in identity badge (App.tsx) and
// AdminStaffPanel's roster table, so the two never drift.
export function roleLabelKey(role: StaffRole): string {
  switch (role) {
    case 'superadmin': return 'admin.roleSuperadmin'
    case 'owner': return 'admin.roleOwner'
    case 'assistant': return 'admin.roleAssistant'
    default: return 'admin.rolePending'
  }
}

export async function fetchStaffRoster(clubId: string): Promise<StaffUser[]> {
  const snap = await getDocs(query(collection(db, 'staff'), where('clubId', '==', clubId)))
  return snap.docs.map((d) => d.data() as StaffUser)
}

// Public (no-login) trainer directory — relies on firestore.rules'
// `allow read: if resource.data.isTrainer == true` filter on /staff, which
// Firestore evaluates per-document for list queries, so this safely
// returns only trainer docs regardless of clubId (each deployment serves
// one club anyway — see CLAUDE.md's multi-tenant model).
export async function fetchTrainers(): Promise<StaffUser[]> {
  const snap = await getDocs(query(collection(db, 'staff'), where('isTrainer', '==', true)))
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
