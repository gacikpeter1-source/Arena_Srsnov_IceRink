# Project: Ice Rink Booking App

## Goal
Mobile-first, responsive reservation app (phone → tablet → desktop) for 
an ice hockey club. Users book full rink or a zone for a time slot. 
No login/registration required. Must be easy to re-brand/redeploy for 
other customers later.

## Workspace layout
/home/user/
  Arena-Srsnov/           ← reference app (read-only, do not modify)
  Arena_Srsnov_IceRink/    ← THIS repo — new app being built

## Role of Arena-Srsnov (../Arena-Srsnov)
Reference/template ONLY. Reuse patterns for:
- Design system: colors, typography, spacing, Tailwind tokens
- Calendar UI: date/time selection components
- Registration form patterns: input structure, validation
- Email system: inspect SETUP.md / EMAIL_SETUP_GUIDE.md for provider, 
  triggers, templates — reuse same approach if it fits
Do NOT copy its routes, data model, or business logic — this is a 
fresh, independent codebase, only conventions are reused.

## Stack
- Vite + React + TypeScript (matches Arena-Srsnov)
- Firebase: Firestore (data), Cloud Functions (server logic/email)
- Tailwind CSS
- Hosted on Vercel, repo on GitHub (Arena_Srsnov_IceRink)
- PWA-ready from day one (manifest + service worker) for future 
  Capacitor wrap → App Store / Google Play

## Key requirements
- No login — booking form captures name + phone/email, returns a 
  confirmation code for self-service view/cancel
- Email notifications on booking create/cancel (reuse Arena-Srsnov's 
  email mechanism)
- Rink zones configurable (full/half/thirds), not hardcoded
- Time slots configurable per club (hours, slot duration)
- Booking creation MUST use a Firestore transaction to atomically 
  check-and-reserve a slot/zone — prevents double-booking from 
  concurrent requests
- Payments: build data model + UI step now, gate behind 
  `paymentsEnabled` config flag — currently OFF
- Localization: app must support Slovak and English. Default language 
  is chosen from the browser's language (Slovak if the browser is set 
  to Slovak, English otherwise) — no hardcoded default. A language 
  switcher must be easy to find at the top of the app (header) so the 
  user can override it at any time.

## Staff roles & access control
Customer booking stays login-free (see above); this is about the 
`/admin` side only. Four-tier role model on the `staff` collection:
- `superadmin` — full control, only role that can grant/revoke `owner`
- `owner` ("Club owner") — manages bookings/schedules, can grant/revoke 
  `assistant`, cannot touch owner/superadmin roles
- `assistant` — manages bookings/schedules, cannot manage other staff
- `pending` — self-registered via `/admin/signup` (open to anyone), zero 
  permissions until an owner/superadmin grants a real role
First superadmin is bootstrapped outside the app via 
`scripts/create-superadmin.mjs` (Admin SDK, bypasses rules — same 
chicken-and-egg reason the original single-admin bootstrap script 
existed). Each deployment serves one club (see multi-tenant section 
below), so none of this is scoped by clubId beyond what's already 
implicit — revisit if a deployment ever needs to serve multiple clubs.

## Email delivery
Client code queues emails by writing `{to, message:{subject, html}}` to
the `mail` collection (src/lib/email.ts) — this part was always meant
to reuse Arena-Srsnov's "Firebase Trigger Email from Firestore"
extension, but that extension hit a Google Deployment Manager bug on
install for this project (a stale/inconsistent deployment record,
not fixable by retrying). Replaced with a self-hosted equivalent:
`sendQueuedMail` in `functions/src/index.ts`, an `onDocumentCreated`
trigger on `mail/{id}` that sends via nodemailer + SMTP. Same document
shape either approach expects, so nothing on the queueing side had to
change — only who's watching the collection. Requires two secrets set
via `firebase functions:secrets:set SMTP_URI` / `MAIL_FROM` before
`firebase deploy --only functions`. If a future deployment's extension
install works fine, either approach is interchangeable — don't run
both at once (double-send).

## QR codes
Any active staff role (assistant/owner/superadmin — not `pending`) can
generate and download QR codes from the admin dashboard's QR panel,
all pointing at `/book` with different query params so one route
handles every case:
- Static app QR — `${origin}/`, always the same, for posters/front desk
- Per-zone QR — `?zone=<id>`, opens the booking page filtered to just
  that zone's available times across all days
- Quick-registration ("open ice") QR — `?zone=<id>&date=&time=`, jumps
  straight to the registration form for that exact slot, skipping the
  picker entirely — scan and fill in name/email/phone, nothing else
Booking confirmation emails also embed a QR (of the same cancel-link
URL the "Cancel booking" button uses) as an inline data-URI image, so
a customer can scan their emailed confirmation to reopen their booking.
`src/lib/schedule.ts` (computeDaySchedule) is the single shared
implementation of "which zones are open at which times on a given
day" — reused by the public booking page, admin's manual-create form,
and the QR panel's time picker; keep it that way rather than
re-deriving the schedule logic in a fourth place.

## Multiple rinks
A club can run more than one physical ice surface — this club has two:
"Main Hall" and "Small Hall". Modeled as a `rinks` collection (see `Rink`
in `src/types/index.ts`); `Zone`, `TimeSlotConfig`, and `DivisionRule` each
carry a `rinkId` since hours/division-mode schedules are set per rink, not
club-wide. `Booking` also carries `rinkId` (denormalized from its zone) for
display/export convenience. `src/hooks/useClubData.ts` exposes
`timeSlotConfigs: TimeSlotConfig[]` (one per rink) instead of a single
config — callers filter by `rinkId` for the rink they're working with.

