import { collection, deleteDoc, doc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore'
import { db } from './firebase'
import { PhoneQrCode } from '@/types'

// Staff-managed "call this number" QR codes — see PhoneQrCode in
// src/types/index.ts for the full shape/reasoning. Plain CRUD, same
// pattern as lib/freeIceSlots.ts: no conflict-checking or atomic
// transaction needed, since nothing here reserves anything.

export interface PhoneQrCodeFields {
  label: string
  phone: string
}

export async function createPhoneQrCode(
  input: PhoneQrCodeFields & { clubId: string; createdBy: string; createdByName: string }
): Promise<string> {
  const ref = doc(collection(db, 'phoneQrCodes'))
  await setDoc(ref, {
    clubId: input.clubId,
    label: input.label,
    phone: input.phone,
    showOnStriedacka: false,
    createdBy: input.createdBy,
    createdByName: input.createdByName,
    createdAt: serverTimestamp()
  })
  return ref.id
}

export async function setPhoneQrCodeShowOnStriedacka(id: string, show: boolean): Promise<void> {
  await updateDoc(doc(db, 'phoneQrCodes', id), { showOnStriedacka: show })
}

export async function deletePhoneQrCode(id: string): Promise<void> {
  await deleteDoc(doc(db, 'phoneQrCodes', id))
}

export async function fetchPhoneQrCodes(clubId: string): Promise<(PhoneQrCode & { id: string })[]> {
  const snap = await getDocs(query(collection(db, 'phoneQrCodes'), where('clubId', '==', clubId)))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PhoneQrCode & { id: string })
}
