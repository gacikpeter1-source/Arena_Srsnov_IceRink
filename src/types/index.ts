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
  createdAt: Date
}

export interface Zone {
  id: string
  clubId: string
  name: string // "Full Rink" | "Half A" | "Third 1" ...
  type: 'full' | 'half' | 'third'
  // Zone IDs (including itself) that share physical ice with this zone.
  // Booking one zone must block every zone listed here for the same
  // date/time — this is how "Full Rink" blocks "Half A" and vice versa.
  conflictsWith: string[]
  sortOrder: number
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
  // Zone IDs whose slot locks this booking holds (see lib/bookings.ts).
  // Set at creation time so cancellation releases exactly what was locked.
  lockedZoneIds: string[]
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

export interface StaffUser {
  uid: string
  clubId: string
  email: string
  name: string
  role: 'admin' | 'staff'
  createdAt: Date
}
