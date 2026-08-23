import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp, ArrowDown, Shuffle } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  fetchTournamentTeams,
  fetchTournamentMatches,
  setTeamSeedOrder,
  buildKnockoutPreview,
  createKnockoutBracket,
  setTournamentMatchResult,
  KnockoutDrawError
} from '@/lib/tournaments'
import { formatDateISO } from '@/lib/utils'
import { Club, DivisionMode, Rink, TournamentMatch, TournamentTeam, Zone } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import TournamentBracketView from './TournamentBracketView'

interface TournamentKnockoutGeneratorProps {
  tournamentId: string
  club: Club
  rinks: Rink[]
  zones: Zone[]
}

const FORMATS: DivisionMode[] = ['full', 'half', 'third']

/**
 * Knockout ("pavúk") bracket — before generation, shows the same kind of
 * config + live-preview flow as TournamentRoundRobinGenerator (team order,
 * rink/format/time/breaks); after generation, switches to a live bracket
 * view where any trainer/staff can record a match's result, which
 * auto-advances the winner into the next round (see
 * setTournamentMatchResult/lib/tournaments.ts) — never a silent
 * auto-move, the trainer must actually enter the score.
 */
export default function TournamentKnockoutGenerator({ tournamentId, club, rinks, zones }: TournamentKnockoutGeneratorProps) {
  const { t } = useTranslation()
  const { user, staff } = useAuth()
  const activeRinks = rinks.filter((r) => r.active).sort((a, b) => a.sortOrder - b.sortOrder)

  const [teams, setTeams] = useState<(TournamentTeam & { id: string })[]>([])
  const [order, setOrder] = useState<string[]>([])
  const [matches, setMatches] = useState<(TournamentMatch & { id: string })[]>([])
  const [loading, setLoading] = useState(true)

  const [rinkId, setRinkId] = useState('')
  const [format, setFormat] = useState<DivisionMode>('full')
  const [date, setDate] = useState(formatDateISO(new Date()))
  const [startTime, setStartTime] = useState('09:00')
  const [durationMinutes, setDurationMinutes] = useState(15)
  const [defaultBreakMinutes, setDefaultBreakMinutes] = useState(10)
  const [blocksIce, setBlocksIce] = useState(false)
  const [gapOverrides, setGapOverrides] = useState<Record<number, number>>({})
  const [generating, setGenerating] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [scoreInputs, setScoreInputs] = useState<Record<string, { a: string; b: string }>>({})
  const [savingMatchId, setSavingMatchId] = useState<string | null>(null)

  const refresh = () => {
    setLoading(true)
    Promise.all([fetchTournamentTeams(tournamentId), fetchTournamentMatches(tournamentId)])
      .then(([fetchedTeams, fetchedMatches]) => {
        setTeams(fetchedTeams)
        setOrder((prev) => {
          const known = prev.filter((id) => fetchedTeams.some((tm) => tm.id === id))
          const added = fetchedTeams.filter((tm) => !known.includes(tm.id)).map((tm) => tm.id)
          return known.length ? [...known, ...added] : fetchedTeams.map((tm) => tm.id)
        })
        setMatches(fetchedMatches.filter((m) => m.schema === 'knockout'))
      })
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [tournamentId])

  useEffect(() => {
    if (activeRinks.length && !rinkId) setRinkId(activeRinks[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRinks])

  const zonesForSelection = rinkId
    ? zones.filter((z) => z.rinkId === rinkId && z.mode === format).sort((a, b) => a.slotIndex - b.slotIndex)
    : []
  const nameById = new Map(teams.map((tm) => [tm.id, tm.name]))
  const orderedTeams = order.map((id) => ({ id, name: nameById.get(id) ?? '' })).filter((tm) => tm.name)
  const orderedIds = orderedTeams.map((tm) => tm.id).join(',')

  const preview = useMemo(() => {
    if (orderedTeams.length < 2 || zonesForSelection.length === 0) return null
    return buildKnockoutPreview(orderedTeams, zonesForSelection.length, startTime, durationMinutes, defaultBreakMinutes, gapOverrides)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedIds, zonesForSelection.length, startTime, durationMinutes, defaultBreakMinutes, gapOverrides])

  const moveTeam = (index: number, dir: -1 | 1) => {
    setOrder((prev) => {
      const next = [...prev]
      const target = index + dir
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const shuffleTeams = () => {
    setOrder((prev) => {
      const next = [...prev]
      for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[next[i], next[j]] = [next[j], next[i]]
      }
      return next
    })
  }

  const handleGenerate = async () => {
    if (!preview || !rinkId || !user || !staff) return
    setGenerating(true)
    setErrorMessage(null)
    try {
      await setTeamSeedOrder(order)
      await createKnockoutBracket({
        tournamentId,
        clubId: club.id,
        date,
        rinkId,
        zoneIds: zonesForSelection.map((z) => z.id),
        format,
        durationMinutes,
        blocksIce,
        createdBy: user.uid,
        ...(blocksIce
          ? { bookingContact: { name: `${t('tournaments.bookingLabel')} — pavúk`, email: staff.email, phone: '', timezone: club.timezone } }
          : {}),
        preview,
        resolvePlaceholder: (matchNumber) => t('tournaments.winnerOfMatch', { n: matchNumber })
      })
      refresh()
    } catch (err) {
      console.error('Error generating knockout bracket:', err)
      setErrorMessage(t('common.error'))
    } finally {
      setGenerating(false)
    }
  }

  const handleScoreChange = (matchId: string, side: 'a' | 'b', value: string) => {
    setScoreInputs((prev) => ({ ...prev, [matchId]: { a: side === 'a' ? value : prev[matchId]?.a ?? '', b: side === 'b' ? value : prev[matchId]?.b ?? '' } }))
  }

  const handleSaveResult = async (match: TournamentMatch & { id: string }) => {
    const input = scoreInputs[match.id]
    const scoreA = parseInt(input?.a ?? '', 10)
    const scoreB = parseInt(input?.b ?? '', 10)
    if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB)) return
    setSavingMatchId(match.id)
    setErrorMessage(null)
    try {
      await setTournamentMatchResult(match.id, scoreA, scoreB)
      refresh()
    } catch (err) {
      setErrorMessage(err instanceof KnockoutDrawError ? t('tournaments.noDraws') : t('common.error'))
    } finally {
      setSavingMatchId(null)
    }
  }

  if (loading) {
    return (
      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white text-lg">{t('tournaments.knockoutTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-text-muted">{t('common.loading')}</p>
        </CardContent>
      </Card>
    )
  }

  if (matches.length > 0) {
    return (
      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white text-lg">{t('tournaments.knockoutTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {errorMessage && <p className="text-status-danger text-sm">{errorMessage}</p>}
          <TournamentBracketView
            matches={matches}
            scoreInputs={scoreInputs}
            onScoreChange={handleScoreChange}
            onSaveResult={handleSaveResult}
            savingMatchId={savingMatchId}
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="arena-card">
      <CardHeader>
        <CardTitle className="text-white text-lg">{t('tournaments.knockoutTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {teams.length < 2 ? (
          <p className="text-text-muted text-sm">{t('tournaments.needAtLeastTwoTeams')}</p>
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-white">{t('tournaments.seedOrder')}</Label>
                <Button type="button" variant="outline" size="sm" onClick={shuffleTeams}>
                  <Shuffle className="h-4 w-4 mr-1" /> {t('tournaments.shuffleTeams')}
                </Button>
              </div>
              <div className="space-y-1">
                {orderedTeams.map((tm, i) => (
                  <div key={tm.id} className="flex items-center gap-2 bg-background-dark border border-border rounded-md px-2 py-1">
                    <span className="text-text-muted text-xs w-5">{i + 1}.</span>
                    <span className="text-white text-sm flex-1">{tm.name}</span>
                    <Button type="button" size="sm" variant="outline" disabled={i === 0} onClick={() => moveTeam(i, -1)}>
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" size="sm" variant="outline" disabled={i === orderedTeams.length - 1} onClick={() => moveTeam(i, 1)}>
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              {preview && preview.byeCount > 0 && (
                <p className="text-text-muted text-xs">{t('tournaments.byeHint', { count: preview.byeCount })}</p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label className="text-white">{t('tournaments.rink')}</Label>
                <select value={rinkId} onChange={(e) => setRinkId(e.target.value)} className="w-full bg-background-dark border border-border text-white rounded-md px-3 py-2">
                  {activeRinks.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-white">{t('tournaments.format')}</Label>
                <select value={format} onChange={(e) => setFormat(e.target.value as DivisionMode)} className="w-full bg-background-dark border border-border text-white rounded-md px-3 py-2">
                  {FORMATS.map((f) => (
                    <option key={f} value={f}>{t(`tournaments.formatOption.${f}`)}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-white">{t('common.date')}</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-background-dark border-border text-white" />
              </div>
              <div>
                <Label className="text-white">{t('common.time')}</Label>
                <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="bg-background-dark border-border text-white" />
              </div>
              <div>
                <Label className="text-white">{t('tournaments.durationMinutes')}</Label>
                <Input
                  type="number"
                  min={5}
                  step={5}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Math.max(5, parseInt(e.target.value, 10) || 5))}
                  className="bg-background-dark border-border text-white"
                />
              </div>
              <div>
                <Label className="text-white">{t('tournaments.defaultBreak')}</Label>
                <Input
                  type="number"
                  min={0}
                  step={5}
                  value={defaultBreakMinutes}
                  onChange={(e) => setDefaultBreakMinutes(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="bg-background-dark border-border text-white"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-white">
              <input type="checkbox" checked={blocksIce} onChange={(e) => setBlocksIce(e.target.checked)} className="h-4 w-4" />
              {t('tournaments.blocksIceLabel')}
            </label>

            {preview && (
              <div className="space-y-3 border-t border-border pt-4">
                <p className="text-text-secondary text-sm">{t('tournaments.knockoutPreviewHint', { rounds: preview.rounds.length })}</p>
                {preview.rounds.map((round, r) => (
                  <div key={r} className="space-y-1">
                    <h4 className="text-white text-xs font-semibold">{t('tournaments.roundLabel', { n: r + 1 })}</h4>
                    {round.map((m) => (
                      <div key={m.matchNumber} className="flex flex-wrap gap-2 items-center bg-background-dark border border-border rounded-md p-2">
                        {m.startTime && <span className="text-primary text-sm font-medium mono">{m.startTime}</span>}
                        <span className="text-white text-sm">
                          {m.teamA.name ?? t('tournaments.winnerOfMatch', { n: m.matchNumber })}
                          {' '}
                          <span className="text-text-muted">vs</span>{' '}
                          {m.teamB.name ?? t('tournaments.winnerOfMatch', { n: m.matchNumber })}
                        </span>
                        {m.isBye && <span className="text-text-muted text-xs">({t('tournaments.byeLabel')})</span>}
                      </div>
                    ))}
                  </div>
                ))}

                {preview.slots.length > 1 && (
                  <div className="space-y-1 border-t border-border pt-3">
                    <p className="text-text-muted text-xs">{t('tournaments.breaksHint')}</p>
                    {preview.slots.slice(0, -1).map((slot) => (
                      <div key={slot.index} className="flex items-center gap-2">
                        <span className="text-text-muted text-xs mono w-12">{slot.startTime}</span>
                        <Label className="text-text-muted text-xs">{t('tournaments.breakAfterMinutes')}</Label>
                        <Input
                          type="number"
                          min={0}
                          step={5}
                          value={gapOverrides[slot.index] ?? defaultBreakMinutes}
                          onChange={(e) => setGapOverrides((prev) => ({ ...prev, [slot.index]: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
                          className="bg-background-dark border-border text-white w-20 h-7 text-xs"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {errorMessage && <p className="text-status-danger text-sm">{errorMessage}</p>}

            <Button type="button" onClick={handleGenerate} disabled={!preview || generating} className="bg-primary hover:bg-primary-gold text-primary-foreground">
              {generating ? t('common.saving') : t('tournaments.generateKnockout')}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
