import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { useClubData } from '@/hooks/useClubData'
import {
  fetchTournament,
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
import TournamentMatchImportPanel from '@/components/TournamentMatchImportPanel'
import TournamentRoundRobinGenerator from '@/components/TournamentRoundRobinGenerator'
import TournamentKnockoutGenerator from '@/components/TournamentKnockoutGenerator'
import TournamentGroupsGenerator from '@/components/TournamentGroupsGenerator'
import TournamentLiveControlPanel from '@/components/TournamentLiveControlPanel'
import QrCodeDisplay from '@/components/QrCodeDisplay'
import BackButton from '@/components/BackButton'

const FORMATS: DivisionMode[] = ['full', 'half', 'third']

/**
 * One tournament's full management view — teams, schedule generators,
 * live match-day control, QR code, and the manual add-match form/list —
 * split out of TournamentsPage.tsx (see its own doc comment) so a club
 * with several tournaments doesn't have to hold every tournament's tools
 * inline behind a picker on one shared page.
 */
export default function TournamentDetailPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { tournamentId } = useParams<{ tournamentId: string }>()
  const { user, staff } = useAuth()
  const { club, rinks, zones } = useClubData()
  const canManage = staff?.isTrainer || staff?.role === 'assistant' || staff?.role === 'owner' || staff?.role === 'superadmin'
  const activeRinks = rinks.filter((r) => r.active).sort((a, b) => a.sortOrder - b.sortOrder)

  const [tournament, setTournament] = useState<(Tournament & { id: string }) | null>(null)
  const [loading, setLoading] = useState(true)
  const [deletingTournament, setDeletingTournament] = useState(false)
  const [matches, setMatches] = useState<(TournamentMatch & { id: string })[]>([])
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

  useEffect(() => {
    if (!tournamentId) return
    setLoading(true)
    fetchTournament(tournamentId)
      .then(setTournament)
      .finally(() => setLoading(false))
  }, [tournamentId])

  const refreshMatches = () => {
    if (tournamentId) fetchTournamentMatches(tournamentId).then(setMatches)
  }

  useEffect(refreshMatches, [tournamentId])

  useEffect(() => {
    if (activeRinks.length && !rinkId) setRinkId(activeRinks[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRinks])

  const zonesForSelection = rinkId
    ? zones.filter((z) => z.rinkId === rinkId && z.mode === format).sort((a, b) => a.slotIndex - b.slotIndex)
    : []

  useEffect(() => {
    const rowCount = locationType === 'rink' ? Math.max(zonesForSelection.length, 1) : 1
    setTeamRows(Array.from({ length: rowCount }, () => ({ teamA: '', teamB: '' })))
    setHighlightedZone(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rinkId, format, locationType])

  const handleDeleteTournament = async () => {
    if (!tournament || !confirm(t('tournaments.confirmDeleteTournament'))) return
    setDeletingTournament(true)
    try {
      await deleteTournament(tournament.id)
      navigate('/admin/turnaje')
    } finally {
      setDeletingTournament(false)
    }
  }

  const handleAddMatch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!tournamentId || !club || !user || !staff || !tournament) return
    setMatchError(null)
    setCreatingMatch(true)
    try {
      if (locationType === 'other') {
        if (!teamRows[0]?.teamA.trim() || !teamRows[0]?.teamB.trim()) {
          setMatchError(t('tournaments.needBothTeams'))
          return
        }
        await createTournamentMatch({
          tournamentId,
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
            tournamentId,
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
              ? { bookingContact: { name: `${t('tournaments.bookingLabel')}: ${tournament.name}`, email: staff.email, phone: '', timezone: club.timezone } }
              : {})
          })
        }
      }
      setTeamRows(Array.from({ length: locationType === 'rink' ? Math.max(zonesForSelection.length, 1) : 1 }, () => ({ teamA: '', teamB: '' })))
      setVenueName('')
      refreshMatches()
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
      refreshMatches()
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

  if (loading) {
    return <div className="content-container py-12 text-center text-text-muted">{t('common.loading')}</div>
  }

  if (!tournament || !club) {
    return (
      <div className="content-container py-12 max-w-md mx-auto text-center space-y-4">
        <BackButton fallback="/admin/turnaje" />
        <p className="text-text-muted">{t('tournaments.none')}</p>
      </div>
    )
  }

  return (
    <div className="content-container py-6 space-y-6">
      <BackButton fallback="/admin/turnaje" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">{tournament.name}</h1>
          {tournament.format && (
            <p className="text-text-muted text-sm mt-0.5">{t(`tournaments.schemaOption.${tournament.format}`)}</p>
          )}
        </div>
        <Button size="sm" variant="destructive" disabled={deletingTournament} onClick={handleDeleteTournament}>
          {t('common.delete')}
        </Button>
      </div>

      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white text-lg">{t('tournaments.publicScreenTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-start gap-4">
          <QrCodeDisplay
            value={`${window.location.origin}/turnaje?tournament=${tournament.id}`}
            filename={`turnaj-${tournament.name}.png`}
            label={tournament.name}
          />
          <div className="flex flex-col gap-2 max-w-md">
            <p className="text-text-secondary text-sm">{t('tournaments.publicScreenHint')}</p>
            {/* Same-tab navigation (not target="_blank") so BackButton's
                preferred navigate(-1) on /turnaje actually has real
                session history to return to — a new tab would start with
                none and always fall through to the fixed fallback. */}
            <Link to={`/turnaje?tournament=${tournament.id}`} className="text-primary hover:text-primary-gold text-sm underline w-fit">
              {t('tournaments.openPublicScreen')}
            </Link>
          </div>
        </CardContent>
      </Card>

      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white text-lg">{t('tournaments.tvScreenTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-start gap-4">
          <QrCodeDisplay
            value={`${window.location.origin}/turnaje?tournament=${tournament.id}&display=tv`}
            filename={`turnaj-${tournament.name}-tv.png`}
            label={tournament.name}
          />
          <div className="flex flex-col gap-2 max-w-md">
            <p className="text-text-secondary text-sm">{t('tournaments.tvScreenHint')}</p>
            <Link
              to={`/turnaje?tournament=${tournament.id}&display=tv`}
              className="text-primary hover:text-primary-gold text-sm underline w-fit"
            >
              {t('tournaments.openTvScreen')}
            </Link>
          </div>
        </CardContent>
      </Card>

      <TournamentLiveControlPanel tournamentId={tournament.id} rinks={rinks} zones={zones} />

      <TournamentTeamsPanel tournamentId={tournament.id} clubId={club.id} />
      {/* A tournament created before the format dropdown existed has no
          `format` at all — show every generator for those, same as
          before this feature shipped, rather than picking one for them. */}
      {(!tournament.format || tournament.format === 'roundRobin') && (
        <TournamentRoundRobinGenerator tournamentId={tournament.id} club={club} rinks={rinks} zones={zones} />
      )}
      {(!tournament.format || tournament.format === 'knockout') && (
        <TournamentKnockoutGenerator tournamentId={tournament.id} club={club} rinks={rinks} zones={zones} />
      )}
      {(!tournament.format || tournament.format === 'groups') && (
        <TournamentGroupsGenerator tournamentId={tournament.id} club={club} rinks={rinks} zones={zones} pointsForWin={tournament.pointsForWin ?? 3} />
      )}

      {user && <TournamentMatchImportPanel tournamentId={tournament.id} clubId={club.id} createdBy={user.uid} onImported={refreshMatches} />}

      <Card className="arena-card">
        <CardHeader>
          <CardTitle className="text-white text-lg">{t('tournaments.addMatch', { name: tournament.name })}</CardTitle>
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
    </div>
  )
}
