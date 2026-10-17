# Tests

```sh
npm test               # unit tests (Vitest): fraction parser, schema, overlay layout
npx supabase start     # local stack (Docker)
npx supabase db reset  # migrations + fictional seed
npm run test:db        # pgTAP database tests
npm run test:e2e       # Playwright browser tests against the local stack (starts `npm run dev`)
```

## Coverage of the acceptance criteria

| # | Criterion | Tests |
| --- | --- | --- |
| 1 | Create, then find by partial name with different case | `e2e/customers.spec.ts` |
| 2 | Same-name customers coexist and are distinguishable | `e2e/customers.spec.ts`, seed |
| 3 | Photo before any digital specs | `e2e/photos.spec.ts`, `supabase/tests/04_photos.sql` |
| 4 | Mixed fractions and pitch directions save, reload, and appear in the right template slots | `e2e/specs.spec.ts`, `03_revisions.sql`, `fraction.test.ts` |
| 5 | Blank vs zero stay distinct | `e2e/specs.spec.ts`, `schema.test.ts`, `03_revisions.sql` |
| 6 | Hand and thumb mode labelled, no hidden mirroring | `e2e/specs.spec.ts` (left-handed no-thumb) |
| 7 | New revision with correct author; Cancel leaves data unchanged | `e2e/specs.spec.ts`, `03_revisions.sql` |
| 8 | Restore creates a new revision and keeps history | `e2e/specs.spec.ts`, `03_revisions.sql` |
| 9 | Concurrent edits produce a visible conflict | `e2e/specs.spec.ts` (two browsers), `03_revisions.sql` |
| 10 | Failed save/upload keeps entries and allows retry; no orphaned file | `e2e/specs.spec.ts`, `e2e/photos.spec.ts` |
| 11 | Signed-out / nonmember cannot read or modify via UI or API | `02_access_control.sql`, `e2e/access.spec.ts` |
| 12 | Usable at 375 px and desktop; no overlap or clipping | `e2e/layout.spec.ts` (375, 768, 1280 px + print), `overlayConfig.test.ts` |
| 13 | Clean print with identity and date, no controls | `e2e/layout.spec.ts` (print media + Letter PDF) |

`e2e/layout.spec.ts` writes screenshots and a Letter PDF to `test-results/screens/` for a visual check.
