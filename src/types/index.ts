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

export type DivisionMode = 'full' | 'half' | 'third'

export interface Zone {
  id: string
  clubId: string
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
  slotDurationMinutes: number
  hours: DayHours[]
}

// Admin-configured recurring window where the rink is offered as halves or
// thirds instead of the default whole-rink (1/1) booking. A date/time with
// no matching rule falls back to 'full'.
export interface DivisionRule {
  id: string
  clubId: string
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

  status: 'confirmed' | 'cancelled'
  payment?: Payment

  createdAt: Date
  cancelledAt?: Date
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
