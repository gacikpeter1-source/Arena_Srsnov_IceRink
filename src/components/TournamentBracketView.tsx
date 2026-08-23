import { useTranslation } from 'react-i18next'
import { TournamentMatch } from '@/types'
import { Button } from './ui/button'
import { Input } from './ui/input'

interface TournamentBracketViewProps {
  matches: (TournamentMatch & { id: string })[]
  // Omit all four when readOnly — the public /turnaje schedule page shows
  // the same bracket shape with no score-entry UI at all, never a login
  // requirement (customers/parents have no way to record a result).
  readOnly?: boolean
  scoreInputs?: Record<string, { a: string; b: string }>
  onScoreChange?: (matchId: string, side: 'a' | 'b', value: string) => void
  onSaveResult?: (match: TournamentMatch & { id: string }) => void
  savingMatchId?: string | null
}

/**
 * Live knockout bracket, grouped by round with a score-entry row on any
 * match where both teams are known and no result is recorded yet —
 * shared by TournamentKnockoutGenerator (a standalone "pavúk"),
 * TournamentGroupsGenerator's play-off stage (Fáza D), and the public
 * TournamentSchedulePage (read-only), since all three show the exact same
 * bracket shape via buildKnockoutPreview/createKnockoutBracket, just
 * tagged with a different `schema`.
 */
export default function TournamentBracketView({ matches, readOnly, scoreInputs, onScoreChange, onSaveResult, savingMatchId }: TournamentBracketViewProps) {
  const { t } = useTranslation()
  const rounds = new Map<number, (TournamentMatch & { id: string })[]>()
  matches.forEach((m) => {
    const r = m.round ?? 0
    if (!rounds.has(r)) rounds.set(r, [])
    rounds.get(r)!.push(m)
  })
  const roundNumbers = Array.from(rounds.keys()).sort((a, b) => a - b)

  return (
    <div className="space-y-4">
      {roundNumbers.map((r) => (
        <div key={r} className="space-y-2">
          <h3 className="text-white text-sm font-semibold">{t('tournaments.roundLabel', { n: r + 1 })}</h3>
          {rounds
            .get(r)!
            .sort((a, b) => (a.matchNumber ?? 0) - (b.matchNumber ?? 0))
            .map((m) => {
              const decided = !!m.winnerTeamId
              const playable = !readOnly && !m.isBye && !decided && !!m.teamAId && !!m.teamBId
              return (
                <div key={m.id} className="p-2 rounded border border-border space-y-2">
                  <div className="flex justify-between items-center flex-wrap gap-2">
                    <p className={m.isBye ? 'text-text-muted text-sm' : 'text-white text-sm'}>
                      {m.teamA} <span className="text-text-muted">vs</span> {m.teamB}
                      {m.isBye && ` (${t('tournaments.byeLabel')})`}
                    </p>
                    {decided && (
                      <span className="text-status-success text-sm font-medium">
                        {m.scoreA} : {m.scoreB}
                      </span>
                    )}
                    {!m.isBye && !decided && m.startTime && <span className="text-text-muted text-xs">{m.startTime}</span>}
                  </div>
                  {playable && onScoreChange && onSaveResult && (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        value={scoreInputs?.[m.id]?.a ?? ''}
                        onChange={(e) => onScoreChange(m.id, 'a', e.target.value)}
                        className="bg-background-dark border-border text-white w-16 h-8"
                      />
                      <span className="text-text-muted text-xs">:</span>
                      <Input
                        type="number"
                        min={0}
                        value={scoreInputs?.[m.id]?.b ?? ''}
                        onChange={(e) => onScoreChange(m.id, 'b', e.target.value)}
                        className="bg-background-dark border-border text-white w-16 h-8"
                      />
                      <Button
                        type="button"
                        size="sm"
                        disabled={savingMatchId === m.id}
                        onClick={() => onSaveResult(m)}
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
      ))}
    </div>
  )
}
