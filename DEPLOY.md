# Deploying to Railway

This project is configured for a single Railway service backed by a Railway
PostgreSQL database. Config lives in [`railway.json`](./railway.json):

- **Build:** Nixpacks (auto-detects Node from `package.json`)
- **Start:** `npm start` → runs `db/migrate.js` then `server.js`
- **Health check:** `GET /health` (200 once the DB is connected)

## One-time setup (GitHub-connected deploy — recommended)

This path auto-deploys every push to `main`. No CLI needed.

1. Go to <https://railway.app/new> and pick **Deploy from GitHub repo**.
2. Authorize Railway for the GitHub account `isaacschell12-afk` and select the
   **`church-website`** repo.
3. Railway detects `railway.json` and creates the web service. Let the first
   build start — it will fail until the database and env vars exist (next steps).
4. In the project, click **New → Database → Add PostgreSQL**. Railway provisions
   it and exposes a `DATABASE_URL` reference variable.
5. Open the **web service → Variables** tab and add the variables below. For the
   database, use Railway's reference syntax so it always points at the addon:
   `DATABASE_URL = ${{ Postgres.DATABASE_URL }}`
6. Trigger a redeploy (Deployments → ⋯ → Redeploy). Migrations run on boot and
   the default admin is seeded if the `admins` table is empty.
7. Under **Settings → Networking**, click **Generate Domain** to get a public URL.

## Required environment variables

Set these in the Railway service **Variables** tab. `PORT` is injected by
Railway automatically — do not set it. Generate secrets with the commands shown.

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | `${{ Postgres.DATABASE_URL }}` (Railway reference) |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `CSRF_SECRET` | Same generator — must differ from `JWT_SECRET` |
| `BACKUP_SECRET` | `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `BACKUP_EMAIL` | Where weekly JSON backups are emailed |
| `CHURCH_CONTACT_EMAIL` | Where the public contact form delivers messages |
| `RESEND_API_KEY` | From <https://resend.com> |
| `CLOUDINARY_CLOUD_NAME` | From <https://cloudinary.com> |
| `CLOUDINARY_API_KEY` | From Cloudinary |
| `CLOUDINARY_API_SECRET` | From Cloudinary |
| `DEFAULT_ADMIN_USER` | Seeded on first migration |
| `DEFAULT_ADMIN_PASSWORD` | Min 12 chars — **change after first login** |

`ADMIN_RESET_TOKEN` is optional — set it only when performing a password reset,
then remove it.

> Your local `.env` already holds working values for most of these. It is
> gitignored and never pushed — copy the values into Railway's Variables tab by
> hand (don't commit `.env`).

## Alternative: deploy from the CLI

If you'd rather not use the dashboard integration:

```bash
npm i -g @railway/cli
railway login                 # opens a browser to authenticate
railway init                  # create/link a project
railway add --database postgres
railway up                    # build & deploy from this directory
railway variables --set JWT_SECRET=... --set RESEND_API_KEY=...   # repeat per var
railway domain                # generate a public URL
```

With the GitHub integration connected, every push to `main` redeploys
automatically — no `railway up` needed.
