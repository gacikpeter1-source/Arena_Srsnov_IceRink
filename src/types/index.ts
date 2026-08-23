import type { SupportedLanguage } from '@/i18n'

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

// Role hierarchy (ice-rink admin duties only — see isTrainer below for the
// separate, orthogonal training-reservations track):
// - superadmin: full control, and the only role that can grant/revoke 'owner'
// - owner ("Club owner"): manages bookings/schedules, and can grant/revoke
//   'assistant' for their own club, plus grant/revoke isTrainer on anyone
//   but an owner/superadmin — but cannot touch owner/superadmin roles
// - assistant: manages bookings/schedules, cannot manage other staff
// - pending: a self-registered account with no ice-rink permissions yet,
//   awaiting an owner or superadmin to grant it a role
export type StaffRole = 'superadmin' | 'owner' | 'assistant' | 'pending'

export interface StaffUser {
  uid: string
  clubId: string
  email: string
  name: string
  role: StaffRole
  // Independent of `role` — an account can be e.g. role:'assistant' AND
  // isTrainer:true at once (one person doing both jobs). Manages only
  // their own training sessions/series/bundles and the attendance/
  // registrations on them; grants no ice-rink/club-settings/staff access
  // by itself. Distinct from isStaffMember() entirely (see firestore.rules)
  // rather than a variant of role.
  isTrainer?: boolean
  // Trainer-only profile shown on the public trainer directory
  // (/treningy/treneri) — meaningless when isTrainer isn't set.
  bio?: string
  photoUrl?: string
  // Distinguishes this trainer's sessions on the public calendar, where
  // several trainers can each have an independent entry at the same
  // date/time. Auto-assigned from a fixed palette at approval time;
  // editable later.
  calendarColor?: string
  // Set only while isTrainer isn't true yet AND the signup came through
  // the invite-code-gated trainer flow (see lib/trainerInvites.ts) — lets
  // the staff approval panel show "wants to become a trainer" instead of a
  // bare generic pending row, and lets the approve action set isTrainer
  // straight to true instead of the owner having to know to do that.
  // The generic self-signup (AdminSignupPage) never sets this field.
  pendingRole?: 'trainer'
  createdAt: Date
}

// ---------------------------------------------------------------------
// Training reservations (korčuľovanie) — a second, independent booking
// domain living in the same app/Firebase project/Auth as ice-rink
// bookings above, so staff share one login. See CLAUDE.md's "Training
// reservations" section for the full design rationale and the decisions
// this data model reflects.
// ---------------------------------------------------------------------

// Gates trainer self-registration (see AuthContext.signupTrainer) so
// accounts can't be created uncontrolled — an owner/superadmin generates
// one, hands it to a specific person, and it's consumed exactly once.
export interface TrainerInviteCode {
  id: string // the code itself, e.g. a generateToken() string
  clubId: string
  createdBy: string // uid of the owner/superadmin who generated it
  used: boolean
  usedBy?: string // uid of the staff doc created with this code
  usedAt?: Date
  createdAt: Date
}

export type TrainingFrequency = 'daily' | 'weekly'

// Metadata for a recurring series of independently-joinable training
// sessions (e.g. "every Tuesday 17:00") — each occurrence is still its
// own TrainingSession document with its own registrations/capacity;
// customers register per session, not once for the whole series. This is
// the "opakované tréningy" model, distinct from TrainingBundle below.
export interface TrainingSeries {
  id: string
  clubId: string
  trainerId: string
  trainerName: string
  title: string
  frequency: TrainingFrequency
  dayOfWeek?: number // 0=Sun..6=Sat, for weekly
  startTime: string
  durationMinutes: number
  capacity: number | null // null = unlimited
  cancellationCutoffHours: number
  createdAt: Date
}

