import * as XLSX from 'xlsx'
import { Booking, DivisionMode, MatchTeamPlaceholder, Rink, Zone } from '@/types'
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
// same as the manual day editor's Save). Mode is optional — blank (or an
// unrecognized value) means 'full', same default as a session that's never
// split in the manual day editor.
const SCHEDULE_HEADERS = {
  rink: 'Rink',
  date: 'Date',
  startTime: 'Start Time',
  duration: 'Duration (min)',
  mode: 'Mode (Full/Half/Third/HalfLengthwise)'
} as const

const SCHEDULE_IMPORT_HEADERS = [
  SCHEDULE_HEADERS.rink,
  SCHEDULE_HEADERS.date,
  SCHEDULE_HEADERS.startTime,
  SCHEDULE_HEADERS.duration,
  SCHEDULE_HEADERS.mode
]

const MODE_BY_LOWERCASE: Record<string, DivisionMode> = {
  full: 'full',
  half: 'half',
  third: 'third',
  halflengthwise: 'halfLengthwise'
}

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
  mode?: DivisionMode
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
    const modeRaw = String(r[SCHEDULE_HEADERS.mode] ?? '').trim().toLowerCase()
    const mode = modeRaw ? MODE_BY_LOWERCASE[modeRaw] : undefined

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

    rows.push({ rinkName, date, startTime, durationMinutes, mode })
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
// "B5" — text only by default, never resolved against the team roster or
// fed into a standings table. Only a row with a real Group letter gets
// its teams created/matched in `tournamentTeams` and tagged
// `schema: 'groups'` so it feeds the live standings table.
//
// Since a blank-Group cell's "team" is never a real roster name, its text
// can instead use one of three placeholder codes that
// lib/tournaments.ts's resolveMatchPlaceholder later substitutes for the
// real name once it's knowable, live, with no extra step:
//   - "<Group><rank>" (e.g. "A5") — whichever team currently holds that
//     rank in that group's standings.
//   - "W:<label>" — the winner of the row elsewhere in this same import
//     (or an earlier one) whose own Label column is exactly <label>.
//   - "L:<label>" — that same row's loser.
// Anything else is kept as plain literal text (e.g. "Víťaz turnaja z
// minulého roka") with no placeholder — resolveMatchPlaceholder is never
// consulted for it, so it just always displays as typed.
const MATCH_HEADERS = {
  date: 'Date',
  startTime: 'Start Time',
  duration: 'Duration (min)',
  group: 'Group',
  teamA: 'Team A',
  teamB: 'Team B',
  label: 'Label'
} as const

const MATCH_IMPORT_HEADERS = [
  MATCH_HEADERS.date,
  MATCH_HEADERS.startTime,
  MATCH_HEADERS.duration,
  MATCH_HEADERS.group,
  MATCH_HEADERS.teamA,
  MATCH_HEADERS.teamB,
  MATCH_HEADERS.label
]

export function downloadTournamentMatchImportTemplate(filename = 'tournament-matches-template.xlsx'): void {
  const ws = XLSX.utils.aoa_to_sheet([MATCH_IMPORT_HEADERS])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Matches')
  XLSX.writeFile(wb, filename)
}

const GROUP_RANK_PATTERN = /^([A-Za-z]+)(\d+)$/
const WINNER_OF_PATTERN = /^w:(.+)$/i
const LOSER_OF_PATTERN = /^l:(.+)$/i

function parseTeamPlaceholder(cellText: string): MatchTeamPlaceholder | undefined {
  const winnerMatch = cellText.match(WINNER_OF_PATTERN)
  if (winnerMatch) return { kind: 'winnerOf', label: winnerMatch[1].trim() }
  const loserMatch = cellText.match(LOSER_OF_PATTERN)
  if (loserMatch) return { kind: 'loserOf', label: loserMatch[1].trim() }
  const rankMatch = cellText.match(GROUP_RANK_PATTERN)
  if (rankMatch) return { kind: 'groupRank', groupId: rankMatch[1], rank: Number(rankMatch[2]) }
  return undefined
}

export interface TournamentMatchImportRow {
  date: string
  startTime: string
  durationMinutes: number
  // Unset = a placement/play-off row not tied to the team roster (see
  // module doc above) — teamA/teamB are then just display text, possibly
  // a placeholder code.
  groupId?: string
  teamA: string
  teamB: string
  // Set when a blank-Group row's Team A/B cell used placeholder syntax —
  // teamA/teamB still hold the original literal text as a fallback.
  teamAPlaceholder?: MatchTeamPlaceholder
  teamBPlaceholder?: MatchTeamPlaceholder
  label?: string
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
    const label = String(r[MATCH_HEADERS.label] ?? '').trim()

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

