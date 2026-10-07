import { useTranslation } from 'react-i18next'
import { addDays, formatDateISO, localizedName, timeToMinutes } from '@/lib/utils'
import { FreeIceSlot, Rink, Zone } from '@/types'

interface FreeIceBoardProps {
  slots: (FreeIceSlot & { id: string })[]
  rinks: Rink[]
  zones: Zone[]
  lang: string
}

// Same fixed, non-localized day-name format the main rink-schedule board's
// own clock uses (RinkScheduleBoardPage.tsx) — a physical kiosk display
// isn't something a viewer picks a language for.
const BOARD_DAY_NAMES = ['Nedeľa', 'Pondelok', 'Utorok', 'Streda', 'Štvrtok', 'Piatok', 'Sobota']

// The outer bound this board will ever consider — not shown as-is any
// more (see activeHours below), just the range scanned for hours that
// actually have something in them.
const HOUR_START = 5
const HOUR_END = 24

// Fixed small chrome strip (day name/date + rink mini-labels, and the
// matching spacer above the time axis) — unlike the grid body below it,
// this doesn't need to grow with screen size, same reasoning the main
// board's own 6vh header bar already uses.
const HEADER_HEIGHT = 72

// A slot's `height` is computed as a % of the compressed active-hours axis
// (see compressedPosition below), so on a day where many hours are active
// a short, real-duration slot can compute to only a handful of real pixels
// tall — not enough room for the time line + the combined zone/note line
// beneath it even after combining those two onto one line (see the note
// just below). `overflow-hidden` then silently clips whichever line runs
// out of vertical room, same failure mode the single-line-vs-two-line fix
// already solved once for *width* truncation, just now for height. A flat
// CSS `min-height` (not a %, which can't guarantee an absolute floor across
// different screens) guarantees every box — however short its computed
// duration-based height comes out — has room for both lines; a real TV
// screen trades a little visual overlap between adjacent short slots for
// never silently losing text, same trade-off `findOverlapConflict`'s own
// lane-less layout here already accepts in principle.
const SLOT_MIN_HEIGHT_PX = 52

/**
 * Which whole hours, across the entire visible week, actually have at
 * least one slot touching them. Hours nobody uses (a quiet midday
 * stretch, the small hours) are dropped from the axis entirely instead
 * of being reserved as empty space — this is what lets the hours that
 * DO matter get a much bigger share of the screen each, per an explicit
 * "zobraz len tie hodiny kde je voľný ľad" request. Trade-off (explicitly
 * accepted): the axis's shape now depends on the data instead of being
 * fixed 5:00-24:00 every night, and the hour labels can visibly "jump"
 * across a skipped stretch.
 */
function computeActiveHours(allSlots: { startTime: string; endTime: string }[]): number[] {
  const hours: number[] = []
  for (let h = HOUR_START; h < HOUR_END; h++) {
    const hourStartMin = h * 60
    const hourEndMin = (h + 1) * 60
    const used = allSlots.some((s) => timeToMinutes(s.startTime) < hourEndMin && timeToMinutes(s.endTime) > hourStartMin)
    if (used) hours.push(h)
  }
  return hours
}

/**
 * A slot's start/end time, expressed as a fractional position on the
 * compressed `activeHours` axis (e.g. 2.25 = a quarter into the 3rd kept
 * hour) rather than real elapsed hours from HOUR_START. Every hour a slot
 * touches is, by construction, itself in `activeHours` (see
 * computeActiveHours above), and since hours are consecutive integers,
 * any two hours a single slot spans are still adjacent after compression
 * — so a slot's own span never needs to "jump" a gap.
 *
 * `isEnd` handles the one edge case that needs it: an end time landing
 * exactly on an hour boundary (very common here, e.g. "20:00-21:00")
 * belongs to the END of the previous hour's bucket, not the START of
 * whatever hour follows (which may not even be in `activeHours`).
 */