The public booking calendar (`/book`) shows every rink's schedule at once
by default, with a filter to narrow to a single rink (`BookingPage.tsx`).
A single `RinkDiagram` (`src/components/RinkDiagram.tsx`) — using
`public/rink-diagram.jpg` as a background image with the club's actual
painted rink lines — sits above both schedules rather than being
duplicated per rink column, since both rinks share the same physical
layout; when a zone is hovered/focused in either column, the diagram
highlights that zone's slice of the ice and dims the rest — so a customer
booking e.g. "Third 2 of 3" can see exactly which physical part of the
rink they're reserving. The dividing-line positions are hardcoded as
measured percentages of image width in `RinkDiagram.tsx` (`BOUNDS`) — if
the diagram image is ever replaced, re-measure and update those
percentages, they won't self-derive from a new image.

Since zone names (e.g. "Full Rink", "Half A") are only unique within a
rink, not club-wide, the admin Excel import/export
(`src/lib/excel.ts`) includes a "Rink" column and resolves zones by
rink name + zone name together, not zone name alone.

`downloadImportTemplate` (also `src/lib/excel.ts`) gives a blank workbook
with just the header row `parseBookingsWorkbook` expects — a "Download
import template" button next to Import/Export on the admin dashboard,
with an inline hint explaining the columns/date format. Meant for
bulk-adding a recurring group booking that isn't a single customer's
series — e.g. a kindergarten course's standing weekly slot — by filling
in one row per date rather than the one-at-a-time create form.

When both rinks are visible (the default), `BookingPage.tsx` lays their
schedules out as two columns side by side (`grid-cols-2`, unconditional
— not gated behind a `md:` breakpoint) — left is whichever rink sorts
first (`Rink.sortOrder`), right is the other — collapsing to one
full-width column when filtered to a single rink. Deliberately not
gated by breakpoint: since the diagram is shown once (not per column),
each column only holds compact time/zone buttons, which fit two-across
even on a phone in portrait — the earlier per-rink-diagram layout needed
landscape width to show two columns. The diagram highlight tracks
whichever zone was most recently hovered/focused or tapped in *either*
column (not scoped per rink, since there's only one diagram to update),
and tapped selections stay lit after the pointer moves away or the
booking form closes — matters most on touch devices, which have no real
hover.

## Configurable schedule
Session length and hours were previously set once by `scripts/seed.mjs`
and never editable through the app. Owner/assistant self-service now
covers three layers, all in `AdminDashboardPage.tsx`:

- **Default schedule** (`AdminScheduleSettingsPanel.tsx`, writes via
  `lib/timeSlotConfig.ts`) — per rink, edits `TimeSlotConfig`'s
  `slotDurationMinutes`, the new `breakMinutes` (cleaning/prep time between
  sessions, suggested default 10 in the UI but stored as `undefined` until
  actually saved — see below), and which day-of-week + open/close hours
  the rink runs. `computeDaySchedule` (`lib/schedule.ts`) generates slots
  spaced by `slotDurationMinutes + breakMinutes`; the break is never shown
  to customers, only each session's own start-end is (e.g. 8:00-9:00,
  9:10-10:10 for a 60/10 config).
- **Per-day override** (`AdminDaySchedulePanel.tsx`, backed by a new
  `scheduleOverrides` collection, one doc per rinkId+date) — a one-off
  hand-adjusted schedule for a specific date (or a range of dates, applied
  by writing the same override to each date in the range — "per week" is
  just this with a wider range, not a separate concept). Editing one
  session's start time or duration calls `cascadeSlotEdit`
  (`lib/scheduleOverrides.ts`), which re-flows every session after it back
  to the rink's default rhythm — matches the stated policy that one
  session running long reschedules the rest of the day rather than
  preserving whatever other custom durations those later sessions had.
  "Reset to default" deletes the override doc for that date/range.
  Existing bookings aren't auto-migrated when a date's schedule changes
  underneath them — the panel shows a best-effort warning (booked start
  times no longer present in the edited schedule) but leaves resolving
  conflicts to the admin, same "out of scope for this pass" boundary as
  other known limitations in this codebase.
- **Excel import** (`lib/excel.ts`'s `parseScheduleWorkbook` +
  `downloadScheduleImportTemplate`) — a separate, smaller format from the
  booking import (columns: Rink, Date, Start Time, Duration): rows sharing
  a Rink+Date are grouped and written as one full-replace
  `scheduleOverrides` doc for that date, same mechanism the manual day
  editor's Save uses.

`computeDaySchedule` takes an optional `ScheduleOverride | null` fourth
argument — when given, it returns the override's explicit slot list as-is
instead of generating from `TimeSlotConfig`; either way, every `ScheduleRow`
now carries its own `durationMinutes` (previously callers all assumed
`timeSlotConfig.slotDurationMinutes` uniformly, which broke once a single
date could have per-slot custom durations). All four consumers
(`BookingPage.tsx`, `AvailabilityGrid.tsx`, `AdminCreateBookingModal.tsx`,
`AdminQrPanel.tsx`) fetch the relevant override(s) — `BookingPage` for the
whole visible 14-day range across every rink (`fetchScheduleOverridesRange`,
mirroring how `fetchLockedSlotsRange` already worked), the admin tools for
just the single rink+date being edited — and pass them through.

