import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronLeft } from 'lucide-react'
import { Timestamp } from 'firebase/firestore'
import { fetchCognitiveSession, fetchCognitiveSessionByCode, fetchLatestCognitiveSessionForClub } from '@/lib/cognitiveTraining/sessions'
import { measureClockOffsetMs, localNowMs } from '@/lib/cognitiveTraining/clockSync'
import { computeCurrentPhase } from '@/lib/cognitiveTraining/phase'
import { getCognitiveGameModule } from '@/cognitiveTraining/gameRegistry'
import { useClubData } from '@/hooks/useClubData'
import { CognitiveSession } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// A kiosk/TV screen is normally meant to have nothing clickable at all
// (see App.tsx's chrome-stripping for this path) — this is a deliberate,
// documented exception, same "harmless on a real wall-mounted TV, useful
// when someone previews the page on their own phone/laptop" escape hatch
// the rink-schedule/tournament TV boards already use elsewhere in this
// app (their own "Späť na štandardné zobrazenie" link).
function BackToTrainerLink() {
  const { t } = useTranslation()
  return (
    <Link to="/admin/treningy/kognitivny" className="inline-flex items-center gap-1 text-text-muted hover:text-primary text-sm">
      <ChevronLeft className="h-4 w-4" />
      {t('common.back')}
    </Link>
  )
}

type LocalSession = CognitiveSession & { id: string }

const POLL_MS = 2500
const FONT_SCALE_STEP = 0.1
const FONT_SCALE_MIN = 0.5
const FONT_SCALE_MAX = 2.5

function startAtMillis(session: LocalSession): number | null {
  if (!session.startAt) return null
  return (session.startAt as unknown as Timestamp).toMillis()
}

/**
 * The public, no-login TV/kiosk screen for "Kognitívny tréning" — see
 * CLAUDE.md. Two ways in:
 * - `/treningy/kognitivny-tv` (no code at all) — the STATIC url every TV in
 *   the room opens once and leaves open: it auto-polls for whichever
 *   session this club's trainer(s) most recently created
 *   (fetchLatestCognitiveSessionForClub) and always just shows that one,
 *   switching over on its own the moment a new drill is started — no
 *   pairing code to type or scan, nothing to re-open between exercises.
 * - `/treningy/kognitivny-tv/:code` (scanned QR / typed code from a
 *   specific draft session's own pairing card) — the older, narrower way
 *   to point one specific device at one specific session, still useful if
 *   e.g. two trainers are running different drills on different screens
 *   at once and a code is the only way to tell those apart.
 * Once a session is known, this page NEVER needs the countdown/task timing
 * itself to come from the network again — it only polls every POLL_MS to
 * notice a status change (started/finished/cancelled, or re-reading a
 * freshly-generated plan), while every frame's actual countdown/task
 * display is computed purely from this device's own clock against the
 * session's shared `startAt` (see computeCurrentPhase) — exactly what
 * keeps an exercise playing out correctly through a dropped connection.
 */
