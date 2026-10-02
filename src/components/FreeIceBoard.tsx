import { useTranslation } from 'react-i18next'
import { localizedName } from '@/lib/utils'
import { FreeIceSlot, Rink } from '@/types'
import ScaleToFit from './ScaleToFit'

interface FreeIceBoardProps {
  slots: (FreeIceSlot & { id: string })[]
  rinks: Rink[]
  lang: string
}

// Same fixed, non-localized day-name format the main rink-schedule board's
// own clock uses (RinkScheduleBoardPage.tsx) — a physical kiosk display
// isn't something a viewer picks a language for.
const BOARD_DAY_NAMES = ['Nedeľa', 'Pondelok', 'Utorok', 'Streda', 'Štvrtok', 'Piatok', 'Sobota']

function formatDayHeader(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return `${BOARD_DAY_NAMES[date.getDay()]} ${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`
}

/**
 * The staff-curated "free ice available to rent" listing (see FreeIceSlot
 * in src/types/index.ts), rendered for the alternating TV board
 * (RinkScheduleAlternatingBoardPage.tsx) — grouped by date, two date
 * columns side by side (matching how the club's own external spreadsheet
 * already laid this out), wrapped in ScaleToFit so an arbitrary number of
 * upcoming dates/slots never needs scrolling on a kiosk screen.
 */
export default function FreeIceBoard({ slots, rinks, lang }: FreeIceBoardProps) {
  const { t } = useTranslation()
  const rinkName = (rinkId: string) => {
    const rink = rinks.find((r) => r.id === rinkId)
    return rink ? localizedName(rink, lang) : rinkId
  }

  const byDate = new Map<string, (FreeIceSlot & { id: string })[]>()
  slots.forEach((slot) => {
    if (!byDate.has(slot.date)) byDate.set(slot.date, [])
    byDate.get(slot.date)!.push(slot)
  })
  const dates = Array.from(byDate.keys()).sort()

  if (dates.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <p className="text-text-muted text-2xl">{t('freeIce.boardNone')}</p>
      </div>
    )
  }

  return (
    <div className="h-full w-full flex items-center justify-center overflow-hidden">
      <ScaleToFit className="w-full h-full" maxScale={2}>
        <div className="flex flex-col gap-4 p-2">
          <h2 className="text-primary text-3xl font-bold text-center">{t('freeIce.boardTitle')}</h2>
          <div className="grid grid-cols-2 gap-x-10 gap-y-4">
            {dates.map((date) => (
              <div key={date} className="min-w-[420px]">
                <h3 className="text-white text-xl font-bold mb-1 border-b border-border pb-1">{formatDayHeader(date)}</h3>
                <div className="flex flex-col gap-1">
                  {byDate.get(date)!.map((slot) => (
                    <div key={slot.id} className="flex items-center gap-3 text-lg">
                      <span className="mono text-primary shrink-0 w-[115px]">
                        {slot.startTime}–{slot.endTime}
                      </span>
                      <span className="text-white shrink-0 w-[90px] truncate">{rinkName(slot.rinkId)}</span>
                      {slot.note && <span className="text-sky-300 truncate">{slot.note}</span>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </ScaleToFit>
    </div>
  )
}
