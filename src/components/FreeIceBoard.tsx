import { useTranslation } from 'react-i18next'
import { addDays, formatDateISO, localizedName, timeToMinutes } from '@/lib/utils'
import { FreeIceSlot, Rink, Zone } from '@/types'
import ScaleToFit from './ScaleToFit'

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
const PX_PER_HOUR = 48
const GRID_HEIGHT = (HOUR_END - HOUR_START) * PX_PER_HOUR
const HEADER_HEIGHT = 52

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
 * same-time slots on different ice never overlap each other. Wrapped in
 * ScaleToFit so the grid's fixed natural size (time axis height × 7 day
 * columns) always fits the kiosk screen regardless of its actual pixel
 * dimensions, same pattern every other TV panel in this app already uses.
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

  const hourTicks = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i)
  const hourLineBackground = {
    backgroundImage: 'linear-gradient(to bottom, rgba(255,255,255,0.1) 1px, transparent 1px)',
    backgroundSize: `100% ${PX_PER_HOUR}px`
  }

  return (
    <div className="h-full w-full flex items-center justify-center overflow-hidden">
      <ScaleToFit className="w-full h-full" maxScale={2.5}>
        <div className="flex flex-col gap-3 p-2">
          <h2 className="text-primary text-2xl font-bold text-center">{t('freeIce.boardTitle')}</h2>
          <div className="flex">
            {/* Time axis */}
            <div className="shrink-0 w-12" style={{ paddingTop: HEADER_HEIGHT }}>
              <div className="relative" style={{ height: GRID_HEIGHT }}>
                {hourTicks.map((h) => (
                  <div key={h} className="absolute right-1 -translate-y-1/2 text-text-muted text-[11px] mono" style={{ top: (h - HOUR_START) * PX_PER_HOUR }}>
                    {String(h).padStart(2, '0')}:00
                  </div>
                ))}
              </div>
            </div>

            {days.map((day) => {
              const daySlots = slots.filter((s) => s.date === day.iso)
              return (
                <div key={day.iso} className="w-[150px] shrink-0 border-l border-border/60">
                  <div className="text-center" style={{ height: HEADER_HEIGHT }}>
                    <div className="text-white font-bold text-sm">{day.dayName}</div>
                    <div className="text-text-muted text-xs">{day.label}</div>
                    <div className="flex text-text-muted text-[9px] uppercase tracking-wide opacity-70">
                      {rinks.map((rink) => (
                        <div key={rink.id} className="flex-1 truncate px-0.5">
                          {localizedName(rink, lang)}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex" style={{ height: GRID_HEIGHT }}>
                    {rinks.map((rink) => (
                      <div key={rink.id} className="flex-1 min-w-0 relative border-l border-border/30 first:border-l-0" style={hourLineBackground}>
                        {daySlots
                          .filter((s) => s.rinkId === rink.id)
                          .map((slot) => {
                            const top = minutesFromGridStart(slot.startTime) * (PX_PER_HOUR / 60)
                            const height = (timeToMinutes(slot.endTime) - timeToMinutes(slot.startTime)) * (PX_PER_HOUR / 60)
                            const zone = zoneLabel(slot.zoneId)
                            return (
                              <div
                                key={slot.id}
                                className="absolute left-0.5 right-0.5 rounded border border-primary/50 bg-primary/10 px-1 py-0.5 overflow-hidden leading-tight"
                                style={{ top, height: Math.max(height, 20) }}
                              >
                                <div className="text-primary mono text-[10px] font-bold">
                                  {slot.startTime}–{slot.endTime}
                                </div>
                                {zone && <div className="text-text-secondary text-[9px] truncate">{zone}</div>}
                                {slot.note && <div className="text-sky-300 text-[9px] truncate">{slot.note}</div>}
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
      </ScaleToFit>
    </div>
  )
}
