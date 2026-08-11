export interface Club {
  id: string
  name: string
  logoUrl?: string
  colors?: {
    primary?: string
    background?: string
  }
  contact: {
    email: string
    phone?: string
    address?: string
    website?: string
  }
  timezone: string
  paymentsEnabled: boolean
  // Links to sibling club services shown as cards on the hub home screen.
  // Unset until those apps are actually live — the card then shows as
  // "coming soon" instead of a dead link.
  integrations?: {
    trainingReservationsUrl?: string
    tournamentsUrl?: string
  }
  createdAt: Date
}

// A club can run more than one physical ice surface (e.g. "Main Hall" +
// "Small Hall"). Each rink has its own zones/hours/division rules — a zone,
// TimeSlotConfig, or DivisionRule always belongs to exactly one rink.
export interface Rink {
  id: string
  clubId: string
  name: string // "Main Hall" | "Small Hall"
  sortOrder: number
  active: boolean
}

export type DivisionMode = 'full' | 'half' | 'third'

export interface Zone {
  id: string
  clubId: string
  rinkId: string
  name: string // "Full Rink" | "Half A" | "Third 1" ...
  mode: DivisionMode
  // Position within its mode (0 for full; 0/1 for half; 0/1/2 for third).
  // Same-mode zones are physically disjoint slices of the rink, so they
  // never conflict with each other — only one mode is ever offered for a
  // given date/time (see DivisionRule), so there's nothing to block across
  // modes either.
  slotIndex: number
  active: boolean
}

export interface DayHours {
  dayOfWeek: number // 0=Sun .. 6=Sat
  openTime: string // "08:00"
  closeTime: string // "22:00"
}

export interface TimeSlotConfig {
  id: string
  clubId: string
  rinkId: string
  slotDurationMinutes: number
  // Cleaning/prep time between the end of one session and the start of the
  // next, e.g. 10 for "9:00-10:00, then 10:10-11:10". Not shown to
  // customers — the schedule only ever displays each session's own
  // start-end, the gap is just implicit. Missing/undefined (a config
  // written before this field existed) falls back to 0 (back-to-back)
  // rather than silently changing an already-live schedule.
  breakMinutes?: number
  hours: DayHours[]
}

// A one-off, per-date replacement for a rink's normally auto-generated
// schedule — lets an owner/assistant hand-adjust a specific day (or a
// range of days, applied one date at a time) without touching the
// recurring TimeSlotConfig default. `slots` is the full explicit list for
// that date, in order; when present for a rinkId+date, computeDaySchedule
// uses it as-is instead of generating from slotDurationMinutes/breakMinutes.
// One doc per rinkId+date (see scheduleOverrideId in lib/scheduleOverrides.ts).
export interface ScheduleOverride {
  id: string
  clubId: string
  rinkId: string
  date: string // "2026-08-15"
  slots: { startTime: string; durationMinutes: number }[]
  updatedAt: Date
}

// Admin-configured recurring window where the rink is offered as halves or
// thirds instead of the default whole-rink (1/1) booking. A date/time with
// no matching rule falls back to 'full'.
export interface DivisionRule {
  id: string
  clubId: string
  rinkId: string
  dayOfWeek: number // 0=Sun .. 6=Sat
  startTime: string // "18:00", inclusive
  endTime: string // "20:00", exclusive
  mode: Exclude<DivisionMode, 'full'>
}

export interface Payment {
  required: boolean
  amount: number
  currency: string
  status: 'unpaid' | 'paid'
  paidAt?: Date
}

export interface Booking {
  id: string
  clubId: string
  rinkId: string
  zoneId: string
  date: string // "2026-08-07"
  startTime: string // "18:00"
  durationMinutes: number

  name: string
  email: string
  phone: string

  confirmationCode: string // server-generated, unique per club
  cancellationToken: string
  tokenExpiresAt: Date
  // The booking's actual start instant in UTC (date+startTime converted via
  // the club's timezone at creation time) — lets firestore.rules enforce
  // the customer self-cancel cutoff (see CANCELLATION_CUTOFF_HOURS in
  // lib/bookings.ts) without needing timezone math of its own. Optional
  // because bookings created before this field existed won't have it.
  startAtUtc?: Date

  // 'pending': awaiting the emailed confirm-click (see
  // PENDING_CONFIRMATION_MINUTES in lib/bookings.ts) — only single
  // customer-flow bookings ever start here, everything else (staff, Excel
  // import, recurring series) goes straight to 'confirmed'.
  // 'expired': was 'pending' and the confirmation window lapsed unconfirmed.
  status: 'pending' | 'confirmed' | 'cancelled' | 'expired'
  // Only set while status is 'pending' — when the emailed confirm link
  // stops working and the slot lock becomes reclaimable by someone else.
  pendingExpiresAt?: Date
  payment?: Payment

  // Set when this occurrence was created as part of a recurring series (see
  // BookingSeries) — unset for a normal one-off booking. Each occurrence is
  // still a fully independent Booking (own confirmationCode/
  // cancellationToken), so it can be looked up or cancelled on its own.
  seriesId?: string

  createdAt: Date
  cancelledAt?: Date
}

export type SeriesFrequency = 'daily' | 'weekly'

// A recurring series of bookings — either daily or weekly (e.g. "every
// Monday 18:00 for 10 weeks", or "every day 07:00 for the next 14 days"),
// creatable by a customer or by staff. This doc doesn't hold the bookings
// themselves — those are normal Booking docs tagged with this series' id
// — it exists only to remember the recurrence and to let someone cancel
// every remaining occurrence with a single link.
export interface BookingSeries {
  id: string
  clubId: string
  rinkId: string
  zoneId: string
  frequency: SeriesFrequency
  dayOfWeek: number // 0=Sun .. 6=Sat, derived from the first occurrence
  startTime: string
  durationMinutes: number

  name: string
  email: string
  phone: string

  cancellationToken: string
  tokenExpiresAt: Date

  createdAt: Date
}

// Role hierarchy:
// - superadmin: full control, and the only role that can grant/revoke 'owner'
// - owner ("Club owner"): manages bookings/schedules, and can grant/revoke
//   'assistant' for their own club — but cannot touch owner/superadmin roles
// - assistant: manages bookings/schedules, cannot manage other staff
// - pending: a self-registered account with no permissions yet, awaiting an
//   owner or superadmin to grant it a role
export type StaffRole = 'superadmin' | 'owner' | 'assistant' | 'pending'

export interface StaffUser {
  uid: string
  clubId: string
  email: string
  name: string
  role: StaffRole
  createdAt: Date
}
