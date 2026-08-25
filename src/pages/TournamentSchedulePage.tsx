import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useClubData } from '@/hooks/useClubData'
import { fetchTournaments, fetchTournamentMatches, computeGroupStandings, deriveMatchState, withResolvedPlaceholders, GroupStandingRow } from '@/lib/tournaments'
import { generateQrDataUrl } from '@/lib/qrcode'
import { Tournament, TournamentMatch } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import TournamentBracketDiagram from '@/components/TournamentBracketDiagram'
import TournamentStandingsTable from '@/components/TournamentStandingsTable'
import ScaleToFit from '@/components/ScaleToFit'
import BackButton from '@/components/BackButton'

const POLL_MS = 6000
const FAVORITE_TEAM_STORAGE_KEY = 'turnaje-favorite-team'

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
  // A dedicated one-screen, no-scroll dashboard for an unattended TV/cafe
  // screen (its own QR code on TournamentDetailPage.tsx, separate from the
  // plain spectator-screen QR meant for a customer's own phone) — same
  // route+data, just a different render branch, matching this app's
  // established "one route, query params pick the case" QR pattern.
  const isTvMode = searchParams.get('display') === 'tv'
  const canManageTournaments =
    staff?.isTrainer || staff?.role === 'assistant' || staff?.role === 'owner' || staff?.role === 'superadmin'
  const backFallback = canManageTournaments ? '/admin/turnaje' : '/'

  const [tournaments, setTournaments] = useState<(Tournament & { id: string })[]>([])
  const [activeId, setActiveId] = useState<string | null>(tournamentParam)
  const [matches, setMatches] = useState<(TournamentMatch & { id: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [matchesLoading, setMatchesLoading] = useState(false)
  // "My team" filter — remembered per tournament (a spectator revisiting
  // the same screen shouldn't have to re-pick their team every time), but
  // never sent anywhere: purely a client-side view filter over data
  // that's already public.
  const [favoriteTeamId, setFavoriteTeamId] = useState<string | null>(null)

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

  // TV mode's corner QR always points at the plain (non-`display=tv`)
  // page — someone scanning it is on their own phone, where the regular
  // scrollable/interactive view (not the fixed dashboard) is what makes
  // sense.
  const [tvQrDataUrl, setTvQrDataUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!isTvMode || !activeId) {
      setTvQrDataUrl(null)
      return
    }
    let cancelled = false
    generateQrDataUrl(`${window.location.origin}/turnaje?tournament=${activeId}`).then((url) => {
      if (!cancelled) setTvQrDataUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [isTvMode, activeId])

  useEffect(() => {
    if (!activeId) {
      setFavoriteTeamId(null)
      return
    }
    setFavoriteTeamId(localStorage.getItem(`${FAVORITE_TEAM_STORAGE_KEY}:${activeId}`))
  }, [activeId])

  useEffect(() => {
    if (!activeId) return
    if (favoriteTeamId) {
      localStorage.setItem(`${FAVORITE_TEAM_STORAGE_KEY}:${activeId}`, favoriteTeamId)
    } else {
      localStorage.removeItem(`${FAVORITE_TEAM_STORAGE_KEY}:${activeId}`)
    }
  }, [activeId, favoriteTeamId])

  const activeTournament = tournaments.find((tr) => tr.id === activeId)
  const pointsForWin = activeTournament?.pointsForWin ?? 3

  // Team names are only unique within one tournament's own matches, so the
  // filter's option list — and the id-based filtering below — is rebuilt
  // fresh from `matches` on every activeId/poll cycle rather than fetching
  // TournamentTeam docs (which stay staff-only, see the module doc above).
  const teamOptionsMap = new Map<string, string>()
  matches.forEach((m) => {
    if (m.teamAId) teamOptionsMap.set(m.teamAId, m.teamA)
    if (m.teamBId) teamOptionsMap.set(m.teamBId, m.teamB)
  })
  const teamOptions = Array.from(teamOptionsMap.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  const favoriteTeamName = favoriteTeamId ? teamOptionsMap.get(favoriteTeamId) ?? null : null
  const involvesFavoriteTeam = (m: TournamentMatch & { id: string }) =>
    !favoriteTeamId || m.teamAId === favoriteTeamId || m.teamBId === favoriteTeamId
  // A manually-added match (no schema) never has team ids at all, so it
  // can only be matched by name.
  const involvesFavoriteTeamByName = (m: TournamentMatch & { id: string }) =>
    !favoriteTeamId || m.teamA === favoriteTeamName || m.teamB === favoriteTeamName
  const favoriteTeamHasMatches =
    !favoriteTeamId ||
    matches.some((m) => m.teamAId === favoriteTeamId || m.teamBId === favoriteTeamId || m.teamA === favoriteTeamName || m.teamB === favoriteTeamName)

  const groupMatches = matches.filter((m) => m.schema === 'groups')
  const playoffMatches = matches.filter((m) => m.schema === 'groupsPlayoff')
  const knockoutMatches = matches.filter((m) => m.schema === 'knockout')
  const roundRobinMatches = matches.filter((m) => m.schema === 'roundRobin')

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

  // Display-only substitution for a placement/play-off match imported
  // before its real opponents were known (see lib/tournaments.ts's
  // withResolvedPlaceholders) — every list below that shows a raw
  // teamA/teamB string reads from this instead of `matches` directly, so
  // e.g. "A5" automatically becomes the real team name once resolvable,
  // with no action needed from staff.
  const displayMatches = withResolvedPlaceholders(matches, standingsByGroup)

  const realMatches = displayMatches.filter((m) => !m.isBye)
  const liveMatches = realMatches.filter((m) => deriveMatchState(m) === 'live' && involvesFavoriteTeam(m))
  const upcomingMatches = realMatches
    .filter((m) => deriveMatchState(m) === 'scheduled' && involvesFavoriteTeam(m))
    .sort((a, b) => (a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)))
    .slice(0, 8)

  // A manually-added match (no schema at all) never has team ids, so it
  // can't feed a standings table — it only ever shows up in the flat list.
  const otherFinishedMatches = displayMatches
    .filter((m) => !m.schema && deriveMatchState(m) === 'finished')
    .filter(involvesFavoriteTeamByName)

  // TV dashboard only: which single "main overview" panel to show —
  // whichever content is the current substance of the tournament. A
  // bracket (knockout, or a groups tournament that's reached play-off)
  // takes priority since it already encodes "what's next" via its
  // placeholder slots; otherwise groups or the round-robin table.
  const tvBracketMatches = playoffMatches.length > 0 ? playoffMatches : knockoutMatches
  const tvMainPanelKind: 'bracket' | 'groups' | 'roundRobin' | 'none' =
    tvBracketMatches.length > 0 ? 'bracket' : groupIds.length > 0 ? 'groups' : roundRobinStandings.length > 0 ? 'roundRobin' : 'none'
  // A bracket already shows upcoming rounds via its "Winner of Match #N"
  // placeholders, so the TV board skips the separate upcoming strip for
  // it entirely rather than repeating the same information twice.
  const tvUpcomingMatches = tvMainPanelKind === 'bracket' ? [] : upcomingMatches.slice(0, 3)

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
            {m.rinkId ? ` · ${rink?.name ?? ''} — ${zone?.name ?? ''}` : m.venueName ? ` · ${m.venueName}` : ''}
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

  // TV dashboard's compact standings table — Team/P/W/D/L/Score/Pts, the
  // same columns and translation keys as the admin's own richer table
  // (TournamentGroupsGenerator.tsx), rather than the public
  // TournamentStandingsTable's Team/Matches/Played/Score/Pts layout built
  // for a scrollable phone view — a TV has the room for the full W/D/L
  // breakdown a spectator would otherwise have to infer.
  const renderTvStandings = (rows: GroupStandingRow[]) => (
    <table className="border-separate border-spacing-0">
      <thead>
        <tr className="text-text-muted text-sm uppercase tracking-wide">
          <th className="text-left pr-6 pb-2 font-semibold">{t('tournaments.standingsTeam')}</th>
          <th className="text-center px-3 pb-2 font-semibold">{t('tournaments.standingsPlayed')}</th>
          <th className="text-center px-3 pb-2 font-semibold">{t('tournaments.standingsWins')}</th>
          <th className="text-center px-3 pb-2 font-semibold">{t('tournaments.standingsDraws')}</th>
          <th className="text-center px-3 pb-2 font-semibold">{t('tournaments.standingsLosses')}</th>
          <th className="text-center px-3 pb-2 font-semibold">{t('tournaments.standingsGoals')}</th>
          <th className="text-center pl-3 pb-2 font-semibold">{t('tournaments.standingsPoints')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const isFav = !!favoriteTeamId && row.teamId === favoriteTeamId
          return (
            <tr key={row.teamId} className={`border-t border-border ${isFav ? 'bg-primary/10' : ''}`}>
              <td className={`text-left py-2 pr-6 font-bold whitespace-nowrap ${isFav ? 'text-primary' : 'text-white'}`}>{row.teamName}</td>
              <td className="text-center px-3 text-text-secondary">{row.played}</td>
              <td className="text-center px-3 text-text-secondary">{row.wins}</td>
              <td className="text-center px-3 text-text-secondary">{row.draws}</td>
              <td className="text-center px-3 text-text-secondary">{row.losses}</td>
              <td className="text-center px-3 text-text-secondary mono">
                {row.goalsFor}:{row.goalsAgainst}
              </td>
              <td className="text-center pl-3">
                <span className="inline-flex items-center justify-center min-w-[2.5rem] px-2 py-0.5 rounded-full bg-primary/15 text-primary font-bold">
                  {row.points}
                </span>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )

  if (loading) {
    return <div className="content-container py-12 text-center text-text-muted">{t('common.loading')}</div>
  }

  if (isTvMode) {
    return (
      <div className="h-full w-full bg-background-dark flex flex-col p-4 gap-3 text-white text-lg">
        <div className="shrink-0 flex items-center justify-center rounded-2xl border border-border bg-background-card" style={{ height: '9vh' }}>
          <h1 className="text-[clamp(1.5rem,3.2vw,3rem)] font-bold text-primary text-center px-6 truncate">
            {activeTournament?.name ?? t('tournaments.publicTitle')}
          </h1>
        </div>

        {matchesLoading ? (
          <div className="flex-1 flex items-center justify-center text-text-muted text-2xl">{t('common.loading')}</div>
        ) : matches.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-text-muted text-2xl">{t('tournaments.noMatches')}</div>
        ) : (
          <>
            <div className="flex-1 min-h-0">
              {tvMainPanelKind === 'bracket' && (
                <ScaleToFit className="w-full h-full">
                  <TournamentBracketDiagram matches={tvBracketMatches} rinks={rinks} zones={zones} highlightTeamId={favoriteTeamId} />
                </ScaleToFit>
              )}
              {tvMainPanelKind === 'groups' && (
                <ScaleToFit className="w-full h-full">
                  <div className="flex flex-nowrap gap-6">
                    {groupIds.map((g) => (
                      <div key={g} className="rounded-2xl border border-border bg-background-card px-6 py-5 shrink-0">
                        <h2 className="text-primary text-2xl font-bold mb-3 text-center whitespace-nowrap">
                          {t('tournaments.groupLabel', { name: g })}
                        </h2>
                        {renderTvStandings(standingsByGroup.get(g) ?? [])}
                      </div>
                    ))}
                  </div>
                </ScaleToFit>
              )}
              {tvMainPanelKind === 'roundRobin' && (
                <ScaleToFit className="w-full h-full">
                  <div className="rounded-2xl border border-border bg-background-card px-8 py-6">{renderTvStandings(roundRobinStandings)}</div>
                </ScaleToFit>
              )}
              {tvMainPanelKind === 'none' && (
                <div className="h-full flex items-center justify-center text-text-muted text-2xl">{t('tournaments.noMatches')}</div>
              )}
            </div>

            {liveMatches.length > 0 && (
              <div
                className="shrink-0 rounded-2xl border border-status-danger/50 bg-status-danger/5 px-6 py-3 flex flex-col"
                style={{ height: '22vh' }}
              >
                <h2 className="shrink-0 flex items-center gap-2 text-status-danger text-lg font-bold uppercase tracking-wide mb-1">
                  <span className="h-3 w-3 rounded-full bg-status-danger animate-pulse" />
                  {t('tournaments.liveNow')}
                </h2>
                <ScaleToFit className="flex-1 min-h-0 w-full">
                  <div className="flex flex-nowrap gap-6">
                    {liveMatches.map((m) => (
                      <div key={m.id} className="flex items-center gap-6 rounded-xl border border-status-danger/40 px-5 py-4 whitespace-nowrap">
                        <span className="text-white text-3xl font-semibold">
                          {m.teamA} <span className="text-text-muted text-xl font-normal">vs</span> {m.teamB}
                        </span>
                        <span className="text-status-danger text-4xl font-bold">
                          {m.scoreA ?? 0} : {m.scoreB ?? 0}
                        </span>
                      </div>
                    ))}
                  </div>
                </ScaleToFit>
              </div>
            )}

            <div className="shrink-0 flex gap-4" style={{ height: '26vh' }}>
              {tvUpcomingMatches.length > 0 && (
                <div className="flex-1 min-w-0 rounded-2xl border border-border bg-background-card px-6 py-3 flex flex-col">
                  <h2 className="shrink-0 text-white text-lg font-bold uppercase tracking-wide mb-1">{t('tournaments.upcomingMatches')}</h2>
                  <ScaleToFit className="flex-1 min-h-0 w-full">
                    <div className="flex flex-col gap-3">
                      {tvUpcomingMatches.map((m) => (
                        <div key={m.id} className="flex items-center justify-between gap-8 whitespace-nowrap">
                          <span className="text-white text-3xl font-semibold">
                            {m.teamA} <span className="text-text-muted text-xl font-normal">vs</span> {m.teamB}
                          </span>
                          <span className="text-text-muted text-2xl">
                            {m.date} · {m.startTime}
                            {m.rinkId ? ` · ${rinks.find((r) => r.id === m.rinkId)?.name ?? ''} — ${zones.find((z) => z.id === m.zoneId)?.name ?? ''}` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </ScaleToFit>
                </div>
              )}
              {/* Fixed proportionate size (not stretched to the row's full
                  height) — with `flex-1`+`aspect-square` a sparse (or
                  bracket-mode, upcoming-less) row let the QR balloon up to
                  fill the whole row while neighboring text stayed small,
                  looking oversized rather than balanced. */}
              <div
                className={`shrink-0 rounded-2xl border border-border bg-background-card px-4 py-3 flex flex-col items-center justify-center gap-2 ${
                  tvUpcomingMatches.length === 0 ? 'ml-auto' : ''
                }`}
                style={{ width: 'clamp(120px, 16vh, 220px)' }}
              >
                {tvQrDataUrl ? (
                  <img
                    src={tvQrDataUrl}
                    alt=""
                    className="w-full aspect-square bg-white p-1 rounded object-contain"
                    style={{ maxHeight: 'clamp(100px, 14vh, 190px)' }}
                  />
                ) : (
                  <div className="w-full aspect-square bg-background-dark rounded" style={{ maxHeight: 'clamp(100px, 14vh, 190px)' }} />
                )}
                <p className="shrink-0 text-text-muted text-xs text-center">{t('tournaments.tvScanHint')}</p>
              </div>
            </div>
          </>
        )}
      </div>
    )
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

          {teamOptions.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <label htmlFor="favorite-team" className="text-text-muted text-sm">
                {t('tournaments.favoriteTeamLabel')}
              </label>
              <select
                id="favorite-team"
                value={favoriteTeamId ?? ''}
                onChange={(e) => setFavoriteTeamId(e.target.value || null)}
                className="bg-background-dark border border-border rounded-md text-white text-sm px-2 py-1.5"
              >
                <option value="">{t('tournaments.favoriteTeamAll')}</option>
                {teamOptions.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
              {favoriteTeamId && !favoriteTeamHasMatches && (
                <span className="text-text-muted text-xs">{t('tournaments.favoriteTeamNoMatches')}</span>
              )}
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
                    <TournamentStandingsTable rows={roundRobinStandings} highlightTeamId={favoriteTeamId} />
                    <div className="space-y-1">{roundRobinMatches.filter(involvesFavoriteTeam).map(renderMatchRow)}</div>
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
                          <TournamentStandingsTable rows={standingsByGroup.get(g) ?? []} highlightTeamId={favoriteTeamId} />
                          <div className="space-y-1">{(groupMatchesByGroup.get(g) ?? []).filter(involvesFavoriteTeam).map(renderMatchRow)}</div>
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
                    <TournamentBracketDiagram matches={playoffMatches} rinks={rinks} zones={zones} highlightTeamId={favoriteTeamId} />
                  </CardContent>
                </Card>
              )}

              {knockoutMatches.length > 0 && (
                <Card className="arena-card">
                  <CardHeader>
                    <CardTitle className="text-white text-lg">{t('tournaments.knockoutTitle')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <TournamentBracketDiagram matches={knockoutMatches} rinks={rinks} zones={zones} highlightTeamId={favoriteTeamId} />
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
