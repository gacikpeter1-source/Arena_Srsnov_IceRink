# Arena_Srsnov_IceRink
Reservation system for icerink for public or any group or companies
Mobile-first reservation app for ice hockey rink time slots. 
No login required. Multi-tenant/config-driven for easy re-branding.

See CLAUDE.md for architecture and build instructions.

## Getting started

```bash
npm install
cp .env.example .env   # fill in your Firebase project config
npm run dev
```

## Status

Initial scaffold: tooling, design tokens, data model, Firebase wiring,
staff auth, booking flow (with atomic Firestore-transaction slot
reservation), self-service cancellation (email link + manual lookup),
and a read-only admin dashboard skeleton are in place.

Zones and operating hours in `scripts/seed.mjs` are **placeholders** —
replace them with the real Arena Sršňov rink layout and hours before
going live (see `npm run seed`). PWA icons (`public/icon-192.png`,
`public/icon-512.png`, `apple-touch-icon.png`) also still need real
assets derived from the club logo.
