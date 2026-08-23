import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useClubData } from '@/hooks/useClubData'
import { fetchTournaments, fetchTournamentMatches, computeGroupStandings } from '@/lib/tournaments'
import { Tournament, TournamentMatch } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import TournamentBracketView from '@/components/TournamentBracketView'
import BackButton from '@/components/BackButton'

/**
 * Public, no-login tournament schedule — the last missing piece from
 * CLAUDE.md's "Tournaments" section. Read-only: no score entry anywhere,
 * since a customer/parent has no way (and no need) to record a result.
 * Standings and bracket shapes are derived straight from each
 * TournamentMatch doc's own denormalized team names/ids rather than
 * fetching TournamentTeam docs at all — the public firestore.rules read
 * only had to open up `tournaments`/`tournamentMatches`, not
 * `tournamentTeams`, which stays staff-only.
 */
export default function TournamentSchedulePage() {
  const { t } = useTranslation()
  const { club, rinks, zones } = useClubData()

  const [tournaments, setTournaments] = useState<(Tournament & { id: string })[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [matches, setMatches] = useState<(TournamentMatch & { id: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [matchesLoading, setMatchesLoading] = useState(false)

  useEffect(() => {
    if (!club) return
    setLoading(true)
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
    fetchTournamentMatches(activeId)
      .then(setMatches)
      .finally(() => setMatchesLoading(false))
  }, [activeId])

  const groupMatches = matches.filter((m) => m.schema === 'groups')
  const playoffMatches = matches.filter((m) => m.schema === 'groupsPlayoff')
  const knockoutMatches = matches.filter((m) => m.schema === 'knockout')
  const otherMatches = matches.filter((m) => m.schema !== 'groups' && m.schema !== 'groupsPlayoff' && m.schema !== 'knockout')

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
      return [g, computeGroupStandings(groupTeams, ms)] as const
    })
  )

  if (loading) {
    return <div className="content-container py-12 text-center text-text-muted">{t('common.loading')}</div>
  }

  return (
    <div className="content-container py-6 space-y-6">
      <BackButton fallback="/" />
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
              {groupIds.length > 0 && (
                <Card className="arena-card">
                  <CardHeader>
                    <CardTitle className="text-white text-lg">{t('tournaments.groupsTitle')}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
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
                          {(groupMatchesByGroup.get(g) ?? []).map((m) => (
                            <div key={m.id} className="flex flex-wrap justify-between items-center gap-2 p-2 rounded border border-border">
                              <p className="text-white text-sm">
                                {m.teamA} <span className="text-text-muted">vs</span> {m.teamB}
                              </p>
                              <div className="flex items-center gap-3">
                                <span className="text-text-muted text-xs">{m.date} · {m.startTime}</span>
                                {m.scoreA != null && m.scoreB != null ? (
                                  <span className="text-status-success text-sm font-medium">{m.scoreA} : {m.scoreB}</span>
                                ) : (
                                  <span className="text-text-muted text-xs">{t('tournaments.notPlayedYet')}</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {playoffMatches.length > 0 && (
                <Card className="arena-card">
                  <CardHeader>
                    <CardTitle className="text-white text-lg">{t('tournaments.playoffTitle')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <TournamentBracketView matches={playoffMatches} readOnly />
                  </CardContent>
                </Card>
              )}

              {knockoutMatches.length > 0 && (
                <Card className="arena-card">
                  <CardHeader>
                    <CardTitle className="text-white text-lg">{t('tournaments.knockoutTitle')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <TournamentBracketView matches={knockoutMatches} readOnly />
                  </CardContent>
                </Card>
              )}

              {otherMatches.length > 0 && (
                <Card className="arena-card">
                  <CardHeader>
                    <CardTitle className="text-white text-lg">{t('tournaments.matchList')}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {otherMatches.map((m) => {
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
