import * as XLSX from 'xlsx'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import {
  fetchTrainingSessionsInRange,
  fetchTrainingBundlesByIds,
  fetchSessionRegistrations,
  fetchBundleRegistrations,
  fetchTrainerIceLog
} from './training'

// Fixed English headers, same convention as lib/excel.ts.
const SESSION_HEADERS = {
  date: 'Date',
  time: 'Time',
  trainer: 'Trainer',
  type: 'Type',
  title: 'Title',
  capacity: 'Capacity',
  confirmed: 'Confirmed',
  present: 'Present',
  presentNames: 'Present Names'
} as const

const ICE_LOG_HEADERS = {
  date: 'Date',
  trainer: 'Trainer',
  notes: 'Notes'
} as const

export interface GenerateTrainingReportInput {
  clubId: string
  dateFrom: string
  dateTo: string
  // Unset = every trainer. Only applies to registered trainer accounts —
  // a free-text ice-log entry (no trainerId, see TrainerIceLogEntry)
  // is only included when the report isn't filtered to specific trainers.
  trainerIds?: string[]
  generatedBy: string
}

/**
 * Combines two very different sources into one export so an owner can see
 * both sides of "who actually used the ice" for a date range: planned
 * training sessions (with who was marked present) from the calendar, and
 * trainerIceLog entries for ice use with no booked session at all (see
 * CLAUDE.md's "Training reservations" section). Downloads an .xlsx
 * client-side (same lib/excel.ts pattern) and logs a
 * TrainingReportHistory doc for the audit trail — re-downloading a past
 * report isn't built yet (would need the file itself stored somewhere,
 * e.g. Firebase Storage), so the history doc is audit-only for now.
 */
export async function generateTrainingReport(input: GenerateTrainingReportInput): Promise<string> {
  const trainerFilter = input.trainerIds && input.trainerIds.length > 0 ? new Set(input.trainerIds) : null

  const allSessions = await fetchTrainingSessionsInRange(input.clubId, input.dateFrom, input.dateTo)
  const sessions = trainerFilter ? allSessions.filter((s) => s.trainerId && trainerFilter.has(s.trainerId)) : allSessions

  const bundleIds = sessions.filter((s) => s.bundleId).map((s) => s.bundleId as string)
  const bundlesById = await fetchTrainingBundlesByIds(bundleIds)

  const standaloneOrSeries = sessions.filter((s) => !s.bundleId)
  const registrationsBySession = new Map<string, Awaited<ReturnType<typeof fetchSessionRegistrations>>>()
  await Promise.all(
    standaloneOrSeries.map(async (s) => {
      registrationsBySession.set(s.id, await fetchSessionRegistrations(s.id))
    })
  )

  const uniqueBundleIds = Array.from(new Set(sessions.filter((s) => s.bundleId).map((s) => s.bundleId as string)))
  const bundleRegsByBundle = new Map<string, Awaited<ReturnType<typeof fetchBundleRegistrations>>>()
  await Promise.all(
    uniqueBundleIds.map(async (bundleId) => {
      bundleRegsByBundle.set(bundleId, await fetchBundleRegistrations(bundleId))
    })
  )

  const sessionRows = sessions.map((s) => {
    let presentNames: string[] = []
    let confirmedCount = s.confirmedCount
    let capacity = s.capacity

    if (s.bundleId) {
      const bundle = bundlesById.get(s.bundleId)
      confirmedCount = bundle?.confirmedCount ?? confirmedCount
      capacity = bundle?.capacity ?? capacity
      const regs = bundleRegsByBundle.get(s.bundleId) ?? []
      presentNames = regs.filter((r) => r.attendanceBySession?.[s.id]?.checkedIn).map((r) => r.name)
    } else {
      const regs = registrationsBySession.get(s.id) ?? []
      presentNames = regs.filter((r) => r.attendance?.checkedIn).map((r) => r.name)
    }

    return {
      [SESSION_HEADERS.date]: s.date,
      [SESSION_HEADERS.time]: s.startTime,
      [SESSION_HEADERS.trainer]: s.trainerName ?? '',
      [SESSION_HEADERS.type]: s.bundleId ? 'Course/Camp' : s.seriesId ? 'Series' : 'Standalone',
      [SESSION_HEADERS.title]: s.bundleId ? (bundlesById.get(s.bundleId)?.title ?? '') : '',
      [SESSION_HEADERS.capacity]: capacity ?? 'Unlimited',
      [SESSION_HEADERS.confirmed]: confirmedCount,
      [SESSION_HEADERS.present]: presentNames.length,
      [SESSION_HEADERS.presentNames]: presentNames.join(', ')
    }
  })

  const allIceLog = await fetchTrainerIceLog(input.clubId)
  const iceLogRows = allIceLog
    .filter((e) => e.date >= input.dateFrom && e.date <= input.dateTo)
    .filter((e) => !trainerFilter || (e.trainerId && trainerFilter.has(e.trainerId)))
    .map((e) => ({
      [ICE_LOG_HEADERS.date]: e.date,
      [ICE_LOG_HEADERS.trainer]: e.trainerName,
      [ICE_LOG_HEADERS.notes]: e.notes ?? ''
    }))

  const filename = `training-report-${input.dateFrom}-to-${input.dateTo}.xlsx`
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sessionRows), 'Planned Trainings')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(iceLogRows), 'Ice Log (Private)')
  XLSX.writeFile(wb, filename)

  await addDoc(collection(db, 'trainingReportHistory'), {
    clubId: input.clubId,
    generatedBy: input.generatedBy,
    generatedAt: serverTimestamp(),
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    ...(trainerFilter ? { trainerIds: Array.from(trainerFilter) } : {}),
    format: 'xlsx',
    filename
  })

  return filename
}
