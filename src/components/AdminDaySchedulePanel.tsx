import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchBookingsInRange } from '@/lib/bookings'
import { computeDaySchedule } from '@/lib/schedule'
import {
  appendDefaultSlot,
  cascadeSlotEdit,
  deleteScheduleOverride,
  fetchScheduleOverride,
  saveScheduleOverride,
  ScheduleSlot
} from '@/lib/scheduleOverrides'
import { downloadScheduleImportTemplate, parseScheduleWorkbook } from '@/lib/excel'
import { addDays, formatDateISO } from '@/lib/utils'
import { Club, Rink, TimeSlotConfig } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'

interface AdminDaySchedulePanelProps {
  club: Club
  rinks: Rink[]
  timeSlotConfigs: TimeSlotConfig[]
}

/**
 * Owner/assistant editor for a one-off, hand-adjusted schedule on a
 * specific rink+date (or a range of dates, applied one date at a time) —
 * see src/lib/scheduleOverrides.ts. Editing a session's start time or
 * duration cascades every session after it back to the rink's default
 * rhythm (slotDurationMinutes + breakMinutes), matching the club's stated
 * policy that one session running long reschedules the rest of that day
 * rather than trying to preserve whatever other custom durations those
 * later sessions happened to have.
 */
export default function AdminDaySchedulePanel({ club, rinks, timeSlotConfigs }: AdminDaySchedulePanelProps) {
  const { t } = useTranslation()
  const [rinkId, setRinkId] = useState(() => rinks[0]?.id ?? '')
  const [date, setDate] = useState(formatDateISO(new Date()))
  const [applyToRange, setApplyToRange] = useState(false)
  const [rangeEndDate, setRangeEndDate] = useState(formatDateISO(new Date()))

  const config = timeSlotConfigs.find((c) => c.rinkId === rinkId) ?? null

  const [slots, setSlots] = useState<ScheduleSlot[]>([])
  const [isCustom, setIsCustom] = useState(false)
  const [conflicts, setConflicts] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ updated: number; failed: string[] } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadDay = async () => {
    if (!rinkId || !date) return
    setLoading(true)
    setSaved(false)
    const override = await fetchScheduleOverride(club.id, rinkId, date)
    if (override) {
      setSlots(override.slots)
      setIsCustom(true)
    } else if (config) {
      const defaultRows = computeDaySchedule(new Date(`${date}T00:00:00`), config, [], [])
      setSlots(defaultRows.map((r) => ({ startTime: r.time, durationMinutes: r.durationMinutes })))
      setIsCustom(false)
    } else {
      setSlots([])
      setIsCustom(false)
    }

    const bookings = await fetchBookingsInRange(club.id, date, date)
    // 'pending'/'expired' bookings aren't worth flagging: pending resolves
    // itself within 5 minutes either way, and expired no longer holds the
    // slot at all — only a real confirmed booking is an actual conflict.
    const bookedTimes = new Set(bookings.filter((b) => b.rinkId === rinkId && b.status === 'confirmed').map((b) => b.startTime))
    setConflicts([...bookedTimes])
    setLoading(false)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadDay() }, [club.id, rinkId, date, config])

  const editSlot = (index: number, edited: ScheduleSlot) => {
    if (!config) return
    setSlots((prev) => cascadeSlotEdit(prev, index, edited, config.slotDurationMinutes, config.breakMinutes ?? 0))
  }

  const removeSlot = (index: number) => {
    setSlots((prev) => prev.filter((_, i) => i !== index))
  }

  const addSlot = () => {
    if (!config) return
    setSlots((prev) => appendDefaultSlot(prev, config.slotDurationMinutes, config.breakMinutes ?? 0))
  }

  const datesInRange = (): string[] => {
    if (!applyToRange) return [date]
    const dates: string[] = []
    let d = new Date(`${date}T00:00:00`)
    const end = new Date(`${rangeEndDate}T00:00:00`)
    while (d <= end) {
      dates.push(formatDateISO(d))
      d = addDays(d, 1)
    }
    return dates
  }

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      for (const d of datesInRange()) {
        await saveScheduleOverride(club.id, rinkId, d, slots)
      }
      setIsCustom(true)
      setSaved(true)
    } catch (err) {
      console.error('Error saving schedule override:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleResetToDefault = async () => {
    setSaving(true)
    setSaved(false)
    try {
      for (const d of datesInRange()) {
        await deleteScheduleOverride(club.id, rinkId, d)
      }
      await loadDay()
    } catch (err) {
      console.error('Error resetting schedule:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setImportResult(null)
    try {
      const buffer = await file.arrayBuffer()
      const { rows, errors } = parseScheduleWorkbook(buffer)
      const rinkByName = new Map(rinks.map((r) => [r.name.trim().toLowerCase(), r]))
      const failed: string[] = errors.map((err) => `Row ${err.rowNumber}: ${err.message}`)

      const grouped = new Map<string, ScheduleSlot[]>() // key: `${rinkId}::${date}`
      for (const row of rows) {
        const rink = rinkByName.get(row.rinkName.trim().toLowerCase())
        if (!rink) {
          failed.push(`${row.date} ${row.startTime}: unknown rink "${row.rinkName}"`)
          continue
        }
        const key = `${rink.id}::${row.date}`
        if (!grouped.has(key)) grouped.set(key, [])
        grouped.get(key)!.push({ startTime: row.startTime, durationMinutes: row.durationMinutes })
      }

      let updated = 0
      for (const [key, groupSlots] of grouped) {
        const [groupRinkId, groupDate] = key.split('::')
        groupSlots.sort((a, b) => a.startTime.localeCompare(b.startTime))
        await saveScheduleOverride(club.id, groupRinkId, groupDate, groupSlots)
        updated++
      }

      setImportResult({ updated, failed })
      if (grouped.has(`${rinkId}::${date}`)) await loadDay()
    } catch (err) {
      console.error('Error importing schedule:', err)
      setImportResult({ updated: 0, failed: ['Could not read the file.'] })
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <Card className="arena-card">
      <CardHeader>
        <CardTitle className="text-white">{t('admin.dayScheduleTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          {rinks.length > 1 && (
            <div>
              <Label htmlFor="day-schedule-rink" className="text-white">{t('admin.rink')}</Label>
              <select
                id="day-schedule-rink"
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
          <div>
            <Label htmlFor="day-schedule-date" className="text-white">{t('admin.date')}</Label>
            <Input id="day-schedule-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-background-dark border-border text-white" />
          </div>
          <label className="flex items-center gap-2 text-white text-sm cursor-pointer pb-2">
            <input type="checkbox" checked={applyToRange} onChange={(e) => setApplyToRange(e.target.checked)} className="h-4 w-4" />
            {t('admin.applyToRange')}
          </label>
          {applyToRange && (
            <div>
              <Label htmlFor="day-schedule-range-end" className="text-white">{t('admin.rangeEndDate')}</Label>
              <Input
                id="day-schedule-range-end"
                type="date"
                min={date}
                value={rangeEndDate}
                onChange={(e) => setRangeEndDate(e.target.value)}
                className="bg-background-dark border-border text-white"
              />
            </div>
          )}
        </div>

        {!config ? (
          <p className="text-text-muted text-sm">{t('admin.noScheduleConfig')}</p>
        ) : loading ? (
          <p className="text-text-muted text-sm">{t('common.loading')}</p>
        ) : (
          <>
            <p className="text-text-muted text-xs">{isCustom ? t('admin.customScheduleActive') : t('admin.defaultScheduleActive')}</p>

            {conflicts.length > 0 && (
              <p className="text-status-warning text-xs">
                {t('admin.scheduleConflictWarning', { times: conflicts.sort().join(', ') })}
              </p>
            )}

            <div className="space-y-2">
              {slots.map((slot, i) => (
                <div key={i} className="flex items-center gap-2 flex-wrap">
                  <Input
                    type="time"
                    value={slot.startTime}
                    onChange={(e) => editSlot(i, { startTime: e.target.value, durationMinutes: slot.durationMinutes })}
                    className="bg-background-dark border-border text-white max-w-[130px]"
                  />
                  <span className="text-text-muted text-sm">{t('admin.hoursTo')}</span>
                  <span className="mono text-primary text-sm w-14">
                    {(() => {
                      const [h, m] = slot.startTime.split(':').map(Number)
                      const total = h * 60 + m + slot.durationMinutes
                      return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
                    })()}
                  </span>
                  <Label htmlFor={`duration-${i}`} className="text-text-muted text-xs">{t('admin.slotDuration')}</Label>
                  <Input
                    id={`duration-${i}`}
                    type="number"
                    min={5}
                    value={slot.durationMinutes}
                    onChange={(e) => editSlot(i, { startTime: slot.startTime, durationMinutes: Number(e.target.value) })}
                    className="bg-background-dark border-border text-white max-w-[100px]"
                  />
                  <Button type="button" size="sm" variant="destructive" onClick={() => removeSlot(i)}>
                    {t('common.remove')}
                  </Button>
                </div>
              ))}
            </div>

            <Button type="button" variant="outline" size="sm" onClick={addSlot}>
              {t('admin.addSession')}
            </Button>

            {saved && <p className="text-status-success text-sm">{t('common.saved')}</p>}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button onClick={handleSave} disabled={saving} className="bg-primary hover:bg-primary-gold text-primary-foreground">
                {saving ? t('common.saving') : t('common.save')}
              </Button>
              {isCustom && (
                <Button type="button" variant="outline" onClick={handleResetToDefault} disabled={saving}>
                  {t('admin.resetToDefault')}
                </Button>
              )}
            </div>
          </>
        )}

        <div className="border-t border-border pt-4">
          <h3 className="text-white text-sm font-semibold mb-2">{t('admin.importScheduleTitle')}</h3>
          <p className="text-text-muted text-xs mb-3">{t('admin.importScheduleHint')}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => downloadScheduleImportTemplate()}>
              {t('admin.downloadTemplate')}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={importing}>
              {importing ? t('admin.importing') : t('admin.importScheduleButton')}
            </Button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} />
          </div>
          {importResult && (
            <div className="mt-3 text-sm space-y-1">
              <p className="text-status-success">{t('admin.scheduleImportSummary', { count: importResult.updated })}</p>
              {importResult.failed.length > 0 && (
                <ul className="text-status-danger text-xs list-disc list-inside">
                  {importResult.failed.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
