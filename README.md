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
- Email: Resend (contact form + weekly JSON backup)
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
| `BACKUP_EMAIL` | weekly backup recipient |
| `CHURCH_CONTACT_EMAIL` | contact-form recipient |
| `RESEND_API_KEY` | Resend |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary |
| `CLOUDINARY_API_KEY` | Cloudinary |
| `CLOUDINARY_API_SECRET` | Cloudinary |
| `DEFAULT_ADMIN_USER` | seeded on first migration |
| `DEFAULT_ADMIN_PASSWORD` | seeded on first migration |
| `ADMIN_RESET_TOKEN` | set only while performing a reset, then remove |

**There is NO `SESSION_SECRET`. Do not add one.** This stack uses no session middleware.

---

## Deployment steps

**STEP 0 — Domain.** The domain **`TMPCfamily.net` is already registered at GoDaddy** —
you own it, so there is nothing to buy. DNS is handled in STEP 7 / STEP 14 below.

**STEP 1 — Railway project.** Create a Railway project. Add the PostgreSQL addon.
Copy `DATABASE_URL` from the Railway dashboard.

**STEP 2 — Cloudinary.** Free account at cloudinary.com. Copy Cloud Name, API Key, API Secret.

**STEP 3 — Resend.** Free account at resend.com. Verify **`TMPCfamily.net`** as a sending
domain (add the DKIM/SPF records in Cloudflare DNS once STEP 14 is done). Copy the API key.

**STEP 4 — Generate secrets.** Run once per secret for `JWT_SECRET`, `CSRF_SECRET`, and `BACKUP_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # CSRF_SECRET
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"   # BACKUP_SECRET
```

**STEP 5 — Set all 14 env variables** in the Railway dashboard. There is no
`SESSION_SECRET` — do not add one.

**STEP 6 — Deploy.** Confirm `GET /health` returns `ok`. Check Railway logs confirm
migrations applied and the default admin was seeded.

**STEP 7 — Custom domain (GoDaddy → Cloudflare → Railway).** In Railway, add both
`TMPCfamily.net` (apex) and `www.TMPCfamily.net`, and copy the CNAME target Railway
provides for each. Because GoDaddy cannot CNAME the apex, route DNS through Cloudflare
(STEP 14) so the apex can be **CNAME-flattened** to Railway:

1. Complete STEP 14 first (move nameservers to Cloudflare).
2. In Cloudflare DNS add a **CNAME** for `TMPCfamily.net` (apex — Cloudflare flattens it)
   pointing to the Railway target, **proxied** (orange cloud).
3. Add a **CNAME** for `www` pointing to the Railway target, **proxied**.
4. Set Cloudflare SSL/TLS mode to **Full**.

> Prefer not to use Cloudflare yet? In GoDaddy DNS, CNAME `www` to the Railway target and
> use GoDaddy **domain forwarding** to send the apex `TMPCfamily.net` → `www.TMPCfamily.net`.

**STEP 8 — Wait 48 hours** for DNS propagation. Do NOT announce the site. Verify on
dnschecker.org that `TMPCfamily.net` resolves worldwide before going public.

**STEP 9 — Giving iframe whitelisting.** Contact Pushpay or Tithe.ly support directly and
request iframe embed whitelisting for `TMPCfamily.net`. This needs a support ticket,
not just a dashboard setting. Allow 1–3 business days.

**STEP 10 — cron-job.org (weekly backup).** Create an account with a real, monitored
email. Create a cron job: `POST https://TMPCfamily.net/admin/backup`, header
`Authorization: Bearer [your BACKUP_SECRET]`, schedule weekly Sundays 2am, retries 3,
failure notification enabled. Log in monthly — free accounts are purged for inactivity.

**STEP 11 — UptimeRobot.** Monitor `GET https://TMPCfamily.net/health` every 5
minutes. Enable email alerts. Prevents Railway cold starts and notifies you of downtime.

**STEP 12 — Password reset.** In Railway set `ADMIN_RESET_TOKEN` to any string. POST to
`/admin/auth/reset-password` with JSON body
`{"resetToken":"[token]","username":"[admin username]","newPassword":"[min 12 chars]"}`.
Immediately after success, remove `ADMIN_RESET_TOKEN` from Railway and redeploy.

**STEP 13 — Railway plan.** Starter ($5/mo) required — the free tier sleeps and causes
backup failures. Upgrade to Pro ($20/mo) if monthly visitors exceed 5,000.

**STEP 14 — Cloudflare.** Add `TMPCfamily.net` to the Cloudflare free tier. Cloudflare
gives you two nameservers — in **GoDaddy → Domain → Nameservers**, switch from GoDaddy's
defaults to that Cloudflare pair. Once Cloudflare shows the domain as active, do the
apex/`www` CNAME setup in STEP 7. Keep records **proxied** for DDoS protection, caching,
apex CNAME-flattening, and a second SSL layer at no cost.

**STEP 15 — Roles.** `superadmin` has full access. `editor` can manage sermons, events,
ministries, staff, and announcements — but cannot access church info, users, or backup.

**STEP 16 — Future changes.** Keep git history. Before any Claude Code session run
`git add . && git commit -m 'before session'` so you can roll back if a session goes wrong.

**STEP 17 — Cloudinary contingency.** If Cloudinary changes free-tier pricing, existing
image URLs stay valid until account suspension. To migrate: export all `image_url` values
from the DB, re-upload to new storage, then run an
`UPDATE ministries SET image_url = REPLACE(image_url, 'res.cloudinary.com/oldname', 'newdomain.com')`
pattern across all tables.

---

## Project structure

See the top-level folders: `migrations/`, `public/`, `views/`, `routes/`,
`middleware/`, `db/`, plus `server.js` at the root.
