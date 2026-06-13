# Church Website

A complete church website: **Node.js / Express** backend serving an **EJS**-templated
frontend. One project, one Railway deployment, one PostgreSQL database.

## Stack

- Express 4 + EJS (server-rendered, single `layouts/main.ejs` layout)
- PostgreSQL via `pg` (SSL required — Railway)
- Auth: JWT in an httpOnly cookie (no sessions anywhere)
- CSRF: `csrf-csrf` double-submit cookie mode (no session middleware)
- Security: Helmet CSP, `express-rate-limit`, Zod validation, bcryptjs hashing
- Images: Multer (memory) → `file-type` magic-byte check → Cloudinary
- Email: Resend (contact form + daily JSON backup + 500-error alerts)
- Deploys: Railway, building from the GitHub repo (`isaacschell12-afk/church-website`) on push to `main`; CI runs on every PR
- Fonts served locally (Playfair Display + Inter) — no external CDN

## Local development

```bash
npm install
cp .env.example .env      # then fill in real values
npm run migrate           # creates tables + seeds church_info and default admin
npm start                 # runs migrations then boots the server
```

Visit `http://localhost:3000`. Admin login at `/admin/login`
(username/password from `DEFAULT_ADMIN_USER` / `DEFAULT_ADMIN_PASSWORD`).