    rows.push({
      date,
      startTime,
      durationMinutes,
      groupId: groupId || undefined,
      teamA,
      teamB,
      ...(groupId ? {} : { teamAPlaceholder: parseTeamPlaceholder(teamA), teamBPlaceholder: parseTeamPlaceholder(teamB) }),
      label: label || undefined
    })
  })

  return { rows, errors }
}

// ---------------------------------------------------------------------
// Rink team schedule bulk import (see CLAUDE.md's "Rink team schedule"
// section) — each row is one non-recurring occurrence, same "bulk = many
// individual rows, recurrence stays a manual-form-only concept" stance
// the tournament match import above already takes.
//
// Unlike the booking/tournament-match importers, this one is explicitly
// meant to be hand-typed (including as a plain .csv/.txt file, not just
// a generated .xlsx — see parseRinkScheduleWorkbook), so its columns are
// plain Slovak words (no diacritics, to survive a plain-text file with no
// guaranteed encoding) rather than the fixed English headers those other
// importers deliberately keep for language-independent re-import. "Hala"
// is a small integer (1, 2, ...) naming a rink by its position — not the
// rink's own name — since staff already think of the club's two rinks as
// "Hala 1"/"Hala 2" (see the rink-rename note in the "Multiple rinks"
// section) and typing a bare number is far less error-prone by hand than
// typing a rink's full name. "Ihrisko" (which part of the ice) is free
// text and optional — left blank, the row books the whole rink; filled
// in, it's matched against the zone's name, its Slovak translation, or
// (for a split zone) the same A/B/C letter RinkScheduleBoardPage.tsx's TV
// board now shows for exactly this purpose. "Trvanie" (duration, minutes)
// is optional too — left blank, the row books
// RINK_SCHEDULE_IMPORT_DEFAULT_DURATION_MINUTES (60, matching the manual
// create form's own default) rather than erroring, so a hand-typed sheet
// of same-length sessions doesn't need to restate the same number on
// every line.
// ---------------------------------------------------------------------

const RINK_SCHEDULE_HEADERS = {
  rink: 'Hala',
  team: 'Nazov',
  date: 'Datum',
  startTime: 'Cas',
  duration: 'Trvanie',
  room: 'Satna',
  zonePart: 'Ihrisko'
} as const

const RINK_SCHEDULE_IMPORT_HEADERS = [
  RINK_SCHEDULE_HEADERS.rink,
  RINK_SCHEDULE_HEADERS.team,
  RINK_SCHEDULE_HEADERS.date,
  RINK_SCHEDULE_HEADERS.startTime,
  RINK_SCHEDULE_HEADERS.duration,
  RINK_SCHEDULE_HEADERS.room,
  RINK_SCHEDULE_HEADERS.zonePart
]

// One concrete example row shown right under the header row in the
// downloaded template, so staff hand-typing further rows have a working
// sample to copy the format from. Duration left blank to also demonstrate
// the 60-minute default.
const RINK_SCHEDULE_EXAMPLE_ROW = [1, 'Gaca', '01.10.2026', '21:45', '', 'Satna 5', '']

// What a blank "Trvanie" column books — same default the manual create
// form itself starts at.
export const RINK_SCHEDULE_IMPORT_DEFAULT_DURATION_MINUTES = 60

export function downloadRinkScheduleImportTemplate(filename = 'rink-schedule-template.xlsx'): void {
  const ws = XLSX.utils.aoa_to_sheet([RINK_SCHEDULE_IMPORT_HEADERS, RINK_SCHEDULE_EXAMPLE_ROW])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Schedule')
  XLSX.writeFile(wb, filename)
}

export interface RinkScheduleImportRow {
  // 1-based position among the club's rinks (sorted by Rink.sortOrder) —
  // resolved to a real rinkId by the caller, which has the live Rink list;
  // this pure parser never touches Firestore.
  rinkNumber: number
  teamName: string
  date: string
  startTime: string
  durationMinutes: number
  room?: string
  // Free text naming which part of the ice — blank means the whole rink.
  // Resolved by the caller against a zone's name/translation/A-B-C letter.
  zonePart?: string
}

export interface ParsedRinkScheduleImport {
  rows: RinkScheduleImportRow[]
  errors: ImportRowError[]
}

