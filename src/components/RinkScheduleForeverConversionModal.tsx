import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { convertForeverToBounded } from '@/lib/rinkSchedule'
import { SeriesRecurrence, SERIES_MAX_OCCURRENCES } from '@/lib/bookings'
import { formatDateISO, addDays } from '@/lib/utils'
import { RinkScheduleEntry, SeriesFrequency } from '@/types'

interface RinkScheduleForeverConversionModalProps {
  timezone: string
  entry: RinkScheduleEntry & { id: string }
  onClose: () => void
  onSaved: () => void
}

/**
 * Lets staff turn an existing `repeatForever` ("donekonečna") entry into a
 * normal bounded recurring series — the UI counterpart of
 * convertForeverToBounded (lib/rinkSchedule.ts). The frequency itself
 * (daily/weekly) isn't offered as a choice here — it's already fixed by
 * however the series was originally set up (entry.frequency) and this
 * feature only changes WHEN it stops, not its interval.
 */
export default function RinkScheduleForeverConversionModal({ timezone, entry, onClose, onSaved }: RinkScheduleForeverConversionModalProps) {
  const { t } = useTranslation()
  const frequency: SeriesFrequency = entry.frequency ?? 'weekly'
  const [recurrenceType, setRecurrenceType] = useState<'count' | 'until'>('count')
  const [count, setCount] = useState(Math.min(8, SERIES_MAX_OCCURRENCES[frequency]))
  const [untilDate, setUntilDate] = useState(() => formatDateISO(addDays(new Date(), 56)))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ addedCount: number; cancelledCount: number } | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!confirm(t('rinkSchedule.convertToFixedCountConfirm'))) return
    setSaving(true)
    setError(null)
    const recurrence: SeriesRecurrence =
      recurrenceType === 'count' ? { type: 'count', frequency, count } : { type: 'until', frequency, endDate: untilDate }
    try {
      const outcome = await convertForeverToBounded(entry, timezone, recurrence)
      setResult(outcome)
      onSaved()
    } catch {
      setError(t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-background-card max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white text-xl">{t('rinkSchedule.convertToFixedCountTitle')}</DialogTitle>
        </DialogHeader>
        {result ? (
          <div className="space-y-4">
            <p className="text-white text-sm">{t('rinkSchedule.convertToFixedCountSuccess', { added: result.addedCount, cancelled: result.cancelledCount })}</p>
            <DialogFooter>
              <Button type="button" onClick={onClose} className="bg-primary hover:bg-primary-gold text-primary-foreground">
                {t('common.close')}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <p className="text-text-secondary text-sm">{t('rinkSchedule.convertToFixedCountHint')}</p>
            {error && <p className="text-status-danger text-sm">{error}</p>}
            <div className="flex flex-wrap gap-4 text-sm text-white">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="forever-recurrenceType" checked={recurrenceType === 'count'} onChange={() => setRecurrenceType('count')} />
                {t('booking.recurrenceForCount')}
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="forever-recurrenceType" checked={recurrenceType === 'until'} onChange={() => setRecurrenceType('until')} />
                {t('booking.recurrenceUntilDate')}
              </label>
            </div>
            {recurrenceType === 'count' ? (
              <div>
                <Label className="text-white">{t('booking.numberOfOccurrences')}</Label>
                <Input
                  type="number"
                  min={1}
                  max={SERIES_MAX_OCCURRENCES[frequency]}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                  className="bg-background-dark border-border text-white max-w-[120px]"
                />
              </div>
            ) : (
              <div>
                <Label className="text-white">{t('booking.repeatUntil')}</Label>
                <Input
                  type="date"
                  value={untilDate}
                  onChange={(e) => setUntilDate(e.target.value)}
                  className="bg-background-dark border-border text-white"
                />
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={saving} className="bg-primary hover:bg-primary-gold text-primary-foreground">
                {saving ? t('common.saving') : t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