> **Fonts:** the repo references `/public/css/fonts/*.woff2`. Download the
> Playfair Display and Inter `.woff2` files (e.g. from
> [Fontsource](https://fontsource.org)) and drop them into
> `public/css/fonts/` with the exact filenames listed at the top of
> `public/css/main.css`. They are intentionally **not** loaded from
> `fonts.googleapis.com` because the CSP forbids it.

## Environment variables (13 — all validated on startup)

The server crashes on boot with a full list of any missing vars.

| Var | Notes |
| --- | --- |
| `PORT` | Railway injects this |
| `DATABASE_URL` | Railway PostgreSQL addon |
| `JWT_SECRET` | **min 32 chars** |
| `CSRF_SECRET` | **min 32 chars** — must differ from `JWT_SECRET` |
| `BACKUP_SECRET` | **min 64 chars** — used as the backup Bearer token |
| `BACKUP_EMAIL` | daily backup recipient + 500-error alerts |
| `CHURCH_CONTACT_EMAIL` | contact-form recipient |
| `RESEND_API_KEY` | Resend |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary |
| `CLOUDINARY_API_KEY` | Cloudinary |
| `CLOUDINARY_API_SECRET` | Cloudinary |
| `DEFAULT_ADMIN_USER` | seeded on first migration |
| `DEFAULT_ADMIN_PASSWORD` | seeded on first migration |
| `ADMIN_RESET_TOKEN` | set only while performing a reset, then remove |

**There is NO `SESSION_SECRET`. Do not add one.** This stack uses no session middleware.

Optional (not validated on startup):

| Var | Notes |
| --- | --- |
| `SITE_URL` | Canonical origin for SEO / Open Graph / sitemap. Set to `https://www.TMPCfamily.net` in production (see STEP 7 — also drives the apex→www redirect) |
| `AUTO_BACKUP_HOURS` | Hours between automatic in-app backups; defaults to 24 in production, 0 (off) elsewhere |

---

## Deployment steps

**STEP 0 — Domain.** The domain **`TMPCfamily.net` is already registered at GoDaddy** —
you own it, so there is nothing to buy. DNS is handled in STEP 7 below (GoDaddy → Railway).

**STEP 1 — Railway project from GitHub.** In Railway: **New → Deploy from GitHub repo →
`isaacschell12-afk/church-website`** (authorize Railway's GitHub app if prompted). This
links the repo so Railway **auto-deploys on every push to `main`** and builds PRs. Add the
**PostgreSQL** addon to the project and copy `DATABASE_URL` from the Railway dashboard.

**STEP 2 — Cloudinary.** Free account at cloudinary.com. Copy Cloud Name, API Key, API Secret.

**STEP 3 — Resend.** Free account at resend.com. Verify **`TMPCfamily.net`** as a sending
domain (add the DKIM/SPF records in **GoDaddy → Domain → DNS**). Copy the API key.

**STEP 4 — Generate secrets.** Run once per secret for `JWT_SECRET`, `CSRF_SECRET`, and `BACKUP_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # CSRF_SECRET
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"   # BACKUP_SECRET
```

**STEP 5 — Set the 13 required env variables** in the Railway dashboard. There is no
`SESSION_SECRET` — do not add one. (`SITE_URL` is added later in STEP 7, once the domain
is known; `AUTO_BACKUP_HOURS` is optional.)

**STEP 6 — Deploy.** Railway builds and deploys from the connected GitHub repo — push to
`main` (or hit **Deploy** in Railway). Confirm `GET /health` returns `ok`, and check the
Railway logs show migrations applied and the default admin seeded.

**STEP 7 — Custom domain (GoDaddy → Railway).** In Railway, add both
`www.TMPCfamily.net` and `TMPCfamily.net` (apex) as custom domains, and copy the CNAME
target Railway shows for `www` (e.g. `xxxx.up.railway.app`). GoDaddy cannot CNAME the
apex, so **`www` is the live host and the apex forwards to it**:

1. In **GoDaddy → Domain → DNS**, add a **CNAME**: Host `www` → Value the Railway target,
   TTL default. (Delete any parked `www` CNAME/A record GoDaddy created.)
2. In **GoDaddy → Domain → Forwarding**, forward the apex `TMPCfamily.net` →
   `https://www.TMPCfamily.net`, **Permanent (301)**, forward only (no masking).
3. In Railway, set **`SITE_URL=https://www.TMPCfamily.net`** so canonical links, Open
   Graph tags, and the sitemap all use the canonical host. The app also 301s any
   bare-apex request that reaches it to `www`, so there is no redirect loop with the
   GoDaddy forward.

> Optional hardening (not required): route DNS through the Cloudflare free tier (STEP 14)
> to add DDoS protection, caching, and apex **CNAME-flattening** — which lets the apex
> serve Railway directly instead of forwarding. If you do, keep `www` as the canonical
> host (or flip `SITE_URL` to the apex and adjust the redirect accordingly).

**STEP 8 — Wait 48 hours** for DNS propagation. Do NOT announce the site. Verify on
dnschecker.org that `TMPCfamily.net` resolves worldwide before going public.

**STEP 9 — Giving iframe whitelisting.** Contact Pushpay or Tithe.ly support directly and
request iframe embed whitelisting for `TMPCfamily.net`. This needs a support ticket,
not just a dashboard setting. Allow 1–3 business days.

**STEP 10 — Backups.** Backups now run **automatically inside the app** — every 24h in
production (tune with `AUTO_BACKUP_HOURS`), emailed off-site and stored in the database.
No external scheduler is required. *Optional belt-and-suspenders:* add a cron-job.org job
`POST https://www.TMPCfamily.net/admin/backup`, header `Authorization: Bearer [BACKUP_SECRET]`,
for an independent off-platform trigger.

**STEP 11 — UptimeRobot.** Monitor `GET https://www.TMPCfamily.net/health` every 5
minutes. Enable email alerts. Prevents Railway cold starts and notifies you of downtime.

**STEP 12 — Password reset.** In Railway set `ADMIN_RESET_TOKEN` to any string. POST to
`/admin/auth/reset-password` with JSON body
`{"resetToken":"[token]","username":"[admin username]","newPassword":"[min 12 chars]"}`.
Immediately after success, remove `ADMIN_RESET_TOKEN` from Railway and redeploy.

**STEP 13 — Railway plan.** Starter ($5/mo) required — the free tier sleeps and causes
backup failures. Upgrade to Pro ($20/mo) if monthly visitors exceed 5,000.

**STEP 14 — Cloudflare (optional).** Not needed for the GoDaddy → Railway path in STEP 7;
add it only if you want DDoS protection, caching, apex CNAME-flattening, and a second SSL
layer at no cost. Add `TMPCfamily.net` to the Cloudflare free tier; Cloudflare gives you
two nameservers — in **GoDaddy → Domain → Nameservers**, switch from GoDaddy's defaults to
that Cloudflare pair. Once active, add **proxied** CNAMEs for the apex (Cloudflare flattens
it) and `www`, both pointing to the Railway target, and set SSL/TLS mode to **Full**.

**STEP 15 — Roles.** `superadmin` has full access. `editor` can manage sermons, events,
ministries, staff, and announcements — but cannot access church info, users, or backup.

**STEP 16 — Future changes.** Keep git history. Before any Claude Code session run
`git add . && git commit -m 'before session'` so you can roll back if a session goes wrong.
`main` is protected: changes land via PR, CI must pass, then squash-merge — and the
merge to `main` is what triggers Railway to build and deploy the new version.

**STEP 17 — Cloudinary contingency.** If Cloudinary changes free-tier pricing, existing
image URLs stay valid until account suspension. To migrate: export all `image_url` values
from the DB, re-upload to new storage, then run an
`UPDATE ministries SET image_url = REPLACE(image_url, 'res.cloudinary.com/oldname', 'newdomain.com')`
pattern across all tables.

---

## Project structure

See the top-level folders: `migrations/`, `public/`, `views/`, `routes/`,
`middleware/`, `db/`, plus `server.js` at the root.
