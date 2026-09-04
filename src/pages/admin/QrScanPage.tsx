import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import QrScanner from 'qr-scanner'
import QrScannerWorkerPath from 'qr-scanner/qr-scanner-worker.min.js?url'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { markSessionAttendance, markBundleSessionAttendance } from '@/lib/training'
import { formatDateISO } from '@/lib/utils'
import { TrainingBundle, TrainingBundleRegistration, TrainingRegistration, TrainingSession } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import BackButton from '@/components/BackButton'

QrScanner.WORKER_PATH = QrScannerWorkerPath

type Result =
  | { kind: 'session'; reg: TrainingRegistration & { id: string }; session: (TrainingSession & { id: string }) | null }
  | {
      kind: 'bundle'
      reg: TrainingBundleRegistration & { id: string }
      bundle: (TrainingBundle & { id: string }) | null
      sessions: (TrainingSession & { id: string })[]
      selectedSessionId: string | null
    }
  | { kind: 'unsupported' }
  | { kind: 'invalid' }

/**
 * Entrance QR-scan check-in — a trainer/assistant/owner/superadmin points
 * the device camera at the same confirmation QR a customer already got
 * emailed (the training cancel-link QR, see queueTrainingConfirmationEmail/
 * queueBundleConfirmationEmail in lib/email.ts) and checks the whole party
 * in with one tap, writing into the exact same attendance/attendanceBySession
 * fields TrainerRosterModal.tsx's manual roster check-in already uses — see
 * CLAUDE.md's "Fáza 5" note for the full rationale (attendeeCount is what
 * lets one scan cover a family/group). Ice-booking QRs are recognized but
 * not actionable here — Booking has no attendance concept yet.
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
    let path: string
    try {
      path = new URL(data).pathname
    } catch {
      setResult({ kind: 'invalid' })
      return
    }

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
      setResult({ kind: 'session', reg, session })
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
      setResult({ kind: 'bundle', reg, bundle, sessions, selectedSessionId: todaysSessions.length === 1 ? todaysSessions[0].id : null })
    } else if (isBooking) {
      setResult({ kind: 'unsupported' })
    } else {
      setResult({ kind: 'invalid' })
    }
  }

  const handleMarkSessionPresent = async () => {
    if (!result || result.kind !== 'session' || !user) return
    setBusyId(result.reg.id)
    try {
      await markSessionAttendance(result.reg.id, true, user.uid)
      setResult({ ...result, reg: { ...result.reg, attendance: { checkedIn: true } } })
    } finally {
      setBusyId(null)
    }
  }

  const handleMarkBundlePresent = async () => {
    if (!result || result.kind !== 'bundle' || !result.selectedSessionId || !user) return
    setBusyId(result.reg.id)
    try {
      await markBundleSessionAttendance(result.reg.id, result.selectedSessionId, true, user.uid)
      setResult({
        ...result,
        reg: {
          ...result.reg,
          attendanceBySession: { ...result.reg.attendanceBySession, [result.selectedSessionId]: { checkedIn: true } }
        }
      })
    } finally {
      setBusyId(null)
    }
  }

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

            {result.kind === 'session' && (
              <div className="space-y-3">
                <div className="text-text-secondary text-sm space-y-1">
                  <p>{t('common.dateAtTime', { date: result.session?.date ?? result.reg.date, startTime: result.session?.startTime ?? result.reg.startTime })}</p>
                  <p className="mono text-primary">{result.reg.confirmationCode}</p>
                  {(result.reg.attendeeCount ?? 1) > 1 && (
                    <p>{t('trainerRoster.groupSize', { count: result.reg.attendeeCount })}</p>
                  )}
                </div>
                {(result.reg.status === 'cancelled' || result.reg.status === 'expired') && (
                  <p className="text-status-danger text-sm">{t('qrScan.notValidNotice')}</p>
                )}
                {(result.reg.status === 'pending' || result.reg.status === 'waitlist') && (
                  <p className="text-status-muted text-sm">{t('qrScan.notConfirmedNotice')}</p>
                )}
                {result.reg.status !== 'cancelled' && result.reg.status !== 'expired' && (
                  <Button
                    onClick={handleMarkSessionPresent}
                    disabled={busyId === result.reg.id || result.reg.attendance?.checkedIn}
                    className="w-full bg-primary hover:bg-primary-gold text-primary-foreground"
                  >
                    {result.reg.attendance?.checkedIn ? t('trainerRoster.checkedIn') : t('trainerRoster.markPresent')}
                  </Button>
                )}
              </div>
            )}

            {result.kind === 'bundle' && (
              <div className="space-y-3">
                <div className="text-text-secondary text-sm space-y-1">
                  {result.bundle && <p className="text-white">{result.bundle.title}</p>}
                  <p className="mono text-primary">{result.reg.confirmationCode}</p>
                  {(result.reg.attendeeCount ?? 1) > 1 && (
                    <p>{t('trainerRoster.groupSize', { count: result.reg.attendeeCount })}</p>
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
                          {result.reg.attendanceBySession?.[s.id]?.checkedIn ? ` (${t('trainerRoster.checkedIn')})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {result.reg.status !== 'cancelled' && result.reg.status !== 'expired' && (
                  <Button
                    onClick={handleMarkBundlePresent}
                    disabled={busyId === result.reg.id || !result.selectedSessionId || !!result.reg.attendanceBySession?.[result.selectedSessionId ?? '']?.checkedIn}
                    className="w-full bg-primary hover:bg-primary-gold text-primary-foreground"
                  >
                    {result.selectedSessionId && result.reg.attendanceBySession?.[result.selectedSessionId]?.checkedIn
                      ? t('trainerRoster.checkedIn')
                      : t('trainerRoster.markPresent')}
                  </Button>
                )}
              </div>
            )}

            <Button variant="outline" onClick={startScanning} className="w-full border-border text-white">
              {t('qrScan.scanNext')}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
