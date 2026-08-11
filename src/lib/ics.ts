import { minutesToTime, timeToMinutes } from './utils'

export interface IcsEventInput {
  uid: string
  title: string
  description?: string
  location?: string
  date: string // "2026-08-13"
  startTime: string // "18:00"
  durationMinutes: number
  timezone: string // IANA zone, e.g. "Europe/Bratislava"
}

function escapeIcsText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

/**
 * Converts a club-local wall-clock date+time to the true UTC instant,
 * correctly handling DST for the given IANA zone — using only the
 * built-in Intl API, no timezone library needed. Event times are written
 * to the .ics file (and the Google Calendar link) as unambiguous UTC
 * ("Z" suffix) rather than a bare TZID reference: a TZID needs an
 * accompanying VTIMEZONE block per RFC 5545, and while Google/Outlook
 * tolerate a well-known zone name without one, iOS Mail's quick-add
 * screen previews it fine but silently refuses to actually save the
 * event — UTC avoids the whole problem.
 */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  // First guess: treat the wall-clock numbers as if they were already UTC.
  const guess = Date.UTC(year, month - 1, day, hour, minute)

  // Ask what that instant actually looks like in the target zone, then use
  // the difference to back out the zone's real UTC offset (DST-aware)
  // at that point in time.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
    .formatToParts(new Date(guess))
    .reduce<Record<string, string>>((acc, p) => {
      acc[p.type] = p.value
      return acc
    }, {})

  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    parts.hour === '24' ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  )
  const offsetMillis = asIfUtc - guess
  return new Date(guess - offsetMillis)
}

function formatIcsUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

function nowAsIcsUtc(): string {
  return formatIcsUtc(new Date())
}

/**
 * Builds a VCALENDAR containing one VEVENT per input — a single booking
 * passes one event; a recurring series passes one event per occurrence,
 * all in the same file, so importing it adds every session at once.
 */
export function buildIcsContent(events: IcsEventInput[]): string {
  const dtStamp = nowAsIcsUtc()
  const veventBlocks = events.map((event) => {
    const endTime = minutesToTime(timeToMinutes(event.startTime) + event.durationMinutes)
    const startUtc = formatIcsUtc(zonedTimeToUtc(event.date, event.startTime, event.timezone))
    const endUtc = formatIcsUtc(zonedTimeToUtc(event.date, endTime, event.timezone))
    return [
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `DTSTAMP:${dtStamp}`,
      `DTSTART:${startUtc}`,
      `DTEND:${endUtc}`,
      `SUMMARY:${escapeIcsText(event.title)}`,
      event.description ? `DESCRIPTION:${escapeIcsText(event.description)}` : null,
      event.location ? `LOCATION:${escapeIcsText(event.location)}` : null,
      'END:VEVENT'
    ]
      .filter((line): line is string => line !== null)
      .join('\r\n')
  })

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//IceRinkBooking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...veventBlocks,
    'END:VCALENDAR'
  ].join('\r\n')
}

/** Triggers a browser download of .ics content — client-side only. */
export function downloadIcsFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * A one-tap "Add to Google Calendar" link — only supports a single event,
 * so this is used for one-off bookings; a recurring series only offers
 * the multi-event .ics download instead (still importable into Google
 * Calendar via Settings > Import, just not one-tap).
 */
export function buildGoogleCalendarUrl(event: IcsEventInput): string {
  const endTime = minutesToTime(timeToMinutes(event.startTime) + event.durationMinutes)
  const startUtc = formatIcsUtc(zonedTimeToUtc(event.date, event.startTime, event.timezone))
  const endUtc = formatIcsUtc(zonedTimeToUtc(event.date, endTime, event.timezone))
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${startUtc}/${endUtc}`,
    details: event.description ?? '',
    location: event.location ?? ''
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
