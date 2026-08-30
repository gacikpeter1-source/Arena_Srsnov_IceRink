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

**Password reset** is Firebase Auth's own hosted flow
(`sendPasswordResetEmail`, exposed as `AuthContext.resetPassword`) —
no custom email template or Cloud Function, unlike the rest of this
app's mail which goes through the `mail`-collection queue for content
this app actually controls. `AdminLoginPage.tsx`'s "Zabudli ste heslo?"
link swaps the password field for an email-only form; submitting always
shows the same confirmation message regardless of whether
`sendPasswordResetEmail` actually found an account for that address, so
the login page never reveals which emails are registered.

**Fixed: a fresh sign-in sometimes needed two attempts.**
`AuthContext`'s `loading` flag only ever flipped `false -> true` once,
on the very first `onAuthStateChanged` firing at page load. But that
same listener re-fires on every sign-in too, and its own `staff`-doc
`getDoc` is a real async gap — `user` is set immediately, `staff` only
once that read resolves. `AdminLoginPage.tsx` navigates to `/admin` as
soon as `login()`'s `signInWithEmailAndPassword` promise resolves,
which can land *inside* that gap: `ProtectedRoute` then sees
`loading: false, staff: null` (loading was already stuck false from
page load) and bounces straight back to `/admin/login` — a second
login attempt only "worked" because it happened to submit after the
`staff` fetch had already finished. Fixed by calling `setLoading(true)`
at the start of every `onAuthStateChanged` firing, not just relying on
its initial value, so `ProtectedRoute` correctly shows its loading state
through that gap instead of treating it as "signed in, no staff role."

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
  always rendered beneath it) became one `<select>` dropdown — since
  superseded by the ice-attendance split below, which pulled the ice log
  back out into its own page, so this dropdown now only ever covers
  Sessions/Series/Bundles.

None of this needed a `firestore.rules`/`firestore.indexes.json` change —
every permission check it relies on (`isTrainer`, `isOwnerOrSuperadmin`,
`isIceRinkStaff`) already existed from earlier phases; this pass only
changed which UI surfaces expose the same already-authorized actions.

**Ice attendance split into its own page.** `/admin/treningy`
(`TrainerDashboardPage.tsx`) had become a mixed bag: an owner explained
that landing on it first showed "Evidencia trénerov na ľade" for a plain
assistant, when the page's actual purpose is a trainer/owner/superadmin
manually creating trainings. The ice log/attendance concern moved to its
own route, `/admin/treningy/evidencia`
(`IceAttendancePage.tsx` + `AdminTrainerIceLogPanel.tsx`), reachable by
any ice-rink staff role (assistant/owner/superadmin) — `TrainerDashboardPage`
now redirects a plain assistant (isIceRinkStaff but neither a trainer nor
owner/superadmin) straight there via `<Navigate>`, since they have no
Sessions/Series/Bundles tab to land on otherwise; a trainer/owner/
superadmin still reaches it through a small "Evidencia na ľade" link next
to the existing "Späť na správu ľadovej plochy" button.

The new page adds a genuinely new feature on top of the pre-existing
private ice log (a trainer using ice with no booked session at all):
an **ice-attendance checklist** for that day's *scheduled* trainings — a
simple list (date picker + one row per session: time, trainer name, a
checkbox) letting an assistant/owner/superadmin confirm the assigned
trainer was actually physically present, independent of customer
attendance. This is deliberately NOT the same thing as a session's
existing `confirmedCount`/customer `attendance` — it's a new
`trainerPresentConfirmed?: boolean` field on `TrainingSession` (unset =
not yet confirmed either way, not "absent"), settable via
`setSessionTrainerPresence` (`lib/training.ts`) and a matching public
`firestore.rules` transition scoped to `isStaffMember()` and
`trainerPresentConfirmed` alone (mirrors the existing `confirmedCount`-
only public update rule's shape). Purely a payroll-support record — an
owner pulling the combined attendance report (see the Fáza 3 report
above) can now see a "Trainer Present" Yes/No column per planned
training alongside who was marked present and the private ice log, e.g.
to know what to actually pay a trainer for.

The pre-existing private-use log form (trainer name via datalist/free-
text, date, notes — unchanged) is no longer always rendered: a "Zápis
trénera na ľade" button sits right under the page header and toggles it
open, prefilling today's checklist date and the current local time (a
new optional `time` field on `TrainerIceLogEntry`) — logging is for a
trainer the assistant is seeing on the ice right now, not backfilling a
past date. The full log list and the Excel report generator underneath
stay owner/superadmin-only (`canViewLog`), unchanged from Fáza 3.

### Fáza 4: month/week/list calendar views

The public training calendar (`TrainingCalendarPage.tsx`, `/treningy`) was
a single flat 14-day list with no way to browse further out or see a
week at a glance — a customer asked specifically for a monthly overview
(highlighted days, click a day for its trainings), a weekly view (one
column per day), and to keep the existing list. All three now live
behind a view switcher, defaulting to month view:

- **Month** (`TrainingMonthCalendar.tsx`) — a standard Monday-first grid
  for the visible month; a day's number is highlighted
  (`bg-primary/20`) when it has at least one scheduled training, and
  clicking any day (highlighted or not) shows that day's trainings in a
  panel below the grid. Never shows "free ice" slots — there's no such
  concept in the training domain to begin with (unlike the ice-booking
  calendar), so this requirement was automatically satisfied by only
  ever rendering actual `TrainingSession` docs.
- **Week** (`TrainingWeekCalendar.tsx`) — seven columns, Monday first,
  each holding only that day's own trainings; a day with nothing planned
  is simply an empty column (horizontally scrollable on narrow screens,
  same `overflow-x-auto` pattern as the ice-booking `AvailabilityGrid`).
- **List** — unchanged, the original next-14-days card list.

`TrainingSessionCard.tsx` factors out the individual clickable training
card (trainer/bundle name, time, capacity badge) since all three views
render the same card, just in different containers. Month/week views
each manage their own navigation cursor (`monthCursor`/`weekCursor`) and
only fetch `fetchTrainingSessionsInRange` for their own visible
range — the list view keeps fetching the next 14 days as before — so
switching views triggers a fresh fetch scoped to whatever's actually on
screen rather than pre-loading everything. `getMonthStart`/`getMonthEnd`
(`lib/utils.ts`) join the existing `getWeekStart` for this.

## Tournaments
A quick-planning tool for a trainer/assistant/owner/superadmin to
schedule tournament matches — deliberately no bracket/results/standings
system yet, just a name (`Tournament`) plus a flat list of matches
(`TournamentMatch`), built at `/admin/turnaje`
(`TournamentsPage.tsx`) and reachable via `HeaderMenu.tsx`'s dropdown and
`AdminDashboardPage.tsx`, gated to the same three roles as training
management (`isTrainer`/assistant/owner/superadmin). Internal tool only
for this pass — no public schedule page yet (the hub's "Tournaments" card
still points at the external `tournamentsUrl` placeholder until one
exists).