`breakMinutes` defaults to 0 (back-to-back, today's behavior) if a
`TimeSlotConfig` doc doesn't have it set, rather than defaulting to 10 —
an already-live rink's schedule should never silently gain a gap and shed
slots just because this feature shipped; 10 only becomes real once an
owner/assistant explicitly saves it via the settings panel.

## Recurring bookings
Both customers (no login required) and staff can create a daily- or
weekly-recurring series instead of a single slot — a "Repeat this
booking" checkbox on the booking form (customer `BookingModal.tsx` and
admin `AdminCreateBookingModal.tsx`) reveals a Daily/Weekly frequency
choice plus a count-or-end-date recurrence choice (`SeriesRecurrence` /
`SeriesFrequency` in `src/lib/bookings.ts` / `src/types/index.ts`).
`createBookingSeries` books each occurrence through the *same* atomic
`createBooking` transaction used for a one-off booking, one at a time in
a loop — not one multi-slot transaction — so a date someone else already
has is skipped rather than failing the whole series; every occurrence
that *is* created keeps its own confirmationCode/cancellationToken
exactly like a normal booking, so it can still be looked up/cancelled on
its own via the existing `/my-booking` flow. Occurrence caps
(`SERIES_MAX_OCCURRENCES`) differ per frequency — 180 for daily (~6
months), 52 for weekly (~1 year) — the UI bounds its count/date inputs to
the same limits. A `bookingSeries` doc (`BookingSeries` in
`src/types/index.ts`) exists only to remember the recurrence and give the
customer a single link to cancel every remaining occurrence at once —
emailed via `queueSeriesConfirmationEmail`, landing on `SeriesCancelPage`
(`/my-series/:seriesId/:token`), which can also cancel occurrences
individually.

## Booking email confirmation (anti-typo / anti-hoarding)
A single (non-recurring) customer booking made through `BookingModal.tsx`
starts as `status: 'pending'` instead of instantly `'confirmed'` —
`createBooking` is called with `requiresConfirmation: true`, which also
stamps `pendingExpiresAt` (`PENDING_CONFIRMATION_MINUTES`, 5,
`src/lib/bookings.ts`) on both the booking and its `slotLocks` doc. The
slot is still atomically held during the pending window (so nobody else
can grab it), but the customer must click the link in a "please confirm"
email (`queuePendingConfirmationEmail`, deliberately bare — no calendar/QR/
cancel content, since the booking isn't real yet) within that window, via
`ConfirmBookingPage` (`/confirm-booking/:bookingId/:token`) →
`confirmBooking()`. Only on that click does the *real*
`queueBookingConfirmationEmail` (calendar attachment, cancel link, QR) go
out — so a typo'd email address means nobody ever receives a link, nobody
confirms, and the hold simply expires rather than silently squatting on a
slot forever with a booking nobody can look up or cancel.

Staff-created bookings (`AdminCreateBookingModal`, Excel import) and every
occurrence of a recurring series (`createBookingSeries`) skip this and go
straight to `'confirmed'` as before — staff already know the contact info
is real, and a series would need one click per occurrence to fully close
the loophole, which is its own feature for another day.

Expiry is enforced two ways, not just a background sweep:
- **Lazy, read-side**: `fetchLockedSlots`/`fetchLockedSlotsRange` filter out
  any lock whose `expiresAt` has passed, so an abandoned pending hold stops
  blocking the calendar/availability views in real time, with no Cloud
  Function needed.
- **Write-side reclaim**: `createBooking`'s transaction treats an existing
  lock as available for reclaiming (full overwrite) once its `expiresAt` is
  in the past, rather than throwing `SlotUnavailableError` — so the next
  person to actually try booking that exact slot gets it immediately. The
  original pending booking is left orphaned as `'pending'` until something
  touches it (a late confirm click marks it `'expired'`); there's no
  scheduled cleanup job, since nothing in the UI needs one to behave
  correctly — this is data hygiene, not a correctness requirement.

`confirmBooking` re-reads the slot lock inside its own transaction (not
just the booking doc) and checks `bookingId` still matches — if the 5
minutes lapsed and someone else's booking has since reclaimed the same
slot, the late click marks the original `'expired'` instead of blindly
promoting it to `'confirmed'`, which would otherwise double-book the slot.
It's also idempotent (a revisit or double-click on an already-`'confirmed'`
booking is a no-op, just re-rendering the same success state) so the real
confirmation email never gets queued twice.

This only raises the bar, it doesn't close every hole: firestore.rules'
public `'pending' -> 'confirmed'`/`'expired'` transition doesn't verify
possession of `cancellationToken` (rules have no way to see it — the app
only checks it client-side before calling `confirmBooking`), same trust
boundary the rest of this public-write collection already accepts (see the
KNOWN LIMITATION note above `/bookings`). Genuine bot/abuse resistance
would still need rate-limiting or a CAPTCHA on booking creation — out of
scope for this pass, which targets the typo case specifically.

## Cancellation lockdown
A customer can self-cancel a booking (or a single occurrence of a series)
up to `CANCELLATION_CUTOFF_HOURS` (24, `src/lib/bookings.ts`) before it
starts — inside that window the cancel button is hidden/disabled and a
locked notice shown instead, across all three self-service surfaces
(`CancelViaTokenPage`, `CancelLookupPage`, `SeriesCancelPage`). Cancelling
an entire series (`cancelBookingSeries`) skips any locked occurrence and
leaves it confirmed rather than failing the whole action. The check
(`isPastCancellationCutoff`) reuses `zonedTimeToUtc` from `lib/ics.ts` —
same DST-aware local→UTC conversion the calendar-invite feature already
needed, kept in one place rather than re-deriving it.

Staff are exempt: `cancelBooking` itself has no cutoff logic, and the
admin dashboard's cancel action is a separate Firestore-rules branch
(`isStaffMember()`) from the public one, so an owner/assistant can still
cancel a booking last-minute (e.g. rink issue, no-show) regardless of the
customer-facing lockdown.

Enforced server-side too, not just hidden in the UI: `createBooking`
stores `startAtUtc` (the booking's true UTC start instant, converted at
creation time via the club's `timezone` — now a required field on
`CreateBookingInput`/`CreateSeriesInput`) precisely so `firestore.rules`
can gate the public self-cancel `allow update` rule on
`request.time + duration.value(24, 'h') < resource.data.startAtUtc`
without needing its own timezone math (rules have no `Intl` access).
Bookings written before this field existed have no cutoff to check and
fall back to the pre-feature (always-allowed) behavior rather than being
permanently locked out.

