import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useClubData } from '@/hooks/useClubData'
import { fetchTournaments, fetchTournamentMatches, computeGroupStandings, deriveMatchState } from '@/lib/tournaments'
import { Tournament, TournamentMatch } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import TournamentBracketDiagram from '@/components/TournamentBracketDiagram'
import TournamentStandingsTable from '@/components/TournamentStandingsTable'
import BackButton from '@/components/BackButton'

const POLL_MS = 6000

/**
 * Public, no-login tournament schedule — the last missing piece from
 * CLAUDE.md's "Tournaments" section, now doubling as a spectator "big
 * screen" view (a cafe/lobby TV, or a QR code scanned from a phone) since
 * it polls for live updates rather than fetching once. Read-only: no
 * score entry anywhere, since a customer/parent has no way (and no need)
 * to record a result — staff drive the live state from
 * TournamentLiveControlPanel.tsx on the admin side.
 *
 * `?tournament=<id>` (from the admin QR code) deep-links straight past
 * the picker into one tournament, matching this app's established QR
 * pattern of one route handling every case via query params.
 *
 * Standings and bracket shapes are derived straight from each
 * TournamentMatch doc's own denormalized team names/ids rather than
 * fetching TournamentTeam docs at all — the public firestore.rules read
 * only had to open up `tournaments`/`tournamentMatches`, not
 * `tournamentTeams`, which stays staff-only.
 */
