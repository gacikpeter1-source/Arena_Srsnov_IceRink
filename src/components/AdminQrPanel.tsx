import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { computeDaySchedule } from '@/lib/schedule'
import { fetchScheduleOverride } from '@/lib/scheduleOverrides'
import { createPhoneQrCode, deletePhoneQrCode, fetchPhoneQrCodes, setPhoneQrCodeShowOnStriedacka } from '@/lib/phoneQrCodes'
import { formatDateISO, localizedName } from '@/lib/utils'
import { Club, PhoneQrCode, Rink, ScheduleOverride, TimeSlotConfig, Zone } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Label } from './ui/label'
import { Input } from './ui/input'
import QrCodeDisplay from './QrCodeDisplay'

interface AdminQrPanelProps {
  club: Club
  rinks: Rink[]
  zones: Zone[]
  timeSlotConfigs: TimeSlotConfig[]
}

export default function AdminQrPanel({ club, rinks, zones, timeSlotConfigs }: AdminQrPanelProps) {
  const { t, i18n } = useTranslation()
  const { user, staff } = useAuth()
  const origin = window.location.origin

  // 4. Phone-number ("call this number") QR codes — see PhoneQrCode in
  // src/types/index.ts. Fetched once on mount; this panel is the only
  // place that creates/edits/deletes them, so there's no need for the
  // polling RinkScheduleAlternatingBoardPage.tsx's own read side uses.
  const [phoneQrCodes, setPhoneQrCodes] = useState<(PhoneQrCode & { id: string })[]>([])
  const [phoneQrLabel, setPhoneQrLabel] = useState('')
  const [phoneQrPhone, setPhoneQrPhone] = useState('')
  const [phoneQrSaving, setPhoneQrSaving] = useState(false)
  const [phoneQrBusyId, setPhoneQrBusyId] = useState<string | null>(null)

  useEffect(() => {
    fetchPhoneQrCodes(club.id).then(setPhoneQrCodes)
  }, [club.id])

  const handleCreatePhoneQr = async () => {
    if (!phoneQrLabel.trim() || !phoneQrPhone.trim() || !user || !staff) return
    setPhoneQrSaving(true)
    try {
      await createPhoneQrCode({
        clubId: club.id,
        label: phoneQrLabel.trim(),
        phone: phoneQrPhone.trim(),
        createdBy: user.uid,
        createdByName: staff.name
      })
      setPhoneQrLabel('')
      setPhoneQrPhone('')
      setPhoneQrCodes(await fetchPhoneQrCodes(club.id))
    } finally {
      setPhoneQrSaving(false)
    }
  }

  const handleTogglePhoneQrStriedacka = async (entry: PhoneQrCode & { id: string }) => {
    setPhoneQrBusyId(entry.id)
    try {
      await setPhoneQrCodeShowOnStriedacka(entry.id, !entry.showOnStriedacka)
      setPhoneQrCodes((prev) => prev.map((p) => (p.id === entry.id ? { ...p, showOnStriedacka: !p.showOnStriedacka } : p)))
    } finally {
      setPhoneQrBusyId(null)
    }
  }

  const handleDeletePhoneQr = async (id: string) => {
    if (!window.confirm(t('admin.phoneQrConfirmDelete'))) return
    setPhoneQrBusyId(id)
    try {
      await deletePhoneQrCode(id)
      setPhoneQrCodes((prev) => prev.filter((p) => p.id !== id))
    } finally {
      setPhoneQrBusyId(null)
    }
  }

  const [zoneRinkId, setZoneRinkId] = useState(() => rinks[0]?.id ?? '')
  const [qrZoneId, setQrZoneId] = useState('')
  const [qrDate, setQrDate] = useState(formatDateISO(new Date()))
  const [qrTime, setQrTime] = useState('')
  const [generatedSlotUrl, setGeneratedSlotUrl] = useState<string | null>(null)

  const zonesForRink = zones.filter((z) => z.rinkId === zoneRinkId)
  const qrZone = zones.find((z) => z.id === qrZoneId)
  const timeSlotConfig = timeSlotConfigs.find((c) => c.rinkId === qrZone?.rinkId) ?? null

  const [override, setOverride] = useState<ScheduleOverride | null>(null)
  useEffect(() => {
    if (!qrZone) {
      setOverride(null)
      return
    }
    fetchScheduleOverride(club.id, qrZone.rinkId, qrDate).then(setOverride)
  }, [club.id, qrZone, qrDate])

  const availableTimes = useMemo(() => {
    if (!timeSlotConfig || !qrZone) return []
    const rinkZones = zones.filter((z) => z.rinkId === qrZone.rinkId)
    return computeDaySchedule(new Date(`${qrDate}T00:00:00`), timeSlotConfig, rinkZones, override)
      .filter((row) => row.zones.some((z) => z.id === qrZone.id))
      .map((row) => row.time)
  }, [timeSlotConfig, zones, qrDate, qrZone, override])

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

          {rinks.length > 1 && (
            <div className="mb-3 max-w-xs">
              <Label htmlFor="zone-qr-rink" className="text-white">{t('admin.rink')}</Label>
              <select
                id="zone-qr-rink"
                value={zoneRinkId}
                onChange={(e) => setZoneRinkId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background-dark px-3 py-2 text-sm text-white"
              >
                {rinks.map((r) => (
                  <option key={r.id} value={r.id}>{localizedName(r, i18n.language)}</option>
                ))}
              </select>
            </div>
          )}

          {zonesForRink.length === 0 ? (
            <p className="text-text-muted text-sm">{t('home.noZonesConfigured')}</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {zonesForRink.map((zone) => (
                <QrCodeDisplay
                  key={zone.id}
                  value={`${origin}/book?zone=${encodeURIComponent(zone.id)}`}
                  filename={`zone-${zone.id}-qr.png`}
                  label={localizedName(zone, i18n.language)}
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
                {rinks.map((rink) => (
                  <optgroup key={rink.id} label={localizedName(rink, i18n.language)}>
                    {zones.filter((z) => z.rinkId === rink.id).map((z) => (
                      <option key={z.id} value={z.id}>{localizedName(z, i18n.language)}</option>
                    ))}
                  </optgroup>
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
              label={`${localizedName(qrZone, i18n.language)} · ${qrDate} ${qrTime}`}
            />
          )}
        </div>

        {/* 4. Phone-number ("click to call") QR codes — scanning opens the
            phone's own dialer with the number prefilled, no app/website
            involved. A club can create several (e.g. one per purpose) and
            independently mark any of them to also appear on the
            striedačka TV board's footer. */}
        <div>
          <h3 className="text-white text-sm font-semibold mb-2">{t('admin.phoneQrTitle')}</h3>
          <p className="text-text-secondary text-sm mb-3">{t('admin.phoneQrDesc')}</p>

          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div>
              <Label htmlFor="phone-qr-label" className="text-white">{t('admin.phoneQrLabelField')}</Label>
              <Input
                id="phone-qr-label"
                value={phoneQrLabel}
                onChange={(e) => setPhoneQrLabel(e.target.value)}
                placeholder={t('admin.phoneQrLabelPlaceholder')}
                className="bg-background-dark border-border text-white"
              />
            </div>

            <div>
              <Label htmlFor="phone-qr-phone" className="text-white">{t('admin.phoneQrPhoneField')}</Label>
              <Input
                id="phone-qr-phone"
                type="tel"
                value={phoneQrPhone}
                onChange={(e) => setPhoneQrPhone(e.target.value)}
                placeholder="+421905622145"
                className="bg-background-dark border-border text-white"
              />
            </div>

            <Button
              onClick={handleCreatePhoneQr}
              disabled={!phoneQrLabel.trim() || !phoneQrPhone.trim() || phoneQrSaving}
              className="bg-primary hover:bg-primary-gold text-primary-foreground"
            >
              {t('admin.phoneQrAdd')}
            </Button>
          </div>

          {phoneQrCodes.length === 0 ? (
            <p className="text-text-muted text-sm">{t('admin.phoneQrNone')}</p>
          ) : (
            <div className="flex flex-wrap gap-4">
              {phoneQrCodes.map((entry) => (
                <div key={entry.id} className="flex flex-col items-center gap-2">
                  <QrCodeDisplay
                    value={`tel:${entry.phone}`}
                    filename={`tel-${entry.id}-qr.png`}
                    label={`${entry.label} · ${entry.phone}`}
                  />
                  <label className="flex items-center gap-2 text-xs text-white">
                    <input
                      type="checkbox"
                      checked={entry.showOnStriedacka}
                      disabled={phoneQrBusyId === entry.id}
                      onChange={() => handleTogglePhoneQrStriedacka(entry)}
                    />
                    {t('admin.phoneQrShowOnStriedacka')}
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={phoneQrBusyId === entry.id}
                    onClick={() => handleDeletePhoneQr(entry.id)}
                    className="w-full"
                  >
                    {t('admin.phoneQrDelete')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