export default function CognitiveTvPage() {
  const { t } = useTranslation()
  const { code: codeParam } = useParams<{ code?: string }>()
  const { club } = useClubData()
  const isStaticMode = !codeParam

  const [codeInput, setCodeInput] = useState('')
  const [session, setSession] = useState<LocalSession | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [clockOffsetMs, setClockOffsetMs] = useState(0)
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [fontScale, setFontScale] = useState(1)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const autoTriedRef = useRef(false)

  const resolveCode = useCallback(async (code: string) => {
    const found = await fetchCognitiveSessionByCode(code)
    if (found) {
      setSession(found)
      setNotFound(false)
    } else {
      setNotFound(true)
    }
  }, [])

  useEffect(() => {
    if (!isStaticMode && codeParam && !autoTriedRef.current) {
      autoTriedRef.current = true
      resolveCode(codeParam)
    }
  }, [isStaticMode, codeParam, resolveCode])

  useEffect(() => {
    measureClockOffsetMs().then(setClockOffsetMs)
  }, [])

  // Static mode: no code to resolve at all — just keep re-fetching "this
  // club's latest session" on the same cadence a paired TV would poll its
  // one known session, so a fresh drill the trainer starts takes over
  // within one tick, with nothing to pair and nothing to re-open.
  const clubId = club?.id
  useEffect(() => {
    if (!isStaticMode || !clubId) return
    let cancelled = false
    const poll = () => {
      fetchLatestCognitiveSessionForClub(clubId).then((found) => {
        if (!cancelled) setSession(found)
      })
    }
    poll()
    const interval = setInterval(poll, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [isStaticMode, clubId])

  // Paired-by-code mode only — static mode's own poll above already
  // re-fetches the whole session doc on the same cadence.
  const sessionId = session?.id
  useEffect(() => {
    if (isStaticMode || !sessionId) return
    const interval = setInterval(() => {
      fetchCognitiveSession(sessionId).then((fresh) => fresh && setSession(fresh))
    }, POLL_MS)
    return () => clearInterval(interval)
  }, [isStaticMode, sessionId])

  useEffect(() => {
    if (session?.status !== 'started') return
    const interval = setInterval(() => setNowTick(Date.now()), 200)
    return () => clearInterval(interval)
  }, [session?.status])

  // Wake Lock — re-acquired on visibilitychange since the browser always
  // releases it when the tab/screen is hidden, and a kiosk screen that
  // briefly blanked (or had this tab backgrounded) must not stay asleep
  // once it's visible again.
  useEffect(() => {
    if (!session || !('wakeLock' in navigator)) return
    let cancelled = false
    const acquire = () => {
      navigator.wakeLock
        .request('screen')
        .then((lock) => {
          if (cancelled) {
            lock.release()
          } else {
            wakeLockRef.current = lock
          }
        })
        .catch(() => undefined)
    }
    acquire()
    const onVisible = () => {
      if (document.visibilityState === 'visible') acquire()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      wakeLockRef.current?.release().catch(() => undefined)
      wakeLockRef.current = null
    }
  }, [session])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().then(() => setIsFullscreen(false))
    } else {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true))
    }
  }

  const game = session ? getCognitiveGameModule(session.gameId) : undefined
  const startAt = session ? startAtMillis(session) : null
  const phaseState = useMemo(() => {
    if (session?.status !== 'started' || !session.phases || startAt == null) return null
    void nowTick // re-run this memo on every tick, purely for a fresh "now"
    return computeCurrentPhase(session.phases, startAt, localNowMs(clockOffsetMs))
  }, [session, startAt, clockOffsetMs, nowTick])

  // Only the paired-by-code mode ever shows a manual "enter code" prompt —
  // static mode has nothing to type, it just keeps waiting on its own poll
  // above until a session eventually turns up (see the idle message
  // further down for what it shows meanwhile).
  if (!isStaticMode && !session) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-background-dark text-white p-6 gap-6">
        <div className="self-start">
          <BackToTrainerLink />
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (codeInput.trim()) resolveCode(codeInput.trim())
          }}
          className="flex flex-col items-center gap-4 w-full max-w-xs"
        >
          <h1 className="text-xl font-bold">{t('cognitiveTraining.tv.enterCode')}</h1>
          <Input
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            inputMode="numeric"
            autoFocus
            className="text-center text-2xl tabular-nums"
          />
          <Button type="submit" className="w-full bg-primary hover:bg-primary-gold text-primary-foreground">
            {t('cognitiveTraining.tv.connect')}
          </Button>
          {notFound && <p className="text-status-danger text-sm">{t('cognitiveTraining.tv.codeNotFound')}</p>}
        </form>
      </div>
    )
  }

  const isPause = phaseState?.kind === 'phase' && phaseState.phase.type === 'pause'
  // Nothing live right now — no session at all yet (static mode before the
  // very first drill, or between polls), a 'draft' one not started yet, or
  // one the trainer explicitly ended ('finished'/'cancelled' — the time-
  // elapsed-on-its-own case instead shows phaseState's own 'finished' kind
  // below, status stays 'started' for that case by design, see CLAUDE.md).
  const isWaiting = !session || session.status === 'draft' || session.status === 'finished' || session.status === 'cancelled'

  return (
    <div
      className={`h-screen w-screen flex flex-col overflow-hidden text-white transition-colors ${
        isPause ? 'bg-status-warning/20' : 'bg-background-dark'
      }`}
    >
      <div className="shrink-0 flex items-center justify-between px-4 py-1 text-sm text-text-muted">
        <div className="flex items-center gap-4">
          <BackToTrainerLink />
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="border-border text-white" onClick={() => setFontScale((s) => Math.max(FONT_SCALE_MIN, s - FONT_SCALE_STEP))}>
              A-
            </Button>
            <Button size="sm" variant="outline" className="border-border text-white" onClick={() => setFontScale((s) => Math.min(FONT_SCALE_MAX, s + FONT_SCALE_STEP))}>
              A+
            </Button>
          </div>
        </div>
        <Button size="sm" variant="outline" className="border-border text-white" onClick={toggleFullscreen}>
          {isFullscreen ? t('cognitiveTraining.tv.exitFullscreen') : t('cognitiveTraining.tv.fullscreen')}
        </Button>
      </div>

      {/* The big timer always sits up top, per the explicit "Veľká časomiera
          hore" requirement — a countdown-to-start, or the current phase's
          own remaining time once the exercise is running. The task content
          itself (below) is what gets the real visual weight (size/contrast),
          the timer here is secondary but still large enough to read from
          across a rink. */}
      <div className="shrink-0 text-center py-2">
        {phaseState?.kind === 'countdown' && (
          <div className="text-[8rem] font-bold leading-none tabular-nums text-primary">{Math.ceil(phaseState.msRemaining / 1000)}</div>
        )}
        {phaseState?.kind === 'phase' && (
          <div className={`text-6xl font-bold tabular-nums ${isPause ? 'text-status-warning' : 'text-text-secondary'}`}>
            {Math.ceil(phaseState.remainingMs / 1000)}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div style={{ transform: `scale(${fontScale})` }} className="flex flex-col items-center gap-6">
          {isWaiting && <p className="text-2xl text-text-muted">{t('cognitiveTraining.tv.waitingForStart')}</p>}

          {phaseState?.kind === 'phase' && phaseState.phase.type === 'task' && game && <game.TvRenderer content={phaseState.phase.content} />}

          {isPause && <p className="text-5xl font-bold text-status-warning">{t('cognitiveTraining.pause')}</p>}

          {phaseState?.kind === 'finished' && <p className="text-4xl font-bold">{t('cognitiveTraining.finished')}</p>}
        </div>
      </div>
    </div>
  )
}
