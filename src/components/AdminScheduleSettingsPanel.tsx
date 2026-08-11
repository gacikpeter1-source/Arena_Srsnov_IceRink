import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { updateTimeSlotConfig } from '@/lib/timeSlotConfig'
import { DayHours, Rink, TimeSlotConfig } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'

interface AdminScheduleSettingsPanelProps {
  rinks: Rink[]
  timeSlotConfigs: TimeSlotConfig[]
}

const DEFAULT_BREAK_MINUTES = 10

// A fixed Sun-Sat reference week (any 7 consecutive days starting on a
// Sunday) purely so Intl can give us localized weekday names for dayOfWeek
// 0-6 — the actual date is never used for anything else.
const WEEKDAY_REFERENCE = new Date(2023, 0, 1) // a Sunday

/**
 * Owner/assistant editor for a rink's recurring default schedule: session
 * length, the cleaning/prep break between sessions (customers never see
 * the break itself, only each session's own start-end — see
 * computeDaySchedule), and which days/hours the rink is open. This was
 * previously only ever set once by scripts/seed.mjs with no way to change
 * it short of editing Firestore directly.
 */
export default function AdminScheduleSettingsPanel({ rinks, timeSlotConfigs }: AdminScheduleSettingsPanelProps) {
  const { t, i18n } = useTranslation()
  const [rinkId, setRinkId] = useState(() => rinks[0]?.id ?? '')
  const config = timeSlotConfigs.find((c) => c.rinkId === rinkId) ?? null

  const [slotDurationMinutes, setSlotDurationMinutes] = useState(60)
  const [breakMinutes, setBreakMinutes] = useState(DEFAULT_BREAK_MINUTES)
  const [hours, setHours] = useState<DayHours[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!config) return
    setSlotDurationMinutes(config.slotDurationMinutes)
    // Suggests the club's stated default (10) for a config that's never had
    // a break set, rather than silently treating "unset" as 0 in the UI —
    // computeDaySchedule itself still falls back to 0 until this is saved.
    setBreakMinutes(config.breakMinutes ?? DEFAULT_BREAK_MINUTES)
    setHours(config.hours)
    setSaved(false)
  }, [config])

  const dayName = (dayOfWeek: number) => {
    const d = new Date(WEEKDAY_REFERENCE)
    d.setDate(d.getDate() + dayOfWeek)
    return d.toLocaleDateString(i18n.language, { weekday: 'long' })
  }

  const dayHoursFor = (dayOfWeek: number) => hours.find((h) => h.dayOfWeek === dayOfWeek) ?? null

  const toggleDay = (dayOfWeek: number, open: boolean) => {
    if (open) {
      setHours((prev) => [...prev, { dayOfWeek, openTime: '08:00', closeTime: '22:00' }].sort((a, b) => a.dayOfWeek - b.dayOfWeek))
    } else {
      setHours((prev) => prev.filter((h) => h.dayOfWeek !== dayOfWeek))
    }
  }

  const updateDayHours = (dayOfWeek: number, field: 'openTime' | 'closeTime', value: string) => {
    setHours((prev) => prev.map((h) => (h.dayOfWeek === dayOfWeek ? { ...h, [field]: value } : h)))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!config) return
    setSaving(true)
    setSaved(false)
    try {
      await updateTimeSlotConfig(config.id, { slotDurationMinutes, breakMinutes, hours })
      setSaved(true)
    } catch (err) {
      console.error('Error updating schedule settings:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="arena-card">
      <CardHeader>
        <CardTitle className="text-white">{t('admin.scheduleSettingsTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        {rinks.length > 1 && (
          <div className="mb-4 max-w-xs">
            <Label htmlFor="schedule-rink" className="text-white">{t('admin.rink')}</Label>
            <select
              id="schedule-rink"
              value={rinkId}
              onChange={(e) => setRinkId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background-dark px-3 py-2 text-sm text-white"
            >
              {rinks.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
        )}

        {!config ? (
          <p className="text-text-muted text-sm">{t('admin.noScheduleConfig')}</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex flex-wrap gap-4">
              <div>
                <Label htmlFor="slot-duration" className="text-white">{t('admin.slotDuration')}</Label>
                <Input
                  id="slot-duration"
                  type="number"
                  min={5}
                  value={slotDurationMinutes}
                  onChange={(e) => setSlotDurationMinutes(Number(e.target.value))}
                  className="bg-background-dark border-border text-white max-w-[140px]"
                />
              </div>
              <div>
                <Label htmlFor="break-duration" className="text-white">{t('admin.breakDuration')}</Label>
                <Input
                  id="break-duration"
                  type="number"
                  min={0}
                  value={breakMinutes}
                  onChange={(e) => setBreakMinutes(Number(e.target.value))}
                  className="bg-background-dark border-border text-white max-w-[140px]"
                />
              </div>
            </div>
            <p className="text-text-muted text-xs">{t('admin.scheduleSettingsHint')}</p>

            <div>
              <h3 className="text-white text-sm font-semibold mb-2">{t('admin.openingHours')}</h3>
              <div className="space-y-2">
                {Array.from({ length: 7 }, (_, dayOfWeek) => {
                  const dh = dayHoursFor(dayOfWeek)
                  return (
                    <div key={dayOfWeek} className="flex items-center gap-3 flex-wrap">
                      <label className="flex items-center gap-2 text-white text-sm w-32 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={dh !== null}
                          onChange={(e) => toggleDay(dayOfWeek, e.target.checked)}
                          className="h-4 w-4"
                        />
                        {dayName(dayOfWeek)}
                      </label>
                      {dh && (
                        <>
                          <Input
                            type="time"
                            value={dh.openTime}
                            onChange={(e) => updateDayHours(dayOfWeek, 'openTime', e.target.value)}
                            className="bg-background-dark border-border text-white max-w-[130px]"
                          />
                          <span className="text-text-muted text-sm">{t('admin.hoursTo')}</span>
                          <Input
                            type="time"
                            value={dh.closeTime}
                            onChange={(e) => updateDayHours(dayOfWeek, 'closeTime', e.target.value)}
                            className="bg-background-dark border-border text-white max-w-[130px]"
                          />
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {saved && <p className="text-status-success text-sm">{t('common.saved')}</p>}

            <Button type="submit" disabled={saving} className="bg-primary hover:bg-primary-gold text-primary-foreground">
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
