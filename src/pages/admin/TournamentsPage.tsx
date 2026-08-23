import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { useClubData } from '@/hooks/useClubData'
import {
  createTournament,
  fetchTournaments,
  deleteTournament,
  createTournamentMatch,
  fetchTournamentMatches,
  deleteTournamentMatch,
  SlotUnavailableError
} from '@/lib/tournaments'
import { formatDateISO } from '@/lib/utils'
import { DivisionMode, Tournament, TournamentMatch } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import RinkDiagram from '@/components/RinkDiagram'
import TournamentTeamsPanel from '@/components/TournamentTeamsPanel'
import TournamentRoundRobinGenerator from '@/components/TournamentRoundRobinGenerator'
import TournamentKnockoutGenerator from '@/components/TournamentKnockoutGenerator'
import BackButton from '@/components/BackButton'

const FORMATS: DivisionMode[] = ['full', 'half', 'third']

/**
 * Quick tournament planning for a trainer/assistant/owner/superadmin —
 * see CLAUDE.md's "Tournaments" section. Deliberately no bracket/results
 * system yet, just a name plus a flat list of matches; each match picks
 * how the rink is divided for its slot (full/half/third, reusing the
 * exact same Zone/RinkDiagram concept the ice-booking calendar already
 * has) and whether that slot should actually block public /book
 * requests or stay purely informational.
 */