**Variable format, reusing the existing zone system.** A trainer picks
how the rink is divided for a match's time slot — whole rink, half, or
third — reusing `DivisionMode` and the real `Zone` docs the ice-booking
domain already has, not a separate concept. Picking "third" shows one
team-pair row per third-zone (1, 2, or all 3 can be filled in — an empty
row is simply skipped), so "vo všetkých tretinách naraz" (all three
thirds at once) is just filling in all 3 rows, giving 3 independent
`TournamentMatch` docs sharing the same date/time/rink. `RinkDiagram.tsx`
(the same component/image `/book` uses) previews the chosen division,
highlighting whichever row currently has focus — reused as-is per an
explicit product request to keep the visual consistent with the
ice-booking flow rather than building a second diagram.

**Blocking real ice is a per-match choice, not automatic.** A tournament
might run entirely on the club's own ice, or on a different surface this
app doesn't manage a calendar for at all (a hokejbal/football pitch) —
so blocking is only offered when `location: 'rink'`, and even then is an
explicit checkbox (`blocksIce`). When checked, `createTournamentMatch`
(`lib/tournaments.ts`) calls the exact same `createBooking` transaction
customers/staff already use for ice bookings — the match's rink/zone/time
becomes a real `Booking` doc, atomically preventing a double-booking via
`/book`, and shows up in the admin bookings list/exports like any other
staff-created booking (booking `name` is set to `"{tournaments.bookingLabel}: 
{tournament name}"` so it reads clearly there). Left unchecked, the
match is purely a planning record — same principle as training sessions
never touching ice bookings — for when ice is secured outside the app or
the tournament is elsewhere (`location: 'other'`, a free-text venue name,
no zone/blocking concept applies at all). Deleting a match that blocked
ice cancels the underlying booking first (`deleteTournamentMatch`) so the
slot reopens; deleting a whole tournament cascades the same cleanup
across all its matches.

No new `firestore.indexes.json` entries needed — `tournaments`/
`tournamentMatches` are only ever queried by a single equality filter
(`clubId`/`tournamentId`), sorted client-side. `firestore.rules` gates
both collections to `isTrainer() || isStaffMember()` for
create/read, with update/delete narrowed to the creating trainer or any
ice-rink staff member (mirrors `trainingSessions`' existing pattern) —
the `blocksIce` booking write itself needs no new rule since `bookings`
creation is already fully public.

### Fáza A: team roster

A tournament schema/bracket system needs a settled team list to generate
matches from, so that's the first slice: `TournamentTeam` docs (name,
optional manual `seed` for later draw phases), added manually
(`TournamentTeamsPanel.tsx`, mounted under a selected tournament in
`TournamentsPage.tsx`) or via Excel import (`lib/excel.ts`'s
`parseTeamsWorkbook`/`downloadTeamImportTemplate`, one name per row —
same `{rows, errors}` shape as the existing booking/schedule importers).

Team names must be unique within a tournament (case-insensitive) since a
later phase auto-generates schedules/brackets by team identity, where a
silent duplicate would make the pairing ambiguous — enforced in
`createTournamentTeam` (`lib/tournaments.ts`), which re-fetches the
tournament's current teams and throws `DuplicateTeamNameError` rather
than silently creating a second team with the same name. The Excel
parser separately flags a name repeated *within the uploaded file itself*
(an obvious copy-paste mistake) before any writes happen; a name that
collides with an already-saved team is instead caught per-row when the
import loop calls `createTournamentTeam`, so one bad row doesn't abort
the rest of the import.

Access mirrors `tournaments`/`tournamentMatches`
(`isTrainer() || isStaffMember()`) but without the creator-only
restriction on update/delete — any trainer/staff who can see the
tournament can manage its roster, since a club tournament is typically a
shared effort across whoever's helping run it, unlike an individual
trainer's own training sessions. `deleteTournament` now also cascades to
delete a tournament's teams, alongside the existing match/booking
cleanup.

### Fáza B: round-robin schedule generation

The first schema: "každý s každým" — every team plays every other team
exactly once. `circleMethodRounds` (`lib/tournaments.ts`, internal) is
the standard circle-method pairing algorithm — one team fixed, the rest
rotate one position each round, producing `teams.length - 1` rounds of
`teams.length / 2` pairs; an odd team count is handled by padding with a
`null` "bye" slot that's simply dropped from that round's real pairs (the
team paired against it sits that round out).

