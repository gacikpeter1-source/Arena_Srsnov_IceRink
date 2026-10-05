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

**Rink/zone names are bilingual, not hardcoded English.** `Rink.name`/
`Zone.name` (`src/types/index.ts`) stay the default/English value; an
optional `translations?: { sk?: string }` on each doc holds a Slovak
override. `localizedName(entity, lang)` (`src/lib/utils.ts`) is the single
place that picks between them — every UI display site (booking pages,
admin dashboards, the QR panel, the tournament schedule generators/
bracket views, confirmation/cancel pages, the rink schedule board,
emails) calls it with `i18n.language` rather than reading `.name`
directly. `lib/email.ts` already threads an explicit `lang` through every
function it exports (emails render in whatever language the customer was
using at booking time, independent of the live UI), so it passes that
straight through instead. Deliberately **not** extended to Excel import/
export (`lib/excel.ts`) — the Rink/Zone column values there stay matched
and written against the canonical English `name` only, same reasoning
already documented for that file's fixed English column *headers*: an
unambiguous, language-independent interchange format that can always be
re-imported regardless of which language produced or is reading it.

Since rinks/zones have no admin UI at all (see the Excel-import-editing
note two sections up), the Slovak overrides are written the same way any
other rink/zone data is set — a one-off Admin-SDK script,
`scripts/translate-rinks-zones.mjs` (same pattern as `add-zones.mjs`):
matches each doc by its current English `name` against a small mapping
table and sets `translations.sk`, skipping (and logging) any name with no
entry rather than guessing. Safe to re-run.

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

### Division mode moved onto the per-slot schedule (DivisionRule removed)

Originally, which zones a time slot offered (whole rink, or split into
halves/thirds) was decided by a separate `DivisionRule` collection: a
recurring dayOfWeek + time-range → mode table, seeded once by
`scripts/seed.mjs` and never given any admin UI at all. This had two real
problems, both surfaced while preparing demo data for a customer
presentation: (1) it could only ever offer **one** mode for a whole
recurring window, so a club wanting "split some Wednesdays but not
others" had no way to express that; and worse, (2) `computeDaySchedule`
resolved a slot's offered zone(s) purely from the day-of-week rule, with
no awareness of what was actually booked — a zone booked under a
*different* mode than the rule currently in effect (e.g. a "third" locked
while the rule said "half" for that window) simply never showed as
unavailable, since the customer picker only ever checked locks against
whichever mode the rule happened to be offering. A customer could see a
zone as free while the physical ice it covered was actually already
taken.

Per explicit product direction, `DivisionRule` is gone entirely (deleted
`lib/divisionRules.ts`, the `divisionRules` Firestore collection is no
longer read anywhere — old docs left in place, orphaned, harmless). The
standing default is now simply **whole rink** for every session;
splitting only happens when staff explicitly set it. `mode` moved onto
each `ScheduleOverride` slot (`{ startTime, durationMinutes, mode? }`,
`src/types/index.ts`) — missing/undefined still means `'full'`, both for
an override slot written before this field existed and for every slot
`computeDaySchedule` auto-generates from the recurring `TimeSlotConfig`
(that generation path no longer resolves a mode at all — it's always
`'full'`). `AdminDaySchedulePanel.tsx` gained a mode `<select>` next to
each session's time/duration inputs (options limited to whichever modes
that rink actually has zones for), and `cascadeSlotEdit`
(`lib/scheduleOverrides.ts`) resets a cascaded-forward slot's mode back to
`'full'` along with its duration, matching the existing "resets to
default rhythm" policy for edits made earlier in the day. The Excel
schedule importer (`parseScheduleWorkbook`/`downloadScheduleImportTemplate`
in `lib/excel.ts`) gained a matching optional "Mode" column
(Full/Half/Third/HalfLengthwise, case-insensitive; blank or unrecognized
→ `'full'`).

Net effect: a recurring "every Wednesday evening" split isn't a first-class
concept any more — it's set up the same way any other repeating
day-schedule change already is, via the day editor's "apply to a range of
days" (see above), not a separate rule engine. In exchange, the
customer-facing mode for a given slot is now *exactly* whatever staff
declared for that specific session, which is the same source of truth a
staff member actually books against — removing the whole class of
mode/lock mismatch bug described above. This doesn't extend to
staff-side tools that pick a zone directly and skip `computeDaySchedule`
entirely (`RinkScheduleEntry`, `TournamentMatch`, and the admin
manual-create modal's own zone picker, which — unlike those two — *is*
still constrained to the day's configured mode since its zone dropdown is
built from `computeDaySchedule`'s own slot data) — staff creating a
rink-schedule entry or tournament match still need to pick a zone/mode
that matches whatever override is set for that slot for the public `/book`
page to stay accurate, same pre-existing responsibility as before this
change, just no longer masked by an invisible seed-script rule.

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

**Fixed: a series-linked session showed no event name at all, anywhere
customer-facing.** `TrainingSessionCard.tsx` and `TrainingRegistrationModal.tsx`
both only ever special-cased `bundle` for a name — a session belonging to
a `TrainingSeries` instead fell all the way back to showing the trainer's
own name as the headline (card) or a generic "Register for training"
string (the modal's dialog title), since `TrainingSession` itself carries
no title of its own, only a `seriesId` pointing at the series that
actually has one. A customer browsing `/treningy` had no way to tell two
different recurring trainings by the same trainer apart, or to know what
either one actually *was*, before clicking in. `fetchTrainingSeriesByIds`
(`lib/training.ts`) mirrors the existing `fetchTrainingBundlesByIds`
exactly — `TrainingCalendarPage.tsx` now resolves both maps off the same
fetched sessions and threads `series` through
`TrainingMonthCalendar`/`TrainingWeekCalendar`/the list view's card and
into the registration modal, same plumbing `bundles` already had.
`TrainingSessionCard` and the modal both now show, in order of visual
weight: the event's own name (`bundle.title` / `series.title`, the
largest text) first, then the trainer's name and the date/time — both
shrunk to `text-xs text-text-muted`/`text-text-secondary` — as secondary
detail underneath, per an explicit "názov väčší, tréner aj kedy/kde
menšie" request. A session with neither a bundle nor a series (a genuine
one-off with no event name anywhere) still falls back to showing the
trainer's name as the headline, same as before this fix — there's
nothing else to show for that case.

### Fáza 5: group tickets (attendeeCount) + payment scaffold

