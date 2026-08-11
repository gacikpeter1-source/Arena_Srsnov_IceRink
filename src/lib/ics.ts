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

// "2026-08-13" + "18:00" -> "20260813T180000" — a plain local wall-clock
// time (no UTC conversion), paired with a TZID parameter so calendar apps
// know which zone it's in. Simpler than embedding a full VTIMEZONE block,
// and every mainstream calendar app (Google/Apple/Outlook) resolves a
// bare IANA TZID like "Europe/Bratislava" correctly without one.
function formatIcsLocalDateTime(date: string, time: string): string {
  return `${date.replace(/-/g, '')}T${time.replace(':', '')}00`
}

function nowAsIcsUtc(): string {
  return new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
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
    return [
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `DTSTAMP:${dtStamp}`,
      `DTSTART;TZID=${event.timezone}:${formatIcsLocalDateTime(event.date, event.startTime)}`,
      `DTEND;TZID=${event.timezone}:${formatIcsLocalDateTime(event.date, endTime)}`,
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
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${formatIcsLocalDateTime(event.date, event.startTime)}/${formatIcsLocalDateTime(event.date, endTime)}`,
    details: event.description ?? '',
    location: event.location ?? ''
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
