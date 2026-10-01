import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Displays a Rink/Zone's name in whichever language the app is currently
 * in — `name` is always the default/English value, `translations.sk` an
 * optional Slovak override on top of it (see Rink/Zone in types/index.ts).
 * Falls back to `name` for a Slovak session when no override was ever set,
 * or for any language other than 'sk'.
 */
export function localizedName(entity: { name: string; translations?: { sk?: string } }, lang: string): string {
  return lang === 'sk' && entity.translations?.sk ? entity.translations.sk : entity.name
}

export function getWeekStart(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Monday as start
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d
}

export function getMonthStart(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), 1)
  d.setHours(0, 0, 0, 0)
  return d
}

export function getMonthEnd(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  d.setHours(0, 0, 0, 0)
  return d
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

// Deliberately NOT `date.toISOString().split('T')[0]` — toISOString() always
// converts to UTC first, so for a club west of UTC (or, as here, in a
// UTC+1/+2 zone where local midnight is still the previous UTC day for the
// first 1-2 hours of every day) this would compute "today" as yesterday
// right when the club day actually turns over. Real bug: the rink-schedule
// TV board kept showing the previous day's schedule for up to two hours
// past local midnight, because every "today" default across the app
// (this function is called from dozens of components) was silently off by
// a day during that window. Uses the local calendar date of whatever
// device is running this — correct for every real caller here (a
// customer's phone, staff's browser, or the TV's own browser), all in the
// club's own local timezone.
export function formatDateISO(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatDate(date: Date, locale = 'en-US'): string {
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function generateToken(length = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint32Array(length)
  crypto.getRandomValues(bytes)
  let token = ''
  for (let i = 0; i < length; i++) {
    token += chars[bytes[i] % chars.length]
  }
  return token
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0')
  const m = (minutes % 60).toString().padStart(2, '0')
  return `${h}:${m}`
}

export function generateConfirmationCode(): string {
  const bytes = new Uint32Array(2)
  crypto.getRandomValues(bytes)
  const part1 = (bytes[0] % 1000).toString().padStart(3, '0')
  const part2 = (bytes[1] % 1000).toString().padStart(3, '0')
  return `${part1}-${part2}`
}
