import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { computeDaySchedule } from '@/lib/schedule'
import { formatDateISO } from '@/lib/utils'
import { DivisionRule, TimeSlotConfig, Zone } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Label } from './ui/label'
import { Input } from './ui/input'
import QrCodeDisplay from './QrCodeDisplay'

interface AdminQrPanelProps {
  zones: Zone[]
  timeSlotConfig: TimeSlotConfig | null
  divisionRules: DivisionRule[]
}

export default function AdminQrPanel({ zones, timeSlotConfig, divisionRules }: AdminQrPanelProps) {
  const { t } = useTranslation()
  const origin = window.location.origin

  const [qrZoneId, setQrZoneId] = useState('')
  const [qrDate, setQrDate] = useState(formatDateISO(new Date()))
  const [qrTime, setQrTime] = useState('')
  const [generatedSlotUrl, setGeneratedSlotUrl] = useState<string | null>(null)

  const qrZone = zones.find((z) => z.id === qrZoneId)

  const availableTimes = useMemo(() => {
    if (!timeSlotConfig || !qrZone) return []
    return computeDaySchedule(new Date(`${qrDate}T00:00:00`), timeSlotConfig, divisionRules, zones)
      .filter((row) => row.zones.some((z) => z.id === qrZone.id))
      .map((row) => row.time)
  }, [timeSlotConfig, divisionRules, zones, qrDate, qrZone])

  const handleGenerateSlotQr = () => {
    if (!qrZoneId || !qrDate || !qrTime) return
    const url = `${origin}/book?zone=${encodeURIComponent(qrZoneId)}&date=${encodeURIComponent(qrDate)}&time=${encodeURIComponent(qrTime)}`
    setGeneratedSlotUrl(url)
  }

  return (
    <Card className="arena-card">
      <CardHeader>
        <CardTitle className="text-white">{t('admin.qrTab')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-8">
        {/* 1. Static app QR */}
        <div>
          <h3 className="text-white text-sm font-semibold mb-2">{t('admin.appQrTitle')}</h3>
          <p className="text-text-secondary text-sm mb-3">{t('admin.appQrDesc')}</p>
          <QrCodeDisplay value={`${origin}/`} filename="app-qr.png" label={t('admin.appQrLabel')} />
        </div>

        {/* 2. Per-zone browse QR */}
        <div>
          <h3 className="text-white text-sm font-semibold mb-2">{t('admin.zoneQrTitle')}</h3>
          <p className="text-text-secondary text-sm mb-3">{t('admin.zoneQrDesc')}</p>
          {zones.length === 0 ? (
            <p className="text-text-muted text-sm">{t('home.noZonesConfigured')}</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {zones.map((zone) => (
                <QrCodeDisplay
                  key={zone.id}
                  value={`${origin}/book?zone=${encodeURIComponent(zone.id)}`}
                  filename={`zone-${zone.id}-qr.png`}
                  label={zone.name}
                />
              ))}
            </div>
          )}
        </div>

        {/* 3. Quick-registration / "open ice" QR for one specific slot */}
        <div>
          <h3 className="text-white text-sm font-semibold mb-2">{t('admin.slotQrTitle')}</h3>
          <p className="text-text-secondary text-sm mb-3">{t('admin.slotQrDesc')}</p>

          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div>
              <Label htmlFor="qr-zone" className="text-white">{t('admin.zone')}</Label>
              <select
                id="qr-zone"
                value={qrZoneId}
                onChange={(e) => { setQrZoneId(e.target.value); setQrTime(''); setGeneratedSlotUrl(null) }}
                className="flex h-10 w-full rounded-md border border-input bg-background-dark px-3 py-2 text-sm text-white"
              >
                <option value="">{t('admin.selectZone')}</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>{z.name}</option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="qr-date" className="text-white">{t('admin.date')}</Label>
              <Input
                id="qr-date"
                type="date"
                value={qrDate}
                onChange={(e) => { setQrDate(e.target.value); setQrTime(''); setGeneratedSlotUrl(null) }}
                className="bg-background-dark border-border text-white"
              />
            </div>

            <div>
              <Label htmlFor="qr-time" className="text-white">{t('admin.time')}</Label>
              <select
                id="qr-time"
                value={qrTime}
                onChange={(e) => { setQrTime(e.target.value); setGeneratedSlotUrl(null) }}
                className="flex h-10 w-full rounded-md border border-input bg-background-dark px-3 py-2 text-sm text-white"
                disabled={!qrZoneId}
              >
                <option value="">{t('admin.selectTime')}</option>
                {availableTimes.map((time) => (
                  <option key={time} value={time}>{time}</option>
                ))}
              </select>
            </div>

            <Button
              onClick={handleGenerateSlotQr}
              disabled={!qrZoneId || !qrTime}
              className="bg-primary hover:bg-primary-gold text-primary-foreground"
            >
              {t('admin.generateQr')}
            </Button>
          </div>

          {generatedSlotUrl && qrZone && (
            <QrCodeDisplay
              value={generatedSlotUrl}
              filename={`${qrZone.id}-${qrDate}-${qrTime}-qr.png`}
              label={`${qrZone.name} · ${qrDate} ${qrTime}`}
            />
          )}
        </div>
      </CardContent>
    </Card>
  )
}
