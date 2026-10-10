import { doc, updateDoc } from 'firebase/firestore'
import { db } from './firebase'

export interface ClubInfoUpdate {
  name: string
  email: string
  phone: string
  address: string
  website: string
}

/**
 * Owner/superadmin-only (enforced by the isOwnerOrAbove Firestore rule on
 * /clubs/{clubId}): updates the club's public name and contact details —
 * the same fields shown in the app header and its contact bar. Written as
 * dot-notation field paths so an empty string just clears that one field
 * instead of replacing the whole contact object.
 */
export async function updateClubInfo(clubId: string, update: ClubInfoUpdate): Promise<void> {
  await updateDoc(doc(db, 'clubs', clubId), {
    name: update.name,
    'contact.email': update.email,
    'contact.phone': update.phone,
    'contact.address': update.address,
    'contact.website': update.website
  })
}

/**
 * Owner/superadmin-only, same rule as updateClubInfo above. Set from
 * AdminQrPanel.tsx's "free ice list" QR section rather than the general
 * club-settings panel, since it's specifically the number the public free
 * ice list's SMS reservation button texts — see Club.freeIceSmsPhone.
 */
export async function updateFreeIceSmsPhone(clubId: string, phone: string): Promise<void> {
  await updateDoc(doc(db, 'clubs', clubId), { freeIceSmsPhone: phone })
}
