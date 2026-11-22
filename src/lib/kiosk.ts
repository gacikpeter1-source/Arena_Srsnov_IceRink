import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from './firebase'
import { KioskOrder, KioskOrderLine, KioskProduct, KioskVariant } from '@/types'
import { generateConfirmationCode, generateToken } from './utils'

// Plain CRUD for the entrance kiosk's product catalog — see KioskProduct in
// src/types/index.ts. Same shape/conventions as lib/freeIceSlots.ts (a
// small staff-curated collection with no transaction/lock semantics of its
// own), but writes are owner/superadmin-only (firestore.rules), not every
// ice-rink staff role.

export interface KioskVariantInput {
  name: string
  price: number
}

export interface KioskProductFields {
  name: string
  variants: KioskVariantInput[]
  active: boolean
  sortOrder: number
}

// Variant ids only ever need to be stable and unique within their own
// product doc (never queried on, never a Firestore doc id) — a short
// random string is enough, no crypto-strength token needed here.
function generateVariantId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function withVariantIds(variants: KioskVariantInput[]): KioskVariant[] {
  return variants.map((v) => ({ id: generateVariantId(), name: v.name, price: v.price }))
}

export async function fetchKioskProducts(clubId: string): Promise<(KioskProduct & { id: string })[]> {
  const snap = await getDocs(query(collection(db, 'kioskProducts'), where('clubId', '==', clubId)))
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as KioskProduct & { id: string })
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

export async function createKioskProduct(
  input: KioskProductFields & { clubId: string; createdBy: string; createdByName: string }
): Promise<string> {
  const ref = doc(collection(db, 'kioskProducts'))
  await setDoc(ref, {
    clubId: input.clubId,
    name: input.name,
    variants: withVariantIds(input.variants),
    active: input.active,
    sortOrder: input.sortOrder,
    createdBy: input.createdBy,
    createdByName: input.createdByName,
    createdAt: serverTimestamp()
  })
  return ref.id
}

// Variants are always replaced wholesale (the edit form re-submits the
// whole list) — a variant kept from before keeps re-using its own id only
// because the caller is expected to pass existing KioskVariant objects
// through unchanged for rows it didn't touch; a brand-new row has no id
// yet (editable: string | undefined on the form state) and gets a fresh
// one here.
export async function updateKioskProduct(
  id: string,
  fields: { name: string; variants: (KioskVariant | KioskVariantInput)[]; active: boolean; sortOrder: number }
): Promise<void> {
  const variants: KioskVariant[] = fields.variants.map((v) =>
    'id' in v && v.id ? v : { id: generateVariantId(), name: v.name, price: v.price }
  )
  await updateDoc(doc(db, 'kioskProducts', id), {
    name: fields.name,
    variants,
    active: fields.active,
    sortOrder: fields.sortOrder
  })
}

export async function setKioskProductActive(id: string, active: boolean): Promise<void> {
  await updateDoc(doc(db, 'kioskProducts', id), { active })
}

export async function deleteKioskProduct(id: string): Promise<void> {
  await deleteDoc(doc(db, 'kioskProducts', id))
}

// ---------------------------------------------------------------------
// Kiosk orders (the customer-facing "select tiles -> pay" flow,
// KioskPage.tsx) — see KioskOrder in src/types/index.ts. Real-money
// payment is handled the same way as training registrations: this module
// only ever creates the 'pending' order doc; createKioskCheckoutSession/
// stripeWebhook (functions/src/payments.ts) are the only things that ever
// move it to 'paid'.
// ---------------------------------------------------------------------

export async function createKioskOrder(input: { clubId: string; lines: KioskOrderLine[] }): Promise<string> {
  const ref = doc(collection(db, 'kioskOrders'))
  await setDoc(ref, {
    clubId: input.clubId,
    lines: input.lines,
    totalAmount: input.lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0),
    currency: 'EUR',
    status: 'pending',
    confirmationCode: generateConfirmationCode(),
    cancellationToken: generateToken(),
    createdAt: serverTimestamp()
  })
  return ref.id
}

export async function fetchKioskOrder(id: string): Promise<(KioskOrder & { id: string }) | null> {
  const snap = await getDoc(doc(db, 'kioskOrders', id))
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as KioskOrder & { id: string }) : null
}

// Staff phone-camera fallback check-in (QrScanPage.tsx) for when the ESP32
// turnstile hardware is down — see gateScanCheckIn's own kiosk branch
// (functions/src/gate.ts) for the primary path. A whole order is always
// checked in as one unit, same as that path.
export async function markKioskOrderCheckIn(orderId: string, checkedInBy: string): Promise<void> {
  await updateDoc(doc(db, 'kioskOrders', orderId), { checkedInAt: serverTimestamp(), checkedInBy })
}

interface CreateKioskCheckoutSessionInput {
  clubId: string
  orderId: string
  appOrigin: string
}

const createKioskCheckoutSessionCallable = httpsCallable<CreateKioskCheckoutSessionInput, { url: string }>(
  functions,
  'createKioskCheckoutSession'
)

export async function createKioskCheckoutSession(input: CreateKioskCheckoutSessionInput): Promise<string> {
  const result = await createKioskCheckoutSessionCallable(input)
  return result.data.url
}

interface SendKioskOrderEmailInput {
  clubId: string
  orderId: string
  email: string
  appOrigin: string
}

const sendKioskOrderEmailCallable = httpsCallable<SendKioskOrderEmailInput, { ok: true }>(functions, 'sendKioskOrderEmail')

export async function sendKioskOrderEmail(input: SendKioskOrderEmailInput): Promise<void> {
  await sendKioskOrderEmailCallable(input)
}