// Case-insensitive header lookup. The other importers on this page match
// their (fixed, generated-only) header text exactly, but this one is
// explicitly meant to also support a hand-typed plain-text file — nobody
// hand-typing "cas" or "CAS" should get a spurious "missing column" error
// over casing alone.
function getFieldCI(row: Record<string, unknown>, header: string): unknown {
  const key = Object.keys(row).find((k) => k.trim().toLowerCase() === header.toLowerCase())
  return key !== undefined ? row[key] : undefined
}

// A hand-typed .csv/.txt row is parsed by hand too, deliberately not via
// XLSX.read(text, {type: 'string'}) — SheetJS's CSV reader guesses cell
// types from the raw text (numbers, and dates via its own MM.DD.YYYY-
// leaning heuristic), which silently mis-parsed "01.10.2026" as 10
// January instead of 1 October during testing. A plain string split
// keeps every cell exactly the text that was typed, which is also what
// excelValueToDateString/excelValueToTimeString's own "d.m.yyyy"/"HH:mm"
// string branches already expect. No quoted-field support (a comma
// inside a name would break it) — out of scope for a hand-typed row in
// this simple a format.
function parseSimpleCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0)
  if (lines.length === 0) return []
  const headers = lines[0].split(',').map((h) => h.trim())
  return lines.slice(1).map((line) => {
    const cells = line.split(',')
    const row: Record<string, string> = {}
    headers.forEach((header, i) => {
      row[header] = (cells[i] ?? '').trim()
    })
    return row
  })
}

// Accepts either a parsed .xlsx (ArrayBuffer) or the raw text of a
// comma-separated .csv/.txt file typed by hand in exactly the same
// column order as the template.
export function parseRinkScheduleWorkbook(input: ArrayBuffer | string): ParsedRinkScheduleImport {
  let raw: Record<string, unknown>[]
  if (typeof input === 'string') {
    raw = parseSimpleCsv(input)
  } else {
    const wb = XLSX.read(input)
    const ws = wb.Sheets[wb.SheetNames[0]]
    raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
  }

  const rows: RinkScheduleImportRow[] = []
  const errors: ImportRowError[] = []

  raw.forEach((r, i) => {
    const rowNumber = i + 2

    const rinkNumber = Number(String(getFieldCI(r, RINK_SCHEDULE_HEADERS.rink) ?? '').trim())
    const teamName = String(getFieldCI(r, RINK_SCHEDULE_HEADERS.team) ?? '').trim()
    const date = excelValueToDateString(getFieldCI(r, RINK_SCHEDULE_HEADERS.date))
    const startTime = excelValueToTimeString(getFieldCI(r, RINK_SCHEDULE_HEADERS.startTime))
    const durationRaw = String(getFieldCI(r, RINK_SCHEDULE_HEADERS.duration) ?? '').trim()
    const room = String(getFieldCI(r, RINK_SCHEDULE_HEADERS.room) ?? '').trim()
    const zonePart = String(getFieldCI(r, RINK_SCHEDULE_HEADERS.zonePart) ?? '').trim()

    if (!Number.isInteger(rinkNumber) || rinkNumber < 1) {
      errors.push({ rowNumber, message: `Invalid or missing "${RINK_SCHEDULE_HEADERS.rink}"` })
      return
    }
    if (!teamName) {
      errors.push({ rowNumber, message: `Missing "${RINK_SCHEDULE_HEADERS.team}"` })
      return
    }
    if (!date) {
      errors.push({ rowNumber, message: `Invalid or missing "${RINK_SCHEDULE_HEADERS.date}"` })
      return
    }
    if (!startTime) {
      errors.push({ rowNumber, message: `Invalid or missing "${RINK_SCHEDULE_HEADERS.startTime}"` })
      return
    }
    let durationMinutes = RINK_SCHEDULE_IMPORT_DEFAULT_DURATION_MINUTES
    if (durationRaw) {
      const parsed = Number(durationRaw)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        errors.push({ rowNumber, message: `Invalid "${RINK_SCHEDULE_HEADERS.duration}"` })
        return
      }
      durationMinutes = parsed
    }

    rows.push({ rinkNumber, teamName, date, startTime, durationMinutes, room: room || undefined, zonePart: zonePart || undefined })
  })

  return { rows, errors }
}

