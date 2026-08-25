import * as XLSX from 'xlsx'
import { Booking, Rink, Zone } from '@/types'
import { formatDateISO } from './utils'

// Fixed English headers regardless of UI language — keeps the import/export
// format unambiguous and lets an exported file be re-imported directly.
const HEADERS = {
  date: 'Date',
  time: 'Time',
  duration: 'Duration (min)',
  rink: 'Rink',
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
  rinks: Rink[],
  zones: Zone[],
  filename: string
): void {
  const rinkNameById = new Map(rinks.map((r) => [r.id, r.name]))
  const zoneNameById = new Map(zones.map((z) => [z.id, z.name]))

  const rows = bookings.map((b) => ({
    [HEADERS.date]: b.date,
    [HEADERS.time]: b.startTime,
    [HEADERS.duration]: b.durationMinutes,
    [HEADERS.rink]: rinkNameById.get(b.rinkId) ?? b.rinkId,
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

// Columns parseBookingsWorkbook actually reads on import — leaves out
// Confirmation Code / Created At, which only ever make sense as export
// output (parseBookingsWorkbook generates a fresh confirmation code per
// row and ignores any existing one).
const IMPORT_HEADERS = [
  HEADERS.date,
  HEADERS.time,
  HEADERS.duration,
  HEADERS.rink,
  HEADERS.zone,
  HEADERS.name,
  HEADERS.email,
  HEADERS.phone,
  HEADERS.status
]

/**
 * A blank workbook with just the header row parseBookingsWorkbook expects
 * — handy for bulk-adding a recurring group booking (e.g. a kindergarten
 * course's weekly slot) by filling in one row per date rather than using
 * the one-at-a-time create form or the repeat-booking option.
 */
export function downloadImportTemplate(filename = 'reservation-import-template.xlsx'): void {
  const ws = XLSX.utils.aoa_to_sheet([IMPORT_HEADERS])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Bookings')
  XLSX.writeFile(wb, filename)
}

export interface ImportRow {
  date: string
  startTime: string
  durationMinutes: number
  rinkName: string
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
 * Firestore — the caller resolves rink+zone names to rinkId/zoneId and runs
 * each row through the normal createBooking transaction (see
 * AdminDashboardPage), so import gets the same atomic double-booking
 * protection as a live customer booking. Rink name is required because
 * zone names (e.g. "Full Rink") are only unique within a rink, not
 * club-wide.
 */
export function parseBookingsWorkbook(buffer: ArrayBuffer): ParsedImport {
  const wb = XLSX.read(buffer)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })

  const rows: ImportRow[] = []
  const errors: ImportRowError[] = []

  raw.forEach((r, i) => {
    const rowNumber = i + 2 // header row + 1-indexing

    const date = excelValueToDateString(r[HEADERS.date])
    const startTime = excelValueToTimeString(r[HEADERS.time])
    const rinkName = String(r[HEADERS.rink] ?? '').trim()
    const zoneName = String(r[HEADERS.zone] ?? '').trim()
    const name = String(r[HEADERS.name] ?? '').trim()
    const email = String(r[HEADERS.email] ?? '').trim()
    const phone = String(r[HEADERS.phone] ?? '').trim()
    const durationMinutes = Number(r[HEADERS.duration])
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
    if (!rinkName) {
      errors.push({ rowNumber, message: `Missing "${HEADERS.rink}"` })
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
      errors.push({ rowNumber, message: `Invalid or missing "${HEADERS.duration}"` })
      return
    }

    rows.push({ date, startTime, durationMinutes, rinkName, zoneName, name, email, phone, status })
  })

  return { rows, errors }
}

// A separate, smaller import format from the booking one above — sets a
// rink's per-date schedule (see src/lib/scheduleOverrides.ts) rather than
// creating bookings. One row per session; multiple rows sharing the same
// Rink+Date together become that date's full slot list (a full replace,
// same as the manual day editor's Save).
const SCHEDULE_HEADERS = {
  rink: 'Rink',
  date: 'Date',
  startTime: 'Start Time',
  duration: 'Duration (min)'
} as const

const SCHEDULE_IMPORT_HEADERS = [SCHEDULE_HEADERS.rink, SCHEDULE_HEADERS.date, SCHEDULE_HEADERS.startTime, SCHEDULE_HEADERS.duration]

export function downloadScheduleImportTemplate(filename = 'schedule-import-template.xlsx'): void {
  const ws = XLSX.utils.aoa_to_sheet([SCHEDULE_IMPORT_HEADERS])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Schedule')
  XLSX.writeFile(wb, filename)
}

export interface ScheduleImportRow {
  rinkName: string
  date: string
  startTime: string
  durationMinutes: number
}

export interface ParsedScheduleImport {
  rows: ScheduleImportRow[]
  errors: ImportRowError[]
}

/**
 * Parses an uploaded .xlsx into candidate schedule rows — one session per
 * row. Doesn't touch Firestore; the caller (AdminSchedulePanel) resolves
 * rink names to rinkId, groups rows by rinkId+date, sorts each group by
 * start time, and writes one scheduleOverrides doc per date via
 * saveScheduleOverride — a full replace of that date's slot list, same as
 * uploading the manual day editor's Save.
 */
export function parseScheduleWorkbook(buffer: ArrayBuffer): ParsedScheduleImport {
  const wb = XLSX.read(buffer)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })

  const rows: ScheduleImportRow[] = []
  const errors: ImportRowError[] = []

  raw.forEach((r, i) => {
    const rowNumber = i + 2

    const rinkName = String(r[SCHEDULE_HEADERS.rink] ?? '').trim()
    const date = excelValueToDateString(r[SCHEDULE_HEADERS.date])
    const startTime = excelValueToTimeString(r[SCHEDULE_HEADERS.startTime])
    const durationMinutes = Number(r[SCHEDULE_HEADERS.duration])

    if (!rinkName) {
      errors.push({ rowNumber, message: `Missing "${SCHEDULE_HEADERS.rink}"` })
      return
    }
    if (!date) {
      errors.push({ rowNumber, message: `Invalid or missing "${SCHEDULE_HEADERS.date}"` })
      return
    }
    if (!startTime) {
      errors.push({ rowNumber, message: `Invalid or missing "${SCHEDULE_HEADERS.startTime}"` })
      return
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      errors.push({ rowNumber, message: `Invalid or missing "${SCHEDULE_HEADERS.duration}"` })
      return
    }

    rows.push({ rinkName, date, startTime, durationMinutes })
  })

  return { rows, errors }
}

// Tournament team import — one team name per row. This parser only flags
// a name repeated within the same file (an obvious copy-paste mistake);
// the caller (lib/tournaments.ts's createTournamentTeam) separately
// checks each name case-insensitively against the tournament's already-
// saved teams, since that check needs a live Firestore read this parser
// doesn't have access to.
const TEAM_HEADERS = {
  name: 'Team Name'
} as const

const TEAM_IMPORT_HEADERS = [TEAM_HEADERS.name]

export function downloadTeamImportTemplate(filename = 'tournament-teams-template.xlsx'): void {
  const ws = XLSX.utils.aoa_to_sheet([TEAM_IMPORT_HEADERS])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Teams')
  XLSX.writeFile(wb, filename)
}

export interface TeamImportRow {
  name: string
}

export interface ParsedTeamImport {
  rows: TeamImportRow[]
  errors: ImportRowError[]
}

export function parseTeamsWorkbook(buffer: ArrayBuffer): ParsedTeamImport {
  const wb = XLSX.read(buffer)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })

  const rows: TeamImportRow[] = []
  const errors: ImportRowError[] = []
  const seenNames = new Set<string>()

  raw.forEach((r, i) => {
    const rowNumber = i + 2
    const name = String(r[TEAM_HEADERS.name] ?? '').trim()
    if (!name) {
      errors.push({ rowNumber, message: `Missing "${TEAM_HEADERS.name}"` })
      return
    }
    const key = name.toLowerCase()
    if (seenNames.has(key)) {
      errors.push({ rowNumber, message: `Duplicate team name "${name}" in this file` })
      return
    }
    seenNames.add(key)
    rows.push({ name })
  })

  return { rows, errors }
}