## Back navigation
Every routed page except the hub home (`/`) renders `BackButton.tsx` — a
small chevron-arrow control — at the top of its content. Needed because
this app is PWA-installable (see the Stack section): once installed to a
home screen, standalone display mode has no browser chrome at all, so
there's no native back button once a customer is a few taps deep (e.g.
booking confirmation → cancel page → back to the hub).

It prefers real browser-session history (`navigate(-1)`, gated on
react-router's own history-index stamp on `window.history.state` being
> 0) over a fixed destination, so — per an explicit product requirement —
returning from just having created a training lands back on the list you
were already viewing, not a fixed page. It only falls back to a per-page
default route when there's no in-app history to go back to at all (a
fresh visit via a shared link, QR code, or emailed confirmation/cancel
link, which is how most of these sub-pages are actually reached). Each
page picks its own fallback matching its place in the information
architecture — e.g. `/treningy/treneri` falls back to `/treningy`,
`/admin/treningy` falls back to `/treningy` (its training-domain parent,
not `/admin`, per the "Administrácia vs. training management" navigation
note above), and most customer-facing pages (confirmation/cancel links,
`/book`) fall back to the hub home `/`.

## Availability visibility
Two ways to see occupancy without opening each day one at a time (both in
`BookingPage.tsx`):
- Day-picker dots — a green/amber/red dot per date in the 14-day strip,
  computed from one ranged `fetchLockedSlotsRange` query combined with
  each day's `computeDaySchedule`, scoped to whichever rink(s) the rink
  filter currently shows.
- Week grid (`src/components/AvailabilityGrid.tsx`) — a times × days
  heatmap per rink, toggled via List/Grid buttons next to the rink
  filter; clicking an open cell jumps the day-by-day list to that date so
  the customer can pick the exact zone.

