import { useTranslation } from 'react-i18next'
import { Rink, TournamentMatch, Zone } from '@/types'

interface TournamentBracketDiagramProps {
  matches: (TournamentMatch & { id: string })[]
  rinks: Rink[]
  zones: Zone[]
  // Set when a spectator has picked a "my team" filter — highlights that
  // team's box/line wherever it appears in the bracket rather than
  // hiding anything else, since removing boxes would break the bracket
  // shape.
  highlightTeamId?: string | null
}

const BOX_HEIGHT_PX = 60
const BOX_GAP_PX = 16
const COLUMN_WIDTH_PX = 208

/**
 * A real elimination-bracket diagram — columns per round, each round's
 * boxes evenly spread (`justify-around`) across a column height fixed to
 * the first round's box count. Since round *r* always has exactly half
 * as many matches as round *r-1*, spreading half as many boxes evenly
 * across the same total height naturally centers each box roughly
 * between the two it was fed by, which is enough to read as the familiar
 * converging bracket shape without needing computed SVG connector lines.
 *
 * Round labels use the standard elimination-tournament naming (Finále/
 * Semifinále/Štvrťfinále/Osemfinále counting back from the last round)
 * instead of the generic "Kolo N" the admin-side TournamentBracketView
 * uses, since a spectator screen benefits from the familiar names more
 * than an admin editing results does.
 */
export default function TournamentBracketDiagram({ matches, rinks, zones, highlightTeamId }: TournamentBracketDiagramProps) {
  const { t } = useTranslation()
  const rounds = new Map<number, (TournamentMatch & { id: string })[]>()
  matches.forEach((m) => {
    const r = m.round ?? 0
    if (!rounds.has(r)) rounds.set(r, [])
    rounds.get(r)!.push(m)
  })
  const roundNumbers = Array.from(rounds.keys()).sort((a, b) => a - b)
  if (roundNumbers.length === 0) return null

  const firstRoundCount = rounds.get(roundNumbers[0])!.length
  const columnHeight = firstRoundCount * (BOX_HEIGHT_PX + BOX_GAP_PX)

  const roundName = (roundIndex: number) => {
    const fromEnd = roundNumbers.length - 1 - roundIndex
    switch (fromEnd) {
      case 0:
        return t('tournaments.finalLabel')
      case 1:
        return t('tournaments.semifinalLabel')
      case 2:
        return t('tournaments.quarterfinalLabel')
      case 3:
        return t('tournaments.roundOf16Label')
      default:
        return t('tournaments.roundLabel', { n: roundIndex + 1 })
    }
  }

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-8" style={{ width: 'max-content' }}>
        {roundNumbers.map((r, ri) => (
          <div key={r} className="flex flex-col flex-shrink-0" style={{ width: COLUMN_WIDTH_PX }}>
            <div className="flex justify-center mb-3">
              <span className="px-3 py-1 rounded-full bg-background-dark border border-border text-text-secondary text-[11px] font-semibold uppercase tracking-wide">
                {roundName(ri)}
              </span>
            </div>
            <div className="flex flex-col justify-around" style={{ height: columnHeight }}>
              {rounds
                .get(r)!
                .sort((a, b) => (a.matchNumber ?? 0) - (b.matchNumber ?? 0))
                .map((m) => {
                  const decided = !!m.winnerTeamId
                  const live = !decided && m.status === 'live'
                  const aWinner = decided && m.winnerTeamId === m.teamAId
                  const bWinner = decided && m.winnerTeamId === m.teamBId
                  const isFavA = !!highlightTeamId && m.teamAId === highlightTeamId
                  const isFavB = !!highlightTeamId && m.teamBId === highlightTeamId
                  const isFavMatch = isFavA || isFavB
                  return (
                    <div
                      key={m.id}
                      className={`rounded-lg border overflow-hidden text-sm shadow-sm ${
                        m.isBye ? 'border-dashed border-border/70 bg-transparent' : 'border-border bg-background-card'
                      } ${live ? 'ring-1 ring-status-danger/60' : isFavMatch ? 'ring-2 ring-primary/70' : ''}`}
                      style={{ minHeight: BOX_HEIGHT_PX }}
                    >
                      {m.isBye ? (
                        <div className="flex items-center justify-between px-3 py-2 text-text-muted">
                          <span className="truncate">{aWinner ? m.teamA : m.teamB}</span>
                          <span className="text-[10px] uppercase tracking-wide">{t('tournaments.byeLabel')}</span>
                        </div>
                      ) : (
                        <>
                          <div
                            className={`flex items-center justify-between gap-2 px-3 py-1.5 border-l-2 ${
                              aWinner
                                ? 'border-primary bg-primary/10 text-white font-semibold'
                                : isFavA
                                  ? 'border-primary/50 text-primary font-semibold'
                                  : 'border-transparent text-text-secondary'
                            }`}
                          >
                            <span className="truncate">{m.teamA}</span>
                            {(decided || live) && (
                              <span className={`mono text-xs font-bold rounded px-1.5 ${aWinner ? 'bg-primary/20 text-primary' : 'text-text-muted'}`}>
                                {m.scoreA ?? 0}
                              </span>
                            )}
                          </div>
                          <div className="border-t border-border" />
                          <div
                            className={`flex items-center justify-between gap-2 px-3 py-1.5 border-l-2 ${
                              bWinner
                                ? 'border-primary bg-primary/10 text-white font-semibold'
                                : isFavB
                                  ? 'border-primary/50 text-primary font-semibold'
                                  : 'border-transparent text-text-secondary'
                            }`}
                          >
                            <span className="truncate">{m.teamB}</span>
                            {(decided || live) && (
                              <span className={`mono text-xs font-bold rounded px-1.5 ${bWinner ? 'bg-primary/20 text-primary' : 'text-text-muted'}`}>
                                {m.scoreB ?? 0}
                              </span>
                            )}
                          </div>
                        </>
                      )}
                      {live && (
                        <div className="flex items-center gap-1.5 px-3 py-1 bg-status-danger/10 text-status-danger text-[11px] font-semibold">
                          <span className="h-1.5 w-1.5 rounded-full bg-status-danger animate-pulse" />
                          {t('tournaments.liveNow')}
                        </div>
                      )}
                      {!decided && !live && !m.isBye && m.startTime && (
                        <div className="px-3 py-1 text-text-muted text-[11px]">{m.startTime}</div>
                      )}
                      {!m.isBye && m.rinkId && (
                        <div className="px-3 py-1 text-text-muted text-[11px] border-t border-border">
                          {rinks.find((r) => r.id === m.rinkId)?.name ?? ''} — {zones.find((z) => z.id === m.zoneId)?.name ?? ''}
                        </div>
                      )}
                    </div>
                  )
                })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