// ---------------------------------------------------------------------
// Free-ice-for-rent bulk import (see CLAUDE.md's "Free ice import becomes
// the public booking source" note) — a club receives this data as an
// Excel/CSV/TXT file from whoever maintains it, so this mirrors
// parseRinkScheduleWorkbook's conventions exactly: plain ASCII Slovak
// headers (hand-typeable, survive a plain-text file with no guaranteed
// encoding), "Hala" a 1-based rink position rather than a name, and the
// same .xlsx/.csv/.txt dual input + parseSimpleCsv text path (SheetJS's
// own CSV date-guessing already proved unreliable for d.m.yyyy strings —
// see parseRinkScheduleWorkbook's doc comment). Unlike that importer,
// "Od"/"Do" (start/end time) are both required — a free-ice slot has no
// club-wide default duration to fall back to the way a rink-schedule
// entry does.
// ---------------------------------------------------------------------

const FREE_ICE_HEADERS = {
  rink: 'Hala',
  date: 'Datum',
  startTime: 'Od',
  endTime: 'Do',
  zone: 'Zona',
  note: 'Cena'
} as const

const FREE_ICE_IMPORT_HEADERS = [
  FREE_ICE_HEADERS.rink,
  FREE_ICE_HEADERS.date,
  FREE_ICE_HEADERS.startTime,
  FREE_ICE_HEADERS.endTime,
  FREE_ICE_HEADERS.zone,
  FREE_ICE_HEADERS.note
]

const FREE_ICE_EXAMPLE_ROW = [1, '04.10.2026', '06:00', '07:00', '', '']

export function downloadFreeIceImportTemplate(filename = 'volne-lady-template.xlsx'): void {
  const ws = XLSX.utils.aoa_to_sheet([FREE_ICE_IMPORT_HEADERS, FREE_ICE_EXAMPLE_ROW])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'VolneLady')
  XLSX.writeFile(wb, filename)
}

export interface FreeIceImportRow {
  // 1-based position among the club's rinks (sorted by Rink.sortOrder) —
  // resolved to a real rinkId by the caller, same as RinkScheduleImportRow.
  rinkNumber: number
  date: string
  startTime: string
  endTime: string
  // Free text naming which zone is open — blank means the whole rink. The
  // caller additionally recognizes "krajná"/"krajna tretina" (an edge
  // third) and "stredná"/"stredna tretina" (the middle third) as synonyms,
  // on top of matching a real zone's name/translation/A-B-C letter the
  // same way RinkScheduleImportRow.zonePart already does.
  zonePart?: string
  // Free text — price and/or any extra note, e.g. "80 €", "jednorazová
  // akcia – 150 €". No structured price field exists yet (see the
  // payment-scaffold note in CLAUDE.md).
  note?: string
}

export interface ParsedFreeIceImport {
  rows: FreeIceImportRow[]
  errors: ImportRowError[]
}

export function parseFreeIceWorkbook(input: ArrayBuffer | string): ParsedFreeIceImport {
  let raw: Record<string, unknown>[]
  if (typeof input === 'string') {
    raw = parseSimpleCsv(input)
  } else {
    const wb = XLSX.read(input)
    const ws = wb.Sheets[wb.SheetNames[0]]
    raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
  }

  const rows: FreeIceImportRow[] = []
  const errors: ImportRowError[] = []

  raw.forEach((r, i) => {
    const rowNumber = i + 2

    const rinkNumber = Number(String(getFieldCI(r, FREE_ICE_HEADERS.rink) ?? '').trim())
    const date = excelValueToDateString(getFieldCI(r, FREE_ICE_HEADERS.date))
    const startTime = excelValueToTimeString(getFieldCI(r, FREE_ICE_HEADERS.startTime))
    const endTime = excelValueToTimeString(getFieldCI(r, FREE_ICE_HEADERS.endTime))
    const zonePart = String(getFieldCI(r, FREE_ICE_HEADERS.zone) ?? '').trim()
    const note = String(getFieldCI(r, FREE_ICE_HEADERS.note) ?? '').trim()

    if (!Number.isInteger(rinkNumber) || rinkNumber < 1) {
      errors.push({ rowNumber, message: `Invalid or missing "${FREE_ICE_HEADERS.rink}"` })
      return
    }
    if (!date) {
      errors.push({ rowNumber, message: `Invalid or missing "${FREE_ICE_HEADERS.date}"` })
      return
    }
    if (!startTime) {
      errors.push({ rowNumber, message: `Invalid or missing "${FREE_ICE_HEADERS.startTime}"` })
      return
    }
    if (!endTime) {
      errors.push({ rowNumber, message: `Invalid or missing "${FREE_ICE_HEADERS.endTime}"` })
      return
    }

    rows.push({ rinkNumber, date, startTime, endTime, zonePart: zonePart || undefined, note: note || undefined })
  })

  return { rows, errors }
}
