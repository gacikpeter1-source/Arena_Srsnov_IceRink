import { collection, doc, getDocs, query, updateDoc, where } from 'firebase/firestore'
import { db } from './firebase'
import { StaffRole, StaffUser } from '@/types'

export async function fetchStaffRoster(clubId: string): Promise<StaffUser[]> {
  const snap = await getDocs(query(collection(db, 'staff'), where('clubId', '==', clubId)))
  return snap.docs.map((d) => d.data() as StaffUser)
}

export async function updateStaffRole(uid: string, role: StaffRole): Promise<void> {
  await updateDoc(doc(db, 'staff', uid), { role })
}
