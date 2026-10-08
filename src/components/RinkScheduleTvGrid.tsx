import { useLayoutEffect, useRef, useState } from 'react'
import { localizedName, minutesToTime, stripRoomPrefix } from '@/lib/utils'
import { Rink } from '@/types'
import { BoardItem } from '@/hooks/useRinkScheduleBoardData'

// One shared CSS Grid template — Team | Time | Šatňa — applied identically,
// as a literal fixed-px string, to the per-rink header row AND every event
// row beneath it, regardless of which tier ('live'/'next'/a dynamically-
// shrinking 'later') that row renders at. Fixed px columns, sized
// generously for the *largest* font tier ('next', up to ~1.3rem) with
// `truncate`/`line-clamp` as a safety net on every non-time cell, so every
// row's columns land in exactly the same place and nothing can ever bleed
// outside its cell regardless of font size. Time itself never truncates —
// `minutesToTime` always produces exactly 5 characters ("16:45"), so the
// column is sized with real margin rather than an ellipsis safety net.
// Šatňa hostí (away room) and Zóna were both dropped from this board
// entirely per explicit request — staff found them unnecessary clutter on
// the TV screen specifically; both remain shown on the plain non-TV list
// further down the same page (that list is untouched, see
// RinkScheduleBoardPage.tsx's own rendering).
const GRID_TEMPLATE_COLUMNS = 'minmax(0,1fr) 90px 90px'
const GRID_CELL = 'flex items-center min-w-0 px-3.5'
const GRID_CELL_CENTER = 'flex items-center justify-center min-w-0 px-1'
const GRID_DIVIDER = 'border-l border-white/20'

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
const LATER_FONT_MAX_REM = 1.85 // ~29.6px — bumped up again from 1.6 per an
// explicit "there's spare room at the bottom of the screen, use it" request;
// still just a ceiling the measure-and-shrink pass in RinkBoardColumn backs
// off from on a busy day, see its own doc comment
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
    variant === 'next' ? 'text-[clamp(1rem,1.6vw,1.3rem)]' : variant === 'live' ? 'text-[clamp(0.8rem,1.15vw,1.05rem)]' : ''
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
          // The room's own fixed label prefix ("Šatňa", see
          // RoomPrefixInput) is stripped for display here — the column
          // header right above already says "Šatňa", so repeating the
          // word in every cell would be redundant. A value missing
          // entirely (or predating the prefix feature and not matching
          // it) falls back to an em dash, never a blank cell, so "nothing
          // set" always reads clearly rather than looking broken.
          const roomValue = it.room ? stripRoomPrefix(t('rinkSchedule.room'), it.room) : undefined
          // A plain ice rental ("Ľad na prenájom" — no team/trainer, just
          // open ice staff put up for anyone to rent) gets a subtly
          // different, cooler text color so it's easy to pick out from
          // real team/trainer bookings at a glance, without touching the
          // cell's own green/red/amber live-status background.
          const colorClasses = isRentalLabel(it.label) ? 'text-sky-300' : 'text-white'
          return (
            <div
              key={it.id}
              className={`grid items-stretch font-semibold ${sizeOnlyClasses} ${colorClasses}`}
              style={{
                gridTemplateColumns: GRID_TEMPLATE_COLUMNS,
                ...(variant === 'later' && laterMetrics ? { fontSize: `${laterMetrics.fontRem}rem` } : undefined)
              }}
            >
              {/* Each cell wraps its text in a second, non-flex inner span
                  (min-w-0 + flex-1 so it actually fills, and can shrink
                  within, the outer flex cell) — a `display:flex` element
                  wrapping raw text directly doesn't reliably clip/clamp in
                  practice, a real screenshot once showed a long team name
                  overflowing straight through the Time column instead.
                  `line-clamp-3` (not `truncate`): a name/room value wraps
                  across up to three lines rather than being cut to a
                  single-line ellipsis — staff need to actually read the
                  full value, not just recognize it was cut short. A real
                  club name ("Tréning amatérskych hokejistov") or zone label
                  ("Tretina k Rolbovni") still didn't fully fit at 2 lines,
                  caught live the same way as the rest of this board's
                  sizing; 3 lines is still a bound (not unlimited wrapping,
                  so one outlier value can't blow out a row's height
                  arbitrarily), just a more generous one. LATER_FONT_MAX_REM
                  was trimmed to leave headroom for a genuinely 3-line
                  row. */}
              {/* Team/Skupina (Name) is deliberately the one column that's
                  LARGER than the row's own base font (1.15em, vs.
                  Time/Šatňa's 1em) — it's the single thing staff actually
                  need to read from across the room, so it should read as
                  the most prominent text on the board, not just "the same
                  size as everything else". */}
              <span className={GRID_CELL}>
                <span className="min-w-0 flex-1 line-clamp-3 leading-tight text-[1.15em]">
                  {it.label}
                  {it.liveScore ? ` (${it.liveScore})` : ''}
                </span>
              </span>
              <span className={`${GRID_CELL_CENTER} ${GRID_DIVIDER} mono`}>{minutesToTime(slot.startMin)}</span>
              <span className={`${GRID_CELL_CENTER} ${GRID_DIVIDER}`}>
                <span className="min-w-0 flex-1 line-clamp-2 leading-tight text-center">{roomValue ?? '—'}</span>
              </span>
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
      const ratio = (available / needed) * 0.97
      setScale((s) => Math.max(0.05, Math.min(1, s * ratio)))
    } else if (needed < available * 0.92 && scale < 1) {
      // Two sibling rink columns can land at very different scales purely
      // because one has more rows than the other — a quieter column
      // shouldn't just sit on whatever smaller scale an earlier, busier
      // measurement left it at once there's real spare room below its last
      // cell (caught live: Hala 1's text read visibly smaller than Hala
      // 2's on the same real screen). Grows back toward the ceiling in
      // small, damped steps (half the measured slack each pass) rather
      // than jumping straight to the naive available/needed ratio — scale
      // only affects the "later" cells' height, not the fixed-size live/
      // next cells also inside `needed`, so that naive ratio would
      // overshoot; damping lets repeated effect re-runs (same mechanism
      // the shrink branch already relies on) converge without oscillating.
      const slack = available / needed
      const growRatio = 1 + (slack - 1) * 0.5
      setScale((s) => Math.max(0.05, Math.min(1, s * growRatio)))
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
    <div className="flex-1 min-h-0 w-full flex flex-col">
      {/* Shared column header, sized fixed (not part of the measured/
          shrunk area below) so it stays put regardless of how far a busy
          day's "later" tier has shrunk — uses the exact same
          GRID_TEMPLATE_COLUMNS as every row below, so each label sits
          genuinely above its own column rather than just approximately. */}
      <div
        className="shrink-0 grid items-stretch pb-1 text-[0.6rem] uppercase tracking-wide text-text-muted font-semibold"
        style={{ gridTemplateColumns: GRID_TEMPLATE_COLUMNS }}
      >
        <span className={`${GRID_CELL} truncate pr-3.5`}>{t('rinkSchedule.teamName')}</span>
        <span className={`${GRID_CELL_CENTER} ${GRID_DIVIDER} text-center`}>{t('common.time')}</span>
        {/* Šatňa's header uses the same centered alignment as its data
            cells (GRID_CELL_CENTER) — wraps onto two lines rather than
            widening an otherwise narrow column just to fit on one line. */}
        <span className={`${GRID_CELL_CENTER} ${GRID_DIVIDER} leading-[1.1] whitespace-normal text-center`}>{t('rinkSchedule.room')}</span>
      </div>
      <div ref={containerRef} className="flex-1 min-h-0 w-full overflow-hidden">
        <div ref={listRef} className="flex flex-col w-full" style={{ gap: `${gapRem}rem` }}>
          {liveSlots.map((slot) => renderSlotCell(t, slot, 'live'))}
          {nextSlot && renderSlotCell(t, nextSlot, 'next')}
          {laterSlots.map((slot) => renderSlotCell(t, slot, 'later', { fontRem, padYRem }))}
        </div>
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
          <h2 className="shrink-0 text-white text-xl font-bold text-center truncate">{localizedName(rink, lang)}</h2>
          <RinkBoardColumn items={itemsByRink.get(rink.id) ?? []} nowMin={nowMin} t={t} />
        </div>
      ))}
    </>
  )
}
