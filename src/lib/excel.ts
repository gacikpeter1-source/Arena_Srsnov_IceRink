import * as XLSX from 'xlsx'
import { Booking, Zone } from '@/types'
import { formatDateISO } from './utils'

// Fixed English headers regardless of UI language — keeps the import/export
// format unambiguous and lets an exported file be re-imported directly.
const HEADERS = {
  date: 'Date',
  time: 'Time',
  duration: 'Duration (min)',
  zone: 'Zone',
  name: 'Name',
  email: 'Email',
  phone: 'Phone',
  status: 'Status',
  confirmationCode: 'Confirmation Code',
  createdAt: 'Created At'
} as const

function toDateSafe(value: unknown): Date | null {
  if (value instanceof Date) return value
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate()
  }
  return null
}

export function exportBookingsToExcel(
  bookings: (Booking & { id: string })[],
  zones: Zone[],
  filename: string
): void {
  const zoneNameById = new Map(zones.map((z) => [z.id, z.name]))

  const rows = bookings.map((b) => ({
    [HEADERS.date]: b.date,
    [HEADERS.time]: b.startTime,
    [HEADERS.duration]: b.durationMinutes,
    [HEADERS.zone]: zoneNameById.get(b.zoneId) ?? b.zoneId,
    [HEADERS.name]: b.name,
    [HEADERS.email]: b.email,
    [HEADERS.phone]: b.phone,
    [HEADERS.status]: b.status,
    [HEADERS.confirmationCode]: b.confirmationCode,
    [HEADERS.createdAt]: toDateSafe(b.createdAt)?.toISOString() ?? ''
  }))

  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Bookings')
  XLSX.writeFile(wb, filename)
}

export interface ImportRow {
  date: string
  startTime: string
  durationMinutes: number
  zoneName: string
  name: string
  email: string
  phone: string
  status: 'confirmed' | 'cancelled'
}

export interface ImportRowError {
  rowNumber: number
  message: string
}

export interface ParsedImport {
  rows: ImportRow[]
  errors: ImportRowError[]
}

function excelValueToDateString(value: unknown): string | null {
  if (value instanceof Date) return formatDateISO(value)
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (!parsed) return null
    return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
    // Common Slovak/European written format: d.m.yyyy
    const euMatch = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
    if (euMatch) {
      const [, d, m, y] = euMatch
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    }
  }
  return null
}

function excelValueToTimeString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    const match = trimmed.match(/^(\d{1,2}):(\d{2})/)
    if (match) return `${match[1].padStart(2, '0')}:${match[2]}`
  }
  if (value instanceof Date) {
    return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
  }
  if (typeof value === 'number') {
    const totalMinutes = Math.round(value * 24 * 60)
    const h = Math.floor(totalMinutes / 60) % 24
    const m = totalMinutes % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }
  return null
}

/**
 * Parses an uploaded .xlsx into candidate booking rows. Doesn't touch
 * Firestore — the caller resolves zone names to zoneIds and runs each row
 * through the normal createBooking transaction (see AdminDashboardPage),
 * so import gets the same atomic double-booking protection as a live
 * customer booking.
 */
export function parseBookingsWorkbook(buffer: ArrayBuffer, defaultDurationMinutes: number): ParsedImport {
  const wb = XLSX.read(buffer)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })

  const rows: ImportRow[] = []
  const errors: ImportRowError[] = []

  raw.forEach((r, i) => {
    const rowNumber = i + 2 // header row + 1-indexing

    const date = excelValueToDateString(r[HEADERS.date])
    const startTime = excelValueToTimeString(r[HEADERS.time])
    const zoneName = String(r[HEADERS.zone] ?? '').trim()
    const name = String(r[HEADERS.name] ?? '').trim()
    const email = String(r[HEADERS.email] ?? '').trim()
    const phone = String(r[HEADERS.phone] ?? '').trim()
    const durationRaw = r[HEADERS.duration]
    const durationMinutes = durationRaw ? Number(durationRaw) : defaultDurationMinutes
    const statusRaw = String(r[HEADERS.status] ?? 'confirmed').trim().toLowerCase()
    const status: ImportRow['status'] = statusRaw === 'cancelled' ? 'cancelled' : 'confirmed'

    if (!date) {
      errors.push({ rowNumber, message: `Invalid or missing "${HEADERS.date}"` })
      return
    }
    if (!startTime) {
      errors.push({ rowNumber, message: `Invalid or missing "${HEADERS.time}"` })
      return
    }
    if (!zoneName) {
      errors.push({ rowNumber, message: `Missing "${HEADERS.zone}"` })
      return
    }
    if (!name || !email || !phone) {
      errors.push({ rowNumber, message: 'Missing Name/Email/Phone' })
      return
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      errors.push({ rowNumber, message: `Invalid "${HEADERS.duration}"` })
      return
    }

    rows.push({ date, startTime, durationMinutes, zoneName, name, email, phone, status })
  })

  return { rows, errors }
}
