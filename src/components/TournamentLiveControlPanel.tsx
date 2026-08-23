import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Play, Check } from 'lucide-react'
import {
  fetchTournamentMatches,
  setMatchStatus,
  updateLiveMatchScore,
  setTournamentMatchResult,
  setPlainMatchResult,
  deriveMatchState,
  KnockoutDrawError
} from '@/lib/tournaments'
import { Rink, TournamentMatch, Zone } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'

interface TournamentLiveControlPanelProps {
  tournamentId: string
  rinks: Rink[]
  zones: Zone[]
}

const POLL_MS = 5000

/**
 * Match-day control room — separate from the three schedule-generator
 * panels above it (those stay focused on planning brackets/groups ahead
 * of time). Every real match (byes excluded — never actually played) is
 * listed under "Práve sa hrá" / "Nadchádzajúce" / "Dokončené" depending on
 * deriveMatchState, with a Start button, a +/- score stepper once
 * started, and a Finish button. Polls every few seconds (this app has no
 * other real-time listener anywhere — see CLAUDE.md) so a second staff
 * member's phone and the public /turnaje screen elsewhere stay roughly in
 * sync without a manual refresh.
 *
 * Deliberately doesn't replace the existing one-shot "Uložiť výsledok"
 * score entry already built into TournamentBracketView/
 * TournamentGroupsGenerator — those remain a valid, simpler way to record
 * a final score after the fact with no live theatrics; this panel is only
 * for the match-day scoreboard workflow.
 */