## Add to calendar
Every booking confirmation — the in-app confirmation screen
(`BookingModal.tsx`), the emailed confirmation, and the self-service
`/my-booking` and `/my-series` pages — offers "Add to calendar" so a
customer can save it (and share it) via their own Google/Apple/Outlook
calendar. `src/lib/ics.ts` builds a standard iCalendar (.ics) file;
`src/components/AddToCalendarButtons.tsx` renders the actions: a one-tap
"Add to Google Calendar" link (only for a single event — Google's
quick-add URL doesn't support multiple) plus a `.ics` download that
works with any calendar app. A recurring series' `.ics` download bundles
every occurrence as its own `VEVENT` in one file, so importing it adds
every session at once. Event times are written as true UTC (`Z` suffix),
converted from the club's local wall-clock time via `zonedTimeToUtc`
(Intl-based DST-aware conversion, no timezone library needed) — NOT a
bare `TZID=<club.timezone>` reference. That was the first approach and
technically requires an accompanying `VTIMEZONE` block per RFC 5545;
Google/Outlook tolerate a well-known zone name without one, but iOS
Mail's quick-add screen previewed the event fine and then silently
refused to actually save it. UTC sidesteps the whole problem and needs
no VTIMEZONE at all.

The confirmation email embeds the same `.ics` as a real attachment (not
just a link) so Apple Mail/Outlook users can add it with one tap from
their inbox — `sendQueuedMail` (`functions/src/index.ts`) reads an
`attachments` field off the `mail` doc and passes it straight to
nodemailer; `src/lib/email.ts` builds that field client-side when it
queues the email, so there was nothing new to compute server-side.

Shipping this feature exposed a pre-existing PWA bug: `vite.config.ts` set
`registerType: 'autoUpdate'`, but nothing called `virtual:pwa-register`'s
`registerSW()`, so that setting had no actual effect — vite-plugin-pwa
fell back to auto-injecting a bare `registerSW.js` that only calls
`navigator.serviceWorker.register()` once and never reacts to a new worker
taking control. Net effect: an already-open client (especially an iOS
home-screen PWA, which doesn't reliably do a true network reload on
resume) could keep running an old cached JS bundle indefinitely — which is
why a real booking's confirmation email came out with no calendar
attachment/link at all even after the feature had already shipped and been
verified server-side: the phone was still executing a pre-calendar-feature
build. Fixed by setting `injectRegister: false` and registering explicitly
in `src/main.tsx` via `virtual:pwa-register`'s `registerSW({ immediate:
true, onRegisteredSW })`, which installs a 60s `registration.update()`
poll so an already-open tab picks up a new deploy (combined with the
existing `skipWaiting`/`clientsClaim`/`cleanupOutdatedCaches` workbox
options, which control the *server*-side swap but were never sufficient
on their own).

## Training reservations (korčuľovanie)
A second, independent booking domain living in this same app/Firebase
project/Auth — not a separate embedded app, and not a data migration of
`../Arena-Srsnov` either. That reference app was read (see its own repo)
to understand its actual behavior, then this domain was redesigned from
scratch to reuse this app's existing conventions (atomic transactions,
soft-cancel, secure tokens, the `mail` email-queue mechanism, bilingual
i18n) rather than port its code — several of its mechanisms were
deliberately not carried over as-is: unsynchronized `read-then-write`
capacity checks (a real double-booking race), a `Math.random()`
`cancellationToken` (not cryptographically secure), and cancellation by
hard `deleteDoc` (loses history) were all fixed rather than reproduced.

**Why a second Firebase project was rejected**: the reference app runs on
its own separate Firebase project (`arena-srsnov`, vs. this app's
`arena-srsnov-reservation`) with its own Auth user pool. Embedding its
code as-is would have meant staff needing two separate logins — one for
`/admin` (ice bookings) and one for training sessions — plus reconciling
two Tailwind configs and dependency trees for no real benefit. Rebuilding
natively means one Firebase project, one Auth pool, one login.

**Role model**: trainer access is `isTrainer?: boolean` on `StaffUser` (see
`src/types/index.ts`) — independent of `role` (`superadmin`/`owner`/
`assistant`/`pending`), not a fifth value of it. That was the original
design (`role: 'trainer'`) but a club owner asked for one account to be
able to hold an ice-rink role AND trainer access at once (e.g. an
assistant who also coaches), which a single-valued enum can't express —
so the two tracks were decoupled. `isStaffMember()` (assistant/owner/
superadmin — ice-rink duties) and `isTrainer()` (own training sessions
only) are fully independent checks in `firestore.rules`; an account with
neither has `role: 'pending'` and `isTrainer` unset/false. Public
customers still never log in, same as ice bookings.

Granting/revoking `isTrainer` goes through `setTrainerAccess` (`lib/
staff.ts`) — an owner/superadmin action available directly on any
`pending`/`assistant` roster row in `AdminStaffPanel.tsx` (a superadmin
can also touch an owner/superadmin row), not gated behind the invite-code
flow once the account already exists — the invite code only controls who
can *self-register* as a brand-new trainer, not whether an owner can
later hand an existing staff member trainer access with one click.

**Deleting a staff account** (`deleteStaffAccount` in `functions/src/
index.ts`, called via `lib/staff.ts`) is a separate action from
"Revoke" (`updateStaffRole(uid, 'pending')`), which only zeroes out
permissions but leaves the account able to sign in. A real delete removes
both the Firestore `staff` doc and the Firebase Auth account — the Auth
half requires the Admin SDK (a client can't delete another user's Auth
account), so it's a callable Cloud Function rather than a direct
Firestore write; the function re-derives the same caller-role boundary
`firestore.rules`' `/staff` update rule already enforces (superadmin: any
row but their own; owner: only `pending`/`assistant` rows, never
owner/superadmin) since Admin SDK calls bypass Firestore rules entirely
and so must re-check permissions themselves.

**Trainer signup is invite-code-gated**, unlike the generic open
`/admin/signup` (which anyone can use to create a `'pending'` account with
zero permissions until approved). An owner/superadmin generates a
single-use code (`lib/trainerInvites.ts`, `trainerInviteCodes` collection)
and hands it to one specific person — this exists purely to keep the
pending-approval queue from filling with randoms who find the signup URL,
since the actual security boundary (zero permissions until approved) is
identical either way. `TrainerSignupPage.tsx`
(`/admin/signup-trainer`) still creates the account as `role: 'pending'`
(not straight to `'trainer'`) so it goes through the same existing
owner-approval mechanism as everyone else, but stamps
`pendingRole: 'trainer'` so `AdminStaffPanel.tsx` shows "wants to become a
trainer" and offers a one-click "Approve as trainer" button instead of a
bare generic pending row. Redeeming a code
(`redeemTrainerInviteCode`) writes the `staff` doc and marks the code used
in one Firestore transaction — necessary because Firebase Auth account
creation can't itself be part of a Firestore transaction, so
`AuthContext.signupTrainer` deletes the just-created Auth account if the
transaction loses a race (code already used), rather than leaving an
orphaned account with no `staff` doc.

`/admin/signup` (staff) and `/admin/signup-trainer` (invite-code-gated)
are two separate forms creating differently-shaped `staff` docs, which
was confusing when the only way to find the trainer form was a small
link at the bottom of the other page — `SignupModeSwitch.tsx` puts an
explicit Staff/Trainer tab switch in both pages' header instead, so the
choice is obvious before anyone starts typing. The invite-code table in
`AdminStaffPanel.tsx` shows a "Copy link" button per unused code
(`{origin}/admin/signup-trainer?code=<code>`) alongside the raw code
(which stays visible in the table itself, not just a one-time toast) —
`TrainerSignupPage.tsx` reads that `?code=` param to prefill the field,
so an owner can hand a trainer a single link instead of a code to
retype on the right page.

**Data model** (see `src/types/index.ts` for full field docs):
- `trainingSeries` — a recurring series (e.g. "every Tuesday") a trainer
  sets up once; each occurrence is still its own `trainingSessions` doc
  with its own registrations — a customer registers per session, not once
  for the whole series.
- `trainingBundles` — a "kurz"/"kemp": a fixed set of pre-scheduled
  sessions where a customer registers **once** and that single
  registration covers every session in the bundle (`trainingBundleRegistrations`).
  Capacity/waitlist is tracked once, on the bundle, not per session.
  Distinct from `trainingSeries` above — same underlying
  `trainingSessions` documents either way (every real training hour is
  always its own session doc, whether standalone, part of a series via
  `seriesId`, or part of a bundle via `bundleId` — mutually exclusive),
  only the registration/capacity model differs.
- `trainingSessions` — one real training hour, one trainer. Never reserves
  ice/zone time itself (the trainer is assumed to have the ice booked
  separately, outside this system). `trainerId` is optional: an
  Excel-imported row with no trainer name creates a `status: 'unassigned'`
  session that any approved trainer can claim (atomically, first to write
  wins — see firestore.rules) — public registration only opens once
  claimed. Nothing caps how many trainers can run sessions at the same
  date/time — any trainer can always create their own independent session
  alongside others', e.g. to absorb overflow demand.
- `trainingRegistrations` / `trainingBundleRegistrations` — no-login
  customer registrations, one shape per booking-unit above. Attendance
  (`attendance` / `attendanceBySession`) shows the trainer the
  participant's name *and* confirmation code together (not anonymized) —
  marked by the owning trainer on their own session's roster.
- `trainingWalkIns` — a participant who showed up without registering;
  deliberately kept available for people who don't use the app. No email,
  no link to a `trainingRegistrations` doc or a session's `confirmedCount`.
- `trainerIceLog` — a trainer using club ice with **no** booked session at
  all, logged by an assistant. A club-oversight tool for catching
  unauthorized private lessons on club ice — deliberately **not** readable
  by the trainer it's about, only by owner/superadmin.
- `trainingReportHistory` — audit log of generated exports, owner/
  superadmin only, so a past report can be re-downloaded without
  regenerating it.
- Per-session/bundle `cancellationCutoffHours` (default 2, set by the
  trainer at creation time in `TrainerDashboardPage.tsx`) is set
  individually, unlike ice bookings' single club-wide
  `CANCELLATION_CUTOFF_HOURS` constant, since each trainer may want a
  different notice window. Enforced for session registrations the same
  two ways ice bookings' cutoff is (`isPastTrainingCancellationCutoff` in
  `lib/training.ts` for the UI lockout, plus the matching
  `firestore.rules` check using the registration's `startAtUtc` and the
  session's own `cancellationCutoffHours` — no club `timezone` math needed
  in rules, same reason ice bookings stamp `startAtUtc`). Bundle
  registrations deliberately have no cutoff at all — cancelling a
  multi-week course enrollment isn't the same "about to start" concern a
  single session is, so `cancelBundleRegistration` and its rule never
  check one.

### Fáza 2: calendar, directory, registration

Built on the Fáza 1 foundation: the trainer's own dashboard
(`TrainerDashboardPage.tsx`, `/admin/treningy`) for creating standalone
sessions, recurring series, and bundles; the public calendar
(`TrainingCalendarPage.tsx`, `/treningy`) and trainer directory
(`TrainerDirectoryPage.tsx`, `/treningy/treneri`); and the full no-login
registration lifecycle (`lib/training.ts`) for both sessions and bundles.
`AdminDashboardPage.tsx` now redirects a trainer-only account (no ice-rink
role at all) straight to `/admin/treningy` instead of a placeholder, and
shows a "My trainings" link for an account holding both an ice-rink role
and `isTrainer` — same for the reverse link back from the trainer
dashboard. The hub's "Training Reservations" card now points at the
internal `/treningy` route unconditionally, no longer gated behind
`clubs.integrations.trainingReservationsUrl` — the external-link
integration model was superseded once this domain was rebuilt natively in
this app (see the "second Firebase project was rejected" note above).

**Capacity/waitlist model**: the Firestore Web SDK's `Transaction.get()`
only reads documents by reference, not queries, so the capacity decision
can't inspect "how many pending+confirmed registrations exist right now"
inside a transaction the way a query-based count would. Instead, a
'pending' registration reserves a real spot immediately at creation time —
`confirmedCount` on the session/bundle doc is incremented right then, the
same way ice bookings' `slotLocks` hold a slot during the pending window —
and only a registration created while the session/bundle is already full
goes straight to `'waitlist'` without touching `confirmedCount` at all. An
abandoned pending registration's reserved spot is released lazily and
best-effort: `reclaimExpiredSessionRegistrations`/
`reclaimExpiredBundleRegistrations` run a small non-transactional scan
before each new registration attempt on that session/bundle, same
"no scheduled cleanup job, self-heals on next touch" stance
`PENDING_CONFIRMATION_MINUTES` already documents for ice bookings.
Cancelling releases the reserved spot for `'confirmed'` OR `'pending'`
(both hold one) but not `'waitlist'` (which never did). Auto-promoting
the next waitlisted person when a confirmed registration cancels is
deliberately NOT built — it would need its own public
`waitlist -> confirmed` firestore.rules transition (not currently
permitted) and overlaps with the cross-notification feature below, so
it's left for that pass rather than half-building it now.

For a bundle-linked `TrainingSession` (`bundleId` set), the session's own
`capacity`/`confirmedCount` fields are a point-in-time snapshot only, NOT
kept in sync as the bundle fills up — registering against a bundle only
touches the one `trainingBundles` doc plus the new registration, not every
session the bundle contains. The calendar reads the owning bundle's
`capacity`/`confirmedCount` directly for a bundle-linked session's real
`X/Y` (`fetchTrainingBundlesByIds` in `lib/training.ts`) rather than
trusting the session's own (stale) copy.

**Public trainer directory** needed a new `firestore.rules` case: `/staff`
had no public read at all before this, so
`allow read: if resource.data.isTrainer == true` was added — Firestore
evaluates `read` per-document for list queries when the rule only depends
on `resource.data`, so a `where('isTrainer','==',true)` query safely
returns only trainer docs; every other staff doc stays private exactly as
before.

### Fáza 3: dochádzka, walk-iny, evidencia trénera na ľade

No new `firestore.rules`/`firestore.indexes.json` needed for this phase —
the attendance, walk-in, and ice-log write rules were already part of the
Fáza 1 deploy, just unused by any UI until now.

- **Attendance check-in** (`TrainerRosterModal.tsx`, opened via a
  "Roster"/"Účastníci" button on every row in `TrainerDashboardPage.tsx`'s
  Sessions tab — including series and bundle occurrences, not just
  standalone sessions) — the owning trainer marks which registered
  participants actually showed up. For a bundle-linked session, the
  roster comes from `trainingBundleRegistrations` (one signup per
  participant covers the whole bundle) but attendance is still recorded
  per real session via `attendanceBySession[session.id]`, since someone
  enrolled in a multi-week course can still miss individual sessions —
  matches the data model note in `TrainingBundleRegistration`. Marking
  present shows the trainer the participant's name and confirmation code
  together (deliberately not anonymized, see the data model section
  above).
- **Walk-ins** (`trainingWalkIns`, same modal) — a participant who showed
  up without registering. No confirmation code lookup, no link to
  `confirmedCount`; just a name (+ optional notes) the trainer can add or
  remove for that specific session.
- **Trainer ice log** (`AdminTrainerIceLogPanel.tsx`) — an assistant/
  owner/superadmin logs a trainer seen using club ice with no booked
  session at all. Lives in `TrainerDashboardPage.tsx` (`/admin/treningy`),
  not the ice-rink `AdminDashboardPage.tsx` — an assistant's whole reason
  to be on that page is to log this, so the original placement at the
  bottom of the ice-rink dashboard buried it; that page's access guard was
  broadened from "trainers only" to "trainer OR ice-rink staff" so a
  plain assistant (not a trainer) can reach it too, seeing only this
  panel while a trainer sees only their own session/series/bundle tools —
  a dual-role account sees both. The trainer name field is a free-text
  input backed by a `<datalist>` of registered trainers' names (not a
  strict dropdown) — typing a name that matches an existing trainer links
  the entry to their account (`trainerId`), typing anything else still
  logs fine without one (e.g. a guest/private coach who never signed up),
  since `TrainerIceLogEntry.trainerId` is optional precisely for this.
  Only owner/superadmin can read the log back
  (`canViewLog`/`fetchTrainerIceLog`), matching `firestore.rules` — an
  assistant who logs an entry can't see the accumulated log, and the
  trainer it's about never can either.
- **Attendance report** (`lib/trainingReport.ts`, owner/superadmin section
  of `AdminTrainerIceLogPanel.tsx`) — downloads one .xlsx for a date
  range (optionally filtered to one trainer) combining two sheets:
  planned trainings (with who was marked present, pulled from the same
  `attendance`/`attendanceBySession` data the roster check-in writes) and
  the private ice log entries for that range — exactly the "both the
  official calendar and the off-the-books ice use" view an owner asked
  for. Reuses the `lib/excel.ts` pattern (`XLSX.utils.json_to_sheet` +
  `XLSX.writeFile`, client-side, no server round trip) and logs a
  `trainingReportHistory` doc per generation for the audit trail: this
  pass is generate-and-download only, not re-download — that would need
  the file itself persisted somewhere (e.g. Firebase Storage), left for
  later since nothing asked for it yet.

**Owner/superadmin can also create sessions and register customers
directly** — the role model says superadmin has "full control," but the
session-creation UI was originally trainer-only, leaving an owner unable
to act even though `firestore.rules`' `trainingSessions` create rule
already granted `isOwnerOrAbove()` the right regardless of `trainerId`
(added in Fáza 1, just never surfaced). `TrainerDashboardPage.tsx`'s
Sessions tab (not Series/Bundles — those two collections' create rules
stayed trainer-only, no `isOwnerOrAbove()` branch, so extending them
would need its own rules change) is now visible to `isOwnerOrSuperadmin`
too, with a trainer picker (`fetchTrainers()`) in the create-session form
— assign directly to a specific trainer, or leave it unassigned
(`status: 'unassigned'`, same as an Excel-imported row with no trainer
name) for any trainer to claim later. Separately, `TrainingRegistrationModal`
gained an `asStaff` mode — when any ice-rink staff member (assistant/
owner/superadmin) is signed in while on the public `/treningy` calendar,
their registration skips the pending email-confirm window and goes
straight to `'confirmed'` (`registerForSession`/`registerForBundle`'s new
`instantConfirm` flag), mirroring how `AdminCreateBookingModal` already
works for ice bookings — staff already know the contact info is real.

**Automatic waitlist promotion.** When a `'confirmed'`/`'pending'`
registration for a session or bundle is cancelled and a real spot is
freed, `cancelSessionRegistration`/`cancelBundleRegistration`
(`lib/training.ts`) now try to promote whoever's been waiting longest —
straight from `'waitlist'` to `'confirmed'`, no re-click required, since
this is the *same* session/bundle the customer already signed up for
(unlike the still-unbuilt cross-notification below, which crosses between
different trainers and always needs an explicit claim). Firestore's
client SDK can only read documents by reference inside a transaction, not
run a query, so "who's next" (lowest `waitlistPosition`) is found via a
plain query first; each candidate is then tried in its own small
transaction that re-checks the session/bundle still has space and the
candidate is still `'waitlist'` before committing — a candidate who lost
a race (e.g. self-cancelled their waitlist spot moments earlier) is
skipped in favor of the next one rather than failing the whole
promotion. Needed a new public `firestore.rules` transition
(`'waitlist' -> 'confirmed'`, status-only) on both
`trainingRegistrations` and `trainingBundleRegistrations` — the customer
whose unrelated cancel triggers the promotion doesn't own the promoted
doc and needs no special permission to write to it, same public trust
boundary the existing `confirmedCount`-only update rule already accepts.

Promotion is never silent: the caller (`TrainingCancelPage.tsx`) queues
the promoted registrant the same confirmation email (with calendar
attachment/cancel link/QR) an instant-confirm registration gets. That
email needs a language to render in, but there's no browser session of
the *promoted* customer present to read `i18n.language` from — only the
canceller's. So `TrainingRegistration`/`TrainingBundleRegistration`
gained an optional `language` field, captured from the registrant's own
browser at signup time (`TrainingRegistrationModal.tsx` passes
`language: lang` into `registerForSession`/`registerForBundle`) and read
back for the promotion email; a registration from before this field
existed falls back to `'sk'`.

**Planned but not yet built** (this section will be extended as later
phases land): the "krížové upozornenie z čakačky" cross-notification
(when a new session opens at a date/time where another trainer's session
already has a waitlist, everyone on that waitlist gets emailed a one-click
claim link into the new session — never a silent auto-move, since a
waitlisted customer chose a particular trainer and shouldn't end up
enrolled with a different one without an explicit action), and Excel
import/export for sessions.

**Navigation: "Administrácia" vs. training management.** A trainer
reaching the training domain via the home hub's "Reserve Ice
Rink"-equivalent card landed on the *public* `/treningy` calendar (the
customer-facing view), which has no way to create a session — that tool
only lived on `/admin/treningy`, reachable solely through
`/admin` → "Moje tréningy". The fix keeps "Administrácia" scoped to pure
club/app administration (invite codes, club info, QR codes, staff roster)
and surfaces training-management as its own consistently-reachable path,
via three entry points:
- A banner Card at the top of `TrainingCalendarPage.tsx` — shown only when
  `staff?.isTrainer` or the signed-in account holds an ice-rink staff role
  (assistant/owner/superadmin) — with a "Spravovať tréningy" button
  linking to `/admin/treningy`, so landing on the public calendar while
  authorized to manage trainings always surfaces the way in.
- A second, visually distinct link in `HeaderMenu.tsx`'s dropdown
  (`canManageTrainings`, the same three-way role check), placed right
  after the existing public "Tréningy" link — so the dropdown offers both
  "view the public calendar" and "manage trainings" as clearly separate
  destinations regardless of which page you're currently on.
- Inside `/admin/treningy` (`TrainerDashboardPage.tsx`) itself, the old
  Sessions/Series/Bundles button row (plus the ice log panel, previously
  always rendered beneath it) is now one `<select>` dropdown covering all
  four areas including a new `'iceLog'` tab — `availableTabs` is still
  computed the same way each tab always was (Sessions: trainer or
  owner/superadmin; Series/Bundles: trainer only; Ice log: any ice-rink
  staff role), just rendered as one consistent menu instead of a mix of a
  button row and an unconditional panel underneath it.

None of this needed a `firestore.rules`/`firestore.indexes.json` change —
every permission check it relies on (`isTrainer`, `isOwnerOrSuperadmin`,
`isIceRinkStaff`) already existed from earlier phases; this pass only
changed which UI surfaces expose the same already-authorized actions.

## Branding assets
PWA/app icons (favicon, apple-touch-icon, icon-192/512, maskable 
variants) are derived from the club's official mascot graphic (cropped 
square, wordmark excluded — text doesn't read at icon sizes). Source 
lives outside the repo (was a one-off upload); regenerate by re-cropping 
a fresh square export from the club if the mascot art changes. Other 
clubs re-branding this codebase need their own icon set generated the 
same way — this isn't config-driven like colors are, since it's binary 
image assets, not a value.

## Multi-tenant / re-brand requirement
All club-specific data (name, logo, colors, zones, hours, contact, 
paymentsEnabled) in one config (Firestore `clubs` collection or config 
file). New customer deployment = config + env vars + new Vercel 
project, zero code changes.

The header (`App.tsx`) reflects this directly: the brand name shown next
to the logo is `club.name` from Firestore (not a translation string), and
a "Contact us" nav item (`src/components/ContactUsButton.tsx`), between
"Manage my booking" and the language switcher, opens a popup with
mailto/tel/website links plus the address from `club.contact.{email,
phone,address,website}` — each field only renders if actually set.
`Club.contact.website` is a plain string (e.g. `https://...`), opened in
a new tab as-is.

