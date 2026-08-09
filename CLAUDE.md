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

## Multi-tenant / re-brand requirement
All club-specific data (name, logo, colors, zones, hours, contact, 
paymentsEnabled) in one config (Firestore `clubs` collection or config 
file). New customer deployment = config + env vars + new Vercel 
project, zero code changes.

## Future integration (separate repo, not this session)
Arena-Srsnov will own the production domain. Landing page there will 
offer "Reserve Icerink" (this app) and "Training Reservation" 
(Arena-Srsnov), joined via Next.js/Vite Multi-Zone-style rewrites once 
this app has a live Vercel URL.

## First task
Do NOT write code yet. Inspect Arena-Srsnov and report: Firestore 
schema/collections, calendar/booking component structure, registration 
form patterns, email mechanism (provider/trigger/templates), Tailwind 
design tokens. Then propose a data model for: clubs, zones, timeSlots, 
bookings. Wait for confirmation before scaffolding.
