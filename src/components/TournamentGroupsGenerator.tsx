import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp, ArrowDown, Shuffle } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  fetchTournamentTeams,
  fetchTournamentMatches,
  setTeamGroups,
  buildGroupsPreview,
  createGroupsSchedule,
  computeGroupStandings,
  setGroupMatchResult,
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

interface TournamentGroupsGeneratorProps {
  tournamentId: string
  club: Club
  rinks: Rink[]
  zones: Zone[]
}

const FORMATS: DivisionMode[] = ['full', 'half', 'third']

/**
 * "Skupiny + play-off" (Fáza D) — teams are split into lettered groups,
 * each group plays a round-robin among its own members
 * (buildGroupsPreview/lib/tournaments.ts), then the trainer picks how
 * many teams advance from each group into a knockout bracket generated
 * from live standings via the same buildKnockoutPreview/
 * createKnockoutBracket machinery Fáza C already built — just tagged
 * schema: 'groupsPlayoff' so it never mixes with a standalone "pavúk".
 *
 * Group assignment supports both an automatic snake distribution across
 * the current team order (so consecutive seeds don't all land in the same
 * group) and a manual per-team override afterwards, per the trainer's
 * explicit request to support both ways.
 */
export default function TournamentGroupsGenerator({ tournamentId, club, rinks, zones }: TournamentGroupsGeneratorProps) {
  const { t } = useTranslation()
  const { user, staff } = useAuth()
  const activeRinks = rinks.filter((r) => r.active).sort((a, b) => a.sortOrder - b.sortOrder)

  const [teams, setTeams] = useState<(TournamentTeam & { id: string })[]>([])
  const [order, setOrder] = useState<string[]>([])
  const [groupAssignment, setGroupAssignment] = useState<Record<string, string>>({})
  const [groupCount, setGroupCount] = useState(2)
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

  const [playoffRinkId, setPlayoffRinkId] = useState('')
  const [playoffFormat, setPlayoffFormat] = useState<DivisionMode>('full')
  const [playoffDate, setPlayoffDate] = useState(formatDateISO(new Date()))
  const [playoffStartTime, setPlayoffStartTime] = useState('09:00')
  const [playoffDuration, setPlayoffDuration] = useState(15)
  const [playoffDefaultBreak, setPlayoffDefaultBreak] = useState(10)
  const [playoffBlocksIce, setPlayoffBlocksIce] = useState(false)
  const [playoffGapOverrides, setPlayoffGapOverrides] = useState<Record<number, number>>({})
  const [advanceCount, setAdvanceCount] = useState(2)
  const [generatingPlayoff, setGeneratingPlayoff] = useState(false)

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
        setGroupAssignment((prev) => {
          const next: Record<string, string> = {}
          fetchedTeams.forEach((tm) => {
            next[tm.id] = prev[tm.id] ?? tm.groupId ?? ''
          })
          return next
        })
        setMatches(fetchedMatches.filter((m) => m.schema === 'groups' || m.schema === 'groupsPlayoff'))
      })
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [tournamentId])

  useEffect(() => {
    if (activeRinks.length && !rinkId) setRinkId(activeRinks[0].id)
    if (activeRinks.length && !playoffRinkId) setPlayoffRinkId(activeRinks[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRinks])

  const nameById = new Map(teams.map((tm) => [tm.id, tm.name]))
  const orderedTeams = order.map((id) => ({ id, name: nameById.get(id) ?? '' })).filter((tm) => tm.name)
  const groupLabels = Array.from({ length: groupCount }, (_, i) => String.fromCharCode(65 + i))

  const zonesForSelection = rinkId
    ? zones.filter((z) => z.rinkId === rinkId && z.mode === format).sort((a, b) => a.slotIndex - b.slotIndex)
    : []
  const playoffZonesForSelection = playoffRinkId
    ? zones.filter((z) => z.rinkId === playoffRinkId && z.mode === playoffFormat).sort((a, b) => a.slotIndex - b.slotIndex)
    : []

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

  const autoAssignGroups = () => {
    const assignment: Record<string, string> = {}
    let g = 0
    let dir: 1 | -1 = 1
    for (const teamId of order) {
      assignment[teamId] = groupLabels[g]
      g += dir
      if (g >= groupCount) {
        g = groupCount - 1
        dir = -1
      } else if (g < 0) {
        g = 0
        dir = 1
      }
    }
    setGroupAssignment(assignment)
  }

  const assignmentKey = order.map((id) => `${id}:${groupAssignment[id] ?? ''}`).join('|')
  const groupsInput = useMemo(
    () =>
      groupLabels.map((label) => ({
        id: label,
        name: label,
        teams: order.filter((id) => groupAssignment[id] === label).map((id) => ({ id, name: nameById.get(id) ?? '' })).filter((tm) => tm.name)
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assignmentKey, groupCount]
  )

  const preview = useMemo(() => {
    if (zonesForSelection.length === 0) return null
    const totalAssigned = groupsInput.reduce((sum, g) => sum + g.teams.length, 0)
    if (totalAssigned < 2) return null
    return buildGroupsPreview(groupsInput, zonesForSelection.length, startTime, durationMinutes, defaultBreakMinutes, gapOverrides)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupsInput, zonesForSelection.length, startTime, durationMinutes, defaultBreakMinutes, gapOverrides])

  const handleGenerateGroups = async () => {
    if (!preview || !rinkId || !user || !staff) return
    setGenerating(true)
    setErrorMessage(null)
    try {
      const assignments = order.filter((id) => groupAssignment[id]).map((id) => ({ id, groupId: groupAssignment[id] }))
      await setTeamGroups(assignments)
      await createGroupsSchedule({
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
          ? { bookingContact: { name: `${t('tournaments.bookingLabel')} — ${t('tournaments.groupsTitle')}`, email: staff.email, phone: '', timezone: club.timezone } }
          : {}),
        preview
      })
      setGapOverrides({})
      refresh()
    } catch (err) {
      console.error('Error generating groups schedule:', err)
      setErrorMessage(t('common.error'))
    } finally {
      setGenerating(false)
    }
  }

  const handleScoreChange = (matchId: string, side: 'a' | 'b', value: string) => {
    setScoreInputs((prev) => ({ ...prev, [matchId]: { a: side === 'a' ? value : prev[matchId]?.a ?? '', b: side === 'b' ? value : prev[matchId]?.b ?? '' } }))
  }

  const handleSaveGroupResult = async (match: TournamentMatch & { id: string }) => {
    const input = scoreInputs[match.id]
    const scoreA = parseInt(input?.a ?? '', 10)
    const scoreB = parseInt(input?.b ?? '', 10)
    if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB)) return
    setSavingMatchId(match.id)
    setErrorMessage(null)
    try {
      await setGroupMatchResult(match.id, scoreA, scoreB)
      refresh()
    } catch (err) {
      console.error('Error saving group match result:', err)
      setErrorMessage(t('common.error'))
    } finally {
      setSavingMatchId(null)
    }
  }

  const handleSavePlayoffResult = async (match: TournamentMatch & { id: string }) => {
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

  const groupMatches = matches.filter((m) => m.schema === 'groups')
  const playoffMatches = matches.filter((m) => m.schema === 'groupsPlayoff')
  const hasGroupSchedule = groupMatches.length > 0
  const hasPlayoff = playoffMatches.length > 0

  const groupMatchesByGroup = new Map<string, (TournamentMatch & { id: string })[]>()
  groupMatches.forEach((m) => {
    const g = m.groupId ?? '?'
    if (!groupMatchesByGroup.has(g)) groupMatchesByGroup.set(g, [])
    groupMatchesByGroup.get(g)!.push(m)
  })
  const groupIds = Array.from(groupMatchesByGroup.keys()).sort()

  const standingsByGroup = new Map(
    groupIds.map((g) => {
      const ms = groupMatchesByGroup.get(g)!
      const teamIds = new Set<string>()
      ms.forEach((m) => {
        if (m.teamAId) teamIds.add(m.teamAId)
        if (m.teamBId) teamIds.add(m.teamBId)
      })
      const groupTeams = Array.from(teamIds).map((id) => ({ id, name: nameById.get(id) ?? '' }))
      return [g, computeGroupStandings(groupTeams, ms)] as const
    })
  )

  const allGroupMatchesDecided = groupMatches.length > 0 && groupMatches.every((m) => m.scoreA != null && m.scoreB != null)

  const advancingTeams = (() => {
    const list: { id: string; name: string }[] = []
    for (let rank = 0; rank < advanceCount; rank++) {
      for (const g of groupIds) {
        const row = standingsByGroup.get(g)?.[rank]
        if (row) list.push({ id: row.teamId, name: row.teamName })
      }
    }
    return list
  })()
  const advancingTeamIds = advancingTeams.map((tm) => tm.id).join(',')

  const playoffPreview = useMemo(() => {
    if (advancingTeams.length < 2 || playoffZonesForSelection.length === 0) return null
    return buildKnockoutPreview(advancingTeams, playoffZonesForSelection.length, playoffStartTime, playoffDuration, playoffDefaultBreak, playoffGapOverrides)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advancingTeamIds, playoffZonesForSelection.length, playoffStartTime, playoffDuration, playoffDefaultBreak, playoffGapOverrides])

  const handleGeneratePlayoff = async () => {
    if (!playoffPreview || !playoffRinkId || !user || !staff) return
    setGeneratingPlayoff(true)
    setErrorMessage(null)
    try {
      await createKnockoutBracket({
        tournamentId,
        clubId: club.id,
        date: playoffDate,
        rinkId: playoffRinkId,
        zoneIds: playoffZonesForSelection.map((z) => z.id),
        format: playoffFormat,
        durationMinutes: playoffDuration,
        blocksIce: playoffBlocksIce,
        createdBy: user.uid,
        ...(playoffBlocksIce
          ? { bookingContact: { name: `${t('tournaments.bookingLabel')} — ${t('tournaments.playoffTitle')}`, email: staff.email, phone: '', timezone: club.timezone } }
          : {}),
        preview: playoffPreview,
        resolvePlaceholder: (n) => t('tournaments.winnerOfMatch', { n }),
        schema: 'groupsPlayoff'
      })
      refresh()
    } catch (err) {
      console.error('Error generating groups play-off bracket:', err)
      setErrorMessage(t('common.error'))
    } finally {
      setGeneratingPlayoff(false)
    }
  }

  return (
    <Card className="arena-card">
      <CardHeader>
        <CardTitle className="text-white text-lg">{t('tournaments.groupsTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <p className="text-text-muted">{t('common.loading')}</p>
        ) : teams.length < 4 && !hasGroupSchedule ? (
          <p className="text-text-muted text-sm">{t('tournaments.needAtLeastFourTeams')}</p>
        ) : !hasGroupSchedule ? (
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
                    <select
                      value={groupAssignment[tm.id] ?? ''}
                      onChange={(e) => setGroupAssignment((prev) => ({ ...prev, [tm.id]: e.target.value }))}
                      className="bg-background-dark border border-border text-white rounded-md px-2 py-1 text-xs"
                    >
                      <option value="">—</option>
                      {groupLabels.map((label) => (
                        <option key={label} value={label}>{label}</option>
                      ))}
                    </select>
                    <Button type="button" size="sm" variant="outline" disabled={i === 0} onClick={() => moveTeam(i, -1)}>
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" size="sm" variant="outline" disabled={i === orderedTeams.length - 1} onClick={() => moveTeam(i, 1)}>
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label className="text-white">{t('tournaments.groupCount')}</Label>
                <Input
                  type="number"
                  min={2}
                  max={8}
                  value={groupCount}
                  onChange={(e) => setGroupCount(Math.min(8, Math.max(2, parseInt(e.target.value, 10) || 2)))}
                  className="bg-background-dark border-border text-white w-24"
                />
              </div>
              <Button type="button" variant="outline" size="sm" onClick={autoAssignGroups}>
                {t('tournaments.autoAssignGroups')}
              </Button>
              <p className="text-text-muted text-xs">{t('tournaments.groupAssignHint')}</p>
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
              <div className="space-y-2 border-t border-border pt-4">
                <p className="text-text-secondary text-sm">{t('tournaments.previewHint', { count: preview.totalMatches })}</p>
                {preview.groups
                  .filter((g) => g.teamCount > 0 && g.teamCount < 2)
                  .map((g) => (
                    <p key={g.id} className="text-text-muted text-xs">{t('tournaments.groupTooSmall', { name: g.name })}</p>
                  ))}
                {preview.slots.map((slot, i) => (
                  <div key={slot.index} className="space-y-1">
                    <div className="flex flex-wrap gap-2 items-center bg-background-dark border border-border rounded-md p-2">
                      <span className="text-primary text-sm font-medium mono">{slot.startTime}</span>
                      {slot.pairs.map((p, pIdx) => (
                        <span key={pIdx} className="text-white text-sm">
                          <span className="text-text-muted">[{p.groupName}]</span> {p.teamAName} <span className="text-text-muted">vs</span> {p.teamBName}
                          {pIdx < slot.pairs.length - 1 ? ' · ' : ''}
                        </span>
                      ))}
                    </div>
                    {i < preview.slots.length - 1 && (
                      <div className="flex items-center gap-2 pl-2">
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
                    )}
                  </div>
                ))}
              </div>
            )}

            {errorMessage && <p className="text-status-danger text-sm">{errorMessage}</p>}

            <Button type="button" onClick={handleGenerateGroups} disabled={!preview || generating} className="bg-primary hover:bg-primary-gold text-primary-foreground">
              {generating ? t('common.saving') : t('tournaments.generateGroups')}
            </Button>
          </>
        ) : (
          <>
            {errorMessage && <p className="text-status-danger text-sm">{errorMessage}</p>}
            <div className="space-y-4">
              {groupIds.map((g) => (
                <div key={g} className="space-y-2">
                  <h3 className="text-white text-sm font-semibold">{t('tournaments.groupLabel', { name: g })}</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead>
                        <tr className="text-text-muted">
                          <th className="py-1 pr-2">{t('tournaments.standingsTeam')}</th>
                          <th className="px-1 text-center">{t('tournaments.standingsPlayed')}</th>
                          <th className="px-1 text-center">{t('tournaments.standingsWins')}</th>
                          <th className="px-1 text-center">{t('tournaments.standingsDraws')}</th>
                          <th className="px-1 text-center">{t('tournaments.standingsLosses')}</th>
                          <th className="px-1 text-center">{t('tournaments.standingsGoals')}</th>
                          <th className="px-1 text-center">{t('tournaments.standingsPoints')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(standingsByGroup.get(g) ?? []).map((row) => (
                          <tr key={row.teamId}>
                            <td className="py-1 pr-2 text-white">{row.teamName}</td>
                            <td className="px-1 text-center text-white">{row.played}</td>
                            <td className="px-1 text-center text-white">{row.wins}</td>
                            <td className="px-1 text-center text-white">{row.draws}</td>
                            <td className="px-1 text-center text-white">{row.losses}</td>
                            <td className="px-1 text-center text-white">{row.goalsFor}:{row.goalsAgainst}</td>
                            <td className="px-1 text-center text-white font-semibold">{row.points}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="space-y-1">
                    {(groupMatchesByGroup.get(g) ?? []).map((m) => {
                      const decided = m.scoreA != null && m.scoreB != null
                      return (
                        <div key={m.id} className="flex flex-wrap justify-between items-center gap-2 p-2 rounded border border-border">
                          <div>
                            <p className="text-white text-sm">
                              {m.teamA} <span className="text-text-muted">vs</span> {m.teamB}
                            </p>
                            <p className="text-text-muted text-xs">{m.date} · {m.startTime}</p>
                          </div>
                          {decided ? (
                            <span className="text-status-success text-sm font-medium">{m.scoreA} : {m.scoreB}</span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <Input
                                type="number"
                                min={0}
                                value={scoreInputs[m.id]?.a ?? ''}
                                onChange={(e) => handleScoreChange(m.id, 'a', e.target.value)}
                                className="bg-background-dark border-border text-white w-16 h-8"
                              />
                              <span className="text-text-muted text-xs">:</span>
                              <Input
                                type="number"
                                min={0}
                                value={scoreInputs[m.id]?.b ?? ''}
                                onChange={(e) => handleScoreChange(m.id, 'b', e.target.value)}
                                className="bg-background-dark border-border text-white w-16 h-8"
                              />
                              <Button
                                type="button"
                                size="sm"
                                disabled={savingMatchId === m.id}
                                onClick={() => handleSaveGroupResult(m)}
                                className="bg-primary hover:bg-primary-gold text-primary-foreground"
                              >
                                {t('tournaments.saveResult')}
                              </Button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-border pt-4 space-y-4">
              <h3 className="text-white text-lg font-semibold">{t('tournaments.playoffTitle')}</h3>
              {!hasPlayoff ? (
                <>
                  {!allGroupMatchesDecided && <p className="text-text-muted text-xs">{t('tournaments.groupsNotFinishedHint')}</p>}
                  <div>
                    <Label className="text-white">{t('tournaments.advanceCount')}</Label>
                    <Input
                      type="number"
                      min={1}
                      max={8}
                      value={advanceCount}
                      onChange={(e) => setAdvanceCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="bg-background-dark border-border text-white w-24"
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <Label className="text-white">{t('tournaments.rink')}</Label>
                      <select value={playoffRinkId} onChange={(e) => setPlayoffRinkId(e.target.value)} className="w-full bg-background-dark border border-border text-white rounded-md px-3 py-2">
                        {activeRinks.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label className="text-white">{t('tournaments.format')}</Label>
                      <select value={playoffFormat} onChange={(e) => setPlayoffFormat(e.target.value as DivisionMode)} className="w-full bg-background-dark border border-border text-white rounded-md px-3 py-2">
                        {FORMATS.map((f) => (
                          <option key={f} value={f}>{t(`tournaments.formatOption.${f}`)}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label className="text-white">{t('common.date')}</Label>
                      <Input type="date" value={playoffDate} onChange={(e) => setPlayoffDate(e.target.value)} className="bg-background-dark border-border text-white" />
                    </div>
                    <div>
                      <Label className="text-white">{t('common.time')}</Label>
                      <Input type="time" value={playoffStartTime} onChange={(e) => setPlayoffStartTime(e.target.value)} className="bg-background-dark border-border text-white" />
                    </div>
                    <div>
                      <Label className="text-white">{t('tournaments.durationMinutes')}</Label>
                      <Input
                        type="number"
                        min={5}
                        step={5}
                        value={playoffDuration}
                        onChange={(e) => setPlayoffDuration(Math.max(5, parseInt(e.target.value, 10) || 5))}
                        className="bg-background-dark border-border text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-white">{t('tournaments.defaultBreak')}</Label>
                      <Input
                        type="number"
                        min={0}
                        step={5}
                        value={playoffDefaultBreak}
                        onChange={(e) => setPlayoffDefaultBreak(Math.max(0, parseInt(e.target.value, 10) || 0))}
                        className="bg-background-dark border-border text-white"
                      />
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-sm text-white">
                    <input type="checkbox" checked={playoffBlocksIce} onChange={(e) => setPlayoffBlocksIce(e.target.checked)} className="h-4 w-4" />
                    {t('tournaments.blocksIceLabel')}
                  </label>

                  {advancingTeams.length > 0 && (
                    <p className="text-text-secondary text-sm">{t('tournaments.advancingTeamsHint', { names: advancingTeams.map((tm) => tm.name).join(', ') })}</p>
                  )}

                  {playoffPreview && (
                    <div className="space-y-3 border-t border-border pt-4">
                      <p className="text-text-secondary text-sm">{t('tournaments.knockoutPreviewHint', { rounds: playoffPreview.rounds.length })}</p>
                      {playoffPreview.rounds.map((round, r) => (
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

                      {playoffPreview.slots.length > 1 && (
                        <div className="space-y-1 border-t border-border pt-3">
                          <p className="text-text-muted text-xs">{t('tournaments.breaksHint')}</p>
                          {playoffPreview.slots.slice(0, -1).map((slot) => (
                            <div key={slot.index} className="flex items-center gap-2">
                              <span className="text-text-muted text-xs mono w-12">{slot.startTime}</span>
                              <Label className="text-text-muted text-xs">{t('tournaments.breakAfterMinutes')}</Label>
                              <Input
                                type="number"
                                min={0}
                                step={5}
                                value={playoffGapOverrides[slot.index] ?? playoffDefaultBreak}
                                onChange={(e) => setPlayoffGapOverrides((prev) => ({ ...prev, [slot.index]: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
                                className="bg-background-dark border-border text-white w-20 h-7 text-xs"
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <Button
                    type="button"
                    onClick={handleGeneratePlayoff}
                    disabled={!playoffPreview || generatingPlayoff}
                    className="bg-primary hover:bg-primary-gold text-primary-foreground"
                  >
                    {generatingPlayoff ? t('common.saving') : t('tournaments.generatePlayoff')}
                  </Button>
                </>
              ) : (
                <TournamentBracketView
                  matches={playoffMatches}
                  scoreInputs={scoreInputs}
                  onScoreChange={handleScoreChange}
                  onSaveResult={handleSavePlayoffResult}
                  savingMatchId={savingMatchId}
                />
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