function compressedPosition(minutesOfDay: number, activeHours: number[], isEnd: boolean): number {
  const adjusted = isEnd && minutesOfDay % 60 === 0 ? minutesOfDay - 1 : minutesOfDay
  const hour = Math.floor(adjusted / 60)
  const fracInHour = (minutesOfDay - hour * 60) / 60
  const idx = activeHours.indexOf(hour)
  return (idx === -1 ? 0 : idx) + fracInHour
}

/**
 * The staff-curated "free ice available to rent" listing (see FreeIceSlot
 * in src/types/index.ts), rendered for the alternating TV board
 * (RinkScheduleAlternatingBoardPage.tsx) as a real weekly calendar grid —
 * a time axis down the left, one column per day for the next 7 days
 * (today first, each with its own date), and — since this club runs two
 * physical rinks that can both have slots at/near the same time — each
 * day column splits into one lane per active rink so same-time slots on
 * different ice never overlap each other.
 *
 * The axis itself only shows the hours that actually have something in
 * them across the visible week (see computeActiveHours below) — a quiet
 * midday or overnight stretch is dropped entirely rather than reserved
 * as empty space, so every event gets a noticeably bigger box (and its
 * price/zone note room to actually render) than a fixed 5:00-24:00 axis
 * would give it.
 *
 * Every size here is a CSS percentage of its own flex parent (day columns
 * are `flex-1`, slot blocks are positioned by `top`/`height` in `%` of the
 * compressed axis) rather than a fixed pixel grid wrapped in `ScaleToFit`
 * — the earlier fixed-pixel version only ever grew within its own aspect
 * ratio, leaving real screen space unused on a 16:9 TV. This way the grid
 * genuinely fills the kiosk's full width and height, however much of
 * either it actually has.
 */
