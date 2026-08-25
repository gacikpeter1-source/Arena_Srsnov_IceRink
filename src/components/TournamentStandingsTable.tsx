import { useTranslation } from 'react-i18next'
import { GroupStandingRow } from '@/lib/tournaments'

interface TournamentStandingsTableProps {
  rows: GroupStandingRow[]
  // Set when a spectator has picked a "my team" filter — highlights that
  // row instead of removing the others, since a team's rank only means
  // something next to the rest of the table.
  highlightTeamId?: string | null
}

// Cosmetic rank accent for the top 3 (gold/silver/bronze-ish) — purely
// visual, no meaning beyond "this row is near the top".
const RANK_ACCENT = ['text-primary', 'text-slate-300', 'text-amber-600']

const GRID_COLS = 'grid-cols-[1.75rem_1fr_3rem_3rem_3.75rem_3.25rem]'

/**
 * Shared standings row layout for both the round-robin single table and
 * each group's own card in the grid — used only by the public /turnaje
 * screen (the admin's own richer W/D/L table in
 * TournamentGroupsGenerator.tsx is unchanged). Replaces the earlier plain
 * HTML `<table>` with a ranked-row card layout per an explicit "more
 * modern, clearer" request: a numbered rank column, points as a filled
 * pill instead of a bare number, and a divided-row list instead of table
 * borders.
 */
export default function TournamentStandingsTable({ rows, highlightTeamId }: TournamentStandingsTableProps) {
  const { t } = useTranslation()
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className={`grid ${GRID_COLS} gap-2 px-3 py-2 bg-background-dark/80 text-text-muted text-[10px] font-semibold uppercase tracking-wide`}>
        <span />
        <span>{t('tournaments.standingsTeam')}</span>
        <span className="text-center">{t('tournaments.standingsTotalMatches')}</span>
        <span className="text-center">{t('tournaments.standingsPlayedShort')}</span>
        <span className="text-center">{t('tournaments.standingsGoals')}</span>
        <span className="text-center">{t('tournaments.standingsPoints')}</span>
      </div>
      <div className="divide-y divide-border">
        {rows.map((row, i) => {
          const isHighlighted = !!highlightTeamId && row.teamId === highlightTeamId
          return (
          <div
            key={row.teamId}
            className={`grid ${GRID_COLS} gap-2 px-3 py-2 items-center ${isHighlighted ? 'bg-primary/10 border-l-2 border-primary' : ''}`}
          >
            <span className={`text-sm font-bold ${RANK_ACCENT[i] ?? 'text-text-muted'}`}>{i + 1}</span>
            <span className={`truncate ${isHighlighted ? 'text-primary font-bold' : 'text-white font-medium'}`}>{row.teamName}</span>
            <span className="text-center text-text-secondary text-sm">{row.totalMatches}</span>
            <span className="text-center text-text-secondary text-sm">{row.played}</span>
            <span className="text-center text-text-secondary text-sm mono">{row.goalsFor}:{row.goalsAgainst}</span>
            <span className="text-center">
              <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-full bg-primary/15 text-primary font-bold text-sm">
                {row.points}
              </span>
            </span>
          </div>
          )
        })}
      </div>
    </div>
  )
}