**Standing requirement — signed-in identity is always visible.** Whenever
a staff member is signed in, the shared header (`App.tsx`) shows their
name and role. This lives once in the shared header rather than
per-page, specifically so it automatically covers every current and
future admin page without each one needing its own copy of the same
display — do not remove or duplicate this per-page.

The header itself only ever holds the logo/brand, the language switcher,
and one `HeaderMenu.tsx` dropdown trigger — nav links (Trainings, Manage
my booking, Contact us) plus the signed-in identity all live inside that
dropdown instead of as separate header items, after the header got
visibly crowded once the training-reservations nav links landed
alongside the existing ones. The trigger itself shows the staff member's
name when signed in (so identity stays glanceable without opening the
menu — satisfies the requirement above on its own) or a plain menu icon
for a signed-out visitor; opening the dropdown additionally shows the
full "Meno · Rola" line (plus "+ Tréner" when `isTrainer` is also set).
Any future header-level nav item belongs inside `HeaderMenu.tsx`, not as
a new direct header child — that's the whole point of consolidating it.

Owners/superadmins edit the club's name and contact info themselves from
the admin dashboard's "Club settings" panel (`AdminClubSettingsPanel.tsx`,
`updateClubInfo` in `src/lib/club.ts`) rather than needing direct
Firestore access — same `isOwnerOrAbove` write rule as everything else
club-level. Since club data isn't shared/live state across the app (the
header, booking page, and admin dashboard each fetch their own copy on
mount via `useClubData`), saving triggers a full page reload so every
screen picks up the new values immediately.

