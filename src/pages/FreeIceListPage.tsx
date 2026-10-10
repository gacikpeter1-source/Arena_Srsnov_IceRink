import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useClubData } from '@/hooks/useClubData'
import { fetchUpcomingFreeIceSlots } from '@/lib/freeIceSlots'
import { formatDateISO, localizedName } from '@/lib/utils'
import { FreeIceSlot } from '@/types'
import BackButton from '@/components/BackButton'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'

// Per explicit product direction: this feature ships with BOTH reservation
// paths already coded, but only the SMS/phone path goes live in production
// for now — flipping this one constant (no further changes needed) is what
// turns on the "reserve via app" button later, once that flow is actually
// ready to be exposed to customers.
const FREE_ICE_RESERVE_VIA_APP_ENABLED = false

function formatDMY(isoDate: string): string {
  const [y, m, d] = isoDate.split('-')
  return `${Number(d)}.${Number(m)}.${y}`
}

// iOS and Android disagree on the separator before an sms: URI's query
// string — iOS historically only accepts `&` (even as the first param),
// Android only `?`. Sniffing the one case (iOS) that needs the exception
// is the standard workaround; everything else uses the normal `?`.
function buildSmsHref(phone: string, body: string): string {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  return `sms:${phone}${isIOS ? '&' : '?'}body=${encodeURIComponent(body)}`
}

export default function FreeIceListPage() {
  const { t, i18n } = useTranslation()
  const { club, rinks, zones } = useClubData()
  const [slots, setSlots] = useState<(FreeIceSlot & { id: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<(FreeIceSlot & { id: string }) | null>(null)

  useEffect(() => {
    if (!club) return
    fetchUpcomingFreeIceSlots(club.id, formatDateISO(new Date()))
      .then(setSlots)
      .finally(() => setLoading(false))
  }, [club])

  const activeRinks = rinks.filter((r) => r.active).sort((a, b) => a.sortOrder - b.sortOrder)
  const multipleRinks = activeRinks.length > 1

  const zoneLabel = (slot: FreeIceSlot): string => {
    const zone = zones.find((z) => z.id === slot.zoneId)
    const zoneName = zone ? localizedName(zone, i18n.language) : ''
    if (!multipleRinks) return zoneName
    const rink = rinks.find((r) => r.id === slot.rinkId)
    const rinkName = rink ? localizedName(rink, i18n.language) : ''
    return zoneName ? `${rinkName} · ${zoneName}` : rinkName
  }

  const smsPhone = club?.freeIceSmsPhone
  const smsBody = (slot: FreeIceSlot) =>
    t('freeIce.reserveSmsBody', { date: formatDMY(slot.date), time: slot.startTime, zone: zoneLabel(slot) })

  const appUrl = (slot: FreeIceSlot) =>
    `/book?zone=${encodeURIComponent(slot.zoneId)}&date=${encodeURIComponent(slot.date)}&time=${encodeURIComponent(slot.startTime)}`

  return (
    <div className="content-container py-6 space-y-6 max-w-2xl mx-auto">
      <BackButton fallback="/" />
      <div>
        <h1 className="text-2xl font-bold text-white">{t('freeIce.publicListTitle')}</h1>
        <p className="text-text-secondary text-sm mt-1">{t('freeIce.publicListIntro')}</p>
      </div>

      {loading ? (
        <p className="text-text-muted">{t('common.loading')}</p>
      ) : slots.length === 0 ? (
        <p className="text-text-muted">{t('freeIce.publicListNone')}</p>
      ) : (
        <Card className="arena-card">
          <CardContent className="pt-4 divide-y divide-border">
            {slots.map((slot) => (
              <div key={slot.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="text-white font-semibold mono">
                    {formatDMY(slot.date)} · {slot.startTime}
                  </p>
                  <p className="text-text-secondary text-sm truncate">{zoneLabel(slot)}</p>
                </div>
                <Button
                  size="sm"
                  onClick={() => setSelected(slot)}
                  className="shrink-0 bg-primary hover:bg-primary-gold text-primary-foreground"
                >
                  {t('freeIce.reserve')}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="text-white">
                  {formatDMY(selected.date)} · {selected.startTime} · {zoneLabel(selected)}
                </DialogTitle>
                <DialogDescription>{t('freeIce.reserveDialogDesc')}</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                {smsPhone ? (
                  <>
                    <a
                      href={buildSmsHref(smsPhone, smsBody(selected))}
                      className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-gold"
                    >
                      {t('freeIce.reserveSms')}
                    </a>
                    <a
                      href={`tel:${smsPhone}`}
                      className="inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-sm font-semibold text-white hover:bg-background-dark"
                    >
                      {t('freeIce.reserveCall')}
                    </a>
                  </>
                ) : (
                  <p className="text-text-muted text-sm">{t('freeIce.reserveSmsUnavailable')}</p>
                )}
                {FREE_ICE_RESERVE_VIA_APP_ENABLED && (
                  <a
                    href={appUrl(selected)}
                    className="inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-sm font-semibold text-white hover:bg-background-dark"
                  >
                    {t('freeIce.reserveViaApp')}
                  </a>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