// A "kurz"/"kemp" — a fixed bundle of pre-scheduled sessions where a
// participant registers ONCE and that single registration covers every
// session in the bundle (as opposed to TrainingSeries, where each
// occurrence needs its own registration). Capacity/waitlist is tracked
// once, on the bundle itself, not per session.
export interface TrainingBundle {
  id: string
  clubId: string
  trainerId: string
  trainerName: string
  title: string // e.g. "Krasokorčuliarsky kurz jeseň 2026" / "Letný kemp"
  capacity: number | null
  confirmedCount: number // maintained atomically in a transaction
  cancellationCutoffHours: number
  createdAt: Date
}

// One real, physical training hour on the calendar — whether standalone,
// part of a TrainingSeries, or part of a TrainingBundle. Never reserves
// ice/zone time itself — the trainer is assumed to already have the ice
// booked separately (see CLAUDE.md).
export interface TrainingSession {
  id: string
  clubId: string
  // Unset while status is 'unassigned' — created without a trainer name
  // via Excel import, waiting for any approved trainer to claim it. Public
  // registration is only possible once a trainer has claimed it.
  trainerId?: string
  trainerName?: string
  date: string // "2026-08-15"
  startTime: string
  durationMinutes: number
  // null = unlimited (no waitlist ever triggers). Denormalized from the
  // owning TrainingBundle when bundleId is set, since capacity there is
  // shared across every session in the bundle.
  capacity: number | null
  confirmedCount: number // maintained atomically in a transaction
  // Per-session self-cancel cutoff, set by the trainer — not a single
  // club-wide constant like ice bookings' CANCELLATION_CUTOFF_HOURS.
  cancellationCutoffHours: number
  // Mutually exclusive: a session belongs to at most one of these.
  seriesId?: string
  bundleId?: string
  status: 'unassigned' | 'active' | 'cancelled'
  // Confirmed by an assistant/owner/superadmin on the ice-attendance
  // checklist page — marks that the assigned trainer was physically
  // present for this scheduled session, independent of customer
  // attendance (see TrainingRegistration.attendance). Purely a
  // payroll-support record for the owner; unset = not yet confirmed
  // either way, not "trainer was absent".
  trainerPresentConfirmed?: boolean
  createdAt: Date
}

// A customer's (no-login) registration for one specific TrainingSession —
// used for standalone sessions and for each occurrence of a TrainingSeries.
// Same shape/lifecycle as Booking above by design (atomic capacity check,
// pending-confirm-by-email anti-typo window, soft cancel, secure tokens).
export interface TrainingRegistration {
  id: string
  clubId: string
  sessionId: string
  trainerId: string // denormalized for display/queries
  date: string
  startTime: string
  durationMinutes: number

  name: string
  email: string
  phone: string

  confirmationCode: string
  cancellationToken: string
  tokenExpiresAt: Date
  startAtUtc?: Date

  status: 'pending' | 'confirmed' | 'waitlist' | 'cancelled' | 'expired'
  pendingExpiresAt?: Date
  waitlistPosition?: number
  // Set by the trainer/assistant on the session's own check-in screen —
  // the trainer sees this participant's name and confirmationCode
  // together (not anonymized).
  attendance?: { checkedIn: boolean; checkedInAt?: Date; checkedInBy?: string }
  // Captured from the registrant's browser at signup so a later automatic
  // waitlist promotion (no browser session to read from) still emails
  // them in their own language. Unset on registrations from before this
  // field existed — callers fall back to 'sk'.
  language?: SupportedLanguage

  createdAt: Date
  cancelledAt?: Date
}

// A customer's (no-login) registration for an entire TrainingBundle at
// once — covers every session the bundle contains. Attendance is still
// tracked per real session (see attendanceBySession), since someone
// enrolled in a 10-session course can still miss individual sessions.
export interface TrainingBundleRegistration {
  id: string
  clubId: string
  bundleId: string
  trainerId: string

  name: string
  email: string
  phone: string

  confirmationCode: string
  cancellationToken: string
  tokenExpiresAt: Date

  status: 'pending' | 'confirmed' | 'waitlist' | 'cancelled' | 'expired'
  pendingExpiresAt?: Date
  waitlistPosition?: number
  attendanceBySession?: Record<string, { checkedIn: boolean; checkedInAt?: Date; checkedInBy?: string }>
  // See TrainingRegistration.language.
  language?: SupportedLanguage

