# Setup

The app needs a Supabase project. The hosted project for this shop is
`https://bkvijjqhyiyfkuavmerh.supabase.co` (project ref `bkvijjqhyiyfkuavmerh`).

Nothing in this repo contains a secret. The browser only ever gets the public (publishable/anon) key; every
permission is enforced in the database. **Never put the service-role / secret key in `.env*` or in the app.**

## 1. Database migrations

**Already applied** to the hosted project on 2026-10-17 (all files in `supabase/migrations/`, verified against
the local test stack). The migration filenames match the versions recorded in the hosted project, so nothing needs
re-running. Future schema changes go in new migration files and are applied with:

```sh
npm install
npx supabase login                       # opens the browser once
npx supabase link --project-ref bkvijjqhyiyfkuavmerh   # asks for the database password
npx supabase db push                     # applies only migrations the project has not seen yet
```

`db push` does **not** run `supabase/seed.sql`, so no fictional data reaches the hosted project.

The migrations create the tables, row-level security policies, the save/restore functions and a private Storage
bucket `spec-photos` (JPEG/PNG/WebP, 15 MB limit).

## Open-link mode (currently ON)

The hosted shop "Pro Shop" has `open_access = true`: anyone with the app link can use it without signing in, and
saves are labelled "Shared link". Because the project URL and public key ship inside the app, anyone who has the
link can read and change customer data. History stays immutable and customers can't be deleted.

To require sign-in again, run in the SQL editor, then follow steps 2–4 below:

```sql
update public.shops set open_access = false;   -- rename with: update public.shops set name = '...';
```

## 2. Lock down sign-up (dashboard › Authentication)

- **Sign In / Providers › Email:** keep Email enabled. Turn **off** "Allow new users to sign up".
  (Even if someone did sign up, they would see nothing: access requires an active shop membership.)
- **URL Configuration:** set *Site URL* to where the app is hosted (e.g. `https://specs.yourshop.com`) and add it,
  plus `http://localhost:5173` for development, to *Redirect URLs*. Invite and sign-in-link emails return here.
- Optional: *Email Templates* and a custom SMTP sender so invite emails come from the shop.

## 3. Create the shop and the first administrator

1. Dashboard › Authentication › Users › **Invite user**, with the owner's email. They click the email link, land in
   the app signed in, and can set a password under **Account**.
2. Dashboard › SQL Editor, run (with your own values):

   ```sql
   select private.bootstrap_shop('Your Pro Shop Name', 'owner@example.com', 'Owner Name');
   ```

   This creates the shop and makes that account an active **admin**. It can only be run from the SQL editor.

## 4. Add more staff

1. Invite their email in Authentication › Users › Invite user.
2. In the app, an admin opens **Staff**, enters the email and display name, and clicks Add.
   "Remove access" deactivates a person immediately; their past revisions keep their name.

## 5. Run or deploy the app

```sh
cp .env.example .env.local
# .env.example already holds the project URL and its public publishable key.
# Never put the secret/service-role key here.
npm run dev        # http://localhost:5173
npm run build      # static files in dist/, deployable to any static host (Netlify, Vercel, Cloudflare Pages…)
```

On the static host, set the same two `VITE_…` variables and route all paths to `index.html` (single-page app).

## 6. Backups (before relying on this as the only record)

- Database: Supabase Pro plans include daily backups (and optional point-in-time recovery). On the Free plan there
  are no automatic backups: schedule `npx supabase db dump --data-only -f backup-$(date +%F).sql` (with the project
  linked) somewhere safe, or upgrade.
- Photos: Storage objects are **not** included in database backups. Periodically copy the `spec-photos` bucket
  (e.g. with the S3-compatible endpoint and `rclone`/`aws s3 sync`, using credentials kept off the browser app).
- Test a restore once into a separate project.

Orphaned uploads (a file whose record failed to save and could not be cleaned up) can be listed by an admin in the
SQL editor with `select * from private.orphaned_spec_photo_objects;` and removed in the Storage dashboard.

## Local development stack (optional)

Requires Docker.

```sh
npx supabase start     # prints a local URL and publishable key; put them in .env.local
npx supabase db reset  # applies migrations + fictional seed data
npm run dev
```

Seeded fictional sign-ins (password `dev-password-123`): `admin@example.test`, `staff@example.test`,
`staff2@example.test`, and `outsider@example.test` (has an account but no shop access).