// Bulk match-schedule import for a tournament — built for the "away"
// case (Tournament.location === 'other'): a club's own team travels to
// a multi-team tournament run entirely by someone else, arriving as a
// printed poster/table with dozens of matches at fixed times. Typing
// each one through the one-at-a-time "Add match" form doesn't scale, so
// this reads a whole schedule at once. Scoped to `location: 'other'`
// only (one shared venue name entered once in the UI, not per row) —
// an on-ice tournament already has the round-robin/knockout/groups
// generators plus rink/zone-aware manual add, which this doesn't
// attempt to replace.
//
// A blank "Group" cell is deliberate, not an error: a placement/play-off
// row (e.g. "o 9.-10. miesto") is scheduled before the group stage
// finishes, so its "teams" are really just rank placeholders like "A5"/
// "B5" — text only, never resolved against the team roster or fed into
// a standings table. Only a row with a real Group letter gets its teams
// created/matched in `tournamentTeams` and tagged `schema: 'groups'` so
// it feeds the live standings table.
const MATCH_HEADERS = {
  date: 'Date',
  startTime: 'Start Time',
  duration: 'Duration (min)',
  group: 'Group',
  teamA: 'Team A',
  teamB: 'Team B'
} as const

const MATCH_IMPORT_HEADERS = [
  MATCH_HEADERS.date,
  MATCH_HEADERS.startTime,
  MATCH_HEADERS.duration,
  MATCH_HEADERS.group,
  MATCH_HEADERS.teamA,
  MATCH_HEADERS.teamB
]