  createdAt: Date
  cancelledAt?: Date
}

// A participant who shows up to a specific session without having
// registered beforehand — an informal log, deliberately kept available
// for people who don't use the app. No email is sent; never touches
// TrainingRegistration or a session's confirmedCount.
export interface TrainingWalkIn {
  id: string
  clubId: string
  sessionId: string
  name: string
  notes?: string
  checkedInAt: Date
  addedBy: string // uid of the assistant/trainer who logged it
}

// A trainer showing up to use the ice without any booked
// session/reservation in the system — a club-oversight tool (catching
// unauthorized private lessons on club ice), logged by an assistant.
// Deliberately NOT visible to the trainer themselves, only to
// owner/superadmin — see firestore.rules.
export interface TrainerIceLogEntry {
  id: string
  clubId: string
  // Unset when the assistant typed a name that doesn't match any
  // registered trainer account (e.g. a guest/private coach) — logging by
  // name alone shouldn't require the trainer to have signed up first.
  trainerId?: string
  trainerName: string
  date: string
  // Defaults to the current local time when the logging form is opened —
  // the assistant is logging ice use they're witnessing right now, not a
  // past event.
  time?: string
  notes?: string
  loggedBy: string // uid of the assistant who logged it
  loggedAt: Date
}

// Audit log of generated attendance/booking exports, so a past report can
// be re-downloaded without regenerating it — owner/superadmin only.
export interface TrainingReportHistory {
  id: string
  clubId: string
  generatedBy: string
  generatedAt: Date
  dateFrom: string
  dateTo: string
  trainerIds?: string[] // unset = all trainers
  format: 'xlsx' | 'csv'
  filename: string
}

// A quickly-planned tournament (see CLAUDE.md's "Tournaments" section) —
// just a name; the real content is its TournamentMatch docs. Kept
// separate so several matches sharing a name/date range can be managed
// or deleted together.
export interface Tournament {
  id: string
  clubId: string
  name: string
  createdBy: string // uid of the trainer/assistant/owner/superadmin who created it
  createdByName: string
  createdAt: Date
}

// A team entered into a tournament — added manually or via Excel import
// (see lib/excel.ts's parseTeamsWorkbook). Names must be unique within a
// tournament (case-insensitive, enforced in lib/tournaments.ts's
// createTournamentTeam) since later phases reference teams by identity
// to auto-generate schedules/brackets — a silent duplicate would make
// that ambiguous.
export interface TournamentTeam {
  id: string
  tournamentId: string
  clubId: string
  name: string
  // Manual seeding order (1-based) for bracket/group draw — unset until
  // a later phase's seeding UI sets it; random draw doesn't need it.
  seed?: number
  createdAt: Date
}

// One scheduled match. Reuses DivisionMode (full/half/third) for
// `format` — a trainer picks how the rink is divided for this time slot
// exactly like the ice-booking zone system, so a "third" format lets up
// to 3 matches run in parallel, one per third-zone.
export interface TournamentMatch {
  id: string
  tournamentId: string
  clubId: string
  date: string
  startTime: string
  durationMinutes: number
  teamA: string
  teamB: string
  format: DivisionMode
  // 'rink' = played on this club's own ice (rinkId/zoneId set); 'other' =
  // a different venue entirely (e.g. a hokejbal/football pitch this club
  // doesn't manage a calendar for) — venueName set instead, no
  // rink/zone/blocking concept applies.
  location: 'rink' | 'other'
  rinkId?: string
  zoneId?: string
  venueName?: string
  // Only meaningful when location === 'rink' — whether this match's
  // rink/zone/time was atomically reserved via the same booking
  // mechanism customers use (see lib/tournaments.ts), so it can't be
  // double-booked from the public /book page. A trainer can leave this
  // off to keep the slot open to the public, e.g. when ice is already
  // secured outside the app for this tournament.
  blocksIce: boolean
  bookingId?: string // set when blocksIce created a real Booking doc
  createdBy: string
  createdAt: Date
}