export default function TournamentsPage() {
  const { t } = useTranslation()
  const { user, staff } = useAuth()
  const { club, rinks, zones } = useClubData()
  const canManage = staff?.isTrainer || staff?.role === 'assistant' || staff?.role === 'owner' || staff?.role === 'superadmin'
  const activeRinks = rinks.filter((r) => r.active).sort((a, b) => a.sortOrder - b.sortOrder)

  const [tournaments, setTournaments] = useState<(Tournament & { id: string })[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [matches, setMatches] = useState<(TournamentMatch & { id: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [creatingTournament, setCreatingTournament] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [date, setDate] = useState(formatDateISO(new Date()))
  const [startTime, setStartTime] = useState('10:00')
  const [duration, setDuration] = useState(45)
  const [locationType, setLocationType] = useState<'rink' | 'other'>('rink')
  const [rinkId, setRinkId] = useState('')
  const [format, setFormat] = useState<DivisionMode>('full')
  const [blocksIce, setBlocksIce] = useState(false)
  const [venueName, setVenueName] = useState('')
  const [teamRows, setTeamRows] = useState<{ teamA: string; teamB: string }[]>([{ teamA: '', teamB: '' }])
  const [highlightedZone, setHighlightedZone] = useState<number | null>(null)
  const [creatingMatch, setCreatingMatch] = useState(false)
  const [matchError, setMatchError] = useState<string | null>(null)

  const refreshTournaments = () => {
    if (!club) return
    setLoading(true)
    fetchTournaments(club.id).then(setTournaments).finally(() => setLoading(false))
  }

  useEffect(refreshTournaments, [club])

  useEffect(() => {
    if (activeRinks.length && !rinkId) setRinkId(activeRinks[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRinks])

  const refreshMatches = (tournamentId: string) => {
    fetchTournamentMatches(tournamentId).then(setMatches)
  }

  const handleSelectTournament = (id: string) => {
    setActiveId(id)
    setMatchError(null)
    refreshMatches(id)
  }

  const handleCreateTournament = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!club || !user || !staff || !newName.trim()) return
    setCreatingTournament(true)
    try {
      const id = await createTournament({ clubId: club.id, name: newName.trim(), createdBy: user.uid, createdByName: staff.name })
      setNewName('')
      refreshTournaments()
      handleSelectTournament(id)
    } finally {
      setCreatingTournament(false)
    }
  }

  const handleDeleteTournament = async (id: string) => {
    if (!confirm(t('tournaments.confirmDeleteTournament'))) return
    setBusyId(id)
    try {
      await deleteTournament(id)
      if (activeId === id) {
        setActiveId(null)
        setMatches([])
      }
      refreshTournaments()
    } finally {
      setBusyId(null)
    }
  }

  const zonesForSelection = rinkId
    ? zones.filter((z) => z.rinkId === rinkId && z.mode === format).sort((a, b) => a.slotIndex - b.slotIndex)
    : []

  useEffect(() => {
    const rowCount = locationType === 'rink' ? Math.max(zonesForSelection.length, 1) : 1
    setTeamRows(Array.from({ length: rowCount }, () => ({ teamA: '', teamB: '' })))
    setHighlightedZone(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rinkId, format, locationType])

  const activeTournament = tournaments.find((tr) => tr.id === activeId)

  const handleAddMatch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeId || !club || !user || !staff || !activeTournament) return
    setMatchError(null)
    setCreatingMatch(true)
    try {
      if (locationType === 'other') {
        if (!teamRows[0]?.teamA.trim() || !teamRows[0]?.teamB.trim()) {
          setMatchError(t('tournaments.needBothTeams'))
          return
        }
        await createTournamentMatch({
          tournamentId: activeId,
          clubId: club.id,
          date,
          startTime,
          durationMinutes: duration,
          teamA: teamRows[0].teamA.trim(),
          teamB: teamRows[0].teamB.trim(),
          format: 'full',
          location: 'other',
          venueName: venueName.trim(),
          blocksIce: false,
          createdBy: user.uid
        })
      } else {
        const filledRows = zonesForSelection
          .map((zone, i) => ({ zone, row: teamRows[i] }))
          .filter(({ row }) => row?.teamA.trim() && row?.teamB.trim())
        if (filledRows.length === 0) {
          setMatchError(t('tournaments.needAtLeastOneMatch'))
          return
        }
        for (const { zone, row } of filledRows) {
          await createTournamentMatch({
            tournamentId: activeId,
            clubId: club.id,
            date,
            startTime,
            durationMinutes: duration,
            teamA: row.teamA.trim(),
            teamB: row.teamB.trim(),
            format,
            location: 'rink',
            rinkId,
            zoneId: zone.id,
            blocksIce,
            createdBy: user.uid,
            ...(blocksIce
              ? { bookingContact: { name: `${t('tournaments.bookingLabel')}: ${activeTournament.name}`, email: staff.email, phone: '', timezone: club.timezone } }
              : {})
          })
        }
      }
      setTeamRows(Array.from({ length: locationType === 'rink' ? Math.max(zonesForSelection.length, 1) : 1 }, () => ({ teamA: '', teamB: '' })))
      setVenueName('')
      refreshMatches(activeId)
    } catch (err) {
      setMatchError(err instanceof SlotUnavailableError ? t('tournaments.slotUnavailable') : t('common.error'))
    } finally {
      setCreatingMatch(false)
    }
  }

  const handleDeleteMatch = async (match: TournamentMatch & { id: string }) => {
    if (!confirm(t('tournaments.confirmDeleteMatch'))) return
    setBusyId(match.id)
    try {
      await deleteTournamentMatch(match.id, match)
      if (activeId) refreshMatches(activeId)
    } finally {
      setBusyId(null)
    }
  }

  if (staff && !canManage) {
    return (
      <div className="content-container py-12 max-w-md mx-auto text-center space-y-4">
        <BackButton fallback="/" />
        <h1>{t('tournaments.notAuthorizedTitle')}</h1>
        <p className="text-text-secondary">{t('tournaments.notAuthorizedNotice')}</p>
      </div>
    )
  }

  return (
    <div className="content-container py-6 space-y-6">
      <BackButton fallback="/admin" />
      <h1 className="text-2xl font-bold text-white">{t('tournaments.title')}</h1>

      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white text-lg">{t('tournaments.yourTournaments')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form onSubmit={handleCreateTournament} className="flex gap-2 flex-wrap items-end">
            <div className="flex-1 min-w-[200px]">
              <Label className="text-white">{t('tournaments.newTournamentName')}</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} className="bg-background-dark border-border text-white" required />
            </div>
            <Button type="submit" disabled={creatingTournament || !newName.trim()} className="bg-primary hover:bg-primary-gold text-primary-foreground">
              {creatingTournament ? t('common.saving') : t('tournaments.createTournament')}
            </Button>
          </form>

          {loading ? (
            <p className="text-text-muted">{t('common.loading')}</p>
          ) : tournaments.length === 0 ? (
            <p className="text-text-muted text-sm">{t('tournaments.none')}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tournaments.map((tr) => (
                <div key={tr.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleSelectTournament(tr.id)}
                    className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                      activeId === tr.id ? 'bg-primary text-primary-foreground' : 'bg-background-dark text-text-secondary hover:text-primary border border-border'
                    }`}
                  >
                    {tr.name}
                  </button>
                  <Button size="sm" variant="destructive" disabled={busyId === tr.id} onClick={() => handleDeleteTournament(tr.id)}>
                    {t('common.delete')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {activeTournament && club && (
        <>
          <TournamentTeamsPanel tournamentId={activeTournament.id} clubId={club.id} />
          <TournamentRoundRobinGenerator tournamentId={activeTournament.id} club={club} rinks={rinks} zones={zones} />
          <TournamentKnockoutGenerator tournamentId={activeTournament.id} club={club} rinks={rinks} zones={zones} />

          <Card className="arena-card">
            <CardHeader>
              <CardTitle className="text-white text-lg">{t('tournaments.addMatch', { name: activeTournament.name })}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {matchError && <p className="text-status-danger text-sm">{matchError}</p>}
              <form onSubmit={handleAddMatch} className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <Label className="text-white">{t('common.date')}</Label>
                    <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-background-dark border-border text-white" required />
                  </div>
                  <div>
                    <Label className="text-white">{t('common.time')}</Label>
                    <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="bg-background-dark border-border text-white" required />
                  </div>
                  <div>
                    <Label className="text-white">{t('tournaments.durationMinutes')}</Label>
                    <Input type="number" min={10} step={5} value={duration} onChange={(e) => setDuration(Math.max(10, parseInt(e.target.value, 10) || 10))} className="bg-background-dark border-border text-white" required />
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setLocationType('rink')}
                    className={`px-3 py-1.5 rounded-md text-sm ${locationType === 'rink' ? 'bg-primary text-primary-foreground' : 'bg-background-dark text-text-secondary border border-border'}`}
                  >
                    {t('tournaments.locationRink')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLocationType('other')}
                    className={`px-3 py-1.5 rounded-md text-sm ${locationType === 'other' ? 'bg-primary text-primary-foreground' : 'bg-background-dark text-text-secondary border border-border'}`}
                  >
                    {t('tournaments.locationOther')}
                  </button>
                </div>

                {locationType === 'rink' ? (
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
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
                    </div>

                    <RinkDiagram mode={format} highlightedSlotIndex={highlightedZone} className="max-w-md" />

                    <div className="space-y-2">
                      <p className="text-text-secondary text-sm">{t('tournaments.matchRowsHint')}</p>
                      {zonesForSelection.map((zone, i) => (
                        <div key={zone.id} className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] items-center" onFocus={() => setHighlightedZone(i)} onBlur={() => setHighlightedZone(null)}>
                          <Input
                            placeholder={t('tournaments.teamA')}
                            value={teamRows[i]?.teamA ?? ''}
                            onChange={(e) => setTeamRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, teamA: e.target.value } : r)))}
                            className="bg-background-dark border-border text-white"
                          />
                          <span className="text-text-muted text-xs text-center">{zone.name}</span>
                          <Input
                            placeholder={t('tournaments.teamB')}
                            value={teamRows[i]?.teamB ?? ''}
                            onChange={(e) => setTeamRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, teamB: e.target.value } : r)))}
                            className="bg-background-dark border-border text-white"
                          />
                        </div>
                      ))}
                    </div>

                    <label className="flex items-center gap-2 text-sm text-white">
                      <input type="checkbox" checked={blocksIce} onChange={(e) => setBlocksIce(e.target.checked)} className="h-4 w-4" />
                      {t('tournaments.blocksIceLabel')}
                    </label>
                    <p className="text-text-muted text-xs">{t('tournaments.blocksIceHint')}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <Label className="text-white">{t('tournaments.venueName')}</Label>
                      <Input value={venueName} onChange={(e) => setVenueName(e.target.value)} placeholder={t('tournaments.venuePlaceholder')} className="bg-background-dark border-border text-white" required />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input
                        placeholder={t('tournaments.teamA')}
                        value={teamRows[0]?.teamA ?? ''}
                        onChange={(e) => setTeamRows([{ teamA: e.target.value, teamB: teamRows[0]?.teamB ?? '' }])}
                        className="bg-background-dark border-border text-white"
                        required
                      />
                      <Input
                        placeholder={t('tournaments.teamB')}
                        value={teamRows[0]?.teamB ?? ''}
                        onChange={(e) => setTeamRows([{ teamA: teamRows[0]?.teamA ?? '', teamB: e.target.value }])}
                        className="bg-background-dark border-border text-white"
                        required
                      />
                    </div>
                  </div>
                )}

                <Button type="submit" disabled={creatingMatch} className="bg-primary hover:bg-primary-gold text-primary-foreground">
                  {creatingMatch ? t('common.saving') : t('tournaments.addMatchButton')}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="arena-card">
            <CardHeader>
              <CardTitle className="text-white text-lg">{t('tournaments.matchList')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {matches.length === 0 ? (
                <p className="text-text-muted text-sm">{t('tournaments.noMatches')}</p>
              ) : (
                matches.map((m) => {
                  const rink = rinks.find((r) => r.id === m.rinkId)
                  const zone = zones.find((z) => z.id === m.zoneId)
                  return (
                    <div key={m.id} className="flex justify-between items-center p-2 rounded border border-border">
                      <div>
                        <p className="text-white">
                          {m.teamA} <span className="text-text-muted">vs</span> {m.teamB}
                        </p>
                        <p className="text-text-secondary text-sm">
                          {m.date} · {m.startTime} · {t('common.minutes', { count: m.durationMinutes })}
                          {' · '}
                          {m.location === 'rink' ? `${rink?.name ?? ''} — ${zone?.name ?? ''}` : (m.venueName || t('tournaments.locationOther'))}
                        </p>
                        {m.blocksIce && <p className="text-status-success text-xs">{t('tournaments.blockedBadge')}</p>}
                      </div>
                      <Button size="sm" variant="destructive" disabled={busyId === m.id} onClick={() => handleDeleteMatch(m)}>
                        {t('common.delete')}
                      </Button>
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
