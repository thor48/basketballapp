# Setup

ECTOcooler Hoops runs on the same services as ECTOcooler and ECTOcooler Golf, but every piece is its
own: its own GitHub repo, Vercel project, Supabase project and Clerk application. Nothing is shared
with the other two apps except the accounts the projects sit under, so a change or an outage in one
cannot reach the others.

| Service | Football | Golf | Hoops |
| --- | --- | --- | --- |
| GitHub | `thor48/fantasyfootballapp` | `thor48/golfapp` | `thor48/basketballapp` |
| Vercel project | fantasyfootballapp | golfapp | basketballapp |
| Domain | `ectocooler.com` | `golf.ectocooler.com` | `hoops.ectocooler.com` |
| Supabase project | football | golf | hoops |
| Clerk application | ECTOcooler | ECTOcooler Golf | ECTOcooler Hoops |

The board needs none of the keys: Sleeper's API is public and read from the browser. Steps 1 and 2
are enough to have it live; 3 and 4 add sign-in and stars that follow you between devices.

---

## 1. GitHub

Create an empty private repository named `basketballapp` under `thor48` (no README, no
`.gitignore` — the repo already has both), then from `~/Sites/basketballapp`:

```bash
git add -A
git commit -m "ECTOcooler Hoops draft board"
git remote add origin git@github.com:thor48/basketballapp.git
git push -u origin main
```

## 2. Vercel and the domain

**Add New** → **Project** → import `thor48/basketballapp`. Vercel detects Vite; keep the defaults
(build `npm run build`, output `dist`). Deploy. Every push to `main` deploys from then on.

**Settings** → **Domains** → add `hoops.ectocooler.com`, and add the record it asks for wherever
`ectocooler.com`'s DNS lives:

| Type | Name | Value |
| --- | --- | --- |
| CNAME | `hoops` | `cname.vercel-dns.com` |

The board is now live and works signed out.

## 3. Supabase

**New project** in the ectocooler organization, named `hoops`. Save the database password in your
password manager; the app does not use it.

Supabase's Free plan allows only two active free projects, and football and golf may already be
using them. If the dashboard refuses a third, you can upgrade the organization to Pro or pause a
project that isn't in season.

**SQL Editor** → paste [`supabase/schema.sql`](supabase/schema.sql) → run. **Table Editor** should
now list `starred_players`.

From **Project Settings** → **API**, copy the Project URL into `VITE_SUPABASE_URL` and the `anon`
key into `VITE_SUPABASE_ANON_KEY`. The service-role key is not needed yet; when a server function
needs it, it goes in a name without the `VITE_` prefix, never with it.

## 4. Clerk

**Create application** → `ECTOcooler Hoops`, email sign-in (add Google if you like). Copy the
publishable key into `VITE_CLERK_PUBLISHABLE_KEY`.

Connect it to Supabase, the same two halves as the other apps:

1. Clerk: **Configure** → **Integrations** → turn on **Supabase**, and copy the Frontend API domain
   it shows.
2. Supabase (hoops project): **Authentication** → **Sign In / Providers** → **Third-Party Auth** →
   **Clerk** → paste it as a full `https://` URL.

Both halves are per Clerk instance. When you add a production instance on `hoops.ectocooler.com`,
its domain (`https://clerk.hoops.ectocooler.com`) has to be registered in Supabase as well. It is a
different issuer from the football and golf instances, so registering one of theirs does nothing
here.

## 5. Environment variables

Put the three values in `.env.local` for local work (see [`.env.example`](.env.example)) and in
Vercel → **Settings** → **Environment Variables** for production, then redeploy. `VITE_` values are
compiled into the bundle, which is why only the publishable and anon keys are used.

## Checking it

Sign in, star a player, then open the site on your phone signed in as the same user: the star is
there. If stars do not save, the browser console shows the Supabase error:

- `PGRST301`, *No suitable key was found to decode the JWT*: the Clerk domain registered in Supabase
  is missing or is a different instance's.
- `42501`, row-level security: the Clerk side of the Supabase integration is off, so the token has
  no `role` claim.