**Rounds map directly onto the ice-division system.** A round's pairs
are, by construction, always disjoint (every team appears at most once
per round) — so any subset of them can safely run in parallel. This
lines up exactly with `DivisionMode`: picking "third" gives 3 parallel
zones, so a round with 3 pairs plays as one simultaneous time slot, one
pair per zone; a round with more pairs than available zones (e.g. 4 pairs
on a "third" format) spills into consecutive slots — `buildRoundRobinPreview`
chunks each round's pairs into groups of at most `matchesPerSlot`,
**never crossing a round boundary** (chunking across rounds could put two
pairs sharing a team into the same slot, which the round structure alone
doesn't protect against once you leave a single round).

**Live, pure preview before anything is written.** `buildRoundRobinPreview`
takes zero Firestore dependencies — team order, rink format, start
time, match duration, and break minutes go in, a full list of time slots
comes out — so `TournamentRoundRobinGenerator.tsx` recomputes it on every
keystroke via `useMemo` and lets the trainer freely try different rinks/
times/durations before committing. Only clicking "Generate" actually
calls `createRoundRobinSchedule`, which loops `createTournamentMatch`
per pair (inheriting its existing `blocksIce` behavior — one real
`Booking` per match when checked, same as a manually-added match).

**Breaks: one default, individually overridable.** The trainer sets one
`defaultBreakMinutes` applied between every generated slot, but each gap
in the live preview has its own editable input (`gapOverrides`, keyed by
slot index) — e.g. stretching just the gap after the morning session to
fit a lunch break, without changing the default for every other gap.

**Seeding order is cosmetic for round-robin itself** (everyone plays
everyone regardless of starting order) but the trainer can still shuffle
randomly or reorder manually (up/down arrows — no drag-and-drop
dependency) via `TournamentRoundRobinGenerator.tsx`, and the chosen order
is persisted onto each `TournamentTeam.seed` (`setTeamSeedOrder`) so a
later phase's bracket seeding — where order *does* determine who plays
whom — starts from the same order rather than from scratch.

Two new fields on `TournamentMatch` support this and later phases:
`teamAId`/`teamBId` (set only for a roster-generated match; a manually
free-typed match from Fáza 1's single-match form leaves them unset) and
`round` (which generated slot a match belongs to — display/grouping only
so far, no advancement logic reads it yet).

### Fáza C: knockout bracket with bye/seeding and auto-advancement

Single elimination ("pavúk"). `buildKnockoutPreview` (`lib/tournaments.ts`)
builds the whole bracket — every round, not just the first — as a pure,
Firestore-free computation the UI recomputes live, same pattern as
`buildRoundRobinPreview`:

- **Bracket size and byes.** `bracketSize` is the next power of 2 ≥ team
  count; the shortfall (`bracketSize - teams.length`) becomes byes, given
  to the top seeds first — the standard convention (NCAA, FIFA, IOC) since
  distributing byes randomly would undermine the whole point of seeding.
  This falls out for free from pairing the seed order 1-for-1 against the
  team list: a seed number beyond the team count simply has no real team.
- **Seeding order** uses the standard recursive-doubling bracket sequence
  (1v16, 8v9, 5v12, 4v13, ... for 16) so seed 1 and seed 2 can only meet
  in the final, never clustering strong teams into the same early match.
- **Byes resolve immediately at generation time**, propagating the sole
  real team straight into the next round's slot — no real match is ever
  created for a bye (no time, no zone, no booking), just a `winnerTeamId`
  set directly on its own doc.
- **Every round gets real times up front**, not just the first — a
  semifinal/final slot is scheduled even though the actual teams aren't
  known yet, so the trainer has one complete running schedule for the
  whole day. A not-yet-decided slot's `teamA`/`teamB` display string is a
  baked-in placeholder ("Winner of Match #N") resolved by the *caller* at
  generation time (`resolvePlaceholder`) since `lib/tournaments.ts` stays
  i18n-free — same principle as `TournamentMatch.teamA/teamB` always
  being plain persisted strings, not live-translated UI text.
- **Auto-advancement.** Every match (except the final) gets a
  `nextMatchId`/`nextMatchSlot` pointer at generation time, computed from
  pre-generated Firestore doc refs so the whole bracket's linkage can be
  wired before any document is actually written. `setTournamentMatchResult`
  records a score and, if the match has a `nextMatchId`, writes the
  winner straight into that match's slot — the only way a later round's
  placeholder ever gets replaced with a real team. A draw is rejected
  (`KnockoutDrawError`) since there'd be no way to decide who advances.

**`firestore.rules` broadened**: `tournamentMatches`' `allow update` no
longer requires being the bracket's creator — recording a live result
(and its auto-advancement write into a *different* match's doc) is
inherently a "whoever's at the rink with a phone" action, same
collaborative reasoning `tournamentTeams` already uses. `allow delete`
stays creator-restricted so one trainer can't casually wipe another's
bracket.

`TournamentKnockoutGenerator.tsx` shows the same config-and-preview form
as the round-robin generator before anything's been generated, then
switches to a live bracket view (grouped by round, score-entry inputs on
any match where both teams are known and no result is recorded yet) once
matches exist. A new `TournamentMatch.schema` field (`'roundRobin' |
'knockout'`) — also now stamped by `createRoundRobinSchedule` — lets a
future combined format (Fáza D) tell its group-stage matches apart from
its playoff bracket without a second collection.

### Fáza D: groups + play-off

The third schema (`TournamentMatch.schema === 'groups'` for the group
stage, `'groupsPlayoff'` for the bracket that follows) — teams are split
into lettered groups ("A", "B", ...), each group plays a full
round-robin among only its own members, then the trainer chooses how
many teams advance from each group into a knockout bracket built from
live standings. `TournamentGroupsGenerator.tsx` mounts alongside the
round-robin/knockout generators on `TournamentsPage.tsx` and manages both
stages itself, matching the existing "one component covers pre- and
post-generation" pattern `TournamentKnockoutGenerator.tsx` already used.

**Group assignment, both ways per the trainer's request.** A new
`TournamentTeam.groupId` field (set via `setTeamGroups`, same "only
written at generation time" timing `setTeamSeedOrder` already uses)
records which group a team lands in. "Automaticky rozdeliť do skupín"
snake-distributes the current team order across `groupCount` groups
(1→A, 2→B, 3→C, 4→C, 5→B, 6→A for 3 groups) so consecutive seeds don't
all land in one group; each team also gets its own `<select>` right next
to its name so the trainer can manually override any individual
assignment afterward — auto-assign is a starting point, not a
constraint.

**Scheduling interleaves groups instead of running them one after
another.** `buildGroupsPreview` (`lib/tournaments.ts`) computes each
group's own `circleMethodRounds` schedule independently, then combines
round *r* across every group into one shared time band before chunking
into zone-slots — safe to combine arbitrarily because groups partition
the teams, so two pairs from *different* groups can never share a player
the way two pairs from the same round-robin's *own* different rounds
could. This is what lets a 3-team group and a 5-team group run
alongside each other without leaving a zone idle just because the
smaller group finished its own rounds first. `createGroupsSchedule`
writes the result exactly like `createRoundRobinSchedule` does, just
tagging each match with its `groupId`.

**Draws are allowed in the group stage, unlike a knockout match.**
`setGroupMatchResult` records `scoreA`/`scoreB` with no draw check and no
`nextMatchId` advancement — group standings have a points column for
exactly this outcome. `computeGroupStandings` (pure, `lib/
tournaments.ts`) is the standard 3/1/0 win/draw/loss points table sorted
by points → goal difference → goals scored → name, computed live from
whatever results exist so far (an in-progress group's table is simply
partial, not blocked from rendering).

**The play-off is generated from standings, not the raw roster.** The
trainer picks how many teams advance per group ("Postupujú prví N z
každej skupiny"); the advancing list is ordered rank-first (every
group's 1st-place team, then every group's 2nd-place team, ...,
alphabetically by group within each rank) and fed straight into the
*same* `buildKnockoutPreview`/`createKnockoutBracket` Fáza C already
built — the only new thing is an optional `schema` parameter on
`createKnockoutBracket` (defaults to `'knockout'`) so this bracket is
written as `'groupsPlayoff'` instead, keeping it out of the standalone
"pavúk" generator's own match list even though both produce an
identical bracket shape. This rank-first ordering keeps group winners
spread across the bracket (seed 1 and seed 2 still can't meet before the
final) but doesn't *guarantee* two teams from the same group avoid a
rematch in the first round for an arbitrary number of groups — a known,
documented simplification rather than a full anti-collision seeding
algorithm, consistent with how much precision the rest of this
tool aims for.

Recording a play-off result reuses `setTournamentMatchResult` as-is
(draws rejected, auto-advances the winner via `nextMatchId`) — the
bracket-rendering JSX itself was extracted into a shared
`TournamentBracketView.tsx` component so `TournamentKnockoutGenerator.tsx`
(the standalone bracket) and this groups+play-off bracket don't carry two
copies of the same round-grouped, score-entry-row markup.

No `firestore.rules`/`firestore.indexes.json` changes were needed — the
existing `tournamentMatches`/`tournamentTeams` rules already allow any
`isTrainer() || isStaffMember()` to create/read/update regardless of
`schema` or the new `groupId` field.

### Public schedule page (`/turnaje`)

The last missing piece from the phases above — a no-login page
(`TournamentSchedulePage.tsx`) so customers/parents can actually see a
club's tournaments, not just staff planning them. A tournament picker
(hidden when there's only one) switches which tournament's matches load;
below it, up to three sections render depending on what that tournament
actually contains:
- **Group standings** (any `schema === 'groups'` matches) — the same
  3/1/0 points table `computeGroupStandings` already produces for the
  admin tool, plus each group's own match list (score shown once
  recorded, "ešte sa nehralo" otherwise).
- **Play-off / knockout bracket** (`'groupsPlayoff'` and/or `'knockout'`
  matches, shown as separate sections since a tournament could in theory
  carry both) — `TournamentBracketView` reused as-is with a new
  `readOnly` prop that hides the score-entry row entirely (no login, no
  way to record a result here).
- **Everything else** (a manually-added match, or a standalone
  `'roundRobin'` schedule) — the same flat chronological list format the
  admin match list already uses.

Deliberately fetches **only** `tournaments` and `tournamentMatches` — no
`TournamentTeam` read at all. Every value the page needs (team names,
`teamAId`/`teamBId` for standings, bracket shape) is already denormalized
onto each `TournamentMatch` doc, so `firestore.rules` only had to open
`allow read: if true` on those two collections; `tournamentTeams` stays
staff-only exactly as before. Every write rule on both is unchanged
(still `isTrainer() || isStaffMember()`), so nothing about who can
create/edit a tournament changed — only who can look at the result.

With a real public page now live, the hub home's "Tournaments" card
(`HubHomePage.tsx`) stops falling back to the never-configured external
`tournamentsUrl` placeholder for a signed-out/role-less visitor and
routes internally to `/turnaje` instead — the exact same "external
placeholder superseded once the domain got a real page" transition
Training Reservations went through earlier. `HeaderMenu.tsx` gained a
plain public "Turnaje" link (`nav.tournaments`) right next to the
existing "Tréningy" one, and the old single tournaments nav key
(previously doing double duty as the only tournaments link there was)
was renamed `nav.manageTournaments` → "Spravovať turnaje" to make room
for it, matching the existing "Tréningy" / "Spravovať tréningy" pairing.

### Live scoreboard (match-day control + spectator screen)

A club asked to put a tournament's live state up on a screen (a cafe TV,
or a phone via the QR code above) — which zone/group is playing, the
live score, and where every team stands — updated by whichever
trainer/assistant/owner is scoring at rinkside. Two pieces:

**`TournamentMatch.status`** (`'scheduled' | 'live' | 'finished'`,
unset ~ `'scheduled'`) is new, alongside two schema-neutral writers in
`lib/tournaments.ts`: `setMatchStatus` (a plain status flip, used to mark
a match started) and `updateLiveMatchScore` (a raw `scoreA`/`scoreB`
write with **no** draw check, no `winnerTeamId`, no auto-advance) — so a
knockout match can sit at a tied score while still in progress without
tripping the knockout-can't-draw rule that only applies to a *final*
result. `setTournamentMatchResult`/`setPlainMatchResult` (the latter a
newly-extracted, schema-neutral twin of the group-stage writer
`setGroupMatchResult` now delegates to) are unchanged in what they
validate, but now also stamp `status: 'finished'` — they remain the
*only* way a match becomes finished, and calling either again afterward
is how a correction is made: "skóre sa dá upraviť aj po ukončení zápasu"
means re-running the same finalize path, which for a knockout/play-off
match also re-derives the winner and re-writes `nextMatchId`'s slot if
the correction flips who advanced. `deriveMatchState` is the one place
that reads `status` back out, tolerant of every match that predates this
field: a match with a real recorded score reads as `'finished'` even
though `status` was never written for it (the old one-shot "Uložiť
výsledok" flow, or a resolved bye), so nothing already shipped needed a
migration.

**`TournamentLiveControlPanel.tsx`** (mounted on `TournamentsPage.tsx`,
above the three schedule-generator panels) is the match-day control
room — every real match (byes excluded) grouped into "Práve sa hrá" /
"Nadchádzajúce" / "Dokončené" via `deriveMatchState`, each row showing a
"Odštartovať zápas" button while scheduled, then a +/- stepper per team
plus "Ukončiť zápas" once live, with the stepper staying live even after
finishing (any click routes through the finalize path so post-finish
corrections keep advancing the bracket correctly, as above). It
deliberately does **not** replace the pre-existing one-shot score entry
already built into `TournamentBracketView`/`TournamentGroupsGenerator` —
those stay a valid, simpler way to log a final score with no live
theatrics; this panel is purely for the scoreboard workflow. Polling
(every 5s, via a plain `setInterval` — this app has no real-time listener
anywhere, and introducing `onSnapshot` for just this one screen wasn't
worth breaking that consistency) keeps a second staff member's device and
the spectator screen elsewhere roughly in sync without a manual refresh.

**The public `/turnaje` page now polls too** (every 6s) instead of
fetching once, and gained a "Práve sa hrá" section pinned above
everything else — team names and a large pulsing live score for every
`'live'` match — plus small inline live badges wherever a match already
appears in the group match list or the flat "other matches" list.
`TournamentBracketView` grew the same live badge for an undecided bracket
match with `status === 'live'`, shared by both the admin's own bracket
views and the public read-only one. `?tournament=<id>` (matching this
app's established "one route, query params pick the case" QR pattern —
see the "QR codes" section) lets the admin's QR code jump straight past
the tournament picker into one specific tournament, so pointing a phone
or a mounted screen at the code needs no further taps.

**Admin tournament pages split into landing/create/detail routes.**
`/admin/turnaje` originally mixed a "create a tournament" form, a picker
(one small button per tournament), and — inline, below the picker —
every tool for whichever tournament happened to be selected (teams,
generators, live control, QR, manual match list). An owner testing this
found it confusing once a real tournament existed: the page read as
"create tournament, plus a stray button named after my one tournament"
rather than a clear list. Split into three routes, same pattern as
tréningy's own admin/public split elsewhere in this file:
- `/admin/turnaje` (`TournamentsPage.tsx`) — just a "Vytvoriť turnaj"
  button and a plain list of existing tournaments as full-width rows;
  clicking one navigates into it.
- `/admin/turnaje/novy` (`TournamentCreatePage.tsx`) — the name-entry
  form; submitting creates the tournament and navigates straight into
  its own detail page.
- `/admin/turnaje/:tournamentId` (`TournamentDetailPage.tsx`) — every
  tool that used to render inline (QR/live-control/teams/generators/
  manual match form+list), now reading the tournament from the route
  param via a new single-doc `fetchTournament` (`lib/tournaments.ts`)
  instead of finding it in an already-fetched list. Also gained a plain
  "Otvoriť obrazovku pre divákov" link next to the QR code, so staff can
  jump straight to the same read-only `/turnaje?tournament=<id>` view
  from their own device without scanning their own QR code.

**Spectator screen redesign: real standings/bracket, not just a live
ticker.** An owner using the screen in a cafe asked for the actual
tournament shape to be visible, not only whichever match happens to be
live. `TournamentSchedulePage.tsx` (`/turnaje`) now has three distinct
pieces instead of one flat "live now" card:
- **"Kto hrá a kto nasleduje"** — a compact overview pinned at the top:
  every live match with its live score, then the next several upcoming
  matches (any schema) with their scheduled time — the "what's on right
  now" answer the old live-only section gave, generalized to also answer
  "what's coming up".
- **Group standings as a responsive grid of per-group tables** — one card
  per group, `sm:grid-cols-2 xl:grid-cols-3` so groups sit side by side
  and wrap onto additional rows once they don't fit (per an explicit "2
  vedľa seba, ďalšie pod to" layout request), each showing just
  Tím/Zápasy/Odohraté/Skóre/Body — a simpler column set than the admin's
  own richer W/D/L breakdown in `TournamentGroupsGenerator.tsx`, which
  keeps its detailed table unchanged. `GroupStandingRow` gained a
  `totalMatches` field (every match a team has *scheduled* in the group,
  decided or not) precisely to support the new "Zápasy" (total) column,
  which reads differently from the existing "Odohraté" (played-so-far)
  one especially mid-tournament.
- **`TournamentBracketDiagram.tsx`** (new) — a real column-per-round
  bracket tree for knockout/play-off matches, replacing the flat
  round-grouped list `TournamentBracketView` still uses for the admin
  side (that component stays as-is; its editable score inputs are still
  the admin's day-to-day tool). Each round's boxes are spread with
  `justify-around` across a column height fixed to the *first* round's
  box count — since round *r* always has exactly half as many matches as
  round *r-1*, this naturally centers each later box roughly between the
  two it was fed by, close enough to the familiar converging bracket
  shape without computing actual SVG connector lines. Round labels use
  the standard elimination-tournament names (Finále/Semifinále/
  Štvrťfinále/Osemfinále, counted back from the last round) instead of
  the generic "Kolo N" the admin bracket view uses, since a spectator
  screen benefits from the familiar names more.

**Configurable points-for-win.** `Tournament.pointsForWin` (default 3,
set once at creation in `TournamentCreatePage.tsx`) replaces the
previously-hardcoded 3 in `computeGroupStandings` — draw/loss stay the
standard 1/0 regardless, only the win value varies. Passed down from
`TournamentDetailPage.tsx` into `TournamentGroupsGenerator.tsx` and read
directly off the fetched `Tournament` doc on the public schedule page, so
both surfaces always score a group the same way. `computeGroupStandings`'s
tie-break order also changed to match an explicit request: points, then
goal difference ("skóre"), then *fewest* matches played (a team that
reached the same points/difference in fewer games is ranked ahead,
rewarding efficiency over one that needed more games), then name as a
final fallback.

**Same-tab spectator-screen link, role-aware back fallback.** The
"Otvoriť obrazovku pre divákov" link on `TournamentDetailPage.tsx` was
originally `target="_blank"`, which meant `/turnaje`'s `BackButton` had
no real session history to return to (a new tab always starts at history
index 0) and fell through to its fixed fallback regardless — landing an
owner back on the public hub home instead of the admin tournament they'd
just come from. Switched to a same-tab `Link` so `navigate(-1)` actually
works for that case, and separately made the fallback itself role-aware:
staff with tournament-management access (the same check
`TournamentsPage.tsx` gates on) fall back to `/admin/turnaje` instead of
`/` if they land on `/turnaje` with no history at all (e.g. a bookmarked
link), while a genuine public visitor still falls back to the hub home.

**Round-robin tournaments get a standings table too.** The redesign above
initially only rendered a standings table for `schema === 'groups'`
matches — a plain "každý s každým" tournament (`schema === 'roundRobin'`,
no groups at all) got no table whatsoever, just the flat match list,
which an owner running exactly that format flagged as a missing table
rather than a deliberate omission. Fixed by computing one combined
standings table (`computeGroupStandings` over every `roundRobinMatches`
doc, same as a single group would) and rendering it above the groups
grid — the two sections are mutually exclusive in practice (a tournament
uses one schema at a time) but nothing stops both from rendering if a
club mixed formats. The flat "Iné zápasy" list is now restricted to
matches with no schema at all (a manually free-typed match, which has no
team ids to build a standings row from in the first place).

**Tournament system chosen once at creation, not left implicit.** An
owner found the original "create with just a name" flow confusing:
landing straight on a page showing all three schedule generators (round-
robin, knockout, groups) at once, plus teams/live-control/QR, looked like
more setup was still pending rather than a tournament that already
existed — there was no single moment that clearly said "this is now a
real tournament." Fixed by adding `Tournament.format` (`'roundRobin' |
'knockout' | 'groups'`), chosen via a radio-card picker (not a bare
`<select>`, so the chosen option's own description stays visible and the
other two visibly dim rather than needing a separate details panel) on
`TournamentCreatePage.tsx` — name, points-for-win, and format all live on
that one screen, ending in the single "Vytvoriť turnaj" button that
actually creates the document. `TournamentDetailPage.tsx` then renders
**only** the one matching generator instead of all three, with the
chosen system's label shown right under the tournament name so it's
never ambiguous which one is active. A tournament created before this
field existed has no `format` at all — those still show every generator,
matching the app's behavior before this change, since there's no way to
retroactively know which one the trainer meant.

**Standings table and bracket diagram redesigned for a "more modern,
clearer" look.** The plain HTML `<table>` standings became
`TournamentStandingsTable.tsx` — a shared ranked-row card (numbered rank
column with a cosmetic gold/silver/bronze tint for the top 3, points as a
filled pill instead of a bare number) reused by both the round-robin
single table and every group's own card in the grid. `TournamentBracketDiagram.tsx`
got matching polish: rounded match boxes with a left accent border and
tinted background on the winning row, the score itself in a small pill,
a dashed border for byes, and a pulsing ring around a live match's whole
box (not just its score line) so it stands out at a glance across a
crowded bracket.

**A tournament's schedule can now span more than one physical rink at
once.** All three generators (round-robin, knockout, groups' own
group-stage AND play-off pickers) switched their rink `<select>` to a
checkbox list — any subset of the club's active rinks — since this club
runs two ("Main Hall"/"Small Hall", see the "Multiple rinks" section).
Picking e.g. "half" ice on both rinks gives 4 simultaneous zones instead
of 2, exactly like combining zones on a single rink already did.

This needed a real signature change, not just a UI tweak:
`CreateRoundRobinScheduleInput`/`CreateKnockoutBracketInput`/
`CreateGroupsScheduleInput` (`lib/tournaments.ts`) previously took one
shared `rinkId` plus a `zoneIds` array, silently assuming every zone
belonged to that one rink — which stops being true once zones can come
from different rinks. They now take `slotLocations:
{rinkId, zoneId}[]`, built by the UI as `zonesForSelection.flatMap(...)`
across every checked rink (rink first, then that rink's own zones in
`slotIndex` order) so `slotLocations[i]` always names the right rink for
`preview`'s `i`-th parallel pair. The pure preview functions
(`buildRoundRobinPreview`/`buildKnockoutPreview`/`buildGroupsPreview`)
didn't need to change at all — they only ever dealt with an abstract
"how many parallel slots" count, never which rink a slot belongs to, so
rink resolution stays entirely a write-time (and display-time) concern.

**Every match now shows which rink/zone it's on, not just staff-side
tools that already did.** `TournamentBracketView` (admin) and the new
`TournamentBracketDiagram` (public) both gained required `rinks`/`zones`
props for exactly this. The public `/turnaje` page's round-robin and
per-group sections went from showing only the aggregate standings table
back to also listing each individual match (with its rink) underneath —
an unintended regression from the "modernize the visuals" pass that
this restores, since a spectator screen needs to say not just who's
winning but where to find the actual game.

**"My team" filter on the public spectator screen.** A `<select>`
(`TournamentSchedulePage.tsx`, right below the tournament picker, only
rendered once at least one match carries a team id) lets a no-login
visitor narrow the screen to one team — built from `matches` themselves
(id → name, deduped) rather than a `TournamentTeam` fetch, same reason
the rest of this page already avoids that collection (stays staff-only).
The filter **removes** non-matching rows from the flat match lists — live/
upcoming in "Kto hrá a kto nasleduje", the per-match list under each
standings table/group, and the schema-less "Iné zápasy" list (matched by
team *name* there, since a manually-added match has no team ids at all)
— but only **highlights**, never removes, a team's row in
`TournamentStandingsTable` (new optional `highlightTeamId` prop — gold
left-border + bold name) or its box in `TournamentBracketDiagram` (new
same-named prop — a gold ring around the match box, gold text on that
team's own line even before the match is decided): a standing's rank
only means something next to the rest of the table, and removing bracket
boxes would break the bracket's own tree shape. The selection is
remembered in `localStorage` per tournament ID
(`turnaje-favorite-team:<id>`) so a spectator revisiting the same
screen/QR code doesn't have to re-pick their team — never sent anywhere,
purely a client-side view filter over data that's already public.

**TV/spectator dashboard: a dedicated one-screen, no-scroll layout.**
An owner sketched what they actually wanted on an unattended cafe/lobby
screen — tournament name banner, group standings tables side by side,
a "who's playing now" strip, and "what's next" + a QR code in one bottom
row — with an explicit "no scrolling allowed... adaptive to screen size"
requirement. This is a real second layout, not a CSS tweak of the
existing scrollable page, so it's a new render branch in
`TournamentSchedulePage.tsx` gated on `?display=tv` (added to the same
`/turnaje` route, matching this app's "one route, query params pick the
case" QR pattern) rather than a new route — `App.tsx` detects this exact
path+param and skips the shared header/footer chrome entirely (no back
button, no language switcher, nothing clickable — this screen is meant
to be looked at, not touched) and gives `<main>` the full viewport
height.

Two content decisions came directly from the requester, not assumed:
- **Upcoming games is capped to the next 1–3 matches only** — explicitly
  not a full day/week list, unlike the regular page's up-to-8-match
  strip (`upcomingMatches`; `tvUpcomingMatches` is a fresh `.slice(0, 3)`
  of the same computed list, kept separate rather than lowering the
  shared constant since the phone-friendly view still wants more).
- **A knockout/play-off main panel skips the upcoming strip entirely** —
  the bracket already encodes "what's next" via its "Víťaz zápasu #N"
  placeholder slots, so repeating it as a separate list would be
  redundant. `tvMainPanelKind` picks one "main overview" panel per
  tournament state (bracket takes priority if any exists — a groups
  tournament that's reached play-off shows the bracket, not the now-
  historical group tables; otherwise groups, otherwise the round-robin
  table) — never more than one at a time, since showing two large panels
  at once couldn't fit one screen anyway.

**Guaranteeing "never scrolls, adapts to screen size" for content whose
size varies per club** (2 groups vs. 6, a 4-team bracket vs. 16) can't be
done with breakpoints/`clamp()` alone — there's no fixed content amount
to design breakpoints around. `ScaleToFit.tsx` (new, reusable) solves
this by rendering children at their natural size in an off-flow inner
div, measuring that real size with a `ResizeObserver`, and applying a
single `transform: scale()` (capped at `maxScale`, default 2.5) so the
whole block always fits its container — shrinking dense content down,
but also scaling sparse content *up* to fill the screen rather than
sitting small in a corner, same as a broadcast scoreboard graphic would.
It wraps the main panel (whichever kind), the live-matches strip, and
the upcoming-matches list independently — each guaranteed to fit its own
allotted region of the fixed `flex-col` layout (header/main/live/bottom
rows sized in `vh` units) with zero scrollbars regardless of tournament
size. The existing `TournamentBracketDiagram` needed no changes to work
inside it — its own internal `overflow-x-auto` never engages once its
natural (unscrolled) width is what gets measured and scaled.

The TV board reuses `TournamentBracketDiagram` as-is (bracket) but has
its own compact standings table (`renderTvStandings`, local to
`TournamentSchedulePage.tsx`) rather than the public
`TournamentStandingsTable` used elsewhere on this page — a big screen has
room for the fuller Team/P/W/D/L/Score/Pts breakdown (same columns and
translation keys as the admin's own richer table in
`TournamentGroupsGenerator.tsx`) instead of the phone-oriented
Team/Matches/Played/Score/Pts layout. The "my team" highlight
(`favoriteTeamId`) still applies to it, though the TV board renders no
`<select>` of its own — there's no one at the screen to operate one; the
filter only ever gets set by a spectator on their own phone via the
plain (non-`display=tv`) page, so this state is effectively unused on a
real TV, which is fine, not designed against.

A **second QR code** on `TournamentDetailPage.tsx`
(`?tournament=<id>&display=tv`), separate from the existing plain
spectator-screen QR, lets staff point a screen straight at the TV layout
without hand-typing the query param — the existing QR still targets the
regular scrollable page, since a customer/parent scanning it with their
own phone wants the normal interactive view, not a fixed dashboard sized
for a TV.

**Row proportions tuned after a real landscape-phone test.** The initial
`9vh`/`17vh`/`19vh` header/live/bottom split looked fine on a genuine
large TV (1920×1080) but left the live-matches and upcoming-matches rows
only ~70-80px tall on a shorter landscape viewport (e.g. a phone turned
sideways, ~400-430px tall) — `ScaleToFit` still guaranteed no overflow,
but shrank team names down to near-illegibility to fit that little
absolute space, while the main standings/bracket panel (with far more
headroom to begin with) still looked fine, making the mismatch obvious.
Bumped live to `22vh` and the bottom row to `26vh` (main panel still gets
whatever's left via `flex-1`, so a large tournament's bracket/groups grid
is unaffected) and increased the live/upcoming text one Tailwind step —
verified via the same local-harness-plus-Playwright-screenshot technique
across 1920×1080 down to 844×390, including a live (no-reload) resize
between two sizes to confirm `ScaleToFit`'s `ResizeObserver` actually
re-scales on its own rather than needing a fresh mount.

The QR corner previously sized itself via `flex-1 min-h-0 aspect-square`
— filling however tall its row happened to be, so it visually dominated
whenever the neighboring upcoming-matches panel was sparse (few or no
rows). Switched to a fixed `clamp(120px, 16vh, 220px)` box with the QR
image itself capped at `clamp(100px, 14vh, 190px)`, so it stays a
proportionate corner element regardless of what row height it's given or
how much text sits next to it.

### Bulk match-schedule import for an "away" tournament

A club's own team often travels to play in a tournament someone else
organizes — arriving as a printed poster/table with dozens of matches at
fixed times, not something anyone here generated. Typing each one
through the one-at-a-time "Add match" form doesn't scale to a real
20-30-match schedule, so `TournamentMatchImportPanel.tsx` (mounted on
`TournamentDetailPage.tsx`, right above the manual form) reads a whole
workbook at once via a new `parseTournamentMatchesWorkbook`/
`downloadTournamentMatchImportTemplate` pair in `lib/excel.ts`. Columns:
Date, Start Time, Duration (min), Group, Team A, Team B, Label (the last
only meaningful for a blank-Group placement row — see below).

Deliberately scoped to `location: 'other'` only — a single venue name is
entered once in the panel (not per row) and every imported match is
written with `blocksIce: false`, since an on-ice tournament already has
the round-robin/knockout/groups generators plus a rink/zone-aware manual
form; this import isn't meant to replace those.

**A blank Group cell is a deliberate signal, not a validation error.**
A real tournament poster like this mixes two kinds of rows: group-stage
matches with real, already-known teams, and placement/play-off rows
scheduled *before* the group stage finishes (e.g. "o 9.-10. miesto,
A5-B5") whose "teams" are just rank placeholders, not real teams yet.
The importer tells these apart purely by whether Group is filled in:
- **Group set** → both team names are resolved against the tournament's
  `tournamentTeams` roster (created on first sight, matched by name on
  every later row/import), assigned that `groupId` via the existing
  `setTeamGroups`, and the match is tagged `schema: 'groups'` — exactly
  what `computeGroupStandings`/the public `/turnaje` standings table
  already expect, so the live table works immediately with no extra
  step.
- **Group blank** → `teamAId`/`teamBId` are left unset entirely; the
  literal cell text ("A5", "W:SF1", ...) is stored as-is on `teamA`/
  `teamB` as a fallback, and isn't linked to any bracket-advancement
  logic or fed into a standings table.

**A blank-Group cell's text can be a placeholder code, resolved live —
not just inert text staff have to replace by hand.** This app has no
generic classification-bracket generator (`buildKnockoutPreview`/
`createKnockoutBracket` only ever build a single-elimination bracket
among teams that already advanced), but a real poster's placement rows
("o 9.-10. miesto A5-B5", finals referencing semifinal winners) don't
need one *generated* — they just need their two "teams" filled in once
the answer exists. `TournamentMatch.teamAPlaceholder`/`teamBPlaceholder`
(`MatchTeamPlaceholder` in `types/index.ts`) capture that intent per
side:
- `{ kind: 'groupRank', groupId, rank }` — "whoever currently holds rank
  N in group X" — parsed from a cell like `"A5"` (letters = group id,
  trailing digits = 1-based rank).
- `{ kind: 'winnerOf' | 'loserOf', label }` — the winner/loser of another
  match *in this same tournament* carrying that `label` — parsed from
  `"W:label"` / `"L:label"` (case-insensitive). A row sets its own
  `label` (e.g. "SF1") via the import's Label column so later rows can
  reference it.
- Anything else in a blank-Group cell is left as plain literal text —
  parseTeamPlaceholder simply doesn't match it, so no placeholder is
  attached and it always displays exactly as typed.

`lib/tournaments.ts`'s `resolveMatchPlaceholder`/`withResolvedPlaceholders`
do the actual live substitution, reading whichever group's *current*
standings (via the same `computeGroupStandings` the live table already
computes — so a `groupRank` placeholder can show a provisional occupant
before the group is even finished, same "read whatever result data
exists so far" stance the rest of this app's standings/brackets already
take) or another labeled match's own recorded score (a genuine tie
between the referenced sides is left unresolved — there's no winner to
report). Deliberately **display-only**: it never writes a resolved name
back to Firestore, never invents a `teamAId`/`teamBId` for a resolved
side, and is applied by `TournamentSchedulePage.tsx` (both the regular
scrollable view and the TV dashboard, which shares its derived data)
over a `displayMatches` array built once and reused everywhere `matches`
would otherwise have been read directly — a match with no placeholder
passes through completely unchanged. The admin's own
`TournamentLiveControlPanel.tsx` still shows the raw stored text (e.g.
"A5") rather than resolving it live — a smaller, standalone view that
doesn't already compute group standings the way the public page does;
left as a known gap rather than duplicating that computation there for
this pass.

Verified end-to-end with standalone esbuild-bundled scripts (one for
`lib/excel.ts`'s parser, one for `lib/tournaments.ts`'s resolution
functions) fed data shaped like a real poster: a Group-tagged row parses
with its `groupId`; a blank-Group row recognizes `"A5"`/`"W:SF1"`/
`"L:SF1"` as placeholders (and anything else as plain text); a row
missing a team name reports as a row-numbered error; `groupRank`
resolves to the correct current standings row (and `null` past the end
of the table); `winnerOf`/`loserOf` resolves correctly in both
directions and stays `null` for a drawn or unplayed referenced match;
and `withResolvedPlaceholders` substitutes only the sides that *can*
currently resolve, leaving the other side's literal fallback text
in place.

**A regular visitor can toggle the same TV/spectator dashboard on their
own phone**, not just staff pointing an actual TV at it — a small "View
as screen" link on the regular scrollable `/turnaje` page (next to the
`<h1>`) navigates to the exact same `?display=tv` URL used for a real
kiosk. Since `App.tsx` already strips the header/back-button chrome for
that mode (see the earlier TV dashboard note), a way back is added
*inside* the TV layout itself: a small "Standard view" link sits in the
header banner next to the tournament name. It's harmless on a genuine
wall-mounted TV (nobody's there to tap it) but gives a phone visitor an
escape hatch. This link sits in normal flex flow (`shrink-0` next to the
title, not absolutely positioned) — an earlier version centered the
title with an absolutely-positioned corner link, which overlapped a long
tournament name on a narrow phone; the fix costs a perfectly-centered
title on a wide screen, the smaller trade-off of the two, verified via
the same local-harness-plus-Playwright-screenshot technique at both a
375px phone width and 1920px.

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

## Subscription / paid add-on modules
Once this app is resold to other clubs (see the multi-tenant section
above), the operator needs a way to charge separately for the bigger
domains built on top of the always-free core booking product, and to
switch them on/off per club without a code change. `Club.entitlements`
(`ClubEntitlement` in `types/index.ts`, `lib/entitlements.ts`) is a small
per-module on/off map — `treningy` (training reservations) and `turnaje`
(tournaments) are the two gate-able modules today; ice-rink booking
itself is the always-on core and isn't gated at all.

**Manual now, Stripe-shaped later — an explicit hybrid choice.** Nothing
here talks to a payment processor yet: a club pays the operator by
whatever means (bank transfer, invoice) and the operator flips the
switch by hand. The data model is still built as if a webhook might
write to it someday (`enabled` + `expiresAt`, not e.g. a plan-name
string) specifically so wiring in real billing later is additive, not a
rewrite.

**Two ways to activate, matching the two ways a club actually pays.**
`activateEntitlement(clubId, key, days?)` either turns a module on
permanently (`days` omitted, clears any prior expiry) or for a fixed
window starting *today* (`days` given — always "N days from the moment
of activation", never extending some other reference date, so
reactivating an expired pay-as-you-go module always gives a fresh full
window). This covers both real requests this was built for: a club on a
monthly training-reservations plan gets the unlimited toggle, while a
club that only runs one tournament every few months buys, say, 30 days
of `turnaje` right when they need it rather than paying for it
year-round. `isEntitlementActive` treats a missing entitlement (a club
predating this feature, or a module never activated) as inactive —
nothing is free by default just because it was never explicitly turned
off.

**Superadmin-only, enforced in firestore.rules, not just hidden in the
UI.** The `entitlements` map on `clubs/{clubId}` can only be written by
`isSuperAdmin()` — a club's own `owner` can update every other club
field (name, contact info, etc. via the existing `AdminClubSettingsPanel`
flow) but can never grant themselves a paid module, even by crafting a
direct Firestore write. This is also why the operator needs to hold the
`superadmin` role on *each* customer's own deployment (bootstrapped the
same way as any first superadmin, via `scripts/create-superadmin.mjs`) —
there's no separate "app operator" concept layered on top of the
existing four-tier staff role model, since `superadmin` already sits
above a club's own `owner` and this slots in as one more thing only that
top role can do.

**"Cenník / Môj plán" (`AdminSubscriptionPage.tsx`, `/admin/predplatne`,
linked from `HeaderMenu.tsx`'s dropdown) is one shared page for both
audiences**, not two separate screens: any `owner`/`superadmin` sees
every module listed with its description, price, and current status
(Aktívne / Aktívne do `<dátum>` / Neaktívne) — a `superadmin` additionally
sees inline activate/deactivate controls right on the same card. Per an
explicit "don't hide, grey out" request, an inactive module's card still
shows its full description and price at reduced opacity rather than
disappearing — the owner should always see everything the app *can* do,
not just what they currently pay for.

**Enforcement is scoped to admin/management only, never the public
side** — an explicit "len admin/správa" decision. When `turnaje` or
`treningy` is inactive, the *public* `/turnaje` and `/treningy` pages,
and any already-existing tournament/session/series/bundle, keep working
exactly as before; only the "create something new" entry points get
blocked: `TrainerDashboardPage.tsx`'s three "New session/series/bundle"
cards and `TournamentsPage.tsx`'s "Vytvoriť turnaj" button (plus
`TournamentCreatePage.tsx` itself, reachable directly by URL, as a second
layer). A blocked creation form is shown at reduced opacity with
`pointer-events-none` (not just a disabled submit button) — typing into
its inputs is blocked, not only submitting — alongside a plain-language
banner explaining the module isn't active. `TournamentsPage.tsx`'s
create button specifically swaps from a `Link`-wrapped button to a bare
`disabled` button (not a `Link` around a disabled button) when inactive,
since a disabled button *inside* a `Link` still navigates on click — the
wrapper itself has to go, not just the button's own disabled state.

## Product direction: this app is the integration hub
Superseded the original plan below — THIS app (not Arena-Srsnov) is now 
the core of the final product. `/` is a branded hub home screen (club 
logo, name, tagline) with cards linking to each club service:
- "Reserve Ice Rink" — this app's own booking flow, at `/book`, always 
  enabled
- "Training Reservations" — this app's own training domain, at 
  `/treningy` (see the "Training reservations" section below) — no 
  longer an external link, superseded once that domain was rebuilt 
  natively in this app
- "Tournaments" — the hub card checks the same trainer/assistant/owner/
  superadmin role check `TournamentsPage.tsx` itself gates on
  (`canManageTournaments`): a signed-in account with any of those roles
  gets routed straight to the internal `/admin/turnaje` planning tool,
  same as the "Training Reservations" card; everyone else lands on the
  public `/turnaje` schedule page (see the "Tournaments" section below) —
  no longer an external link, superseded once both the internal tool and
  the public schedule page were built natively in this app.
Current assumption: integration is via external links out to 
separately-deployed apps, not a merged single codebase, until a domain 
gets rebuilt natively like Training Reservations and Tournaments' 
internal tool did.

Superseded original plan (kept for history): Arena-Srsnov would own 
the production domain and link to this app instead, joined via 
Next.js/Vite Multi-Zone-style rewrites.

## First task
Do NOT write code yet. Inspect Arena-Srsnov and report: Firestore 
schema/collections, calendar/booking component structure, registration 
form patterns, email mechanism (provider/trigger/templates), Tailwind 
design tokens. Then propose a data model for: clubs, zones, timeSlots, 
bookings. Wait for confirmation before scaffolding.