export default function TournamentSchedulePage() {
  const { t } = useTranslation()
  const { staff } = useAuth()
  const { club, rinks, zones } = useClubData()
  const [searchParams] = useSearchParams()
  const tournamentParam = searchParams.get('tournament')
  const canManageTournaments =
    staff?.isTrainer || staff?.role === 'assistant' || staff?.role === 'owner' || staff?.role === 'superadmin'
  const backFallback = canManageTournaments ? '/admin/turnaje' : '/'

  const [tournaments, setTournaments] = useState<(Tournament & { id: string })[]>([])
  const [activeId, setActiveId] = useState<string | null>(tournamentParam)
  const [matches, setMatches] = useState<(TournamentMatch & { id: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [matchesLoading, setMatchesLoading] = useState(false)

  useEffect(() => {
    if (!club) return
    fetchTournaments(club.id)
      .then((fetched) => {
        setTournaments(fetched)
        setActiveId((prev) => prev ?? fetched[0]?.id ?? null)
      })
      .finally(() => setLoading(false))
  }, [club])

  useEffect(() => {
    if (!activeId) {
      setMatches([])
      return
    }
    setMatchesLoading(true)
    const refresh = () => fetchTournamentMatches(activeId).then(setMatches)
    refresh().finally(() => setMatchesLoading(false))
    const interval = setInterval(refresh, POLL_MS)
    return () => clearInterval(interval)
  }, [activeId])

  const activeTournament = tournaments.find((tr) => tr.id === activeId)
  const pointsForWin = activeTournament?.pointsForWin ?? 3

  const realMatches = matches.filter((m) => !m.isBye)
  const liveMatches = realMatches.filter((m) => deriveMatchState(m) === 'live')
  const upcomingMatches = realMatches
    .filter((m) => deriveMatchState(m) === 'scheduled')
    .sort((a, b) => (a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)))
    .slice(0, 8)

  const groupMatches = matches.filter((m) => m.schema === 'groups')
  const playoffMatches = matches.filter((m) => m.schema === 'groupsPlayoff')
  const knockoutMatches = matches.filter((m) => m.schema === 'knockout')
  const roundRobinMatches = matches.filter((m) => m.schema === 'roundRobin')
  // A manually-added match (no schema at all) never has team ids, so it
  // can't feed a standings table — it only ever shows up in the flat list.
  const otherFinishedMatches = matches.filter((m) => !m.schema && deriveMatchState(m) === 'finished')

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
      const nameById = new Map<string, string>()
      ms.forEach((m) => {
        if (m.teamAId) {
          teamIds.add(m.teamAId)
          nameById.set(m.teamAId, m.teamA)
        }
        if (m.teamBId) {
          teamIds.add(m.teamBId)
          nameById.set(m.teamBId, m.teamB)
        }
      })
      const groupTeams = Array.from(teamIds).map((id) => ({ id, name: nameById.get(id) ?? '' }))
      return [g, computeGroupStandings(groupTeams, ms, pointsForWin)] as const
    })
  )

  // A round-robin tournament (no groups) still gets one combined standings
  // table — "every team plays every team" naturally produces the same
  // kind of league table a group does, just without splitting into
  // multiple groups, so it reuses computeGroupStandings directly.
  const roundRobinTeamIds = new Set<string>()
  const roundRobinNameById = new Map<string, string>()
  roundRobinMatches.forEach((m) => {
    if (m.teamAId) {
      roundRobinTeamIds.add(m.teamAId)
      roundRobinNameById.set(m.teamAId, m.teamA)
    }
    if (m.teamBId) {
      roundRobinTeamIds.add(m.teamBId)
      roundRobinNameById.set(m.teamBId, m.teamB)
    }
  })
  const roundRobinStandings = computeGroupStandings(
    Array.from(roundRobinTeamIds).map((id) => ({ id, name: roundRobinNameById.get(id) ?? '' })),
    roundRobinMatches,
    pointsForWin
  )

  // Shared row for both the round-robin and the per-group match lists —
  // every match shows its rink/zone alongside the score/time so a
  // spectator screen never leaves a match's physical location ambiguous.
  const renderMatchRow = (m: TournamentMatch & { id: string }) => {
    const state = deriveMatchState(m)
    const rink = rinks.find((r) => r.id === m.rinkId)
    const zone = zones.find((z) => z.id === m.zoneId)
    return (
      <div key={m.id} className="flex flex-wrap justify-between items-center gap-2 p-2 rounded border border-border">
        <div>
          <p className="text-white text-sm">
            {m.teamA} <span className="text-text-muted">vs</span> {m.teamB}
          </p>
          <p className="text-text-muted text-xs">
            {m.date} · {m.startTime}
            {m.rinkId ? ` · ${rink?.name ?? ''} — ${zone?.name ?? ''}` : ''}
          </p>
        </div>
        {state === 'finished' ? (
          <span className="text-status-success text-sm font-medium">{m.scoreA} : {m.scoreB}</span>
        ) : state === 'live' ? (
          <span className="flex items-center gap-1 text-status-danger text-sm font-semibold">
            <span className="h-2 w-2 rounded-full bg-status-danger animate-pulse" />
            {m.scoreA ?? 0} : {m.scoreB ?? 0}
          </span>
        ) : (
          <span className="text-text-muted text-xs">{t('tournaments.notPlayedYet')}</span>
        )}
      </div>
    )
  }

  if (loading) {
    return <div className="content-container py-12 text-center text-text-muted">{t('common.loading')}</div>
  }

  return (
    <div className="content-container py-6 space-y-6">
      <BackButton fallback={backFallback} />
      <h1 className="text-2xl font-bold text-white">{t('tournaments.publicTitle')}</h1>

      {tournaments.length === 0 ? (
        <p className="text-text-muted">{t('tournaments.publicNone')}</p>
      ) : (
        <>
          {tournaments.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {tournaments.map((tr) => (
                <button
                  key={tr.id}
                  type="button"
                  onClick={() => setActiveId(tr.id)}
                  className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                    activeId === tr.id ? 'bg-primary text-primary-foreground' : 'bg-background-dark text-text-secondary hover:text-primary border border-border'
                  }`}
                >
                  {tr.name}
                </button>
              ))}
            </div>
          )}

          {matchesLoading ? (
            <p className="text-text-muted">{t('common.loading')}</p>
          ) : matches.length === 0 ? (
            <p className="text-text-muted text-sm">{t('tournaments.noMatches')}</p>
          ) : (
            <div className="space-y-6">
              {(liveMatches.length > 0 || upcomingMatches.length > 0) && (
                <Card className="arena-card">
                  <CardHeader>
                    <CardTitle className="text-white text-lg">{t('tournaments.whatsOnTitle')}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {liveMatches.length > 0 && (
                      <div className="space-y-2">
                        <h3 className="flex items-center gap-2 text-status-danger text-sm font-semibold">
                          <span className="h-2 w-2 rounded-full bg-status-danger animate-pulse" />
                          {t('tournaments.liveNow')}
                        </h3>
                        {liveMatches.map((m) => (
                          <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 p-3 rounded border border-status-danger/40">
                            <div>
                              <p className="text-white text-lg font-semibold">
                                {m.teamA} <span className="text-text-muted text-sm font-normal">vs</span> {m.teamB}
                              </p>
                              {m.rinkId && (
                                <p className="text-text-muted text-xs">
                                  {rinks.find((r) => r.id === m.rinkId)?.name ?? ''} — {zones.find((z) => z.id === m.zoneId)?.name ?? ''}
                                </p>
                              )}
                            </div>
                            <p className="text-status-danger text-2xl font-bold">
                              {m.scoreA ?? 0} : {m.scoreB ?? 0}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                    {upcomingMatches.length > 0 && (
                      <div className="space-y-1">
                        <h3 className="text-white text-sm font-semibold">{t('tournaments.upcomingMatches')}</h3>
                        {upcomingMatches.map((m) => (
                          <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 p-2 rounded border border-border">
                            <p className="text-white text-sm">
                              {m.teamA} <span className="text-text-muted">vs</span> {m.teamB}
                            </p>
                            <span className="text-text-muted text-xs">
                              {m.date} · {m.startTime}
                              {m.rinkId ? ` · ${rinks.find((r) => r.id === m.rinkId)?.name ?? ''} — ${zones.find((z) => z.id === m.zoneId)?.name ?? ''}` : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {roundRobinStandings.length > 0 && (
                <Card className="arena-card">
                  <CardHeader>
                    <CardTitle className="text-white text-lg">{t('tournaments.standingsTitle')}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <TournamentStandingsTable rows={roundRobinStandings} />
                    <div className="space-y-1">{roundRobinMatches.map(renderMatchRow)}</div>
                  </CardContent>
                </Card>
              )}

              {groupIds.length > 0 && (
                <Card className="arena-card">
                  <CardHeader>
                    <CardTitle className="text-white text-lg">{t('tournaments.groupsTitle')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {groupIds.map((g) => (
                        <div key={g} className="space-y-2">
                          <h3 className="text-white text-sm font-semibold">{t('tournaments.groupLabel', { name: g })}</h3>
                          <TournamentStandingsTable rows={standingsByGroup.get(g) ?? []} />
                          <div className="space-y-1">{(groupMatchesByGroup.get(g) ?? []).map(renderMatchRow)}</div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {playoffMatches.length > 0 && (
                <Card className="arena-card">
                  <CardHeader>
                    <CardTitle className="text-white text-lg">{t('tournaments.playoffTitle')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <TournamentBracketDiagram matches={playoffMatches} rinks={rinks} zones={zones} />
                  </CardContent>
                </Card>
              )}

              {knockoutMatches.length > 0 && (
                <Card className="arena-card">
                  <CardHeader>
                    <CardTitle className="text-white text-lg">{t('tournaments.knockoutTitle')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <TournamentBracketDiagram matches={knockoutMatches} rinks={rinks} zones={zones} />
                  </CardContent>
                </Card>
              )}

              {otherFinishedMatches.length > 0 && (
                <Card className="arena-card">
                  <CardHeader>
                    <CardTitle className="text-white text-lg">{t('tournaments.matchList')}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {otherFinishedMatches.map((m) => {
                      const rink = rinks.find((r) => r.id === m.rinkId)
                      const zone = zones.find((z) => z.id === m.zoneId)
                      return (
                        <div key={m.id} className="flex justify-between items-center flex-wrap gap-2 p-2 rounded border border-border">
                          <div>
                            <p className="text-white">
                              {m.teamA} <span className="text-text-muted">vs</span> {m.teamB}
                            </p>
                            <p className="text-text-secondary text-sm">
                              {m.date} · {m.startTime} · {t('common.minutes', { count: m.durationMinutes })}
                              {' · '}
                              {m.location === 'rink' ? `${rink?.name ?? ''} — ${zone?.name ?? ''}` : m.venueName || t('tournaments.locationOther')}
                            </p>
                          </div>
                          <span className="text-status-success text-sm font-medium">{m.scoreA} : {m.scoreB}</span>
                        </div>
                      )
                    })}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
