import { useEffect, useMemo, useState } from 'react'
import { useClubData } from '@/hooks/useClubData'
import { fetchLockedSlots } from '@/lib/bookings'
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
  const { club, zones, timeSlotConfig, loading, error } = useClubData()
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [selectedZone, setSelectedZone] = useState<Zone | null>(null)
  const [lockedSlots, setLockedSlots] = useState<Set<string>>(new Set())
  const [pendingBooking, setPendingBooking] = useState<{ zone: Zone; time: string } | null>(null)

  const days = useMemo(() => generateDayOptions(14), [])
  const dateISO = formatDateISO(selectedDate)

  useEffect(() => {
    if (zones.length > 0 && !selectedZone) {
      setSelectedZone(zones[0])
    }
  }, [zones, selectedZone])

  useEffect(() => {
    if (!club) return
    fetchLockedSlots(club.id, dateISO).then(setLockedSlots)
  }, [club, dateISO])

  const timeSlots = useMemo(() => {
    if (!timeSlotConfig) return []
    const dayHours = timeSlotConfig.hours.find((h) => h.dayOfWeek === selectedDate.getDay())
    if (!dayHours) return []

    const slots: string[] = []
    const openMin = timeToMinutes(dayHours.openTime)
    const closeMin = timeToMinutes(dayHours.closeTime)
    for (let m = openMin; m + timeSlotConfig.slotDurationMinutes <= closeMin; m += timeSlotConfig.slotDurationMinutes) {
      slots.push(minutesToTime(m))
    }
    return slots
  }, [timeSlotConfig, selectedDate])

  const refreshLockedSlots = () => {
    if (club) fetchLockedSlots(club.id, dateISO).then(setLockedSlots)
  }

  if (loading) {
    return <div className="content-container py-12 text-center text-text-muted">Loading...</div>
  }

  if (error || !club) {
    return (
      <div className="content-container py-12 text-center text-status-danger">
        {error ?? 'Club not found.'}
      </div>
    )
  }

  return (
    <div className="content-container py-6 space-y-6">
      <div>
        <h1>{club.name}</h1>
        <p className="text-text-secondary">Pick a date, zone, and time to book.</p>
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
              <div className="text-xs">{day.toLocaleDateString('en-US', { weekday: 'short' })}</div>
              <div className="font-semibold">{day.getDate()}</div>
            </button>
          )
        })}
      </div>

      {/* Zone tabs */}
      <div className="flex gap-2 flex-wrap">
        {zones.map((zone) => (
          <button
            key={zone.id}
            onClick={() => setSelectedZone(zone)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              selectedZone?.id === zone.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-background-card text-text-secondary hover:bg-background-cardHover'
            }`}
          >
            {zone.name}
          </button>
        ))}
      </div>

      {/* Time slots */}
      {!selectedZone ? (
        <Card className="arena-card p-8 text-center text-text-secondary">No zones configured yet.</Card>
      ) : timeSlots.length === 0 ? (
        <Card className="arena-card p-8 text-center text-text-secondary">Closed on this day.</Card>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
          {timeSlots.map((time) => {
            const isTaken = lockedSlots.has(`${selectedZone.id}__${time}`)
            return (
              <Button
                key={time}
                variant={isTaken ? 'secondary' : 'outline'}
                disabled={isTaken}
                onClick={() => setPendingBooking({ zone: selectedZone, time })}
                className="mono"
              >
                {time}
              </Button>
            )
          })}
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
