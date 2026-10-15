import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import QrScanner from 'qr-scanner'
import QrScannerWorkerPath from 'qr-scanner/qr-scanner-worker.min.js?url'
import { collection, doc, getDoc, getDocs, query, Timestamp, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { markSessionAttendance, markBundleSessionAttendance, markSessionTicketCheckIn, markBundleTicketCheckIn } from '@/lib/training'
import { triggerGateOpen } from '@/lib/gate'
import { formatDateISO } from '@/lib/utils'
import { RegistrationTicket, TrainingBundle, TrainingBundleRegistration, TrainingRegistration, TrainingSession } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import BackButton from '@/components/BackButton'

QrScanner.WORKER_PATH = QrScannerWorkerPath

// checkedInAt is written via serverTimestamp() so it arrives as a Firestore
// Timestamp at runtime despite the TS type saying Date (same convention as
// isLockExpired in lib/bookings.ts).
function formatCheckedInAt(checkedInAt: Date | undefined): string {
  if (!checkedInAt) return ''
  return (checkedInAt as unknown as Timestamp).toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

type Result =
  | {
      kind: 'session'
      reg: TrainingRegistration & { id: string }
      session: (TrainingSession & { id: string }) | null
      // Set when the scanned QR names one specific person's own ticket
      // (?ticket=<id> — see RegistrationTicket); null for an older QR that
      // predates per-ticket codes, or a registration with no `tickets` at
      // all, in which case this page falls back to the old whole-
      // registration check-in behavior.
      ticket: RegistrationTicket | null
      // Snapshotted at scan time, never updated afterward — distinguishes
      // "this code was already used on an earlier scan" (real reuse/sharing
      // warning) from "I just marked it present in this very scan". Reads
      // the per-ticket state when `ticket` is set, else the whole-
      // registration `attendance` field (old behavior).
      wasAlreadyCheckedIn: boolean
      wasAlreadyCheckedInAt: Date | undefined
    }
  | {
      kind: 'bundle'
      reg: TrainingBundleRegistration & { id: string }
      bundle: (TrainingBundle & { id: string }) | null
      sessions: (TrainingSession & { id: string })[]
      selectedSessionId: string | null
      ticket: RegistrationTicket | null
      // Snapshotted at scan time, keyed by sessionId — see the session
      // variant's wasAlreadyCheckedIn for why this can't just read the
      // live (locally-mutated) reg.attendanceBySession/ticketCheckInsBySession
      // instead.
      originalAttendanceBySession: TrainingBundleRegistration['attendanceBySession']
      originalTicketCheckInsBySession: TrainingBundleRegistration['ticketCheckInsBySession']
    }
  | { kind: 'unsupported' }
  | { kind: 'invalid' }

/**
 * Entrance QR-scan check-in — a trainer/assistant/owner/superadmin points
 * the device camera at a confirmation QR a customer already got emailed
 * (the training cancel-link URL, see queueTrainingConfirmationEmail/
 * queueBundleConfirmationEmail in lib/email.ts and payments.ts's own
 * ticket-PDF builder). Each person on a registration gets their own QR —
 * one per RegistrationTicket, encoded as the same cancel-link URL plus a
 * `?ticket=<id>` param — so scanning one person's ticket only checks THAT
 * person in, writing per-ticket state via markSessionTicketCheckIn/
 * markBundleTicketCheckIn while also keeping the older whole-registration
 * `attendance`/`attendanceBySession` fields (which TrainerRosterModal.tsx's
 * manual roster still reads) in sync. An older QR with no `?ticket=` param,
 * or a registration with no `tickets` array at all (predates this feature),
 * falls back to the original whole-party check-in in one tap — see
 * CLAUDE.md's "Fáza 5" note for that original rationale. Ice-booking QRs
 * are recognized but not actionable here — Booking has no attendance
 * concept yet.
 */
export default function QrScanPage() {
  const { t } = useTranslation()
  const { user, staff } = useAuth()
  const videoRef = useRef<HTMLVideoElement>(null)
  const scannerRef = useRef<QrScanner | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [cameraError, setCameraError] = useState(false)

  const canScan = staff?.isTrainer || staff?.role === 'assistant' || staff?.role === 'owner' || staff?.role === 'superadmin'

  const startScanning = () => {
    setResult(null)
    scannerRef.current?.start().catch(() => setCameraError(true))
  }

  useEffect(() => {
    if (!canScan || !videoRef.current) return
    const scanner = new QrScanner(videoRef.current, (r) => handleScan(r.data), {
      highlightScanRegion: true,
      highlightCodeOutline: true,
      maxScansPerSecond: 5
    })
    scannerRef.current = scanner
    scanner.start().catch(() => setCameraError(true))
    return () => {
      scanner.stop()
      scanner.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canScan])

  const handleScan = async (data: string) => {
    scannerRef.current?.stop()
    let url: URL
    try {
      url = new URL(data)
    } catch {
      setResult({ kind: 'invalid' })
      return
    }
    const path = url.pathname
    const ticketId = url.searchParams.get('ticket')

    const sessionMatch = path.match(/^\/treningy\/zrusit\/([^/]+)\/([^/]+)$/)
    const bundleMatch = path.match(/^\/treningy\/kurz\/zrusit\/([^/]+)\/([^/]+)$/)
    const isBooking = /^\/my-booking\/[^/]+\/[^/]+$/.test(path)

    if (sessionMatch) {
      const [, regId, token] = sessionMatch
      const snap = await getDoc(doc(db, 'trainingRegistrations', regId))
      if (!snap.exists() || snap.data().cancellationToken !== token) {
        setResult({ kind: 'invalid' })
        return
      }
      const reg = { id: snap.id, ...snap.data() } as TrainingRegistration & { id: string }
      const sessionSnap = await getDoc(doc(db, 'trainingSessions', reg.sessionId))
      const session = sessionSnap.exists() ? ({ id: sessionSnap.id, ...sessionSnap.data() } as TrainingSession & { id: string }) : null
      const ticket = ticketId ? (reg.tickets?.find((t) => t.id === ticketId) ?? null) : null
      const wasAlreadyCheckedIn = ticket ? reg.ticketCheckIns?.[ticket.id]?.checkedIn === true : reg.attendance?.checkedIn === true
      const wasAlreadyCheckedInAt = ticket ? reg.ticketCheckIns?.[ticket.id]?.checkedInAt : reg.attendance?.checkedInAt
      setResult({ kind: 'session', reg, session, ticket, wasAlreadyCheckedIn, wasAlreadyCheckedInAt })
    } else if (bundleMatch) {
      const [, regId, token] = bundleMatch
      const snap = await getDoc(doc(db, 'trainingBundleRegistrations', regId))
      if (!snap.exists() || snap.data().cancellationToken !== token) {
        setResult({ kind: 'invalid' })
        return
      }
      const reg = { id: snap.id, ...snap.data() } as TrainingBundleRegistration & { id: string }
      const bundleSnap = await getDoc(doc(db, 'trainingBundles', reg.bundleId))
      const bundle = bundleSnap.exists() ? ({ id: bundleSnap.id, ...bundleSnap.data() } as TrainingBundle & { id: string }) : null
      const sessionsSnap = await getDocs(query(collection(db, 'trainingSessions'), where('bundleId', '==', reg.bundleId)))
      const sessions = sessionsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as TrainingSession & { id: string })
        .sort((a, b) => (a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)))
      const today = formatDateISO(new Date())
      const todaysSessions = sessions.filter((s) => s.date === today)
      const ticket = ticketId ? (reg.tickets?.find((t) => t.id === ticketId) ?? null) : null
      setResult({
        kind: 'bundle',
        reg,
        bundle,
        sessions,
        selectedSessionId: todaysSessions.length === 1 ? todaysSessions[0].id : null,
        ticket,
        originalAttendanceBySession: reg.attendanceBySession,
        originalTicketCheckInsBySession: reg.ticketCheckInsBySession
      })
    } else if (isBooking) {
      setResult({ kind: 'unsupported' })
    } else {
      setResult({ kind: 'invalid' })
    }
  }

  const handleMarkSessionPresent = async () => {
    if (!result || result.kind !== 'session' || !user || !staff) return
    setBusyId(result.reg.id)
    try {
      if (result.ticket) {
        await markSessionTicketCheckIn(result.reg.id, result.ticket.id, true, user.uid)
        setResult({
          ...result,
          reg: {
            ...result.reg,
            ticketCheckIns: { ...result.reg.ticketCheckIns, [result.ticket.id]: { checkedIn: true } },
            attendance: { checkedIn: true }
          }
        })
      } else {
        await markSessionAttendance(result.reg.id, true, user.uid)
        setResult({ ...result, reg: { ...result.reg, attendance: { checkedIn: true } } })
      }
      // See lib/gate.ts's own doc comment — fire-and-forget, never blocks
      // or fails the check-in itself.
      triggerGateOpen(staff.clubId)
    } finally {
      setBusyId(null)
    }
  }

  const handleMarkBundlePresent = async () => {
    if (!result || result.kind !== 'bundle' || !result.selectedSessionId || !user || !staff) return
    setBusyId(result.reg.id)
    try {
      if (result.ticket) {
        await markBundleTicketCheckIn(result.reg.id, result.selectedSessionId, result.ticket.id, true, user.uid)
        setResult({
          ...result,
          reg: {
            ...result.reg,
            ticketCheckInsBySession: {
              ...result.reg.ticketCheckInsBySession,
              [result.selectedSessionId]: {
                ...result.reg.ticketCheckInsBySession?.[result.selectedSessionId],
                [result.ticket.id]: { checkedIn: true }
              }
            },
            attendanceBySession: { ...result.reg.attendanceBySession, [result.selectedSessionId]: { checkedIn: true } }
          }
        })
      } else {
        await markBundleSessionAttendance(result.reg.id, result.selectedSessionId, true, user.uid)
        setResult({
          ...result,
          reg: {
            ...result.reg,
            attendanceBySession: { ...result.reg.attendanceBySession, [result.selectedSessionId]: { checkedIn: true } }
          }
        })
      }
      triggerGateOpen(staff.clubId)
    } finally {
      setBusyId(null)
    }
  }

  // Per-ticket progress across the whole registration (session variant) —
  // shown alongside a single-ticket scan so staff can see "2/3 people
  // checked in" even though this scan only covers one of them.
  const sessionTicketProgress =
    result?.kind === 'session' && result.reg.tickets
      ? { checked: result.reg.tickets.filter((t) => result.reg.ticketCheckIns?.[t.id]?.checkedIn).length, total: result.reg.tickets.length }
      : null
  const bundleTicketProgress =
    result?.kind === 'bundle' && result.reg.tickets && result.selectedSessionId
      ? {
          checked: result.reg.tickets.filter((t) => result.reg.ticketCheckInsBySession?.[result.selectedSessionId as string]?.[t.id]?.checkedIn)
            .length,
          total: result.reg.tickets.length
        }
      : null

  if (staff && !canScan) {
    return (
      <div className="content-container py-12 max-w-md mx-auto text-center space-y-4">
        <BackButton fallback="/admin" />
        <h1>{t('qrScan.notAuthorizedTitle')}</h1>
        <p className="text-text-secondary">{t('qrScan.notAuthorizedNotice')}</p>
      </div>
    )
  }

  return (
    <div className="content-container py-6 space-y-6 max-w-md mx-auto">
      <BackButton fallback="/admin/treningy" />
      <h1 className="text-2xl font-bold text-white">{t('qrScan.title')}</h1>
      <p className="text-text-secondary text-sm">{t('qrScan.intro')}</p>

      <Card className="arena-card overflow-hidden">
        <div className="relative bg-black aspect-square">
          <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
        </div>
      </Card>

      {cameraError && <p className="text-status-danger text-sm">{t('qrScan.cameraError')}</p>}

      {result && (
        <Card className="arena-card">
          <CardHeader>
            <CardTitle className="text-white text-lg">
              {result.kind === 'session' || result.kind === 'bundle' ? result.reg.name : t('qrScan.resultTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {result.kind === 'invalid' && <p className="text-status-danger text-sm">{t('qrScan.invalidCode')}</p>}
            {result.kind === 'unsupported' && <p className="text-status-muted text-sm">{t('qrScan.bookingNotSupported')}</p>}

            {result.kind === 'session' && (() => {
              const isCheckedIn = result.ticket ? result.reg.ticketCheckIns?.[result.ticket.id]?.checkedIn === true : result.reg.attendance?.checkedIn === true
              return (
              <div className="space-y-3">
                <div className="text-text-secondary text-sm space-y-1">
                  {result.ticket && (
                    <p className="text-white font-semibold">{t(`qrScan.ticketLabel.${result.ticket.label}`)}</p>
                  )}
                  <p>{t('common.dateAtTime', { date: result.session?.date ?? result.reg.date, startTime: result.session?.startTime ?? result.reg.startTime })}</p>
                  <p className="mono text-primary">{result.reg.confirmationCode}</p>
                  {(result.reg.attendeeCount ?? 1) > 1 && (
                    <p>{t('trainerRoster.groupSize', { count: result.reg.attendeeCount })}</p>
                  )}
                  {sessionTicketProgress && (
                    <p>{t('qrScan.ticketProgress', { checked: sessionTicketProgress.checked, total: sessionTicketProgress.total })}</p>
                  )}
                </div>
                {(result.reg.status === 'cancelled' || result.reg.status === 'expired') && (
                  <p className="text-status-danger text-sm">{t('qrScan.notValidNotice')}</p>
                )}
                {(result.reg.status === 'pending' || result.reg.status === 'waitlist') && (
                  <p className="text-status-muted text-sm">{t('qrScan.notConfirmedNotice')}</p>
                )}
                {result.wasAlreadyCheckedIn && (
                  <p className="text-status-danger text-sm font-semibold bg-status-danger/10 border border-status-danger/30 rounded-md px-3 py-2">
                    {t('qrScan.alreadyScannedWarning', { time: formatCheckedInAt(result.wasAlreadyCheckedInAt) })}
                  </p>
                )}
                {result.reg.status !== 'cancelled' && result.reg.status !== 'expired' && (
                  <Button
                    onClick={handleMarkSessionPresent}
                    disabled={busyId === result.reg.id || isCheckedIn}
                    className="w-full bg-primary hover:bg-primary-gold text-primary-foreground"
                  >
                    {isCheckedIn ? t('trainerRoster.checkedIn') : t('trainerRoster.markPresent')}
                  </Button>
                )}
              </div>
              )
            })()}

            {result.kind === 'bundle' && (() => {
              const selectedId = result.selectedSessionId
              const isCheckedIn = selectedId
                ? result.ticket
                  ? result.reg.ticketCheckInsBySession?.[selectedId]?.[result.ticket.id]?.checkedIn === true
                  : result.reg.attendanceBySession?.[selectedId]?.checkedIn === true
                : false
              const wasAlreadyCheckedIn = selectedId
                ? result.ticket
                  ? result.originalTicketCheckInsBySession?.[selectedId]?.[result.ticket.id]?.checkedIn === true
                  : result.originalAttendanceBySession?.[selectedId]?.checkedIn === true
                : false
              const wasAlreadyCheckedInAt = selectedId
                ? result.ticket
                  ? result.originalTicketCheckInsBySession?.[selectedId]?.[result.ticket.id]?.checkedInAt
                  : result.originalAttendanceBySession?.[selectedId]?.checkedInAt
                : undefined
              return (
              <div className="space-y-3">
                <div className="text-text-secondary text-sm space-y-1">
                  {result.ticket && (
                    <p className="text-white font-semibold">{t(`qrScan.ticketLabel.${result.ticket.label}`)}</p>
                  )}
                  {result.bundle && <p className="text-white">{result.bundle.title}</p>}
                  <p className="mono text-primary">{result.reg.confirmationCode}</p>
                  {(result.reg.attendeeCount ?? 1) > 1 && (
                    <p>{t('trainerRoster.groupSize', { count: result.reg.attendeeCount })}</p>
                  )}
                  {bundleTicketProgress && (
                    <p>{t('qrScan.ticketProgress', { checked: bundleTicketProgress.checked, total: bundleTicketProgress.total })}</p>
                  )}
                </div>
                {(result.reg.status === 'cancelled' || result.reg.status === 'expired') && (
                  <p className="text-status-danger text-sm">{t('qrScan.notValidNotice')}</p>
                )}
                {(result.reg.status === 'pending' || result.reg.status === 'waitlist') && (
                  <p className="text-status-muted text-sm">{t('qrScan.notConfirmedNotice')}</p>
                )}
                {result.sessions.length > 0 && (
                  <div>
                    <label className="text-white text-sm mb-1 block">{t('qrScan.pickSession')}</label>
                    <select
                      value={result.selectedSessionId ?? ''}
                      onChange={(e) => setResult({ ...result, selectedSessionId: e.target.value || null })}
                      className="w-full bg-background-dark border border-border text-white rounded-md px-3 py-2"
                    >
                      <option value="">{t('qrScan.selectSessionPlaceholder')}</option>
                      {result.sessions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.date} {s.startTime}
                          {(result.ticket
                            ? result.reg.ticketCheckInsBySession?.[s.id]?.[result.ticket.id]?.checkedIn
                            : result.reg.attendanceBySession?.[s.id]?.checkedIn)
                            ? ` (${t('trainerRoster.checkedIn')})`
                            : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {wasAlreadyCheckedIn && (
                  <p className="text-status-danger text-sm font-semibold bg-status-danger/10 border border-status-danger/30 rounded-md px-3 py-2">
                    {t('qrScan.alreadyScannedWarning', { time: formatCheckedInAt(wasAlreadyCheckedInAt) })}
                  </p>
                )}
                {result.reg.status !== 'cancelled' && result.reg.status !== 'expired' && (
                  <Button
                    onClick={handleMarkBundlePresent}
                    disabled={busyId === result.reg.id || !result.selectedSessionId || isCheckedIn}
                    className="w-full bg-primary hover:bg-primary-gold text-primary-foreground"
                  >
                    {isCheckedIn ? t('trainerRoster.checkedIn') : t('trainerRoster.markPresent')}
                  </Button>
                )}
              </div>
              )
            })()}

            <Button variant="outline" onClick={startScanning} className="w-full border-border text-white">
              {t('qrScan.scanNext')}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
