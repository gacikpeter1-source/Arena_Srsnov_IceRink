import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router-dom'
import { Timestamp } from 'firebase/firestore'
import { useAuth } from '@/contexts/AuthContext'
import { useClubData } from '@/hooks/useClubData'
import { listCognitiveGames, getCognitiveGameModule } from '@/cognitiveTraining/gameRegistry'
import {
  createDraftCognitiveSession,
  endCognitiveSessionEarly,
  fetchCognitiveSession,
  fetchCognitiveSessionAnswers,
  fetchOrCreateCognitiveResult,
  fetchRecentCognitivePlayerNames,
  recordCognitiveResultTask,
  startCognitiveSession as requestSessionStart
} from '@/lib/cognitiveTraining/sessions'
import { measureClockOffsetMs, localNowMs } from '@/lib/cognitiveTraining/clockSync'
import { computeCurrentPhase } from '@/lib/cognitiveTraining/phase'
import { generateQrDataUrl } from '@/lib/qrcode'
import { CognitiveSession, CognitiveSessionAnswers } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import BackButton from '@/components/BackButton'

type LocalSession = CognitiveSession & { id: string }

/** `startAt` arrives as a Firestore Timestamp despite the TS type saying Date — same convention this app's other server-timestamp fields already follow (see e.g. lib/bookings.ts's isLockExpired). */
function startAtMillis(session: LocalSession): number | null {
  if (!session.startAt) return null
  return (session.startAt as unknown as Timestamp).toMillis()
}

/**
 * Trainer's phone-side control screen for the "Kognitívny tréning" module
 * — see CLAUDE.md for the full architecture. Pick a game + its config,
 * create a draft session (gets a fresh pairing code the TV connects to),
 * press Start (triggers server-side plan generation — see
 * startCognitiveSession in functions/src/index.ts), then watch the same
 * timer/task the TV shows, plus the correct answer, and record each
 * player's result as tasks resolve.
 */
