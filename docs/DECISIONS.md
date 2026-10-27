# Defaults, open decisions and data model

## Provisional defaults (from the build brief; easy to change)

| Default | Where it lives |
| --- | --- |
| One current fit per customer in the UI, with full revision history. The `fits` table already allows more named fits later (`is_primary = false`). | `fits_one_primary_per_customer` index; `getCurrentFit()` |
| Name required; phone and notes optional. Search matches partial names in any case (every word must appear) and phone digits in any format. Duplicates are warned about, never blocked; phones need not be unique. | `search_customers`, `find_possible_duplicates` |
| All active staff of a shop can view and edit. Admins manage membership. | `staff_memberships`, `admin_set_staff` |
| Right/left hand and thumb-in/no-thumb are recorded and shown as labels. The template is **never mirrored** for left-handers. | `FitIdentity`, `overlayConfig.ts` |
| Photos are reference only; uploading never creates or verifies measurements. | `PhotosPage` |
| No span conversions and no derived values. Cut-to-cut and actual-cut are stored independently. | schema |
| No per-ball layout tracking. | — |
| Hole sizes are numeric inches (fractions or decimals). Oval and insert details are free text. | `FIELDS` in `src/measurements/schema.ts` |
| Oval angle is in degrees and may be negative; all other numbers are unsigned. | `kind: 'angle'` |
| Photo rotation is stored as metadata and applied on display; the uploaded file is kept byte-for-byte. | `spec_photos.rotation` |
| Photos are 15 MB max, JPEG/PNG/WebP only (enforced by the bucket too). HEIC gets a clear "not supported yet" message. | migration `…300_spec_photos.sql`, `checkPhotoFile()` |

## Open owner decisions

1. **Template orientation and finger mapping.** Currently *provisional*: viewed from above the ball with the thumb
   hole toward the bowler; left upper hole = **middle**, right upper hole = **ring**, same for both hands. A legend on
   every sheet says so. Change `FINGER_MAPPING` in `src/template/overlayConfig.ts` (one file) once confirmed.
2. **Hole-size and oval notation.** If the shop uses drill letters or other notation for hole sizes, the hole fields
   would move from numeric to text. Oval is text today.
3. **Multiple named fits at launch?** The database supports it; the UI shows one.
4. **Connecting to an existing customer database?** Not built; customers are created here.
5. **Signed oval angle / direction convention** for the thumb oval angle.

## Data model

- `shops`, `staff_memberships(shop_id, user_id, role, active)` – who can see what.
- `customers` – name, phone, notes, generated `name_search` and `phone_digits` (trigram-indexed for search),
  `last_spec_at`.
- `fits` – one per customer for now; `current_revision_id` and `lock_version` (optimistic concurrency).
- `fit_revisions` – immutable snapshots (`snapshot` JSONB, `schema_version = 1`), unique `revision_number` per fit,
  `author_id` from the signed-in user, optional `change_note`, `restored_from_revision_id`.
- `spec_photos` – metadata for files in the private `spec-photos` bucket at
  `<shop_id>/<customer_id>/<photo_id>/original.<ext>`; optional link to a revision.

Composite foreign keys keep every row in the same shop as its parent, and the current revision must belong to its fit.

### Measurement snapshot (schema version 1)

Every key is always present; `null` means *not recorded*, which is different from a measured `0`.

- Numbers: `{"entered": "4 3/8", "n": 35, "d": 8}` – the notation as typed plus an exact reduced fraction
  (no floating point). Accepted input: `4 3/8`, `4-3/8`, `3/8`, `4.375`, `.375`, `4`, optional `"`/`in`/`°`.
- Pitches add `"dir"`: `left`/`right` (lateral) or `forward`/`reverse`; `none` only for zero.
- Text fields are strings; `hand` is `right`/`left`; `thumb_mode` is `thumb_in`/`no_thumb`.

Field keys: `hand, thumb_mode, fit_label, middle_hole, middle_oval, middle_lateral_pitch, middle_fr_pitch, ring_hole,
ring_oval, ring_lateral_pitch, ring_fr_pitch, middle_cut_to_cut, ring_cut_to_cut, middle_actual_cut, ring_actual_cut,
thumb_hole, thumb_oval, thumb_lateral_pitch, thumb_fr_pitch, thumb_oval_angle, finger_insert_details,
thumb_system_details, fitting_notes`.

The browser validates for fast feedback, but the database re-parses and validates every save
(`private.normalize_fit_snapshot`), so the two parsers are tested against the same cases.

### Saving

`save_fit_revision(customer, expected_lock_version, snapshot, note)` runs in one transaction: lock the fit row, compare
the lock version (mismatch → HTTP 409 conflict with who saved), skip if nothing changed, insert the revision, move the
current pointer, bump the lock version. `restore_fit_revision` does the same with an old snapshot. Clients cannot write
`fits` or `fit_revisions` directly, and revisions cannot be updated or deleted.