Built ahead of a planned entrance QR-scanning check-in flow (a staff
tablet/phone at the door scans a customer's confirmation QR) — a family or
group buying tickets together should be covered by that one QR, not one
per person, and the door scan should check the whole party in with a
single tap. Two additive pieces landed together since they compose (a
price, once payments are real, is naturally "per person × headcount"):

**`attendeeCount`** — new optional field on `Booking`, `TrainingRegistration`,
and `TrainingBundleRegistration` (`src/types/index.ts`), defaulting to 1 when
unset (a record from before this field existed). The customer/staff booking
forms (`BookingModal.tsx`, `AdminCreateBookingModal.tsx`,
`TrainingRegistrationModal.tsx`) all gained a plain "number of people" input
next to name/email/phone. Its effect differs by domain, matching how each
domain's capacity actually works:
- **Ice bookings** — purely informational. A `Booking` reserves a whole
  zone/time slot regardless of headcount, so `attendeeCount` doesn't affect
  `createBooking`'s transaction at all — it only shows up for display (a
  `×3` badge next to the name in `AdminDashboardPage.tsx`'s bookings table)
  and, later, for the QR check-in screen to know how many people to expect.
- **Training registrations/bundles** — genuinely affects capacity.
  `registerForSession`/`registerForBundle` (`lib/training.ts`) now check
  `confirmedCount + attendeeCount <= capacity` (not just "is there *a*
  spot") and increment/decrement `confirmedCount` by `attendeeCount`
  throughout — creation, the pending-window reclaim sweep, cancellation,
  and waitlist promotion all use the registration's own stored
  `attendeeCount` (falling back to 1 for a pre-existing registration)
  rather than assuming exactly one spot per registration. Waitlist
  promotion (`promoteNextWaitlistedSessionRegistration`/
  `...BundleRegistration`) specifically skips a candidate whose party
  doesn't fit the space just freed rather than blocking everyone behind
  them — the next (possibly smaller) waitlisted party is tried instead, so
  a cancellation doesn't stall on the front of the queue being a family of
  6 when only 2 spots opened up. `TrainerRosterModal.tsx`'s check-in list
  shows `Meno · N osôb` for any registration with `attendeeCount > 1`.

**Payment scaffold — ready, not active.** `TrainingSession.price` and
`TrainingBundle.price` (optional, per-person, set by the trainer at
creation next to capacity/cancellationCutoffHours in
`TrainerDashboardPage.tsx`'s three creation forms) are the first real use
of the `Payment` type that's existed on `Booking` since this app's original
spec but was never wired up. `registerForSession`/`registerForBundle` now
accept a `paymentsEnabled` flag (the caller passes `club.paymentsEnabled`
straight through — always `false` today, so this is inert in production)
and only attach `payment: { required: true, amount: price * attendeeCount,
currency: 'EUR', status: 'unpaid' }` to the registration when both that
flag AND a price are set; `TrainingRegistrationModal.tsx` mirrors the same
condition to show a running total, so nothing customer-facing changes
until a club actually turns `paymentsEnabled` on. Deliberately scoped to
the training domain only for now — ice bookings keep `attendeeCount` as
informational-only, with no equivalent `price` field yet, since zones have
no admin UI to attach a per-zone price to (see the "halfLengthwise" note
below on that same limitation) and a club-wide/rink-wide default would be
a bigger modeling decision than this pass needed to make.

**Entrance QR-scan check-in** (`QrScanPage.tsx`, `/admin/treningy/scan-qr`,
linked from `HeaderMenu.tsx`'s dropdown right under "Spravovať tréningy",
gated to the same `isTrainer || assistant/owner/superadmin` check as that
link) is the piece the `attendeeCount` work above was built ahead of. Uses
`qr-scanner` (camera access + decode, no backend) pointed at the device's
video feed; on a decode, the scanned string is parsed as a URL and matched
against the *exact* cancel-link path patterns the confirmation emails
already embed as QR images (`queueTrainingConfirmationEmail`/
`queueBundleConfirmationEmail` in `lib/email.ts`) — `/treningy/zrusit/:regId/:token`
for a session registration, `/treningy/kurz/zrusit/:regId/:token` for a
bundle one — rather than inventing a second QR payload. The registration
doc is fetched by `regId` and the embedded `token` checked against its
`cancellationToken` (same trust check `TrainingCancelPage.tsx` already
does) before showing anything, so a garbled or tampered scan can't surface
another customer's name. A `/my-booking/:bookingId/:token` (ice booking) QR
is recognized but shown as "not supported yet" rather than erroring, since
`Booking` has no attendance field to check into. Marking present calls the
*same* `markSessionAttendance`/`markBundleSessionAttendance` functions
`TrainerRosterModal.tsx`'s manual roster already uses — one tap checks in
the registration's whole `attendeeCount` party, matching the "single scan,
whole group" decision above, not a per-person count. For a bundle
registration (which covers many sessions), the scanner fetches the
bundle's own session list and auto-selects today's date's session when
there's exactly one match, otherwise shows a picker — same "which session"
ambiguity a bundle registration always has when checking in doesn't
otherwise limit it to a single occurrence.

**`firestore.rules` broadened**: the `attendance`/`attendanceBySession`
public-writable-only-by-the-owning-trainer rule on `trainingRegistrations`/
`trainingBundleRegistrations` gained an `isStaffMember()` (assistant/owner/
superadmin) branch alongside the existing trainer-only one — whoever's on
door duty checking people in may not be the trainer running that
particular session, same reasoning the ice-attendance checklist's
`trainerPresentConfirmed` rule already established.

**Reuse/sharing warning.** A scanned code whose registration (or, for a
bundle, its specific session) was already checked in shows a prominent red
warning with the original check-in time, so staff notice if a customer's
QR is being passed around to multiple people instead of covering one
`attendeeCount` party as intended — deliberately *not* an outright block
(e.g. staff might legitimately re-scan to double-check), just a visible
flag. This required snapshotting the "was already checked in" state at
scan time (`wasAlreadyCheckedIn` on the session result,
`originalAttendanceBySession` on the bundle one) rather than reading the
live `reg.attendance`/`attendanceBySession` — those get locally updated
the instant staff taps "Mark present" on a *legitimate* first scan, which
would otherwise make the warning flash on immediately after every normal
check-in instead of only on a genuine second scan.

**"Pay now vs. pay at the door" deliberately not built yet.** A club asked
about letting a customer choose at booking time whether to pay online
immediately (so their QR itself proves payment at the door) or pay in
person (so the QR only identifies them, payment handled separately) — with
the app tracking scan counts so a paid QR can't be reused by multiple
people. This is explicitly on hold until a real payment gateway exists
(see the payment-scaffold note above — `paymentsEnabled` stays off); adding
a "pay now" choice with no actual charge behind it would be misleading, so
this stays a single-path flow (pay-at-the-door only, informally) until
Stripe or similar is actually wired in.

**Planned next**: an ESP32-driven electromagnetic door lock triggered by a
valid scan — not built yet; this pass is the software check-in only.

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

**A second way to split "half".** `DivisionMode` gained a fourth value,
`halfLengthwise`, alongside `full`/`half`/`third` — purely additive, not a
replacement: `half` keeps its existing meaning (the center red line, near
end/far end), `halfLengthwise` is a second two-slot split whose boundary
instead runs along the rink's length (mantinel-to-mantinel, left/right
board side). Since there's no painted line on the ice for this split (only
the blue lines and center red line are real), `RinkDiagram.tsx` doesn't
measure a percentage for it the way it does for `half`/`third` — it just
divides 50/50 by image *height* instead of *width* (`BOUNDS[mode].axis:
'vertical' | 'horizontal'` picks which). Zones have never had an admin UI
(they're set up once via `scripts/seed.mjs` and rarely change), so a new
mode's actual `Zone` docs are created via a small companion script,
`scripts/add-zones.mjs` (same Admin-SDK, safe-to-re-run pattern) rather
than a Firestore console edit. Adding only the `Zone` docs — with no
matching `DivisionRule` — is deliberate: `resolveDivisionMode` (`lib/
divisionRules.ts`) still only ever resolves to a mode an explicit rule
names, so the public `/book` calendar's day-to-day schedule is completely
unaffected; `halfLengthwise` only becomes reachable through the
tournament match generators/manual-match form above, which pick zones
directly by mode without consulting `DivisionRule` at all. If a club later
wants customers to book a lengthwise half directly via `/book`, that would
need its own `DivisionRule` (same script-only limitation as zones today).

**Update: the `halfLengthwise` zones were removed; the real half/third
zones were renamed to match how staff actually refer to the ice.** A club
request to rename zones to match the physical layout staff actually use
day to day (relative to the "Rolbovňa" ice-resurfacer bay and the rink's
scoreboard) also included dropping `halfLengthwise` entirely — it was
never reachable from `/book` (see above) and the club doesn't use that
split in practice. Both rinks' `*-halflengthwise-0`/`*-halflengthwise-1`
`Zone` docs were deleted (via the same one-off Admin-SDK script pattern,
run dry-run first, checking every collection that stores a raw `zoneId`
— `bookings`, `bookingSeries`, `rinkScheduleEntries`, `freeIceSlots`,
`tournamentMatches`, `slotLocks` — for live references before deleting;
the only hit was a single already-past, already-orphaned `slotLocks` doc
whose own `bookingId` no longer resolved to a real `Booking`, cleaned up
alongside the zones rather than treated as a blocker, same "orphaned docs
left in place, harmless" precedent documented elsewhere in this file). The
remaining `half-a`/`half-b`/`third-1`/`third-2`/`third-3` zones (on both
`main-hall` and `small-hall` — identical rename on both, per explicit
confirmation that the physical orientation is the same on both rinks)
were renamed on both their English `name` and Slovak `translations.sk`:
Half A → "Half – Resurfacer Side" / "Polovica k Rolbovni", Half B →
"Half – Scoreboard Side" / "Polovica k Tabuli", Third 1 → "Third –
Scoreboard Side" / "Tretina k Tabuli", Third 2 → "Middle Third" /
"Stredná Tretina", Third 3 → "Third – Resurfacer Side" / "Tretina k
Rolbovni" — the English names are this session's own translation of the
Slovak phrasing the club actually asked for (there was no existing
English equivalent to preserve, unlike a normal translation edit via
`scripts/translate-rinks-zones.mjs`). `*-full` zones were untouched.

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

**A short numeric code as a third way in, for when neither a QR nor the
full URL is realistic.** A QR code needs a phone camera to scan, and
typing `/turnaje?tournament=<firestore-id>&display=tv` via a TV remote's
on-screen keyboard is impractical — a club asked for something a remote's
number pad (or slow arrow-key typing) can actually handle. `Tournament.tvCode`
(`src/types/index.ts`) is a short 4-digit code, lazily generated the first
time `TournamentDetailPage.tsx` loads a tournament that doesn't have one
yet (`ensureTournamentTvCode` in `lib/tournaments.ts` — retries a fresh
random candidate on a collision against the `tournaments` collection,
rare enough at this scale that a transaction wasn't worth it) rather than
at creation time, so an existing tournament picks one up automatically
instead of needing a migration. The public route `/tv/:code`
(`TvCodeRedirectPage.tsx`) resolves it back to the tournament
(`fetchTournamentByTvCode`, a single-equality query — no new
`firestore.indexes.json` entry, same as every other `tournaments` query)
and replaces straight into the real TV URL; an unrecognized code (typo,
or the tournament was deleted) shows a plain "invalid code" notice
instead of erroring. The code itself is shown in large text right next
to the existing TV-screen QR/link on `TournamentDetailPage.tsx`. Writing
the generated code is best-effort — `firestore.rules`' `tournaments`
update rule only allows the creating trainer or any ice-rink staff
member, so a different trainer opening someone else's tournament simply
never sees the shortcut (the write is silently caught and dropped)
rather than erroring, same as if the code had never been generated.
The numeric-code machinery (generation, collision retry, lookup) is
tournament-only, since a tournament is the one thing here that comes in
multiples needing to be told apart. The rink schedule board has no
per-tournament id to shorten in the first place — it's one shared board
per deployment — so it just gets a fixed alias instead: `/tv` (no code
at all) is a plain `<Navigate>` straight to `/rozvrh?display=tv`, added
right next to the `/tv/:code` route in `App.tsx`. Typing `arenasrsnov…/tv`
on a remote is about as simple as a URL gets, so no random code was
needed for this one. Unlike the tournament shortcut — which only ever
appeared on `TournamentDetailPage.tsx`, the one place staff already look
for it — the `/tv` alias had nowhere staff would think to look for it at
all, since `RinkSchedulePage.tsx` (`/admin/rozvrh`) had no QR/link
section to begin with (the only route in was the public page's own "View
as screen" link). Fixed by giving `RinkSchedulePage.tsx` the same
QR-code-plus-link card `TournamentDetailPage.tsx` already has for its TV
screen, plus the plain `/tv` text underneath.

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

## Rink team schedule

A third, independent planning domain (alongside Training Reservations and
Tournaments) for a standing "who has the ice when" schedule — recurring
team practices, courses, and public-skating blocks — inspired by an
external design concept the club shared (a TV-board spec written for a
different platform, "Nexus"). Adapted rather than ported wholesale: that
concept's `{halls, entries}` single-doc-wholesale-replace model doesn't
fit this app's conventions or its own stated requirements once discussed
concretely, so the actual data model below deliberately differs from it —
see the per-decision notes.

**`RinkScheduleEntry`** (`src/types/index.ts`, `lib/rinkSchedule.ts`,
`/admin/rozvrh`, `RinkSchedulePage.tsx`) reuses this app's existing
`Rink`/`Zone` concepts for "halls" and their sections — there's no reason
to model those twice. Access is `isTrainer() || isStaffMember()`, same
three-way check Trainings/Tournaments already use (an explicit "aj
tréner" — trainer access matters — answer to what would otherwise default
to ice-rink-staff-only). Unlike the reference concept, there's **no
club-wide team/group registry** behind `teamName` — it's plain free text
autocompleted client-side from previously-used names (a `<datalist>`,
same pattern `AdminTrainerIceLogPanel.tsx`'s free-text trainer name field
already uses) — an explicit choice: this app already has real "teams"
(`TournamentTeam`) but they're tournament-scoped, not club-wide standing
groups, and inventing a new registry just for this display label wasn't
worth the added modeling for what's still Fáza 1.

**Every entry always blocks real ice — no separate non-transactional
schedule layer.** This is the one point where the reference concept's own
design (a display-only schedule, "staff responsible for not double-
booking themselves") was explicitly rejected in favor of real enforcement:
`createRinkScheduleEntry` calls the *exact* `createBooking`/
`createBookingSeries` transaction the customer-facing `/book` flow uses,
so a schedule entry gets the same atomic double-booking protection a
customer booking already has — colliding with an existing booking (from
any source: a customer, another schedule entry, or a tournament match's
`blocksIce`) throws the same `SlotUnavailableError` the rest of the app
already surfaces. `RinkScheduleEntry` is a thin, richer wrapper doc around
that real reservation (team name, optional room) — never a second source
of truth for whether ice is free. It points at either a single `bookingId`
or a `seriesId` (recurring, via the exact same `SeriesRecurrence` UI/types
`BookingModal.tsx`/`AdminCreateBookingModal.tsx` already use), matching
whichever `createBooking*` call created it. Deleting an entry cancels its
underlying booking(s) directly via `cancelBooking` (**not**
`cancelBookingSeries`, which enforces the customer self-cancel cutoff —
this is staff deleting their own entry, same "staff are exempt from the
cancellation lockdown" stance `cancelBooking` itself already takes) before
removing the entry doc.

**One real scenario this resolves without new logic**: a club worried
about "verejné korčuľovanie" (public skating) overlapping with a
customer's separately-booked private lesson at the same time — since
entries are zone-scoped, not whole-rink-only, a public-skating entry on
one half of the rink simply leaves the other half's zone bookable as
normal through `/book` or the training domain; nothing extra was needed
beyond already having zones.

**Bulk import stays row-per-occurrence, matching the tournament-match
importer's convention, not the reference concept's "recurrence in the
import too".** `parseRinkScheduleWorkbook`/`downloadRinkScheduleImportTemplate`
(`lib/excel.ts`) take Rink/Zone/Team/Room/Date/Start Time/Duration
columns — Rink+Zone resolved by name in the caller
(`RinkScheduleImportPanel.tsx`), same reason the booking import already
resolves rink+zone names itself (zone names aren't unique club-wide).
Recurring entries stay a manual-form-only concept.

**Import columns redesigned for hand-typing, including a plain .csv/.txt
file, not just a generated .xlsx.** The Rink/Zone/Team/Room/Date/Start
Time/Duration columns above were superseded by a smaller, Slovak-worded
set the club actually asked for: **Hala** (a small integer — 1, 2, ... —
naming a rink by its position among `rinks` sorted by `sortOrder`, not
its name; far less error-prone to hand-type than "Main Hall"), **Nazov**
(team/event name), **Datum** (`dd.mm.rrrr`), and **Cas** (24h start
time) are required — `parseRinkScheduleWorkbook` reports exactly which
row is missing which one, same "collect every row error, don't abort on
the first" behavior every other importer here already has. **Satna**
(room) and **Ihrisko** (which part of the ice) are optional: `Ihrisko` is
free text matched by the caller against a zone's `name`, its Slovak
`translations.sk`, or — for a split zone — the same A/B/C letter
`RinkScheduleBoardPage.tsx`'s TV board now shows (see the "split-zone
event" note below), and left blank it resolves to that rink's whole-rink
zone rather than erroring. There's no Duration column at all any more —
every imported row books a fixed 60 minutes
(`RINK_SCHEDULE_IMPORT_DEFAULT_DURATION_MINUTES`), matching the manual
create form's own 60-minute default, since a hand-typed row shouldn't
need to restate the same number on every line. Column headers themselves
are plain ASCII Slovak words (no diacritics, so a plain-text file with no
guaranteed encoding still round-trips) and matched case-insensitively
(`getFieldCI`) — a deliberate departure from the other importers on this
page, which keep fixed-case English headers for cross-language
re-import; this importer is explicitly Slovak-first and meant to be typed
by hand, so those two constraints don't apply here. `downloadRinkScheduleImportTemplate`
now writes one example data row under the header row (`1,Gaca,
01.10.2026,21:45,Satna 5,`) as a concrete model to copy from.

`parseRinkScheduleWorkbook` accepts either an `.xlsx` `ArrayBuffer` or
the raw text of a `.csv`/`.txt` file typed in the same column order —
`RinkScheduleImportPanel.tsx`'s file input now accepts all three
extensions and reads the file as text vs. an array buffer accordingly.
The text path deliberately does **not** go through
`XLSX.read(text, { type: 'string' })` — testing that path surfaced a real
bug: SheetJS's own CSV cell-type guessing silently misread `01.10.2026`
as 10 January (an MM.DD.YYYY-leaning heuristic) instead of 1 October,
even though the exact same string parses correctly via
`excelValueToDateString`'s own `d.m.yyyy` text branch when it isn't
pre-mangled into a `Date`. Fixed with a small hand-rolled `parseSimpleCsv`
(split on newlines, then on commas — no quoted-field support, out of
scope for a hand-typed row this simple) that keeps every cell exactly the
text that was typed, so the existing date/time string parsing behaves
identically whether the row came from a `.csv`/`.txt` file or was read
back out of the generated `.xlsx` template.

**Duration column added back, optional.** The "no Duration column at
all" decision two paragraphs up didn't survive contact with a real club
that does want to vary session length per row — **Trvanie** (minutes) is
now a column again, positioned between **Cas** and **Satna** to match how
the club actually reads the sheet left to right. Still optional: a blank
cell books `RINK_SCHEDULE_IMPORT_DEFAULT_DURATION_MINUTES` (60) exactly
as before, so a sheet of same-length sessions still never needs to repeat
that number — a non-blank cell that isn't a valid positive number is a
row error (`Invalid "Trvanie"`), same "collect every row error" pattern
the other required columns already use, rather than silently falling back
to 60 for a typo.

### Fáza 2: public "who has the ice when" TV dashboard

`RinkScheduleBoardPage.tsx` (`/rozvrh`, public, no login — linked from
`HeaderMenu.tsx` right after "Spravovať turnaje", same place a plain
public "Turnaje"/"Tréningy" link already sits) merges this domain's real
`Booking`s with live `tournamentMatches` for the same rink/day into one
feed per rink. Deliberately reads `Booking` directly (via the same
`fetchBookingsInRange` the admin dashboard already uses) rather than
`RinkScheduleEntry` for the ground truth of "what's happening when" — the
entry doc is only cross-referenced afterward (by `bookingId`/`seriesId`)
to attach its `room`, matching the "never a second source of truth"
principle the Fáza 1 note above already establishes. This also means a
customer's own direct booking (never touching the Rozvrh admin tool at
all) shows up on the board correctly, same as a schedule-entry-created
one — there's no special-casing by origin, only by what's actually
reserved. A tournament match shows richer detail (team names, live score)
via the existing `deriveMatchState`; its `teamA`/`teamB` are shown as
literally stored, with no `withResolvedPlaceholders` resolution — a
simpler "good enough for a glance" pass, `/turnaje` itself stays the
authoritative resolved view for a tournament's own schedule.

Same "one route, query params pick the case" pattern as `/turnaje`:
the plain route is a normal scrollable per-rink list (for a phone
visitor); `?display=tv` renders the fixed, no-scroll kiosk dashboard —
one column per rink, each with its own mini sliding timeline (a fixed
window, `now` line, `ScaleToFit`-wrapped "Nasleduje"/up-next list below
it) plus a corner QR (always pointing at the plain page, same reasoning
the turnaje TV board's own QR follows) and a live clock in the header.
`App.tsx`'s TV-mode chrome-stripping check (no header/back-button/footer,
full viewport) is now a path array (`['/turnaje', '/rozvrh']`), not a
single hardcoded route.

**Periodic recompute, not a true animation loop** — per an explicit
"simpler is fine" answer: block positions/widths are plain CSS properties
recomputed every 30s (a `now` tick) with a `transition`, so the shift
*reads* as a smooth slide without a `requestAnimationFrame` loop
continuously repainting.

**Overlapping items get separate lanes, not stacked on top of each
other.** Two items on the same rink can legitimately overlap in time —
e.g. "half" split into two zones used simultaneously — caught by an
actual harness+Playwright screenshot during this pass (two same-time
blocks rendered fully overlapping, their labels illegible on top of each
other) before shipping. Fixed with a small greedy lane-assignment pass
(sort by start time, place each item in the first lane whose previous
occupant already ended, else open a new lane) so overlapping blocks stack
into visually separate rows within the timeline instead.

**The sliding timeline was replaced with a plain stacked event list**
after staff found the interactive timeline hard to read at a glance on
a real screen during a live demo. `RinkScheduleBoardPage.tsx`'s TV mode
no longer renders a proportional time-axis at all — instead each rink
column is one `ScaleToFit`-wrapped vertical list of "slot" cells, one
cell per distinct start time (`groupIntoSlots`), rendered with three
visual tiers: any slot already underway (`startMin <= now`) is a compact
green cell labelled "Práve sa hrá" (reusing `tournaments.liveNow`); the
single soonest not-yet-started slot is a large red cell labelled
"Nasleduje" (`rinkSchedule.upNext`, repurposed from the old section
header into a per-cell badge); every slot after that renders smaller and
grey, however many fit — `ScaleToFit` still guarantees no scrolling, same
as the timeline it replaced. Two or three sessions sharing one start time
(the ice split into zones) land in the *same* cell — one shared time
shown once, each session's own name+room stacked underneath — rather
than one cell per session, per an explicit "jedna bunka, jeden čas"
request. Each row is Name/Time/Room only; the zone label (still computed
for the plain non-TV list further down this page) is deliberately not
shown here, since the room and/or distinct names already tell concurrent
sessions apart at a glance.

The corner QR code and the interactive-timeline-era header clock were
both dropped from TV mode in the same pass — the QR simply took up space
the club wanted back for the two rink columns (a customer can still get
to `/rozvrh` other ways), and the old plain `HH:mm` clock became
redundant once the header's "Späť na štandardné zobrazenie" link (nobody
taps a wall-mounted screen) was replaced with a full `dd.MM.yyyy HH:mm`
date+time — `formatBoardClock`, a fixed non-localized format since a
physical TV display isn't something a viewer picks a language for. That
element is still technically the same link back to `/rozvrh` under the
hood (just restyled as a clock, no visible underline) — harmless on a
real TV and a convenient escape hatch when someone previews TV mode on
a phone or laptop.

**Cells stretch to the column's real width; colors tuned after seeing it
live.** The first cut of the above wrapped the whole event list in
`ScaleToFit`, same as every other TV screen in this app — but
`ScaleToFit`'s inner content is `display: inline-block` (shrink-to-fit),
so a `w-full` cell inside it only ever stretched to the *widest row's own
natural text width*, not the column's actual available width — the list
sat centered with wasted space on both sides instead of filling the
column, exactly the "not readable enough" feedback this got. Fixed by
dropping `ScaleToFit` from this list entirely: `renderEventList`'s root is
now a plain `w-full h-full` flex column directly in the rink column's own
block context (no `inline-block` ancestor in the way), so every cell
genuinely spans the full column width and `justify-between` correctly
pushes a room label all the way to the right edge. Text sizes switched
from fixed Tailwind steps to `clamp()` (same technique the header's club
name already used) so they scale continuously with screen size rather
than jumping between a couple of breakpoints. Losing `ScaleToFit` also
means losing its "always fits, no matter how many events" guarantee, so
`MAX_UPCOMING_SLOTS` (5) caps how many upcoming slots render — matches
the cap the very first pre-timeline version of this list already used,
before more precision was needed.

**Three-tier color scheme, with a timing threshold on the middle tier.**
After seeing an early red-for-"next"/grey-for-"later" cut live, the final
scheme is: green (`status-success`) for a slot already underway, unchanged
from the start; red (`status-danger`) for the single soonest upcoming
slot, but **only once it's within `NEXT_HIGHLIGHT_MINUTES` (45) of
starting** — before that it renders identically to every other upcoming
slot; and amber/yellow (`status-warning`) for everything else upcoming
(including that same soonest slot while it's still more than 45 minutes
out). The 45-minute threshold matters because without it the very next
game of the day would sit red for hours before it's actually relevant —
red is reserved for "starting soon," not just "soonest."

**Text/cell sizes dialed back down.** The `clamp()` ranges from the
full-width fix above (e.g. the "next" cell's time at up to `3.5rem`)
read as oversized once seen live — comfortably legible from across a
room doesn't need to mean "fills half the cell." Every `clamp()` in
`renderSlotCell` was cut roughly in half (the "next" time down to a
`1.15rem–1.75rem` range, cell padding/border/gap all trimmed to match:
`rounded-lg border px-3 py-1.5`, `gap-2` between stacked cells) — still
scales continuously with screen size, just anchored to a smaller,
"reasonable" baseline.

**Header bar shrunk, club-name text left alone.** The header row itself
(the bordered box holding the clock-link and club name) was a fixed
`9vh` — most of that height was empty padding around a single line of
text, space that mattered more going to the two rink columns below.
Shrunk the box to `6vh` (plus the outer page padding/gap from `p-4 gap-3`
to `p-3 gap-2`) without touching the club name's own `clamp()` font
size — per an explicit "not the Arena Sršňov font, the cell" distinction:
the box got more compact, the text inside it didn't shrink.

**Row format corrected to "Name - Time - Room" per line, no separate
shared time header.** The original cell design (see the "sliding timeline
was replaced" note above) put one time at the top of the cell and each
session's name+room stacked below it — after a round of feedback that
turned out to be a miscommunication of the actual ask. The final,
explicitly specified format drops that shared header entirely: each
session gets its own single line reading `{name} - {startTime} - {room}`
(e.g. "HC Michalovce - 16:45 - Šatňa 3"), room omitted from the line
entirely when unset. A cell shared by several same-time sessions (the ice
split into zones) still holds one row per session, each repeating its own
start time rather than relying on a header — simpler and self-contained
per line, at the cost of the small duplication. The live/next badge
("Práve sa hrá"/"Nasleduje") stays as its own line above the sessions,
unchanged.

**A split-zone event also carries a note of which physical part of the
ice it's on.** The row format above reads fine for a whole-rink booking,
but a cell shared by several same-time sessions (the exact "ice split
into zones" case this board already groups into one cell) previously gave
no way to tell which session was on which half/third — worst exactly
where the ambiguity matters most, since those are the rows sharing one
cell. Each zone's own `slotIndex` (0/1/2 within its `mode`, see `Zone` in
`src/types/index.ts`) is mapped to a letter (`String.fromCharCode(65 +
slotIndex)` → A/B/C) and shown as a small badge at the end of the line
(after the "Name - Time - Room" text, not before it — an earlier cut put
it in front of the name, which read as labeling the whole row rather than
being one more trailing detail alongside room) on
`RinkScheduleBoardPage.tsx`'s TV board — deliberately free text for now
(per an explicit "voľný text, ale zatiaľ ako príklad A, B, C" request)
rather than a real per-zone label field, so a club can later rename it to
match however staff actually refer to each half/third without a schema
change. Only shown for a genuinely split zone (`zone.mode !== 'full'`) —
a whole-rink booking has no "which part" ambiguity, so it gets no badge
at all.

**Header re-centered, day name added; "later" cells shrunk to fit a full
day.** Two more requests surfaced once a real Friday's worth of data
(18 bookings on one rink) was actually loaded onto the board: the club
name previously sat in a `flex-1 text-center` cell next to the clock
link, which only centers within the space left over after that link's
own width — close to centered but not exactly, and visibly off once the
clock text (now longer, see below) grew. Switched the header to a CSS
grid (`grid-cols-[1fr_auto_1fr]`, clock in the first column, title in the
second, an empty third column for symmetry) so the title sits at the
true horizontal center of the screen regardless of what either side
holds. `formatBoardClock` also gained a leading Slovak day name
(`BOARD_DAY_NAMES`, indexed by `Date.getDay()`) —
"Piatok 02.10.2026 14:33" instead of just the date — same fixed,
non-localized-to-viewer reasoning the rest of this format already
follows.

Separately, a live club day can have 14+ distinct time slots once every
booking/rental/training on a rink is counted — `MAX_UPCOMING_SLOTS` (was
5) is now a generous 20, and the `'later'`-tier cell (the plain yellow
rows; the green "live" and red "next" cells are deliberately left at
their original size, unchanged) got smaller padding (`px-2 py-0.5` vs.
`px-3 py-1.5`) and a smaller font clamp
(`clamp(0.55rem,0.75vw,0.7rem)`), plus the list's own `gap-2` dropped to
`gap-1` — verified against a real 18-event Friday via the same local-
harness-plus-Playwright-screenshot technique already used elsewhere in
this file, comfortably fitting every slot with room to spare on a
1920×1080 screen (this board still has no `ScaleToFit`, per the earlier
"cells stretch to the column's real width" decision, so this is a fixed
size tuned to the real data rather than a dynamic one).

The green "live" label text also changed from the shared
`tournaments.liveNow` key ("Práve sa hrá", i.e. "currently being played"
— fits a sports match) to a new `rinkSchedule.liveNow` key ("Práve
prebieha", a more generic "currently in progress" fitting a rental/
training/public-skating row just as well) — scoped to this board only,
the tournament pages keep using `tournaments.liveNow` as before.

**Later cells scale font/padding with slot count; zone badge shows the
real zone name.** Seeing the fixed-small "later" cells on an actual TV
(not just a 1920×1080 screenshot) showed two more problems: the owner
found the shrunk text too small to read comfortably, and a quiet moment
with only 2-3 upcoming slots left most of the screen empty below them —
the opposite problem from the "needs to fit 14+" one this size was
originally tuned for. `laterCellStyle` (`RinkScheduleBoardPage.tsx`)
replaces the fixed clamp with a count-based interpolation between
`LATER_FONT_MAX_REM`/`LATER_PAD_Y_MAX_REM` (a quiet day, ≤3 later slots)
and `LATER_FONT_MIN_REM`/`LATER_PAD_Y_MIN_REM` (a packed day, ≥15 later
slots — the real-world max this board has actually seen); live/next
cells are untouched (still `shrink-0`, original fixed size) per the
earlier explicit "keep those as they are" request. The zone-part badge
(A/B/C) also changed to show the zone's own real localized name
(`it.zoneLabel`, e.g. "Tretina 1", "Polovica A") instead of a bare
letter — per an explicit "zapíš to podľa rozpisu" (write it the way the
schedule itself does) request, since the source schedules this board is
transcribed from never used A/B/C, only the zone names themselves.

**Correction: "later" cells don't flex-grow to fill leftover height — a
hard font-size ceiling instead.** The first cut above made each "later"
cell `flex-1`, so the whole stack filled the column's remaining height
exactly — but with only one such cell (nothing else upcoming beyond the
one already-highlighted "next" slot), that single event stretched into
a box spanning most of the screen, which looked wrong on a real TV per
an explicit "jedna udalosť nemôže byť na celú obrazovku" (one event
can't take up the whole screen) correction. Cells are `shrink-0` again
(natural height from their own font+padding, not flex-grown) — a quiet
day now just leaves blank space below the last cell instead of
inflating one of them to fill it. `LATER_FONT_MAX_REM` is now a genuine
hard ceiling at 30px (`1.875rem` at the default 16px root, the explicit
number asked for) that no single event is ever scaled past, regardless
of how few others there are; `LATER_PAD_Y_MAX_REM` was reduced to match
(it no longer needs to help a cell visually "fill" space, just give it
breathing room).

**Fixed: the TV board kept showing yesterday's schedule well past
midnight.** `RinkScheduleBoardPage.tsx`'s data-fetch effect computed
`today` once (`formatDateISO(new Date())`, at the top of the component
body) and closed over that single value inside `refresh`, which the
`POLL_MS` (30s) `setInterval` then called repeatedly — every poll reused
the exact same `today` string the effect happened to capture when it
last ran. The effect only re-ran (picking up a fresh `today`) when React
chose to re-render AND the newly-computed `today` differed from before;
on an always-on kiosk TV, if that happened to stall for any reason around
midnight (backgrounded/throttled timers, a brief standby), `refresh` kept
querying `fetchBookingsInRange` for the previous day indefinitely — a
real report of a TV still showing Thursday's schedule two minutes into
Friday. Fixed by moving the `formatDateISO(new Date())` call inside
`refresh` itself, so every single poll (not just the first one after a
dependency change) independently asks "what day is it right now" —
the effect's dependency array dropped `today` entirely, now just `[club]`.
Also added a `visibilitychange` listener that calls `refresh()`
immediately once the tab/screen is visible again, so a TV waking from
standby doesn't wait up to 30s for its next scheduled poll to notice
anything.

**Fixed: the app never actually reloaded itself onto a new deploy.**
Diagnosing the bug above surfaced a second, compounding issue: even
after this fix shipped, the owner still saw the old behavior live on the
TV, because `src/main.tsx`'s PWA update machinery (see the "Add to
calendar" section's PWA bug writeup) only ever *checked for and
installed* a new service worker (`registration.update()` every 60s, plus
`skipWaiting`/`clientsClaim` in `vite.config.ts`) — it never made the
already-running page actually pick up the new JS. `skipWaiting`/
`clientsClaim` let a new worker take over as *controller* for future
network requests, but the page's own already-executing bundle, React
state, and closures keep running regardless until something reloads it.
An always-on kiosk tab (exactly this TV board, left open for days) could
sit on a stale build indefinitely even though a newer one had already
"taken over" in the background. Added a
`navigator.serviceWorker.addEventListener('controllerchange', ...)`
handler in `main.tsx` that calls `window.location.reload()` the one time
that event fires per page life (guarded by a `refreshed` flag) — this is
the actual moment the handoff happens, and the only reliable point to
reload from. Affects every page, not just this TV board, but matters
most here specifically because nothing else ever forces a reload on a
kiosk screen nobody manually refreshes.

**Found the actual root cause: `formatDateISO` computed "today" in UTC,
not local time.** The two fixes above were both real bugs worth fixing,
but neither explained why the board kept showing the previous day's
schedule for a sustained stretch after local midnight rather than just
an occasional missed tick. `formatDateISO` (`lib/utils.ts`) used
`date.toISOString().split('T')[0]` — `toISOString()` always converts to
UTC first, so for this club's Europe/Bratislava timezone (UTC+1 in
winter, UTC+2 in summer) the computed "date" stayed on *yesterday* for
the first 1-2 hours of every single local day, not just around a timer
hiccup. This function is called from dozens of places across the app
(every admin date-picker's default, the booking calendar, the QR panel,
tournament generators, and this board's own `today`) — all equally
affected during that window, though the TV board was the one actually
watched closely enough to notice. Fixed by building the ISO string from
`getFullYear()`/`getMonth()`/`getDate()` instead, which read the
*local* calendar date of whatever device is running the code — correct
for every real caller here (a customer's phone, staff's browser, the
TV's own browser), since they're all physically in the club's own
timezone. The earlier timer-closure and service-worker-reload fixes
above are still genuinely correct and worth keeping (a long-running
kiosk tab needs both), but this was the fix that actually mattered for
the reported symptom.

**Plain ice rentals get a subtly different text color on the TV board.**
"Ľad na prenájom" (whole rink) and "Tretina na prenájom" (one third) —
generic rentals with no specific team/trainer — are just conventionally-
typed team names, same free-text `<datalist>`-autocompleted field every
other entry uses; there's no reserved value for either anywhere in the
data model. Rather than list every exact wording staff might type,
`isRentalLabel` (`RinkScheduleBoardPage.tsx`) matches any label
*containing* "prenájom" (accent-folded first, so "prenajom" typed
without the diacritic still matches) and colors just that line's text
`text-sky-300` instead of white — covers "Ľad na prenájom", "Tretina na
prenájom", "Polovica na prenájom", or any other future rental wording
staff phrase the same way, with no code change needed. The cell's own
green/red/amber live-status background is untouched, this is purely a
text-color accent layered on top. Deliberately scoped to the TV board's
own cells only, not the plain (non-TV) list further down this page —
that list already colors a row's label by live/finished state (red for
live, muted for finished), and layering a second, unrelated color rule
on the same text risked muddying a meaning that already exists there.

**Later cells packed tighter still, per an explicit "keep the text the
same size, just squeeze the padding" request.** `LATER_PAD_Y_MIN_REM`/
`LATER_PAD_Y_MAX_REM` dropped further (0.3/0.6 → 0.12/0.3 rem) and the
event list's own `gap-2` (between cells) dropped to `gap-1` — only
padding/spacing shrank, `LATER_FONT_MIN_REM`/`LATER_FONT_MAX_REM` are
untouched. The rink column's own "Hala 1"/"Hala 2" heading chrome also
shrank (`text-lg` → `text-sm`, card `p-3 gap-2` → `p-2 gap-1`) to free a
little more vertical room for the event list below it. Target was "at
least 14 events on screen" — verified via the same Playwright-screenshot
technique against the real ~15-slot Friday schedule, which now fits with
comfortable room to spare below the last cell (not just barely).

**Replaced the fixed-size "later" cells with real measure-and-shrink-to-fit,
and aligned name/time/room into columns.** The previous approach
(`laterCellStyle`, a count-based interpolation between a sparse and a dense
reference count) was tuned against the real days seen so far (~15 slots) —
a club asked explicitly for a guarantee that *every* scheduled event for the
day always shows, with no artificial cap and no fixed minimum font size,
sized as large as the screen allows. `RinkScheduleBoardPage.tsx` now has a
`RinkBoardColumn` component (one per rink, each with its own independent
`scale` state) that actually measures: render the later cells at `scale`
(starting at 1, i.e. the unchanged `LATER_FONT_MAX_REM`/`LATER_PAD_Y_MAX_REM`
ceiling), then in a `useLayoutEffect` compare the list's real
`scrollHeight` against its container's `clientHeight` — if it overflows,
shrink `scale` by the overflow ratio (with a small safety margin) and let
React re-render and re-measure, repeating until it fits or hits
`LATER_FONT_FLOOR_REM` (a last-resort "never literally vanish" floor, not a
comfortable minimum — there's deliberately no such thing any more).
`useLayoutEffect` specifically (not `useEffect`) because it runs before the
browser paints, so this converges within the same frame instead of
flashing full-size-then-shrink. `scale` resets to 1 whenever the `items`
prop reference changes (every poll, or an event moving from upcoming to
live) so a day that gets quieter as events finish grows back toward full
size rather than staying stuck at whatever a busier earlier moment had
shrunk it to — the reset and the re-measurement both happen inside the same
layout-effect pass, so this doesn't flash either. `MAX_UPCOMING_SLOTS` is
gone entirely — every upcoming slot for the day is now a candidate to
render; the measurement is what keeps it on-screen, not a slot-count cap.
Live/next cells are untouched (still fixed-size), matching the established
"keep those as they are" stance.

Separately, the old "Name - Time - Room" single hyphen-joined string
(`{it.label} - {minutesToTime(...)} - {room}`) is now three separate
elements — a flexible truncating name, then a fixed-`ch`-width monospace
time (`w-[5.5ch]`, right-aligned), then a fixed-`ch`-width room
(`w-[10ch]`, truncated) — so every row's time lines up under the next
row's time, and the same for room, per an explicit alignment request;
`ch` units scale with each cell's own current font-size, so the columns
stay aligned at whatever size a given day's measurement converged on. The
zone-part badge (e.g. "Tretina 1") stays a separate trailing pill after
the room column, unchanged. A live score (tournament matches only) is
appended directly after the name instead of being a fourth hyphen-joined
segment, since it's conceptually part of "what this event is," not a
fixed-width column of its own.

**Quick filters on the entries table.** `RinkSchedulePage.tsx` (`/admin/rozvrh`) could only be scrolled, not filtered — unworkable once a club has a real season's worth of entries. A filter row above the table (rink `<select>`, date picker, a free-text time field, a free-text name field) narrows what's shown; rink/date are exact matches, time/name are case-insensitive substring matches (so typing "17" catches every 17:xx start, and a partial team name is enough). Deliberately independent state from the create-form's own rinkId/date/startTime fields above it — picking a filter never changes what the "add new entry" form is about to submit. Matching happens per real occurrence (not per entry): an entry with no occurrences left falls back to matching its own original date/time/rink/name (nothing else to check it against), and a whole entry (including a recurring series' "Zmazať celú sériu" row) is only rendered once at least one of its rows survives the filter — a series with every occurrence filtered out doesn't leave a stray delete button with nothing above it. A "Zrušiť filtre" button appears only once a filter is actually set, and a distinct `rinkSchedule.noneFiltered` message ("no entries match the filter") is shown separately from the pre-existing `rinkSchedule.none` ("no entries at all") empty state, so the two situations aren't confused.

### Editing and cancelling individual occurrences

Originally `RinkSchedulePage.tsx` only supported create-or-delete-the-
whole-entry — a club pointed out that practices get cancelled or moved
often enough that retyping a whole entry from scratch every time wasn't
workable. Two related but distinct actions landed together:

**Editing (`RinkScheduleEditModal.tsx`, `rescheduleRinkScheduleEntry`/
`rescheduleRinkScheduleOccurrence` in `lib/rinkSchedule.ts`)** can move a
team/rink/zone/date/time/duration/room to anything, including for one
single occurrence inside an otherwise-unchanged recurring series — not
just the whole series at once. This only works because each occurrence
was already its own independent `Booking` doc (via `createBookingSeries`,
see the "Recurring bookings" section) sharing nothing but a `seriesId`, so
moving one occurrence is exactly "cancel this one Booking, create a new
one with the same `seriesId`" — the rest of the series is untouched by
construction, no special-casing needed. Reuses the exact same
`findSlotConflict`/replace-confirm flow (`lib/rinkConflicts.ts`) the
create form already has, since a moved occurrence can just as easily land
on another tournament match or entry as a brand-new one can.

A same-zone/date/time edit (only the team name, duration, or room
changed) takes a different, cheaper path — patching the existing
`Booking`'s `name`/`rinkId`/`durationMinutes` fields in place via
`updateDoc` rather than cancel-and-recreate. This isn't just an
optimization: trying to `createBooking` "into" the exact slot the
existing booking already holds would immediately throw
`SlotUnavailableError` against itself, since nothing was released yet.

Once a series can have individually-diverging occurrences, its own entry
doc's `date`/`startTime`/`rinkId`/`zoneId` fields stop meaning anything
beyond "how the series was first set up" — they're never read again after
creation. `fetchRinkScheduleOccurrences` (`lib/rinkSchedule.ts`) is the
one place that now matters for display: it re-reads the live `Booking`
docs (via `fetchSeriesBookings` for a series, or the entry's own
`bookingId` for a single occurrence) rather than trusting the entry's own
copies, so `RinkSchedulePage.tsx`'s table renders one row **per real
occurrence**, not one summary row per entry — showing each occurrence's
actual current rink/zone/date/time even after some have been individually
moved.

**Per-occurrence room override**: `room` was previously one field on the
whole entry. A moved-and-rebooked-elsewhere occurrence might reasonably
need a different locker room than the rest of the series, so
`RinkScheduleEntry.occurrenceRooms?: Record<bookingId, string>` holds
per-occurrence overrides, checked first (`occurrenceRooms[booking.id] ??
entry.room`) everywhere a room is displayed — the admin table and
`RinkScheduleBoardPage.tsx`'s room lookup. Keyed by the occurrence's
*current* booking id specifically because rescheduling replaces that id
(cancel old, create new) — the override is copied across to the new id
and the stale old one is dropped, rather than being written once and
going stale the first time that occurrence moves again.

**Cancelling one occurrence** (`handleCancelOccurrence` in
`RinkSchedulePage.tsx`, a direct `cancelBooking` call — the same "staff
are exempt from the cutoff" function `deleteRinkScheduleEntry` already
used) is new and distinct from deleting the whole entry: it removes just
that one `Booking`, leaving the entry doc and every other occurrence in
the series alone. Deleting the whole series (`deleteRinkScheduleEntry`,
unchanged) is still available as its own separate button, since "the team
disbanded, remove the whole standing block" and "this one Tuesday is
cancelled" are different actions with different blast radius.

**Known limitation, not new**: staff-only Firestore rules for canceling/
editing a `Booking` (`firestore.rules`' `bookings` collection) grant full
rights to `isStaffMember()` (assistant/owner/superadmin) but not to a pure
`isTrainer()` account with no ice-rink role — this was already true of
`deleteRinkScheduleEntry`'s use of the same `cancelBooking` call before
this pass, just newly exercised by the same gap here. A trainer-only
account trying to reschedule or cancel a same-day occurrence within the
usual 24h customer cutoff window can hit a permission error; broadening
`bookings`' rules to trust `isTrainer()` with unrestricted booking edits
was deliberately not done here since it would grant far more than "let a
trainer manage their own rink-schedule entries" (it has no way to check
"is this booking mine" without a new field), so this is left as a
documented gap rather than a quick-but-too-broad rules change.

**Still not built**: per-team recolorable legend; logo-derived TV-board
branding colors. Cross-domain conflict detection (below) landed in a
later pass.

**Separate home/away locker rooms for a match entry.** `room` alone
couldn't express a league game where the two teams need different
changing rooms — `RinkScheduleEntry.awayRoom` (plus its own
`occurrenceAwayRooms?: Record<bookingId, string>` per-occurrence override,
mirroring `room`/`occurrenceRooms` exactly) covers that: `room` is the
home side, `awayRoom` the visiting side, both optional and independent —
a normal single-team entry (training, public skating) just leaves
`awayRoom` unset. `RinkSchedulePage.tsx`'s create form and
`RinkScheduleEditModal.tsx` both gained a second "Šatňa hostí" input next
to the existing room field. Wherever a room is displayed
(`RinkScheduleBoardPage.tsx`'s TV timeline blocks, its "Nasleduje" list,
and the plain list view), `formatRoomLine` shows just `room` when
`awayRoom` is unset, or both labeled ("Domáci: X · Hostia: Y") when both
are set — never silently dropping the away room. Not extended to the
Excel bulk importer (`parseRinkScheduleWorkbook`) — that's for recurring
standing blocks (practices/courses), not one-off matches, which are
already a manual-form case.

### Automatic cleanup: finished rink-schedule bookings are hard-deleted

An explicit, scoped exception to this app's usual "never hard-delete,
keep history" stance (see the training domain's own rejection of
`deleteDoc`-based cancellation, and the general "no scheduled cleanup
job, data hygiene not a correctness requirement" pattern used for pending
bookings elsewhere): a club operator asked for rink-schedule occurrences
specifically to be permanently removed once they're old, saying they have
no need to keep that history. Deliberately scoped to **only** bookings
created through the rink-schedule tool (`RinkScheduleEntry`) — a direct
customer booking via `/book`, a training session, and a tournament match
(even one that `blocksIce`) are all untouched, since deleting a
tournament match would corrupt `computeGroupStandings`' live table (it
reads every match a group ever had) and deleting a training session would
break the attendance report's historical data — neither of those
exceptions was asked for, so neither was extended.

`cleanupFinishedRinkScheduleEntries` (`functions/src/index.ts`) is a
scheduled Cloud Function (`onSchedule`, every 30 minutes — frequent
enough that a finished occurrence disappears reasonably close to, not
long after, its grace window) rather than a client-triggered job, since
"delete once 2 hours old" has no natural event to hang off of. For each
`RinkScheduleEntry`: a single-occurrence entry (`bookingId` set) is
deleted together with its one `Booking` once `startAtUtc + durationMinutes
+ 2h` has passed (or immediately if the booking's already gone some other
way — nothing left for the entry to point at either way); a recurring
entry (`seriesId` set) has each of its own occurrences — every real
`Booking` sharing that `seriesId`, all created up front by
`createBookingSeries` with no "generate more later" job — aged out
individually, and the entry doc itself is only deleted once *every*
occurrence it ever had is gone. `startAtUtc` (stamped on every booking
since the cancellation-cutoff feature made it required) is what lets this
job compute a real end instant without needing the club's `timezone` —
same reason `firestore.rules`' own cutoff check doesn't need it either. A
booking somehow missing `startAtUtc` is left alone rather than guessed
at, the same documented gap the cancellation cutoff itself already
accepts. Writes are batched (capped under Firestore's 500-per-batch
limit) to stay correct even against a large first-run backlog. Requires
the Firebase project to be on the Blaze (pay-as-you-go) plan — Cloud
Scheduler—backed scheduled functions aren't available on the free Spark
plan regardless of actual usage, unlike the existing `onDocumentCreated`/
`onCall` functions.

Stale keys left behind in a surviving series entry's `occurrenceRooms`/
`occurrenceAwayRooms` maps (pointing at a since-deleted occurrence's
booking id) are left as orphaned, harmless data rather than pruned —
never read again once that booking id no longer resolves to anything,
same "orphaned docs left in place, harmless" precedent this codebase
already accepts elsewhere (e.g. old `divisionRules` docs).

### Tournament ↔ rink schedule conflicts

Both domains reserve real ice through the exact same `createBooking`/
`createBookingSeries` transaction (`TournamentMatch.blocksIce`+`bookingId`,
`RinkScheduleEntry.bookingId`/`seriesId`), so a genuine collision between
them already failed safely — `SlotUnavailableError` — but with no
awareness that the *other* domain, specifically, was what was in the way,
and no way to resolve it without leaving the form and hunting down the
conflicting match/entry manually. `src/lib/rinkConflicts.ts`
(`findSlotConflict`/`resolveSlotConflict`) closes that gap without adding
a new source of truth: given a clubId/zoneId/date/startTime, it reads the
one real `slotLocks` doc for that slot (same doc `createBooking` itself
locks against) and, if occupied, traces the lock's `bookingId` back to
whichever collection references it — `tournamentMatches` by `bookingId`,
`rinkScheduleEntries` by `bookingId` or (for a recurring entry) the
booking's own `seriesId` — returning a `SlotConflict` with a
human-readable label and, when the slot is owned by one of these two
planning tools, an `ownerId` staff can act on. A slot held by a plain
customer booking (found in neither collection) still returns a
`SlotConflict`, deliberately with no `ownerId` — this app never lets a
tournament/schedule form silently cancel a real customer's reservation on
the other's behalf, so both callers below only ever offer a "replace"
choice when `ownerId` is set, and just show an informational notice
otherwise.

Both directions are wired the same way, per the explicit product ask
("obe naraz" — proactive in the form *and* reactive on submit):

- **`RinkSchedulePage.tsx`** (single, non-recurring entries only — see
  below) debounces `findSlotConflict` on every rink/zone/date/time change
  and shows an inline `text-status-warning` notice under the form while
  the slot is already taken. On submit, a caught `SlotUnavailableError`
  re-runs the same lookup; if it resolves to an owned conflict, `confirm()`
  offers to cancel it (`resolveSlotConflict`, which calls
  `deleteTournamentMatch`/`deleteRinkScheduleEntry` — never a bare
  `cancelBooking`, so the owning planning doc doesn't get left behind
  pointing at a cancelled booking) and retries the same create call.
- **`TournamentDetailPage.tsx`**'s manual "Add match" form can create
  several matches in one submit (one per zone row, e.g. all three thirds
  at once), so the same proactive lookup runs *per zone* and the reactive
  replace-or-skip decision is made *per zone* too — declining to replace
  one zone's conflict doesn't abort the other zones' matches, it just
  skips that one and reports which zones were left out
  (`slotUnavailableForZones`).

**Deliberately out of scope for this pass**: the three batch schedule
generators (round-robin/knockout/groups, which can create dozens of
matches — and thus dozens of potential conflicts — across computed time
slots in one call) and both Excel bulk importers
(`TournamentMatchImportPanel.tsx`/`RinkScheduleImportPanel.tsx`) still
just fail a colliding row the same way they always did, with no
conflict-aware replace flow; a recurring `RinkScheduleEntry` (`repeat`
checked) is also excluded from the reactive replace path specifically —
`createBookingSeries` already skips any individually-conflicting
occurrence rather than throwing, so a thrown `SlotUnavailableError` there
only means *every* occurrence collided, which isn't a single "replace
this one thing" case the existing confirm-dialog UX fits.

### Real time-interval overlap detection (not just exact-slot matching)

`findSlotConflict` above only ever matches an *exact* zoneId+date+
startTime key — the same thing `createBooking`'s own transaction locks
against. That's fine for the customer-facing `/book` flow (times are
always picked from `computeDaySchedule`'s generated grid, which never
overlaps itself), but staff-entered times on `RinkSchedulePage.tsx` and
`TournamentDetailPage.tsx`'s manual form are free text — and sessions
here are explicitly **not** all on a clean hourly grid to begin with (a
configurable cleaning/prep break between sessions, `TimeSlotConfig.
breakMinutes`, means a real start time can be anything, e.g. 11:30 or
14:35). Two bookings with *different* exact start times can still
genuinely overlap the same physical ice — this surfaced as a real bug
seeding demo data: a 'full'-ice booking at 11:30 was accepted even
though both halves of that same rink were already booked 11:00–12:00,
since `createBooking`'s lock only ever checks the one exact zoneId it
was given, never any other zone on the same rink.

`findOverlapConflict` (`lib/rinkConflicts.ts`) closes this with a real
interval check: given a rink/zone/date/start/duration, it fetches every
`confirmed`/`pending` booking on that rink+date and flags one whose
[start, end) genuinely overlaps — on the *same* zone directly, or against
*every* zone on the rink when either side is `'full'` (since `'full'`
occupies the whole rink either way). Two zones of the *same* split mode
(e.g. two different thirds) never overlap each other by construction, so
they're not cross-checked; two *different* split modes (half vs third)
also aren't — this app has no stored mapping of which half corresponds to
which thirds, so that specific cross-check stays a documented gap rather
than a guess, consistent with how much precision the rest of the
conflict-detection code already aims for.

`RinkSchedulePage.tsx`'s create form and `RinkScheduleEditModal.tsx` both
now run `findOverlapConflict` proactively (debounced, on every
rink/zone/date/time/duration change) and — this being the one that
actually matters, since `createBooking`'s transaction itself never throws
for a same-zone-different-time or cross-zone overlap — reactively before
ever calling `createRinkScheduleEntry`/`rescheduleRinkScheduleEntry`.
Since more than one existing booking can block a single `'full'` request
(e.g. both halves already taken), the reactive check loops: resolve one
conflict, re-check, repeat, until the slot is genuinely free or staff
declines a replace. `findSlotConflict`'s exact-match lookup is kept as a
fallback inside the existing `catch (SlotUnavailableError)` branch, for
the narrow race where someone else books the exact same slot in the gap
between the proactive check and the actual write.

**The same gap existed on the public `/book` page itself, not just the
staff-side forms.** `BookingPage.tsx`'s zone buttons only greyed out an
exact `${zoneId}__${time}` match against `slotLocks` (via
`fetchLockedSlots`) — so a zone genuinely occupied by an ad-hoc-timed
booking (e.g. a rink-schedule entry at 11:30) could still show as bookable
at, say, 11:00 if nothing held that exact key. `computeOverlapBlockedKeys`
(`lib/schedule.ts`) is the display-side equivalent of `findOverlapConflict`
— given a rink's already-computed `ScheduleRow[]` and that day's real
`Booking` docs (fetched once via `fetchBookingsInRange`, not one query per
candidate cell), it returns the full set of blocked `${zoneId}__${time}`
keys using the same interval-overlap + `'full'`-blocks-everything rule,
merged into `BookingPage.tsx`'s existing `lockedSlots` check. `BookingModal.tsx`
also runs `findOverlapConflict` reactively before ever calling
`createBooking` (non-recurring bookings only, same scope boundary as the
staff-side forms) — unlike the staff flow, a blocked customer booking is
never offered a "replace" option, since a customer can never cancel
someone else's reservation. Deliberately **not** extended to the 14-day
day-picker dots or the week-view `AvailabilityGrid` heatmap in this pass —
those stay on the faster exact-match `lockedSlotsRange` check, since
they're approximate at-a-glance indicators rather than what actually gates
a real booking attempt.

### Alternating "striedačka" TV board + free-ice-for-rent listing

A second physical kiosk screen, distinct from the hallway TV
(`/rozvrh?display=tv`) — a club asked for a TV at the players' bench
("striedačka") that cycles between that same live schedule and a new
"voľné ľady na prenájom" (free ice available to rent) listing, which the
club previously tracked by hand in an external spreadsheet (date, day
name, time range, rink, an occasional price/zone-restriction note like
"len krajná tretina — 80 €"). `FreeIceSlot` (`src/types/index.ts`,
`src/lib/freeIceSlots.ts`) is a small new collection for that same list,
now live in the app — deliberately **not** a real reservation (it never
touches `bookings`/`slotLocks` at all, unlike `RinkScheduleEntry`), since
it's advertising copy for ice that's still open, not ice already taken.
`note` is one free-text field covering both price and any zone
restriction together, since neither has a structured field anywhere in
this app's data model yet (see the payment-scaffold section above) — this
mirrors how `RinkScheduleEntry.teamName` is also plain free text rather
than a structured registry. Managed via a new plain CRUD admin page,
`FreeIceSlotsPage.tsx` (`/admin/volne-lady`, linked from `HeaderMenu.tsx`
next to "Spravovať rozvrh"), gated to the same `isTrainer() ||
isStaffMember()` check as the rest of this planning domain — deliberately
no conflict-detection/booking integration at all, unlike
`RinkSchedulePage.tsx`, since there's no real slot being reserved here.

`RinkScheduleBoardPage.tsx`'s fetch/poll/compute logic and its kiosk
rendering were both extracted out so the new alternating screen could
reuse them exactly rather than duplicating either: `useRinkScheduleBoardData`
(`src/hooks/useRinkScheduleBoardData.ts`) owns the bookings/entries/
matches fetch-and-poll (including the `today`-recomputed-per-poll and
`visibilitychange` fixes already documented above) and the live/next/
later item computation; `RinkScheduleTvGrid.tsx` owns the per-rink column
rendering (the measure-and-shrink `RinkBoardColumn`, the rental-color
accent, etc.) as a component callers wrap in their own `flex-1 min-h-0
flex gap-3` container. `RinkScheduleBoardPage.tsx` itself now just calls
both; `formatRoomLine` moved to `lib/utils.ts` since it's shared by both
the grid and that page's own plain (non-TV) list view.

`RinkScheduleAlternatingBoardPage.tsx` (`/rozvrh/strieda`) composes
`useRinkScheduleBoardData` + `RinkScheduleTvGrid` (live board) with a new
`FreeIceBoard.tsx` component (the free-ice listing, grouped by date in a
two-column grid mirroring how the club's own spreadsheet already laid
this out, wrapped in `ScaleToFit` so an arbitrary number of upcoming
dates/slots never needs scrolling) — a `setInterval`-driven `slide` state
cross-fades between the two (CSS `opacity`/`pointer-events`, not
mounting/unmounting, so neither side ever re-fetches mid-cycle). Unlike
`/rozvrh`/`/turnaje`, this path has no non-kiosk variant at all — it's
always a kiosk screen, so `App.tsx`'s TV-mode chrome-stripping check now
also matches this path unconditionally (not gated behind `?display=tv`
the way `/rozvrh`/`/turnaje` are). The cycle interval is a plain
`?interval=<seconds>` query param (default 10, minimum 3) rather than a
stored setting — matching this app's established "one route, query
params pick the case" pattern and letting staff change it per-screen just
by editing the saved/bookmarked URL, with no admin UI needed for a single
number. `firestore.rules` opens `freeIceSlots` to public read (the kiosk
has no login) with writes restricted to the same trainer/staff roles as
`rinkScheduleEntries`.

### Free ice import becomes the public booking source

A follow-up request changed what `FreeIceSlot` actually *is*: the club
will receive this same "free ice" data as a real Excel file from whoever
maintains it, and explicitly wants `/book` (the public booking page) to
show customers **only** the time slots listed there — not the full
TimeSlotConfig/ScheduleOverride-generated schedule `computeDaySchedule`
has always produced. Per an explicit three-way confirmation: (1) this is
a full replacement, not a filter layered on top of the old schedule; (2)
a rink/date with no `FreeIceSlot` entry shows as closed on `/book`, with
no fallback to the old generated schedule; (3) a restriction note like
"len krajná tretina" must resolve to a real, specific bookable zone, not
stay purely informational.

**`FreeIceSlot` gained a real `zoneId`.** It's no longer just advertising
copy — it names exactly which zone a customer reserves. Resolved either
by staff directly (a Zone `<select>` next to Rink on `FreeIceSlotsPage.tsx`'s
manual form) or by the new bulk importer (below). `note` stays free text
for price/extra info only (e.g. "80 €", "jednorazová akcia – 150 €") —
still no structured price field anywhere in this app's data model (see
the payment-scaffold section). Booking one still goes through the exact
same public `createBooking` transaction every other `/book` reservation
uses — `FreeIceSlot` only decides what's *offered*, the atomic
double-booking protection is completely unchanged.

**`freeIceSlotsToScheduleRows` (`lib/schedule.ts`) is the new row
generator**, living alongside `computeDaySchedule` rather than replacing
it — `computeDaySchedule` itself is untouched and still backs every
staff-side tool (`AdminCreateBookingModal.tsx`, the admin QR panel,
`TournamentDetailPage.tsx`'s manual-match zone picker): staff still need
to see/plan against the full day regardless of what's publicly
advertised. Only `BookingPage.tsx` (and the `AvailabilityGrid.tsx` week
heatmap it feeds, refactored to take pre-computed `rowsByDate` instead of
a `TimeSlotConfig`/`ScheduleOverride` pair it used to compute from
internally) switched its source — fetching `FreeIceSlot` docs across the
visible 14-day range (`fetchFreeIceSlotsRange`, same `clubId`+`date>=/<=`
shape as `fetchLockedSlotsRange`, backed by a matching
`firestore.indexes.json` composite index) and generating every rink's
`ScheduleRow[]` from that alone. A rink/date with zero entries returns an
empty array — by design, the day shows "closed," there is no fallback.

**Known, accepted gap**: the admin QR panel's quick-registration
(`?zone=&date=&time=`) deep links still derive their duration from
`TimeSlotConfig.slotDurationMinutes`, independent of whether that exact
zone/time is actually in the current free-ice listing — scanning an old
QR code can still open a booking form for a slot nobody's currently
advertising. Left as-is for this pass since fixing it would mean
reworking the QR panel (a staff tool, deliberately out of scope here) to
generate its codes from `FreeIceSlot` too; `computeOverlapBlockedKeys`
still runs against whatever rows the page is now sourcing, so the usual
interval-overlap protection applies regardless of where a row came from.

**Bulk import**: `parseFreeIceWorkbook`/`downloadFreeIceImportTemplate`
(`lib/excel.ts`) mirror `parseRinkScheduleWorkbook`'s conventions exactly
— plain ASCII Slovak headers (Hala/Datum/Od/Do/Zona/Cena), the same
`.xlsx`/`.csv`/`.txt` dual input via `parseSimpleCsv` (SheetJS's own CSV
date-guessing already proved unreliable for `d.m.yyyy` strings — see that
importer's own doc comment). Unlike it, "Od"/"Do" are both required —
there's no club-wide default duration to fall back to for a free-ice
slot. `FreeIceImportPanel.tsx` (mirroring `RinkScheduleImportPanel.tsx`)
resolves "Hala" (1-based rink position) and "Zona" the same way that
importer resolves "Ihrisko" — exact zone name/translation/A-B-C letter —
plus two extra synonyms specific to this spreadsheet's own vocabulary:
"krajná tretina" (an edge third — ambiguous between the two physical
edges, so this deterministically picks the first non-middle third) and
"stredná tretina" (the middle third). A blank cell resolves to the rink's
whole-rink zone. `FreeIceSlotsPage.tsx` also shows a standing warning
banner above the form explaining this list now gates real public booking
availability, so staff don't mistake it for the purely-informational tool
it started as.

**`FreeIceBoard.tsx`'s TV display redesigned as a real weekly calendar
grid**, per an explicit "lavý stĺpec časová os 5:00-24:00, ďalšie dni ako
stĺpce" request — the original two-column flat list grouped by date
wasn't readable enough at a glance. Now: a fixed time axis (`HOUR_START`
5, `HOUR_END` 24, never shrinking/growing with the data so the grid's
shape stays stable night to night) runs down the left in `PX_PER_HOUR`
(48px) rows, and one column per day for the **next 7 days starting
today** (not a Monday-first calendar week — today could be any weekday,
and a kiosk board should always show what's coming up next, same
"upcoming N days from today" convention `BookingPage.tsx`'s own 14-day
window already uses) — each with its own day name + short date. Since
this club runs two physical rinks that can both have a slot at/near the
same time, each day column splits into one lane per active rink (a
small "HALA 1 / HALA 2" mini-header row under the date) rather than a
generic overlap-avoidance algorithm — simpler and more meaningful than
arbitrary lanes when the lane count is always exactly the rink count.
Each slot renders as an absolutely-positioned block within its rink's
lane, `top`/`height` computed straight from its start/end time against
the fixed axis (`(minutes - HOUR_START*60) * (PX_PER_HOUR/60)`), showing
time range, the split-zone name (if any), and the price/note — the same
`ScaleToFit` wrapping already used elsewhere scales the whole natural-size
grid (axis + 7 narrow day columns) to fit the kiosk screen, so this
needed no new no-scroll mechanism of its own. Hour gridlines are a CSS
`background-image` repeating gradient on each rink lane rather than extra
DOM nodes, same trick a calendar grid typically uses to avoid rendering
one element per hour row. The empty-state message (`freeIce.boardNone`)
now only shows when truly nothing is scheduled across the whole 7-day
window — a quiet day still renders its full empty grid rather than
disappearing, since an empty but intact calendar reads as "nothing
booked" at a glance, not as a broken screen.

**Correction: percentage-based sizing instead of `ScaleToFit`, so the
grid actually fills the screen.** The first cut above still wrapped the
grid in `ScaleToFit` with a fixed-pixel natural size (`PX_PER_HOUR`
rows × fixed-width day columns) — per an explicit "využi maximálnu šírku
a výšku" (use the maximum width and height) correction, this left real
space unused on a real 16:9 TV: `ScaleToFit` scales uniformly to the
*smaller* of the width/height ratios, so a grid whose natural aspect
ratio didn't match the screen's just sat centered with empty margins on
whichever axis wasn't the limiting one (height, in practice — the grid's
7 narrow fixed-width columns needed far less width than a 1920px screen
offered). Replaced with genuine percentage-based sizing: day columns are
plain `flex-1` (filling whatever width is left after the fixed time
axis), and every slot's `top`/`height` is a `%` of the fixed 19-hour
axis (`TOTAL_HOURS * 60` minutes) rather than a pixel offset — the hour
gridlines' CSS `background-size` is likewise expressed as a percentage
(`100% / TOTAL_HOURS`) so they repeat correctly regardless of the
column's real rendered height. `ScaleToFit` is gone from this component
entirely; only the small header strip (day name/date + rink mini-labels,
`HEADER_HEIGHT`) stays a fixed pixel height, same "chrome doesn't need
to scale, content does" reasoning the main rink-schedule board's own 6vh
header bar already follows. Text sizes switched to `clamp()` tied to
`vw` (same technique the header club-name text and the main TV board's
own "later" cells already use) so they scale continuously with screen
size now that the grid genuinely occupies the full available width.

**Time axis compressed to only the hours actually in use, not a fixed
5:00-24:00 range.** Even after the full-screen fix above, most of the
19-hour axis still sat empty on a real day (free ice mostly clusters in
a few morning/evening windows), so every event's own box stayed short —
its price/restriction `note` line often got clipped by the cell's own
`overflow-hidden` rather than genuinely not fitting the available width.
Per an explicit "zobraz len tie hodiny kde je voľný ľad" (show only the
hours where there's free ice) request: `computeActiveHours`
(`FreeIceBoard.tsx`) scans every slot across the whole visible 7-day
window and keeps only the whole hours at least one of them actually
touches — a quiet stretch (late morning, after 22:00, overnight) is
dropped from the axis entirely rather than reserved as blank space, and
every kept hour gets an equal share of the grid's height
(`100 / activeHours.length` instead of `100 / 19`). This is a shared,
week-wide set (not computed per day) specifically so every day column
still aligns on the same row grid — a slot on Tuesday and a slot on
Friday in the same kept hour still line up horizontally.

`compressedPosition` maps a real clock time to its fractional position
on this compressed axis (e.g. 2.25 = a quarter into the 3rd kept hour).
This works cleanly because every hour a slot spans is, by construction,
itself kept (that's exactly what "touches" means in
`computeActiveHours`), and since hours are consecutive integers, two
hours a single slot spans are still adjacent after compression — a
slot's own span never needs to jump a gap. The one real edge case: an
end time landing exactly on an hour boundary (very common in this data,
e.g. "20:00-21:00") has to resolve to the END of the *previous* hour's
bucket, not the start of whatever hour follows (which might not even be
kept) — handled by nudging the boundary-exact minute back by 1 before
taking its hour, while still computing the fractional position (1.0)
from the real, unnudged minute so the box's bottom edge lands exactly on
the bucket boundary with no rounding seam.

Trade-off accepted explicitly: this gives up the earlier "fixed axis,
same shape every night" property (see the original "časová os zhora dole
od 5:00 do 24:00" request two sections up) — the grid's shape now
depends on the night's actual data, and the hour labels on the left
visibly "jump" across a skipped stretch (e.g. straight from 11:00 to
15:00) instead of listing every hour in between. That jump is the
intended signal that a quiet stretch was compressed away, not a bug.

**Public link to the striedačka board, from the public `/rozvrh` page
itself.** `/rozvrh/strieda` (`RinkScheduleAlternatingBoardPage.tsx`) was
already login-free — it reads the exact same public data
(`useRinkScheduleBoardData`, `freeIceSlots`) the plain `/rozvrh` page
does — but the only link to it anywhere in the app lived on the
staff-only `FreeIceSlotsPage.tsx` (`/admin/volne-lady`), so a customer
had no way to find it on their own. `RinkScheduleBoardPage.tsx`'s header
now shows a second link, "TV striedačka"
(`rinkSchedule.alternatingScreen`), right next to the existing "Zobraziť
ako na obrazovke" one — same treatment, no new route or rule needed since
the page was never actually gated, just unlinked.

**Fixed: "Upraviť" (Edit) on `FreeIceSlotsPage.tsx` looked like it did
nothing.** `handleEdit` always correctly populated the create/edit form's
state (confirmed by inspecting the DOM directly) — the bug was purely
visual: that form sits in a card near the *top* of the page, while the
button that triggers edit mode is a per-row action in the slot list
further down, which on a real club's data (dozens of rows) is well below
the fold. Clicking it silently updated an off-screen form with no visible
change at the click site, reading as "nothing happened" rather than "now
editing." First fix attempt scrolled the same inline form into view on
edit; per explicit follow-up feedback ("radšej popup okno... rovnaký
princip je pri úprave rozvrhu") that was replaced with a real modal
instead — `FreeIceSlotEditModal.tsx`, mirroring
`RinkScheduleEditModal.tsx`'s own pattern for the sibling rink-schedule
domain (same `Dialog` primitives, same per-field layout), minus that
modal's conflict-detection (this page never had any to begin with — see
its own doc comment). The top-of-page form is now create-only again
(`handleSubmit` always calls `createFreeIceSlot`, no more
`editingId`-driven dual mode); clicking "Upraviť" on a row opens the
modal with that slot's values regardless of scroll position, closing on
save or cancel.

**Fixed: dropdown ("rolldown") menus showed black text when opened.**
Every `<select>` on these two admin pages (and their matching edit modals,
`RinkScheduleEditModal.tsx`/`FreeIceSlotEditModal.tsx`) already had
`text-white` on the closed `<select>` box, but that class only styles the
box itself — the browser's native opened option list ignores the
parent's Tailwind classes and falls back to its own default rendering
(black text), which on this app's dark `bg-background-dark` background
made the open list unreadable. `<option>` elements now carry their own
explicit `bg-background-dark text-white` classes too, which Chrome/
Firefox do respect for the opened list — same reasoning as the closed
box's own styling, just applied to the part of the control the parent's
className doesn't reach.

**"Zoznam voľných termínov" row format: day name first, then date, then
time.** `FreeIceSlotsPage.tsx`'s list table previously led with the raw
ISO date (`2026-10-07`) and no day-of-week at all, per an explicit
"každý riadok začína menom dňa" request — a new leading "Deň" column
(`dayName`, `Intl.DateTimeFormat(i18n.language, { weekday: 'long' })`,
capitalized) now shows the localized weekday name, followed by the date
reformatted to `d.m.yyyy` (`formatDMY`, built directly from the stored
ISO string's own parts rather than via `Date` parsing — no UTC/local
ambiguity to worry about for a pure string reformat), then time,
Hala/Zóna/Poznámka unchanged. Deliberately `Intl`-localized to whichever
language the admin UI is currently in, unlike the TV-board day-name
arrays elsewhere in this app (`RinkScheduleBoardPage.tsx` etc.) — those
stay fixed Slovak because a physical kiosk screen isn't something a
viewer picks a language for, but this is a staff admin page where the
viewer does.

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
