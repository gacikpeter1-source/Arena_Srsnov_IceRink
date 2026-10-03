import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useRinkScheduleBoardData } from '@/hooks/useRinkScheduleBoardData'
import { minutesToTime, localizedName, formatRoomLine } from '@/lib/utils'
import RinkScheduleTvGrid from '@/components/RinkScheduleTvGrid'
import BackButton from '@/components/BackButton'

/**
 * Public "who has the ice when" board — merges the rink team schedule
 * (real Bookings, whether created via RinkSchedulePage.tsx or directly by
 * a customer) with live tournament matches for the same rink/day into one
 * feed, per CLAUDE.md's "Rink team schedule" > "Planned next" discussion.
 * Same "one route, query params pick the case" pattern as /turnaje:
 * `?display=tv` renders the fixed, no-scroll kiosk dashboard (one column
 * per rink); the plain route is a normal scrollable page for a phone
 * visitor. Deliberately shows raw TournamentMatch.teamA/teamB text (no
 * placeholder resolution via withResolvedPlaceholders) — a simpler,
 * "good enough for a glance" pass; /turnaje itself remains the
 * authoritative detailed view for a tournament's own resolved schedule.
 *
 * The fetch/poll/compute logic and the kiosk grid rendering both live in
 * useRinkScheduleBoardData/RinkScheduleTvGrid now, shared with
 * RinkScheduleAlternatingBoardPage.tsx (the "striedačka" screen that
 * cycles this same live board with the free-ice-for-rent listing).
 */
export default function RinkScheduleBoardPage() {
  const { t, i18n } = useTranslation()
  const { staff } = useAuth()
  const [searchParams] = useSearchParams()
  const isTvMode = searchParams.get('display') === 'tv'
  const canManage = staff?.isTrainer || staff?.role === 'assistant' || staff?.role === 'owner' || staff?.role === 'superadmin'
  const backFallback = canManage ? '/admin/rozvrh' : '/'

  const { club, loading, now, nowMin, activeRinks, itemsByRink } = useRinkScheduleBoardData(i18n.language)

  // "Piatok 30.09.2026 09:45" — a fixed, language-independent format for the
  // TV header clock (this is a physical display, not something a viewer
  // picks a language for), replacing the old "back to standard view" link
  // there — nobody at a wall-mounted screen needs that escape hatch. The day
  // name is always Slovak, same reasoning as the rest of this fixed format.
  const BOARD_DAY_NAMES = ['Nedeľa', 'Pondelok', 'Utorok', 'Streda', 'Štvrtok', 'Piatok', 'Sobota']
  function formatBoardClock(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${BOARD_DAY_NAMES[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  if (isTvMode) {
    return (
      <div className="h-full w-full bg-background-dark flex flex-col p-3 gap-2 text-white">
        <div className="shrink-0 grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-xl border border-border bg-background-card px-4" style={{ height: '6vh' }}>
          <Link
            to="/rozvrh"
            replace
            className="justify-self-start mono text-text-secondary text-sm sm:text-lg whitespace-nowrap hover:text-primary"
          >
            {formatBoardClock(now)}
          </Link>
          <h1 className="justify-self-center min-w-0 text-[clamp(1.1rem,3.2vw,3rem)] font-bold text-primary text-center truncate">
            {club?.name ?? t('rinkSchedule.title')}
          </h1>
          <div aria-hidden="true" />
        </div>

        <div className="flex-1 min-h-0 flex gap-3">
          <RinkScheduleTvGrid activeRinks={activeRinks} itemsByRink={itemsByRink} nowMin={nowMin} lang={i18n.language} t={t} />
        </div>
      </div>
    )
  }

  return (
    <div className="content-container py-6 space-y-6">
      <BackButton fallback={backFallback} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-white">{t('rinkSchedule.title')}</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link to="/rozvrh?display=tv" className="text-primary hover:text-primary-gold text-sm underline w-fit">
            {t('tournaments.viewAsScreen')}
          </Link>
          <Link to="/rozvrh/strieda" className="text-primary hover:text-primary-gold text-sm underline w-fit">
            {t('rinkSchedule.alternatingScreen')}
          </Link>
        </div>
      </div>

      {loading ? (
        <p className="text-text-muted">{t('common.loading')}</p>
      ) : activeRinks.every((r) => (itemsByRink.get(r.id) ?? []).length === 0) ? (
        <p className="text-text-muted">{t('rinkSchedule.boardNone')}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {activeRinks.map((rink) => {
            const items = itemsByRink.get(rink.id) ?? []
            return (
              <div key={rink.id} className="rounded-lg border border-border bg-background-card p-4 space-y-3">
                <h2 className="text-white text-lg font-bold">{localizedName(rink, i18n.language)}</h2>
                {items.length === 0 ? (
                  <p className="text-text-muted text-sm">{t('rinkSchedule.boardNoneForRink')}</p>
                ) : (
                  <div className="space-y-2">
                    {items.map((it) => (
                      <div key={it.id} className="flex items-center justify-between gap-3 text-sm">
                        <div>
                          <p className={`font-medium ${it.state === 'live' ? 'text-status-danger' : it.state === 'finished' ? 'text-text-muted' : 'text-white'}`}>
                            {it.label}
                            {it.state === 'live' && ` · ${t('rinkSchedule.liveNow')}`}
                            {it.liveScore ? ` (${it.liveScore})` : ''}
                          </p>
                          <p className="text-text-muted text-xs">
                            {it.zoneLabel}
                            {formatRoomLine(t, it.room, it.awayRoom) ? ` · ${formatRoomLine(t, it.room, it.awayRoom)}` : ''}
                          </p>
                        </div>
                        <span className="text-text-secondary whitespace-nowrap">
                          {minutesToTime(it.startMin)}–{minutesToTime(it.endMin)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
