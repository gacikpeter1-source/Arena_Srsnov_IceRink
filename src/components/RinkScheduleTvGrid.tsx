import { useLayoutEffect, useRef, useState } from 'react'
import { localizedName, minutesToTime, formatRoomLine } from '@/lib/utils'
import { Rink } from '@/types'
import { BoardItem } from '@/hooks/useRinkScheduleBoardData'

// Any team name containing "prenájom" (rental) — "Ľad na prenájom" (whole
// rink), "Tretina na prenájom" (one third), or any future wording staff
// type the same way — is a generic paid-rental slot, not a specific team/
// trainer. Team names are plain free text (no stored value anywhere in the
// data model, see CLAUDE.md's "no club-wide team registry" note), so this
// is a substring match rather than a fixed list of exact labels; accents
// are folded first so "prenájom"/"prenajom" (typed without the diacritic)
// both match, purely for this board's own color-coding.
function isRentalLabel(label: string): boolean {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .includes('prenajom')
}

// Groups active (not-yet-finished) items by exact start time — two or three
// events sharing one start time (the ice split into zones) land in the same
// slot/cell rather than one cell each.
interface BoardSlot {
  startMin: number
  items: BoardItem[]
}

function groupIntoSlots(items: BoardItem[]): BoardSlot[] {
  const active = items.filter((it) => it.state !== 'finished')
  const byStart = new Map<number, BoardItem[]>()
  active.forEach((it) => {
    if (!byStart.has(it.startMin)) byStart.set(it.startMin, [])
    byStart.get(it.startMin)!.push(it)
  })
  return Array.from(byStart.entries())
    .sort(([a], [b]) => a - b)
    .map(([startMin, slotItems]) => ({ startMin, items: slotItems }))
}

// The single soonest upcoming slot only turns red once it's this close to
// starting — before that it renders in the same yellow tier as every other
// later slot, per an explicit "vysvietená najskôr 45min pred začiatkom" (lit
// up no earlier than 45 minutes before start) request.
const NEXT_HIGHLIGHT_MINUTES = 45

// "Later" (yellow) cells' font/padding scale dynamically to fit however many
// events a real day actually has — see RinkBoardColumn below for the
// measure-and-shrink mechanism. LATER_FONT_MAX_REM (30px at the default 16px
// root) is a hard ceiling an event is never scaled past even on the
// quietest day; LATER_FONT_FLOOR_REM is just a last-resort safety floor
// (never literally vanish), not a "comfortable minimum" — the whole point of
// the dynamic approach is that there is no fixed minimum, everything shrinks
// as far as it needs to so every scheduled event for the day is visible.
const LATER_FONT_MAX_REM = 1.875 // 30px
const LATER_PAD_Y_MAX_REM = 0.3
const LATER_GAP_MAX_REM = 0.25
const LATER_FONT_FLOOR_REM = 0.4