export function downloadTournamentMatchImportTemplate(filename = 'tournament-matches-template.xlsx'): void {
  const ws = XLSX.utils.aoa_to_sheet([MATCH_IMPORT_HEADERS])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Matches')
  XLSX.writeFile(wb, filename)
}

export interface TournamentMatchImportRow {
  date: string
  startTime: string
  durationMinutes: number
  // Unset = a placement/play-off row not tied to the team roster (see
  // module doc above) — teamA/teamB are then just display text.
  groupId?: string
  teamA: string
  teamB: string
}

export interface ParsedTournamentMatchImport {
  rows: TournamentMatchImportRow[]
  errors: ImportRowError[]
}

export function parseTournamentMatchesWorkbook(buffer: ArrayBuffer): ParsedTournamentMatchImport {
  const wb = XLSX.read(buffer)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })

  const rows: TournamentMatchImportRow[] = []
  const errors: ImportRowError[] = []

  raw.forEach((r, i) => {
    const rowNumber = i + 2

    const date = excelValueToDateString(r[MATCH_HEADERS.date])
    const startTime = excelValueToTimeString(r[MATCH_HEADERS.startTime])
    const durationMinutes = Number(r[MATCH_HEADERS.duration])
    const groupId = String(r[MATCH_HEADERS.group] ?? '').trim()
    const teamA = String(r[MATCH_HEADERS.teamA] ?? '').trim()
    const teamB = String(r[MATCH_HEADERS.teamB] ?? '').trim()

    if (!date) {
      errors.push({ rowNumber, message: `Invalid or missing "${MATCH_HEADERS.date}"` })
      return
    }
    if (!startTime) {
      errors.push({ rowNumber, message: `Invalid or missing "${MATCH_HEADERS.startTime}"` })
      return
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      errors.push({ rowNumber, message: `Invalid or missing "${MATCH_HEADERS.duration}"` })
      return
    }
    if (!teamA || !teamB) {
      errors.push({ rowNumber, message: `Missing "${MATCH_HEADERS.teamA}" or "${MATCH_HEADERS.teamB}"` })
      return
    }

    rows.push({ date, startTime, durationMinutes, groupId: groupId || undefined, teamA, teamB })
  })

  return { rows, errors }
}
