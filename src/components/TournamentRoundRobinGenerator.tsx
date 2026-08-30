import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp, ArrowDown, Shuffle } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { fetchTournamentTeams, setTeamSeedOrder, buildRoundRobinPreview, createRoundRobinSchedule, ScheduleSlotLocation } from '@/lib/tournaments'
import { formatDateISO } from '@/lib/utils'
import { Club, DivisionMode, Rink, TournamentTeam, Zone } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'

interface TournamentRoundRobinGeneratorProps {
  tournamentId: string
  club: Club
  rinks: Rink[]
  zones: Zone[]
}

const FORMATS: DivisionMode[] = ['full', 'half', 'halfLengthwise', 'third']

/**
 * Round-robin ("každý s každým") schedule generator — every team plays
 * every other team exactly once, via the standard circle-method pairing
 * (buildRoundRobinPreview/lib/tournaments.ts). The trainer can reorder
 * teams manually (up/down) or shuffle randomly before generating; the
 * order is cosmetic for round-robin fairness itself but persisted via
 * setTeamSeedOrder so a later knockout/groups phase can reuse it.
 *
 * The live preview recomputes instantly as any input changes (pure
 * function, no Firestore round-trip) so the trainer can freely try
 * different rinks/formats/times before committing anything — only
 * clicking "generate" actually writes matches.
 */
export default function TournamentRoundRobinGenerator({ tournamentId, club, rinks, zones }: TournamentRoundRobinGeneratorProps) {
  const { t } = useTranslation()
  const { user, staff } = useAuth()
  const activeRinks = rinks.filter((r) => r.active).sort((a, b) => a.sortOrder - b.sortOrder)

  const [teams, setTeams] = useState<(TournamentTeam & { id: string })[]>([])
  const [order, setOrder] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  const [rinkIds, setRinkIds] = useState<string[]>([])
  const [format, setFormat] = useState<DivisionMode>('full')
  const [date, setDate] = useState(formatDateISO(new Date()))
  const [startTime, setStartTime] = useState('09:00')
  const [durationMinutes, setDurationMinutes] = useState(15)
  const [defaultBreakMinutes, setDefaultBreakMinutes] = useState(10)
  const [blocksIce, setBlocksIce] = useState(false)
  const [gapOverrides, setGapOverrides] = useState<Record<number, number>>({})
  const [generating, setGenerating] = useState(false)
  const [resultMessage, setResultMessage] = useState<string | null>(null)

  const refresh = () => {
    setLoading(true)
    fetchTournamentTeams(tournamentId)
      .then((fetched) => {
        setTeams(fetched)
        setOrder((prev) => {
          const known = prev.filter((id) => fetched.some((tm) => tm.id === id))
          const added = fetched.filter((tm) => !known.includes(tm.id)).map((tm) => tm.id)
          return known.length ? [...known, ...added] : fetched.map((tm) => tm.id)
        })
      })
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [tournamentId])

  useEffect(() => {
    if (activeRinks.length && rinkIds.length === 0) setRinkIds([activeRinks[0].id])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRinks])

  const toggleRink = (id: string) => {
    setRinkIds((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]))
  }

  // Combining every selected rink's own zones for the chosen format lets
  // the same tournament run in parallel across more than one physical
  // rink at once (e.g. "half" on two rinks = 4 simultaneous matches) —
  // ordered by rink first so slotLocations lines up with zonesForSelection
  // one-to-one.
  const zonesForSelection = activeRinks
    .filter((r) => rinkIds.includes(r.id))
    .flatMap((r) => zones.filter((z) => z.rinkId === r.id && z.mode === format).sort((a, b) => a.slotIndex - b.slotIndex))
  const slotLocations: ScheduleSlotLocation[] = zonesForSelection.map((z) => ({ rinkId: z.rinkId, zoneId: z.id }))
  const rinkNameById = new Map(activeRinks.map((r) => [r.id, r.name]))
  const nameById = new Map(teams.map((tm) => [tm.id, tm.name]))
  const orderedTeams = order.map((id) => ({ id, name: nameById.get(id) ?? '' })).filter((tm) => tm.name)
  const orderedIds = orderedTeams.map((tm) => tm.id).join(',')

  const preview = useMemo(() => {
    if (orderedTeams.length < 2 || zonesForSelection.length === 0) return null
    return buildRoundRobinPreview(orderedTeams, zonesForSelection.length, startTime, durationMinutes, defaultBreakMinutes, gapOverrides)
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
    if (!preview || rinkIds.length === 0 || !user || !staff) return
    setGenerating(true)
    setResultMessage(null)
    try {
      await setTeamSeedOrder(order)
      const count = await createRoundRobinSchedule({
        tournamentId,
        clubId: club.id,
        date,
        slotLocations,
        format,
        durationMinutes,
        blocksIce,
        createdBy: user.uid,
        ...(blocksIce
          ? { bookingContact: { name: `${t('tournaments.bookingLabel')} — round robin`, email: staff.email, phone: '', timezone: club.timezone } }
          : {}),
        preview
      })
      setResultMessage(t('tournaments.roundRobinCreated', { count }))
      setGapOverrides({})
    } catch (err) {
      console.error('Error generating round-robin schedule:', err)
      setResultMessage(t('common.error'))
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Card className="arena-card">
      <CardHeader>
        <CardTitle className="text-white text-lg">{t('tournaments.roundRobinTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-text-muted">{t('common.loading')}</p>
        ) : teams.length < 2 ? (
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
            </div>

            <div className="space-y-1">
              <Label className="text-white">{t('tournaments.rinks')}</Label>
              <div className="flex flex-wrap gap-3">
                {activeRinks.map((r) => (
                  <label key={r.id} className="flex items-center gap-1.5 text-sm text-white">
                    <input type="checkbox" checked={rinkIds.includes(r.id)} onChange={() => toggleRink(r.id)} className="h-4 w-4" />
                    {r.name}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
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
                {preview.slots.map((slot, i) => (
                  <div key={slot.index} className="space-y-1">
                    <div className="flex flex-wrap gap-2 items-center bg-background-dark border border-border rounded-md p-2">
                      <span className="text-primary text-sm font-medium mono">{slot.startTime}</span>
                      {slot.pairs.map((p, pIdx) => (
                        <span key={pIdx} className="text-white text-sm">
                          {p.teamAName} <span className="text-text-muted">vs</span> {p.teamBName}
                          <span className="text-text-muted text-xs">
                            {' '}({rinkNameById.get(zonesForSelection[pIdx]?.rinkId) ?? ''} — {zonesForSelection[pIdx]?.name ?? ''})
                          </span>
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

            {resultMessage && <p className="text-status-success text-sm">{resultMessage}</p>}

            <Button type="button" onClick={handleGenerate} disabled={!preview || rinkIds.length === 0 || generating} className="bg-primary hover:bg-primary-gold text-primary-foreground">
              {generating ? t('common.saving') : t('tournaments.generateRoundRobin')}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