export default function TournamentLiveControlPanel({ tournamentId, rinks, zones }: TournamentLiveControlPanelProps) {
  const { t } = useTranslation()
  const [matches, setMatches] = useState<(TournamentMatch & { id: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [errorByMatch, setErrorByMatch] = useState<Record<string, string>>({})
  const [busyMatchId, setBusyMatchId] = useState<string | null>(null)

  const refresh = () => {
    fetchTournamentMatches(tournamentId)
      .then(setMatches)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    setLoading(true)
    refresh()
    const interval = setInterval(refresh, POLL_MS)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId])

  const isBracket = (m: TournamentMatch) => m.schema === 'knockout' || m.schema === 'groupsPlayoff'

  const handleStart = async (m: TournamentMatch & { id: string }) => {
    setBusyMatchId(m.id)
    setErrorByMatch((prev) => ({ ...prev, [m.id]: '' }))
    try {
      await setMatchStatus(m.id, 'live')
      refresh()
    } finally {
      setBusyMatchId(null)
    }
  }

  const handleFinish = async (m: TournamentMatch & { id: string }) => {
    setBusyMatchId(m.id)
    setErrorByMatch((prev) => ({ ...prev, [m.id]: '' }))
    try {
      const a = m.scoreA ?? 0
      const b = m.scoreB ?? 0
      if (isBracket(m)) await setTournamentMatchResult(m.id, a, b)
      else await setPlainMatchResult(m.id, a, b)
      refresh()
    } catch (err) {
      setErrorByMatch((prev) => ({ ...prev, [m.id]: err instanceof KnockoutDrawError ? t('tournaments.noDraws') : t('common.error') }))
    } finally {
      setBusyMatchId(null)
    }
  }

  const adjustScore = async (m: TournamentMatch & { id: string }, side: 'a' | 'b', delta: number) => {
    const nextA = Math.max(0, (m.scoreA ?? 0) + (side === 'a' ? delta : 0))
    const nextB = Math.max(0, (m.scoreB ?? 0) + (side === 'b' ? delta : 0))
    setMatches((prev) => prev.map((x) => (x.id === m.id ? { ...x, scoreA: nextA, scoreB: nextB } : x)))
    setErrorByMatch((prev) => ({ ...prev, [m.id]: '' }))
    try {
      if (deriveMatchState(m) === 'finished') {
        if (isBracket(m)) await setTournamentMatchResult(m.id, nextA, nextB)
        else await setPlainMatchResult(m.id, nextA, nextB)
      } else {
        await updateLiveMatchScore(m.id, nextA, nextB)
      }
      refresh()
    } catch (err) {
      setErrorByMatch((prev) => ({ ...prev, [m.id]: err instanceof KnockoutDrawError ? t('tournaments.noDraws') : t('common.error') }))
      refresh()
    }
  }

  if (loading) {
    return (
      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white text-lg">{t('tournaments.liveControlTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-text-muted">{t('common.loading')}</p>
        </CardContent>
      </Card>
    )
  }

  const realMatches = matches.filter((m) => !m.isBye)
  if (realMatches.length === 0) return null

  const live = realMatches.filter((m) => deriveMatchState(m) === 'live')
  const upcoming = realMatches.filter((m) => deriveMatchState(m) === 'scheduled')
  const finished = realMatches.filter((m) => deriveMatchState(m) === 'finished')

  const renderMatch = (m: TournamentMatch & { id: string }) => {
    const state = deriveMatchState(m)
    const rink = rinks.find((r) => r.id === m.rinkId)
    const zone = zones.find((z) => z.id === m.zoneId)
    return (
      <div key={m.id} className="p-3 rounded border border-border space-y-2">
        <div className="flex justify-between items-center flex-wrap gap-2">
          <div>
            <p className="text-white text-sm font-medium">
              {m.teamA} <span className="text-text-muted">vs</span> {m.teamB}
            </p>
            <p className="text-text-muted text-xs">
              {m.date} · {m.startTime}
              {m.location === 'rink' ? ` · ${rink?.name ?? ''} — ${zone?.name ?? ''}` : m.venueName ? ` · ${m.venueName}` : ''}
            </p>
          </div>
          {state === 'live' && (
            <span className="flex items-center gap-1 text-status-danger text-xs font-semibold">
              <span className="h-2 w-2 rounded-full bg-status-danger animate-pulse" /> {t('tournaments.liveNow')}
            </span>
          )}
        </div>

        {state === 'scheduled' ? (
          <Button
            type="button"
            size="sm"
            onClick={() => handleStart(m)}
            disabled={busyMatchId === m.id}
            className="bg-primary hover:bg-primary-gold text-primary-foreground"
          >
            <Play className="h-3.5 w-3.5 mr-1" /> {t('tournaments.startMatch')}
          </Button>
        ) : (
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-white text-sm w-24 truncate">{m.teamA}</span>
              <Button type="button" size="sm" variant="outline" onClick={() => adjustScore(m, 'a', -1)}>
                -
              </Button>
              <span className="text-white text-lg font-bold w-6 text-center">{m.scoreA ?? 0}</span>
              <Button type="button" size="sm" variant="outline" onClick={() => adjustScore(m, 'a', 1)}>
                +
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-white text-sm w-24 truncate">{m.teamB}</span>
              <Button type="button" size="sm" variant="outline" onClick={() => adjustScore(m, 'b', -1)}>
                -
              </Button>
              <span className="text-white text-lg font-bold w-6 text-center">{m.scoreB ?? 0}</span>
              <Button type="button" size="sm" variant="outline" onClick={() => adjustScore(m, 'b', 1)}>
                +
              </Button>
            </div>
            {state === 'live' && (
              <Button
                type="button"
                size="sm"
                onClick={() => handleFinish(m)}
                disabled={busyMatchId === m.id}
                className="bg-primary hover:bg-primary-gold text-primary-foreground"
              >
                <Check className="h-3.5 w-3.5 mr-1" /> {t('tournaments.finishMatch')}
              </Button>
            )}
            {state === 'finished' && <span className="text-status-success text-xs">{t('tournaments.finishedBadge')}</span>}
          </div>
        )}
        {errorByMatch[m.id] && <p className="text-status-danger text-xs">{errorByMatch[m.id]}</p>}
      </div>
    )
  }

  return (
    <Card className="arena-card">
      <CardHeader>
        <CardTitle className="text-white text-lg">{t('tournaments.liveControlTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {live.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-white text-sm font-semibold">{t('tournaments.liveNow')}</h3>
            {live.map(renderMatch)}
          </div>
        )}
        {upcoming.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-white text-sm font-semibold">{t('tournaments.upcomingMatches')}</h3>
            {upcoming.map(renderMatch)}
          </div>
        )}
        {finished.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-white text-sm font-semibold">{t('tournaments.finishedMatches')}</h3>
            {finished.map(renderMatch)}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
