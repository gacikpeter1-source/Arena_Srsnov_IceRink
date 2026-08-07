import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useClubData } from '@/hooks/useClubData'
import { fetchLockedSlots } from '@/lib/bookings'
import { resolveDivisionMode } from '@/lib/divisionRules'
import { addDays, formatDateISO, minutesToTime, timeToMinutes } from '@/lib/utils'
import { Zone } from '@/types'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import BookingModal from '@/components/BookingModal'

function generateDayOptions(count: number) {
  const today = new Date()
  return Array.from({ length: count }, (_, i) => addDays(today, i))
}

export default function HomePage() {
  const { t, i18n } = useTranslation()
  const { club, zones, timeSlotConfig, divisionRules, loading, error } = useClubData()
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [lockedSlots, setLockedSlots] = useState<Set<string>>(new Set())
  const [pendingBooking, setPendingBooking] = useState<{ zone: Zone; time: string } | null>(null)

  const days = useMemo(() => generateDayOptions(14), [])
  const dateISO = formatDateISO(selectedDate)

  useEffect(() => {
    if (!club) return
    fetchLockedSlots(club.id, dateISO).then(setLockedSlots)
  }, [club, dateISO])

  const refreshLockedSlots = () => {
    if (club) fetchLockedSlots(club.id, dateISO).then(setLockedSlots)
  }

  // For each open time slot on the selected day, resolve which division
  // mode is offered (per admin schedule, default 'full') and pair it with
  // the zones for that mode.
  const schedule = useMemo(() => {
    if (!timeSlotConfig) return []
    const dayOfWeek = selectedDate.getDay()
    const dayHours = timeSlotConfig.hours.find((h) => h.dayOfWeek === dayOfWeek)
    if (!dayHours) return []

    const openMin = timeToMinutes(dayHours.openTime)
    const closeMin = timeToMinutes(dayHours.closeTime)
    const rows: { time: string; zones: Zone[] }[] = []

    for (let m = openMin; m + timeSlotConfig.slotDurationMinutes <= closeMin; m += timeSlotConfig.slotDurationMinutes) {
      const time = minutesToTime(m)
      const mode = resolveDivisionMode(divisionRules, dayOfWeek, time)
      const slotZones = zones.filter((z) => z.mode === mode)
      rows.push({ time, zones: slotZones })
    }
    return rows
  }, [timeSlotConfig, divisionRules, zones, selectedDate])

  if (loading) {
    return <div className="content-container py-12 text-center text-text-muted">{t('common.loading')}</div>
  }

  if (error || !club) {
    return (
      <div className="content-container py-12 text-center text-status-danger">
        {error ?? t('home.clubNotFound')}
      </div>
    )
  }

  return (
    <div className="content-container py-6 space-y-6">
      <div>
        <h1>{club.name}</h1>
        <p className="text-text-secondary">{t('home.subtitle')}</p>
      </div>

      {/* Day picker */}
      <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
        {days.map((day) => {
          const isSelected = formatDateISO(day) === dateISO
          return (
            <button
              key={day.toISOString()}
              onClick={() => setSelectedDate(day)}
              className={`flex-shrink-0 px-4 py-2 rounded-md text-center transition-colors ${
                isSelected ? 'bg-primary text-primary-foreground' : 'bg-background-card text-text-secondary hover:bg-background-cardHover'
              }`}
            >
              <div className="text-xs">{day.toLocaleDateString(i18n.language, { weekday: 'short' })}</div>
              <div className="font-semibold">{day.getDate()}</div>
            </button>
          )
        })}
      </div>

      {/* Time slots, each showing the zone(s) offered for that window */}
      {schedule.length === 0 ? (
        <Card className="arena-card p-8 text-center text-text-secondary">{t('home.closedToday')}</Card>
      ) : (
        <div className="space-y-2">
          {schedule.map(({ time, zones: slotZones }) => (
            <div key={time} className="flex items-center gap-3 flex-wrap">
              <div className="w-14 mono text-sm text-text-muted flex-shrink-0">{time}</div>
              <div className="flex gap-2 flex-wrap">
                {slotZones.length === 0 ? (
                  <span className="text-text-muted text-sm">{t('home.noZonesConfigured')}</span>
                ) : (
                  slotZones.map((zone) => {
                    const isTaken = lockedSlots.has(`${zone.id}__${time}`)
                    return (
                      <Button
                        key={zone.id}
                        variant={isTaken ? 'secondary' : 'outline'}
                        disabled={isTaken}
                        onClick={() => setPendingBooking({ zone, time })}
                      >
                        {zone.name}
                      </Button>
                    )
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {pendingBooking && timeSlotConfig && (
        <BookingModal
          club={club}
          zone={pendingBooking.zone}
          date={dateISO}
          startTime={pendingBooking.time}
          durationMinutes={timeSlotConfig.slotDurationMinutes}
          isOpen
          onClose={() => setPendingBooking(null)}
          onBooked={refreshLockedSlots}
        />
      )}
    </div>
  )
}
