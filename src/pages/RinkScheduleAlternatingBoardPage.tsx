import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { useRinkScheduleBoardData } from '@/hooks/useRinkScheduleBoardData'
import { fetchUpcomingFreeIceSlots } from '@/lib/freeIceSlots'
import { formatDateISO } from '@/lib/utils'
import { generateQrDataUrl } from '@/lib/qrcode'
import { FreeIceSlot } from '@/types'
import RinkScheduleTvGrid from '@/components/RinkScheduleTvGrid'
import FreeIceBoard from '@/components/FreeIceBoard'

const DEFAULT_INTERVAL_SECONDS = 10
const FREE_ICE_POLL_MS = 60000

// Fixed Slovak price/contact copy for the rate-card footer below — same
// "a physical kiosk isn't something a viewer picks a language for" reasoning
// every other fixed string on this board already follows (day names, "Práve
// sa hrá", ...). No structured per-zone price field exists anywhere in this
// app's data model (see CLAUDE.md's payment-scaffold section) and this is a
// standing rate card, not one-off FreeIceSlot.note copy, so it's plain
// static content here rather than something read from Firestore.
const PRICE_ROWS: { label: string; price: string }[] = [
  { label: 'Celá ľadová plocha', price: 'cena dohodou' },
  { label: 'Polovica ľadovej plochy', price: '100 €' },
  { label: 'Krajná tretina', price: '80 €' },
  { label: 'Stredná tretina', price: '50 €' }
]
const FALLBACK_PHONE = '+421905622145'

// Same fixed day-name format the main board's own clock uses.
const BOARD_DAY_NAMES = ['Nedeľa', 'Pondelok', 'Utorok', 'Streda', 'Štvrtok', 'Piatok', 'Sobota']
function formatBoardClock(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${BOARD_DAY_NAMES[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * A second kiosk screen, for the players' bench ("striedačka") rather than
 * the hallway TV that /rozvrh?display=tv already covers — cycles between
 * that exact same live schedule board and the staff-curated "free ice
 * available to rent" listing (FreeIceSlot, see lib/freeIceSlots.ts), on a
 * timer. Always full-screen/no-chrome (see App.tsx's isTvScreen check,
 * which lists this path unconditionally — there's no non-kiosk variant of
 * this page the way /rozvrh and /turnaje have one, since nobody browses to
 * this one on their own phone).
 *
 * The cycle interval is a plain `?interval=<seconds>` query param on the
 * URL (default 10) rather than a stored setting — matching this app's
 * established "one route, query params pick the case" pattern (see the
 * `/turnaje`/`/rozvrh` TV modes and the tvCode shortcut) and letting staff
 * change it per-screen just by editing the saved/bookmarked URL, with no
 * admin UI needed for a single number.
 */
export default function RinkScheduleAlternatingBoardPage() {
  const { t, i18n } = useTranslation()
  const [searchParams] = useSearchParams()
  const requestedInterval = Number(searchParams.get('interval'))
  const intervalSeconds = Number.isFinite(requestedInterval) && requestedInterval >= 3 ? requestedInterval : DEFAULT_INTERVAL_SECONDS

  const { club, zones, now, nowMin, activeRinks, itemsByRink } = useRinkScheduleBoardData(i18n.language)
  const [freeSlots, setFreeSlots] = useState<(FreeIceSlot & { id: string })[]>([])
  const [slide, setSlide] = useState<0 | 1>(0)
  // QR points back at this same striedačka screen, so a visitor can open
  // the identical cycling board on their own phone — same "preview link"
  // reasoning every other TV-board QR in this app already follows.
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!club) return
    const refresh = () => fetchUpcomingFreeIceSlots(club.id, formatDateISO(new Date())).then(setFreeSlots)
    refresh()
    const interval = setInterval(refresh, FREE_ICE_POLL_MS)
    return () => clearInterval(interval)
  }, [club])

  useEffect(() => {
    const timer = setInterval(() => setSlide((s) => (s === 0 ? 1 : 0)), intervalSeconds * 1000)
    return () => clearInterval(timer)
  }, [intervalSeconds])

  useEffect(() => {
    generateQrDataUrl(`${window.location.origin}/rozvrh/strieda`).then(setQrDataUrl)
  }, [])

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

      <div className="flex-1 min-h-0 relative">
        <div className={`absolute inset-0 flex gap-3 transition-opacity duration-700 ${slide === 0 ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <RinkScheduleTvGrid activeRinks={activeRinks} itemsByRink={itemsByRink} nowMin={nowMin} lang={i18n.language} t={t} />
        </div>
        <div className={`absolute inset-0 transition-opacity duration-700 ${slide === 1 ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <FreeIceBoard slots={freeSlots} rinks={activeRinks} zones={zones} lang={i18n.language} />
        </div>
      </div>

      {/* Price/contact rate-card footer — a persistent `shrink-0` row (not
          part of either cycling slide), per an explicit "čo najmenej
          zasahovať, ale musí byť viditeľné" request: it takes a small,
          fixed slice of the column's height, and both RinkScheduleTvGrid's
          own measure-and-shrink pass and FreeIceBoard's percentage-based
          sizing already adapt to whatever vertical room is actually left,
          so neither cycling view needed any change to make room for this. */}
      <div className="shrink-0 flex items-center justify-between gap-4 rounded-xl border border-border bg-background-card px-4" style={{ height: '9vh' }}>
        <div className="min-w-0 flex flex-col justify-center gap-1">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-0.5">
            {PRICE_ROWS.map((row) => (
              <span key={row.label} className="text-[clamp(0.6rem,1vw,0.95rem)] font-semibold text-text-secondary whitespace-nowrap">
                {row.label}: <span className="text-primary">{row.price}</span>
              </span>
            ))}
          </div>
          <p className="text-[clamp(0.65rem,1.1vw,1.05rem)] text-text-secondary whitespace-nowrap">
            Tel.: <span className="text-white font-semibold">{club?.contact?.phone || FALLBACK_PHONE}</span>
          </p>
        </div>
        {qrDataUrl && (
          <img
            src={qrDataUrl}
            alt="QR"
            className="shrink-0 rounded bg-white p-1"
            style={{ width: 'clamp(48px, 7vh, 86px)', height: 'clamp(48px, 7vh, 86px)' }}
          />
        )}
      </div>
    </div>
  )
}
