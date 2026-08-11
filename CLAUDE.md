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
