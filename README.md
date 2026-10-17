# ProshopSpeccy

Internal staff app for a bowling pro shop to store, find, view and edit customer fitting spec sheets.

Staff search for a customer, open their measurements drawn on the familiar spec-sheet template, edit values in a form,
and save a new revision. Photos of original paper sheets are kept alongside as reference.

- **Stack:** React + TypeScript (Vite) in the browser; Supabase Auth, Postgres and private Storage behind it.
- **Access:** invite-only. Only active members of a shop (table `staff_memberships`) can read or change anything,
  enforced by row-level security and storage policies, not by the UI.
- **History:** every save is an immutable revision; restoring copies an old revision forward.

## Docs

- [docs/SETUP.md](docs/SETUP.md): connect the hosted Supabase project, apply migrations, invite the first admin, run locally.
- [docs/DECISIONS.md](docs/DECISIONS.md): provisional defaults, open owner decisions, and how the data is modelled.
- [docs/TESTING.md](docs/TESTING.md): how to run the unit, database and browser tests, and what they cover.

## Layout

| Path | What it holds |
| --- | --- |
| `src/measurements/` | The one typed measurement schema and the fraction parser (used for editing, validation, display, print) |
| `src/template/` | Spec-sheet overlay: `overlayConfig.ts` (field positions, finger mapping) and `SpecSheet.tsx` |
| `src/customers/`, `src/fits/`, `src/photos/`, `src/staff/` | Screens and data access per area |
| `public/assets/specSheet550wide.png` | The blank template, decoded from the build brief |
| `supabase/migrations/` | Schema, policies, save/restore functions, storage bucket |
| `supabase/seed.sql` | Fictional local-only fixtures (never pushed to the hosted project) |
| `supabase/tests/` | pgTAP database tests |
| `e2e/` | Playwright browser tests |