function renderSlotCell(
  t: (key: string, opts?: Record<string, unknown>) => string,
  slot: BoardSlot,
  variant: 'live' | 'next' | 'later',
  laterMetrics?: { fontRem: number; padYRem: number }
) {
  const cellClasses =
    variant === 'live'
      ? 'border-status-success bg-status-success/15'
      : variant === 'next'
        ? 'border-status-danger bg-status-danger/15'
        : 'border-status-warning bg-status-warning/15'
  const sizeOnlyClasses =
    variant === 'next' ? 'text-[clamp(0.95rem,1.6vw,1.3rem)]' : variant === 'live' ? 'text-[clamp(0.8rem,1.15vw,1rem)]' : ''
  // Every cell sizes to its own content (shrink-0) — a "later" cell never
  // flex-grows to fill leftover height, so one lone event never balloons
  // into a screen-filling box; its font/padding just scale within the
  // bounded range computed above.
  const sizeClasses = variant === 'later' ? 'shrink-0 px-3' : 'shrink-0 px-3 py-1.5'
  const laterStyle = variant === 'later' && laterMetrics ? { paddingTop: `${laterMetrics.padYRem}rem`, paddingBottom: `${laterMetrics.padYRem}rem` } : undefined

  return (
    <div key={slot.startMin} className={`w-full rounded-lg border ${sizeClasses} ${cellClasses}`} style={laterStyle}>
      {(variant === 'live' || variant === 'next') && (
        <div className="mb-0.5">
          {variant === 'live' && <span className="text-status-success text-[0.65rem] uppercase tracking-wide font-semibold">{t('rinkSchedule.liveNow')}</span>}
          {variant === 'next' && <span className="text-status-danger text-[0.65rem] uppercase tracking-wide font-semibold">{t('rinkSchedule.upNext')}</span>}
        </div>
      )}
      <div className="flex flex-col gap-0.5 w-full">
        {slot.items.map((it) => {
          const room = formatRoomLine(t, it.room, it.awayRoom)
          // A plain ice rental ("Ľad na prenájom" — no team/trainer, just
          // open ice staff put up for anyone to rent) gets a subtly
          // different, cooler text color so it's easy to pick out from
          // real team/trainer bookings at a glance, without touching the
          // cell's own green/red/amber live-status background.
          const colorClasses = isRentalLabel(it.label) ? 'text-sky-300' : 'text-white'
          return (
            <div
              key={it.id}
              className={`flex items-center gap-2 min-w-0 font-semibold ${sizeOnlyClasses} ${colorClasses}`}
              style={variant === 'later' && laterMetrics ? { fontSize: `${laterMetrics.fontRem}rem` } : undefined}
            >
              {/* Name / time / room each their own column (no dashes) so
                  every row's time lines up under the next, same for room —
                  `ch`-based widths scale with this row's own font size, so
                  columns stay aligned at whatever size the day's density
                  computed. */}
              <span className="flex-1 min-w-0 truncate">
                {it.label}
                {it.liveScore ? ` (${it.liveScore})` : ''}
              </span>
              <span className="shrink-0 w-[5.5ch] mono text-right overflow-hidden">{minutesToTime(slot.startMin)}</span>
              <span className="shrink-0 w-[10ch] truncate">{room ?? ''}</span>
              {it.zonePart && (
                <span className="shrink-0 inline-flex items-center justify-center rounded border border-current px-1.5 leading-tight text-[0.75em] font-bold whitespace-nowrap">
                  {it.zoneLabel}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * One rink's event column on the TV board. Owns a measure-and-shrink pass
 * (via useLayoutEffect, which runs before the browser paints so the
 * adjustment is invisible rather than flashing full-size then shrinking):
 * render the "later" cells at `scale` (starting at 1, i.e. the full
 * LATER_FONT_MAX_REM ceiling), measure the real content height against the
 * column's actual available height, and if it overflows, shrink `scale` by
 * the overflow ratio and let React re-render/re-measure — repeats until it
 * fits or hits LATER_FONT_FLOOR_REM. `scale` resets to 1 whenever `items`
 * itself changes (a new poll, or an event moving from upcoming to live/
 * finished) so the day re-tries at full size and only shrinks again if it
 * still doesn't fit — otherwise a quiet stretch of the day would stay
 * stuck at whatever size an earlier, busier moment had shrunk it to.
 */
function RinkBoardColumn({
  items,
  nowMin,
  t
}: {
  items: BoardItem[]
  nowMin: number
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  const [scale, setScale] = useState(1)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const lastItemsRef = useRef(items)

  const slots = groupIntoSlots(items)
  const liveSlots = slots.filter((s) => s.startMin <= nowMin)
  const upcomingSlots = slots.filter((s) => s.startMin > nowMin)
  const hasNext = upcomingSlots.length > 0 && upcomingSlots[0].startMin - nowMin <= NEXT_HIGHLIGHT_MINUTES
  const nextSlot = hasNext ? upcomingSlots[0] : null
  const laterSlots = hasNext ? upcomingSlots.slice(1) : upcomingSlots

  const fontRem = Math.max(LATER_FONT_FLOOR_REM, LATER_FONT_MAX_REM * scale)
  const padYRem = Math.max(0.03, LATER_PAD_Y_MAX_REM * scale)
  const gapRem = Math.max(0.04, LATER_GAP_MAX_REM * scale)

  useLayoutEffect(() => {
    if (lastItemsRef.current !== items) {
      lastItemsRef.current = items
      if (scale !== 1) {
        setScale(1)
        return
      }
    }
    const container = containerRef.current
    const list = listRef.current
    if (!container || !list) return
    const available = container.clientHeight
    const needed = list.scrollHeight
    if (needed > available + 1 && scale > 0.05) {
      const ratio = (available / needed) * 0.96
      setScale((s) => Math.max(0.05, Math.min(1, s * ratio)))
    }
    // Deliberately keyed on [items, scale], not left dependency-less: the
    // parent recomputes `items` as a brand-new array every render (every
    // poll/clock tick), so this still re-measures whenever anything the
    // board cares about changes, without React warning about an unbounded
    // effect that re-runs after every single render for no declared reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, scale])

  if (slots.length === 0) return <p className="text-text-muted text-base">{t('rinkSchedule.boardNoUpcoming')}</p>

  return (
    <div ref={containerRef} className="flex-1 min-h-0 w-full overflow-hidden">
      <div ref={listRef} className="flex flex-col w-full" style={{ gap: `${gapRem}rem` }}>
        {liveSlots.map((slot) => renderSlotCell(t, slot, 'live'))}
        {nextSlot && renderSlotCell(t, nextSlot, 'next')}
        {laterSlots.map((slot) => renderSlotCell(t, slot, 'later', { fontRem, padYRem }))}
      </div>
    </div>
  )
}

interface RinkScheduleTvGridProps {
  activeRinks: Rink[]
  itemsByRink: Map<string, BoardItem[]>
  nowMin: number
  lang: string
  t: (key: string, opts?: Record<string, unknown>) => string
}

/**
 * One column per active rink, each a RinkBoardColumn — the kiosk grid
 * shared by both RinkScheduleBoardPage's own `?display=tv` mode and the
 * alternating board (RinkScheduleAlternatingBoardPage.tsx), so the two
 * screens show identical live-schedule rendering without duplicating it.
 * Callers supply their own flex wrapper (`flex-1 min-h-0 flex gap-3` in
 * both current usages) since this component only ever renders the columns
 * themselves.
 */
export default function RinkScheduleTvGrid({ activeRinks, itemsByRink, nowMin, lang, t }: RinkScheduleTvGridProps) {
  return (
    <>
      {activeRinks.map((rink) => (
        <div key={rink.id} className="flex-1 min-w-0 flex flex-col rounded-2xl border border-border bg-background-card p-2 gap-1">
          <h2 className="shrink-0 text-white text-sm font-bold text-center truncate">{localizedName(rink, lang)}</h2>
          <RinkBoardColumn items={itemsByRink.get(rink.id) ?? []} nowMin={nowMin} t={t} />
        </div>
      ))}
    </>
  )
}
