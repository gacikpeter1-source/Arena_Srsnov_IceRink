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
Each rink section renders a `RinkDiagram` (`src/components/RinkDiagram.tsx`)
using `public/rink-diagram.jpg` as a background image with the club's
actual painted rink lines; when a zone is hovered/focused, the diagram
highlights that zone's slice of the ice and dims the rest — so a customer
booking e.g. "Third 2 of 3" can see exactly which physical part of the rink
they're reserving. The dividing-line positions are hardcoded as measured
percentages of image width in `RinkDiagram.tsx` (`BOUNDS`) — if the diagram
image is ever replaced, re-measure and update those percentages, they
won't self-derive from a new image.

Since zone names (e.g. "Full Rink", "Half A") are only unique within a
rink, not club-wide, the admin Excel import/export
(`src/lib/excel.ts`) includes a "Rink" column and resolves zones by
rink name + zone name together, not zone name alone.

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