No-thumb mode keeps any saved thumb and span values in the snapshot, but the sheet, the text view and the editor leave
the thumb and span parts out; switching back to thumb-in shows them again.

### Paper sheet intake

Backfilling paper sheets happens on a separate page, `/intake/` (its own Vite entry, `intake/index.html`, with hash
routes so reloads work on GitHub Pages). The app has no link or route to it. Photos go to the private `intake-photos`
bucket and the `intake_items` queue; `claim_next_intake` hands out the oldest waiting sheet (an unfinished claim goes
back after an hour), `release_intake` puts one back or sets it aside as unreadable, and `complete_intake` records the
customer and the copy of the photo saved to their Photos as a spec sheet. Queue rows change only through those
functions.

A sheet can also have a photo of its back (`back_path`, set with `set_intake_back`), since layouts are sometimes drawn
there. Photos are shrunk on the device before upload (`src/lib/shrinkPhoto.ts`: longest edge 2000px, JPEG quality
0.8, original kept when that isn't smaller), so a typical 2–4MB phone photo lands at a few hundred KB. When a sheet is
finished, front and back are copied to the bowler's Photos and the queue copies are deleted, so each photo is stored
once. Even so, about 3000 sheets is more than the Supabase free plan's 1GB of storage is likely to hold.

### Photo files in Cloudflare R2

To stay on free plans, new photo files go to the Cloudflare R2 bucket `proshop-photos` (10GB free, no download
charges) instead of Supabase Storage (1GB free). Records stay in Supabase; `spec_photos.store` and
`intake_items.store` say where each file is, so photos uploaded earlier keep working from Supabase Storage. R2 keys
start with the old bucket name (`spec-photos/<shop>/<customer>/<photo>/<file>`, `intake-photos/<shop>/<item>/<file>`).

The browser never holds an R2 key. The `photo-files` Edge Function (`supabase/functions/photo-files`, deployed with
`verify_jwt` off because the publishable key is not a JWT) asks the database, as the caller, whether the keys are
allowed (`public.r2_keys_allowed`), then returns links that expire after an hour: `get` to view, `put` to upload a
new file, `delete` only for a file no record uses. Its secrets (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_ACCOUNT_ID`) are set in the Supabase dashboard. The bucket's CORS policy allows GET and PUT from the site.

A typed-in paper sheet is not copied: the bowler's spec sheet record points at the queue's R2 file. The site build
sets `VITE_PHOTO_STORE=r2`; local tests use Supabase Storage by default, and can run against the function with
Deno and the local stack's S3 endpoint (`R2_ENDPOINT=http://127.0.0.1:54321/storage/v1/s3`, `R2_REGION=local`, a
`proshop-photos` bucket, and `VITE_PHOTO_STORE=r2 VITE_PHOTO_FILES_URL=http://127.0.0.1:8000`).

## Current spec sheet: one digital version and one paper photo

A bowler can have several digital versions and several paper sheet photos. `fits.current_revision_id` is the current
digital version; `customers.current_photo_id` is the current paper sheet (when empty, the newest spec sheet photo).
"Import specs" on a spec sheet photo opens it beside the editor, like intake; saving adds a new version, links it
to the photo (`spec_photos.imported_revision_id`, since `revision_id` never changes after upload) and makes both
current. Staff can switch either one later: "Make current" in the history points at an existing version without
copying it (Restore still copies), and the "Current paper sheet" switch offers to switch the photo's own version too.

## Ball finder: who owns a ball left in the shop

"Find a ball's owner" (`/find-owner`, linked from the Customers page) takes whatever staff can measure off a ball and
lists the bowlers whose spec sheets are closest, with a match percentage, name and phone. `public.ball_finder_sheets`
returns every saved version of every bowler's specs (only the fields measurable off a ball), and
`src/finder/match.ts` scores them in the browser:

- Each measured field scores 100% on an exact match, falling to 0% at its tolerance: holes and grip sizes 1/16",
  spans and pitches 1/4", bridge and slug size 1/8". Hand, grips and thumb insert match exactly or not at all.
- Spans count double and holes one and a half times, since they tell bowlers apart best.
- A field the sheet left blank scores half, so missing values neither win nor lose; each result says how many
  measurements it compared.
- Spans are compared with the span type picked (no conversion between types). A pitch with no direction picked
  compares the amount only.
- Any number can be typed as a range ("3 7/8 to 4 5/16", or with a spaced dash). A range is a filter: only sheets
  with a value inside it are listed (a blank value is left out too), and they score 100% on that field. "4-3/8"
  with no spaces is still a mixed number.
- Each bowler is listed once, by their best-matching version, current or older (a ball may have been drilled to
  older specs).

Two date filters narrow the sheets, with a month shortcut: the date on the paper sheet (`spec_photos.sheet_date`, read
by the AI reader; a later edit of a version keeps the date of the sheet it was corrected from), or the day the
version was entered in the app. With dates and no measurements, the page lists the spec sheets from those dates.
