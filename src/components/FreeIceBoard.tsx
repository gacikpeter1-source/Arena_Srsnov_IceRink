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

// The fixed time axis this board always shows, per an explicit "časová os
// zhora dole od 5:00 do 24:00" request — regardless of how early/late the
// real slots that day actually start, so the grid's shape never jumps
// around as the underlying data changes.
const HOUR_START = 5
const HOUR_END = 24
const TOTAL_HOURS = HOUR_END - HOUR_START
const PERCENT_PER_HOUR = 100 / TOTAL_HOURS
// Fixed small chrome strip (day name/date + rink mini-labels, and the
// matching spacer above the time axis) — unlike the grid body below it,
// this doesn't need to grow with screen size, same reasoning the main
// board's own 6vh header bar already uses.
const HEADER_HEIGHT = 56

function minutesFromGridStart(time: string): number {
  return timeToMinutes(time) - HOUR_START * 60
}

/**
 * The staff-curated "free ice available to rent" listing (see FreeIceSlot
 * in src/types/index.ts), rendered for the alternating TV board
 * (RinkScheduleAlternatingBoardPage.tsx) as a real weekly calendar grid —
 * a fixed 5:00-24:00 time axis down the left, one column per day for the
 * next 7 days (today first, each with its own date), and — since this
 * club runs two physical rinks that can both have slots at/near the same
 * time — each day column splits into one lane per active rink so
 * same-time slots on different ice never overlap each other.
 *
 * Every size here is a CSS percentage of its own flex parent (day columns
 * are `flex-1`, slot blocks are positioned by `top`/`height` in `%` of the
 * fixed 19-hour axis) rather than a fixed pixel grid wrapped in
 * `ScaleToFit` — the earlier fixed-pixel version only ever grew within its
 * own aspect ratio, leaving real screen space unused on a 16:9 TV. This
 * way the grid genuinely fills the kiosk's full width and height, however
 * much of either it actually has.
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

  const hourTicks = Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => HOUR_START + i)
  const hourLineBackground = {
    backgroundImage: 'linear-gradient(to bottom, rgba(255,255,255,0.1) 1px, transparent 1px)',
    backgroundSize: `100% ${PERCENT_PER_HOUR}%`
  }

  return (
    <div className="h-full w-full flex flex-col overflow-hidden p-2 gap-2">
      <h2 className="shrink-0 text-primary text-[clamp(1rem,2vw,1.75rem)] font-bold text-center">{t('freeIce.boardTitle')}</h2>
      <div className="flex-1 min-h-0 flex">
        {/* Time axis */}
        <div className="shrink-0 w-16 flex flex-col">
          <div className="shrink-0" style={{ height: HEADER_HEIGHT }} />
          <div className="flex-1 min-h-0 relative">
            {hourTicks.map((h) => (
              <div
                key={h}
                className="absolute right-1 -translate-y-1/2 text-text-muted text-[clamp(0.6rem,0.8vw,0.95rem)] mono"
                style={{ top: `${(h - HOUR_START) * PERCENT_PER_HOUR}%` }}
              >
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>
        </div>

        {days.map((day) => {
          const daySlots = slots.filter((s) => s.date === day.iso)
          return (
            <div key={day.iso} className="flex-1 min-w-0 flex flex-col border-l border-border/60">
              <div className="shrink-0 text-center" style={{ height: HEADER_HEIGHT }}>
                <div className="text-white font-bold text-[clamp(0.75rem,1.1vw,1.15rem)]">{day.dayName}</div>
                <div className="text-text-muted text-[clamp(0.6rem,0.85vw,0.9rem)]">{day.label}</div>
                <div className="flex text-text-muted text-[clamp(0.45rem,0.6vw,0.65rem)] uppercase tracking-wide opacity-70">
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
                        const topPct = (minutesFromGridStart(slot.startTime) / (TOTAL_HOURS * 60)) * 100
                        const heightPct = ((timeToMinutes(slot.endTime) - timeToMinutes(slot.startTime)) / (TOTAL_HOURS * 60)) * 100
                        const zone = zoneLabel(slot.zoneId)
                        return (
                          <div
                            key={slot.id}
                            className="absolute left-0.5 right-0.5 rounded border border-primary/50 bg-primary/10 px-1 py-0.5 overflow-hidden leading-tight"
                            style={{ top: `${topPct}%`, height: `${Math.max(heightPct, 2)}%` }}
                          >
                            <div className="text-primary mono text-[clamp(0.55rem,0.75vw,0.9rem)] font-bold">
                              {slot.startTime}–{slot.endTime}
                            </div>
                            {zone && <div className="text-text-secondary text-[clamp(0.45rem,0.65vw,0.8rem)] truncate">{zone}</div>}
                            {slot.note && <div className="text-sky-300 text-[clamp(0.45rem,0.65vw,0.8rem)] truncate">{slot.note}</div>}
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
