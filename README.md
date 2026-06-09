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

**STEP 0 — Buy a domain** (~$12/yr, Namecheap). Nothing else works without it.

**STEP 1 — Railway project.** Create a Railway project. Add the PostgreSQL addon.
Copy `DATABASE_URL` from the Railway dashboard.

**STEP 2 — Cloudinary.** Free account at cloudinary.com. Copy Cloud Name, API Key, API Secret.

**STEP 3 — Resend.** Free account at resend.com. Verify your church domain as a sending
domain. Copy the API key.

**STEP 4 — Generate secrets.** Run twice for `JWT_SECRET` and `BACKUP_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"   # BACKUP_SECRET
```

**STEP 5 — Set all 13 env variables** in the Railway dashboard. There is no
`SESSION_SECRET` — do not add one.

**STEP 6 — Deploy.** Confirm `GET /health` returns `ok`. Check Railway logs confirm
migrations applied and the default admin was seeded.

**STEP 7 — Custom domain.** Add `www.yourchurch.com` in the Railway dashboard. Copy the
CNAME target Railway provides. In Namecheap DNS add a CNAME record for `www` pointing to
that target.

**STEP 8 — Wait 48 hours** for DNS propagation. Do NOT announce the site. Verify on
dnschecker.org that `www.yourchurch.com` resolves worldwide before going public.

**STEP 9 — Giving iframe whitelisting.** Contact Pushpay or Tithe.ly support directly and
request iframe embed whitelisting for `www.yourchurch.com`. This needs a support ticket,
not just a dashboard setting. Allow 1–3 business days.

**STEP 10 — cron-job.org (weekly backup).** Create an account with a real, monitored
email. Create a cron job: `POST https://www.yourchurch.com/admin/backup`, header
`Authorization: Bearer [your BACKUP_SECRET]`, schedule weekly Sundays 2am, retries 3,
failure notification enabled. Log in monthly — free accounts are purged for inactivity.

**STEP 11 — UptimeRobot.** Monitor `GET https://www.yourchurch.com/health` every 5
minutes. Enable email alerts. Prevents Railway cold starts and notifies you of downtime.

**STEP 12 — Password reset.** In Railway set `ADMIN_RESET_TOKEN` to any string. POST to
`/admin/auth/reset-password` with JSON body
`{"resetToken":"[token]","username":"[admin username]","newPassword":"[min 12 chars]"}`.
Immediately after success, remove `ADMIN_RESET_TOKEN` from Railway and redeploy.

**STEP 13 — Railway plan.** Starter ($5/mo) required — the free tier sleeps and causes
backup failures. Upgrade to Pro ($20/mo) if monthly visitors exceed 5,000.

**STEP 14 — Cloudflare.** Add your domain to Cloudflare free tier. Point Namecheap
nameservers to Cloudflare. Enable proxy mode for DDoS protection, caching, and a second
SSL layer at no cost.

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
