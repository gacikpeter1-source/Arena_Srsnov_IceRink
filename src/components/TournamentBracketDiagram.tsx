import { useTranslation } from 'react-i18next'
import { TournamentMatch } from '@/types'

interface TournamentBracketDiagramProps {
  matches: (TournamentMatch & { id: string })[]
}

const BOX_HEIGHT_PX = 56
const BOX_GAP_PX = 16

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
export default function TournamentBracketDiagram({ matches }: TournamentBracketDiagramProps) {
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
      <div className="flex gap-6" style={{ width: 'max-content' }}>
        {roundNumbers.map((r, ri) => (
          <div key={r} className="flex flex-col flex-shrink-0" style={{ width: 200 }}>
            <h4 className="text-white text-xs font-semibold text-center mb-2">{roundName(ri)}</h4>
            <div className="flex flex-col justify-around" style={{ height: columnHeight }}>
              {rounds
                .get(r)!
                .sort((a, b) => (a.matchNumber ?? 0) - (b.matchNumber ?? 0))
                .map((m) => {
                  const decided = !!m.winnerTeamId
                  const live = !decided && m.status === 'live'
                  const aWinner = decided && m.winnerTeamId === m.teamAId
                  const bWinner = decided && m.winnerTeamId === m.teamBId
                  return (
                    <div key={m.id} className="rounded border border-border bg-background-dark overflow-hidden text-sm" style={{ minHeight: BOX_HEIGHT_PX }}>
                      {m.isBye ? (
                        <div className="flex items-center justify-between px-2 py-1.5 text-text-secondary">
                          <span className="truncate">{aWinner ? m.teamA : m.teamB}</span>
                          <span className="text-text-muted text-xs">{t('tournaments.byeLabel')}</span>
                        </div>
                      ) : (
                        <>
                          <div className={`flex items-center justify-between px-2 py-1 ${aWinner ? 'text-white font-semibold' : 'text-text-secondary'}`}>
                            <span className="truncate">{m.teamA}</span>
                            <span>{decided || live ? m.scoreA ?? 0 : ''}</span>
                          </div>
                          <div className="border-t border-border" />
                          <div className={`flex items-center justify-between px-2 py-1 ${bWinner ? 'text-white font-semibold' : 'text-text-secondary'}`}>
                            <span className="truncate">{m.teamB}</span>
                            <span>{decided || live ? m.scoreB ?? 0 : ''}</span>
                          </div>
                        </>
                      )}
                      {live && (
                        <div className="flex items-center gap-1 px-2 py-0.5 bg-status-danger/10 text-status-danger text-xs font-medium">
                          <span className="h-1.5 w-1.5 rounded-full bg-status-danger animate-pulse" />
                          {t('tournaments.liveNow')}
                        </div>
                      )}
                      {!decided && !live && !m.isBye && m.startTime && (
                        <div className="px-2 py-0.5 text-text-muted text-xs">{m.startTime}</div>
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