export default function CognitiveTrainingPage() {
  const { t } = useTranslation()
  const { user, staff } = useAuth()
  const { club } = useClubData()

  const games = useMemo(() => listCognitiveGames(), [])
  const [gameId, setGameId] = useState(games[0]?.id ?? '')
  const [config, setConfig] = useState<Record<string, unknown>>(games[0]?.defaultConfig ?? {})

  const [session, setSession] = useState<LocalSession | null>(null)
  const [answers, setAnswers] = useState<CognitiveSessionAnswers | null>(null)
  const [clockOffsetMs, setClockOffsetMs] = useState(0)
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)

  const [playerNames, setPlayerNames] = useState<string[]>([])
  const [newPlayerName, setNewPlayerName] = useState('')
  const [players, setPlayers] = useState<{ name: string; resultId: string }[]>([])

  useEffect(() => {
    measureClockOffsetMs().then(setClockOffsetMs)
  }, [])

  useEffect(() => {
    if (club) fetchRecentCognitivePlayerNames(club.id).then(setPlayerNames)
  }, [club])

  // Ticks the displayed timer/task while a session is actually running —
  // the countdown/phase itself is always computed fresh from startAt plus
  // this device's own clockOffsetMs, never from a server round trip (see
  // CLAUDE.md's sync section), so this interval only needs to be frequent
  // enough to *look* smooth, not to drive correctness.
  useEffect(() => {
    if (session?.status !== 'started') return
    const interval = setInterval(() => setNowTick(Date.now()), 200)
    return () => clearInterval(interval)
  }, [session?.status])

  const phaseState = useMemo(() => {
    if (session?.status !== 'started' || !session.phases) return null
    const startAt = startAtMillis(session)
    if (startAt == null) return null
    void nowTick // re-run this memo on every tick
    return computeCurrentPhase(session.phases, startAt, localNowMs(clockOffsetMs))
  }, [session, clockOffsetMs, nowTick])

  // isTrainer, OR owner/superadmin (same "full control" extension the
  // training domain's own session-creation tool already grants them —
  // see TrainerDashboardPage.tsx's isOwnerOrSuperadmin) — a plain
  // assistant with no isTrainer flag still has no reason to run a
  // cognitive drill, so that case alone stays blocked.
  const isOwnerOrSuperadmin = staff?.role === 'owner' || staff?.role === 'superadmin'
  if (staff && !staff.isTrainer && !isOwnerOrSuperadmin) {
    return <Navigate to="/admin" replace />
  }

  const selectedGame = getCognitiveGameModule(gameId)

  const handleSelectGame = (id: string) => {
    setGameId(id)
    setConfig(getCognitiveGameModule(id)?.defaultConfig ?? {})
  }

  const handleCreateDraft = async () => {
    if (!user || !club || !selectedGame) return
    setBusy(true)
    try {
      const id = await createDraftCognitiveSession({ clubId: club.id, trainerId: user.uid, gameId: selectedGame.id, config })
      const fresh = await fetchCognitiveSession(id)
      setSession(fresh)
    } finally {
      setBusy(false)
    }
  }

  const handleStart = async () => {
    if (!session) return
    setBusy(true)
    try {
      await requestSessionStart(session.id)
      const [fresh, freshAnswers] = await Promise.all([fetchCognitiveSession(session.id), fetchCognitiveSessionAnswers(session.id)])
      setSession(fresh)
      setAnswers(freshAnswers)
    } finally {
      setBusy(false)
    }
  }

  const handleEnd = async () => {
    if (!session) return
    setBusy(true)
    try {
      await endCognitiveSessionEarly(session.id, session.status === 'started')
      setSession(null)
      setAnswers(null)
      setPlayers([])
      if (club) fetchRecentCognitivePlayerNames(club.id).then(setPlayerNames)
    } finally {
      setBusy(false)
    }
  }

  const handleAddPlayer = async () => {
    const name = newPlayerName.trim()
    if (!name || !club || !session) return
    const resultId = await fetchOrCreateCognitiveResult(club.id, session.id, name)
    setPlayers((prev) => (prev.some((p) => p.name === name) ? prev : [...prev, { name, resultId }]))
    setNewPlayerName('')
  }

  const currentTaskPhaseIndex = phaseState?.kind === 'phase' && phaseState.phase.type === 'task' ? phaseState.phaseIndex : null
  const currentAnswer = currentTaskPhaseIndex != null ? answers?.answers.find((a) => a.index === currentTaskPhaseIndex)?.correctAnswer : undefined

  return (
    <div className="content-container py-6 space-y-6 max-w-md mx-auto">
      <BackButton fallback="/admin/treningy" />
      <h1 className="text-2xl font-bold text-white">{t('cognitiveTraining.title')}</h1>

      {!session && (
        <Card className="arena-card">
          <CardHeader>
            <CardTitle className="text-white text-lg">{t('cognitiveTraining.chooseGame')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <select
              value={gameId}
              onChange={(e) => handleSelectGame(e.target.value)}
              className="w-full bg-background-dark border border-border text-white rounded-md px-3 py-2"
            >
              {games.map((g) => (
                <option key={g.id} value={g.id} className="bg-background-dark text-white">
                  {t(g.displayName)}
                </option>
              ))}
            </select>

            {selectedGame && <selectedGame.ConfigForm value={config} onChange={setConfig} />}

            <Button onClick={handleCreateDraft} disabled={busy || !selectedGame} className="w-full bg-primary hover:bg-primary-gold text-primary-foreground">
              {t('cognitiveTraining.prepare')}
            </Button>
          </CardContent>
        </Card>
      )}

      {session && session.status === 'draft' && (
        <>
          <PairingCard session={session} />
          <Button onClick={handleStart} disabled={busy} className="w-full bg-primary hover:bg-primary-gold text-primary-foreground">
            {t('cognitiveTraining.start')}
          </Button>
        </>
      )}

      {session && session.status === 'started' && (
        <Card className="arena-card">
          <CardContent className="py-6 space-y-4">
            {phaseState?.kind === 'countdown' && (
              <div className="text-center text-5xl font-bold text-primary tabular-nums">{Math.ceil(phaseState.msRemaining / 1000)}</div>
            )}
            {phaseState?.kind === 'phase' && phaseState.phase.type === 'task' && selectedGame && (
              <>
                <div className="text-center text-text-muted text-sm tabular-nums">{Math.ceil(phaseState.remainingMs / 1000)}s</div>
                <selectedGame.TrainerRenderer content={phaseState.phase.content} correctAnswer={currentAnswer} />
              </>
            )}
            {phaseState?.kind === 'phase' && phaseState.phase.type === 'pause' && (
              <div className="text-center space-y-1">
                <p className="text-status-warning font-semibold">{t('cognitiveTraining.pause')}</p>
                <p className="text-text-muted text-sm tabular-nums">{Math.ceil(phaseState.remainingMs / 1000)}s</p>
              </div>
            )}
            {phaseState?.kind === 'finished' && <p className="text-center text-white font-semibold">{t('cognitiveTraining.finished')}</p>}
          </CardContent>
        </Card>
      )}

      {session && (session.status === 'draft' || session.status === 'started') && (
        <Card className="arena-card">
          <CardHeader>
            <CardTitle className="text-white text-base">{t('cognitiveTraining.players')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  list="cognitive-player-names"
                  value={newPlayerName}
                  onChange={(e) => setNewPlayerName(e.target.value)}
                  placeholder={t('cognitiveTraining.playerNamePlaceholder') ?? ''}
                />
                <datalist id="cognitive-player-names">
                  {playerNames.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </div>
              <Button onClick={handleAddPlayer} variant="outline" className="border-border text-white">
                {t('cognitiveTraining.addPlayer')}
              </Button>
            </div>

            {players.map((p) => (
              <div key={p.resultId} className="flex items-center justify-between gap-2 border-t border-border pt-2">
                <span className="text-white">{p.name}</span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={currentTaskPhaseIndex == null}
                    onClick={() => currentTaskPhaseIndex != null && recordCognitiveResultTask(p.resultId, currentTaskPhaseIndex, true)}
                    className="bg-status-success hover:bg-status-success/90"
                  >
                    {t('cognitiveTraining.correct')}
                  </Button>
                  <Button
                    size="sm"
                    disabled={currentTaskPhaseIndex == null}
                    onClick={() => currentTaskPhaseIndex != null && recordCognitiveResultTask(p.resultId, currentTaskPhaseIndex, false)}
                    variant="destructive"
                  >
                    {t('cognitiveTraining.incorrect')}
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {session && (
        <Button onClick={handleEnd} disabled={busy} variant="destructive" className="w-full">
          {t('cognitiveTraining.end')}
        </Button>
      )}
    </div>
  )
}

function PairingCard({ session }: { session: LocalSession }) {
  const { t } = useTranslation()
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!session.pairingCode) return
    generateQrDataUrl(`${window.location.origin}/treningy/kognitivny-tv/${session.pairingCode}`).then(setQrDataUrl)
  }, [session.pairingCode])

  return (
    <Card className="arena-card">
      <CardContent className="py-6 flex flex-col items-center gap-3">
        <p className="text-text-secondary text-sm">{t('cognitiveTraining.pairingIntro')}</p>
        <p className="text-4xl font-bold tabular-nums text-primary">{session.pairingCode}</p>
        {qrDataUrl && <img src={qrDataUrl} alt="QR" className="w-40 h-40" />}
      </CardContent>
    </Card>
  )
}