export default function FreeIceBoard({ slots, rinks, zones, lang }: FreeIceBoardProps) {
  const { t } = useTranslation()

  const zoneLabel = (zoneId: string) => {
    const zone = zones.find((z) => z.id === zoneId)
    // Only shown for a genuinely split zone — a whole-rink slot has no
    // "which part" ambiguity, same convention the main TV board's own
    // zonePart badge already follows.
    return zone && zone.mode !== 'full' ? localizedName(zone, lang) : undefined
  }

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(new Date(), i)
    return { iso: formatDateISO(date), dayName: BOARD_DAY_NAMES[date.getDay()], label: `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.` }
  })
  const visibleDates = new Set(days.map((d) => d.iso))

  if (!slots.some((s) => visibleDates.has(s.date))) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <p className="text-text-muted text-2xl">{t('freeIce.boardNone')}</p>
      </div>
    )
  }

  const weekSlots = slots.filter((s) => visibleDates.has(s.date))
  const activeHours = computeActiveHours(weekSlots)
  const hourUnits = activeHours.length || 1
  const percentPerUnit = 100 / hourUnits
  // One label per kept hour, plus a final closing label for the end of
  // the last one — e.g. kept hours [8, 9, 17] show "08:00 09:00 10:00
  // 17:00 18:00", the jump itself being the visible signal that a quiet
  // stretch was skipped.
  const hourTicks = [
    ...activeHours.map((h, i) => ({ hour: h, pct: i * percentPerUnit })),
    { hour: activeHours[activeHours.length - 1] + 1, pct: 100 }
  ]
  const hourLineBackground = {
    backgroundImage: 'linear-gradient(to bottom, rgba(255,255,255,0.1) 1px, transparent 1px)',
    backgroundSize: `100% ${percentPerUnit}%`
  }

  return (
    <div className="h-full w-full flex flex-col overflow-hidden p-2 gap-2">
      <h2 className="shrink-0 text-primary text-[clamp(1.25rem,2.3vw,2rem)] font-bold text-center">{t('freeIce.boardTitle')}</h2>
      <div className="flex-1 min-h-0 flex">
        {/* Time axis */}
        <div className="shrink-0 w-20 flex flex-col">
          <div className="shrink-0" style={{ height: HEADER_HEIGHT }} />
          <div className="flex-1 min-h-0 relative">
            {hourTicks.map(({ hour, pct }) => (
              <div
                key={hour}
                className="absolute right-1 -translate-y-1/2 text-text-muted text-[clamp(0.8rem,1.1vw,1.3rem)] font-semibold mono"
                style={{ top: `${pct}%` }}
              >
                {String(hour).padStart(2, '0')}:00
              </div>
            ))}
          </div>
        </div>

        {days.map((day) => {
          const daySlots = slots.filter((s) => s.date === day.iso)
          return (
            <div key={day.iso} className="flex-1 min-w-0 flex flex-col border-l border-border/60">
              <div className="shrink-0 text-center" style={{ height: HEADER_HEIGHT }}>
                <div className="text-white font-bold text-[clamp(1rem,1.4vw,1.5rem)]">{day.dayName}</div>
                <div className="text-text-muted text-[clamp(0.8rem,1.1vw,1.2rem)]">{day.label}</div>
                <div className="flex text-text-muted text-[clamp(0.55rem,0.75vw,0.8rem)] uppercase tracking-wide opacity-70">
                  {rinks.map((rink) => (
                    <div key={rink.id} className="flex-1 truncate px-0.5">
                      {localizedName(rink, lang)}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex-1 min-h-0 flex">
                {rinks.map((rink) => (
                  <div key={rink.id} className="flex-1 min-w-0 relative border-l border-border/30 first:border-l-0" style={hourLineBackground}>
                    {daySlots
                      .filter((s) => s.rinkId === rink.id)
                      .map((slot) => {
                        const topUnits = compressedPosition(timeToMinutes(slot.startTime), activeHours, false)
                        const endUnits = compressedPosition(timeToMinutes(slot.endTime), activeHours, true)
                        const topPct = (topUnits / hourUnits) * 100
                        const heightPct = ((endUnits - topUnits) / hourUnits) * 100
                        const zone = zoneLabel(slot.zoneId)
                        return (
                          <div
                            key={slot.id}
                            className="absolute left-0.5 right-0.5 rounded border border-primary/50 bg-primary/10 px-1.5 py-1 overflow-hidden leading-tight"
                            style={{ top: `${topPct}%`, height: `${Math.max(heightPct, 2)}%`, minHeight: SLOT_MIN_HEIGHT_PX }}
                          >
                            <div className="text-primary mono text-[clamp(0.8rem,1.1vw,1.3rem)] font-bold leading-tight">
                              {slot.startTime}
                            </div>
                            {/* Zone and note used to be two separate lines — on a real
                                1-hour slot in a busy day, the compressed grid's box often
                                isn't tall enough for all three lines (time + zone + note),
                                and `overflow-hidden` silently drops whichever line runs out
                                of room rather than truncating it — a real screenshot showed
                                a slot's price/restriction note (e.g. "80 e tretina")
                                vanishing completely even though the zone line above it still
                                fit. Combined onto one truncating line instead: needing room
                                for only two lines total (time + this one) reliably fits
                                where three didn't, and a genuine overflow now degrades to an
                                ellipsis rather than disappearing outright. */}
                            {(zone || slot.note) && (
                              // Note comes first (not zone) specifically so a narrow
                              // day column's `truncate` cuts the zone part, not the
                              // price/restriction note — the note is the detail staff
                              // actually asked to see on a glance, the zone is the
                              // secondary one.
                              <div className="text-[clamp(0.55rem,0.8vw,0.95rem)] truncate leading-tight">
                                {slot.note && <span className="text-sky-300">{slot.note}</span>}
                                {zone && slot.note && <span className="text-text-muted"> · </span>}
                                {zone && <span className="text-text-secondary">{zone}</span>}
                              </div>
                            )}
                          </div>
                        )
                      })}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