## Product direction: this app is the integration hub
Superseded the original plan below — THIS app (not Arena-Srsnov) is now 
the core of the final product. `/` is a branded hub home screen (club 
logo, name, tagline) with cards linking to each club service:
- "Reserve Ice Rink" — this app's own booking flow, at `/book`, always 
  enabled
- "Training Reservations" — external link to the Arena-Srsnov training 
  app, from `clubs.integrations.trainingReservationsUrl`
- "Tournaments" — external link to a future tournament system, from 
  `clubs.integrations.tournamentsUrl`
Both integration URLs are optional on the `Club` config; unset shows 
the card as "coming soon" rather than a dead link. This keeps the 
integration config-driven and per-club, consistent with the 
multi-tenant requirement — no code changes needed once those URLs 
exist. Current assumption: integration is via external links out to 
separately-deployed apps, not a merged single codebase. Revisit if 
that assumption turns out wrong.

Superseded original plan (kept for history): Arena-Srsnov would own 
the production domain and link to this app instead, joined via 
Next.js/Vite Multi-Zone-style rewrites.

## First task
Do NOT write code yet. Inspect Arena-Srsnov and report: Firestore 
schema/collections, calendar/booking component structure, registration 
form patterns, email mechanism (provider/trigger/templates), Tailwind 
design tokens. Then propose a data model for: clubs, zones, timeSlots, 
bookings. Wait for confirmation before scaffolding.
