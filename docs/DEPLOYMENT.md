# Deployment and pilot runbook

Status: prepared and tested locally only. Nothing has been deployed; hosted migrations 021–028 are not applied. Every step below that touches hosted systems needs Evans's explicit approval at the time.

## 1. What is deployed

One container image (`Dockerfile`) run twice:

| Process | Command | Notes |
| --- | --- | --- |
| API + web app | `node backend/dist/main.js` | Serves `/api/v1`, the built web app (`WEB_DIST`), `/healthz`, `/readyz`. Run **one** instance until the login limiter moves out of memory. |
| Worker | `node backend/dist/jobs/worker.js` | Durable jobs (audit export). Needs `WORKER_DATABASE_URL`. |

The API refuses to start in production if the database ledger is behind `backend/migrations` (`assertMigrated`); `/readyz` reports the same state.

## 2. Environment (production)

| Variable | Purpose |
| --- | --- |
| `NODE_ENV=production`, `DATABASE_TARGET=supabase` | Enables secure cookies, hosted-database rules |
| `DATABASE_URL` | Supabase session-pooler URL for the restricted `school_app` role, `sslmode=verify-full`, `sslrootcert` path |
| `WORKER_DATABASE_URL` | Same for `school_worker` |
| `ALLOWED_HOSTS`, `ALLOWED_ORIGINS` | Public host name(s) and `https://` origin(s) |
| `TRUST_PROXY` | Number of proxy hops in front of the API (usually `1`) |
| `AUTH_MODE=password` | Interim email + temporary-password sign-in (until managed auth / SMS OTP) |
| `PORT`, `HOST`, `WEB_DIST` | Set by the image (`3018`, `0.0.0.0`, `/app/frontend/dist`) |
| `MFA_ENCRYPTION_KEY` | Long random secret used to encrypt authenticator secrets (required in production; back it up — losing it forces MFA re-enrolment). `MFA_REQUIRED` defaults to on in production |
| `MFA_REQUIRED=false` | Pilot decision (Evans, 2026-09-29): schools sign in with the temporary password they must change at first login; authenticator MFA and SMS OTP are configured later with each school. Note this also makes the platform administrator password-only, so use a long unique password for that account |
| `SMS_SEND_ENABLED` | Leave **unset** for the pilot start: notices are approved and shown in the guardian app, and SMS deliveries are recorded as "SMS switched off". To enable later set `SMS_SEND_ENABLED=true`, `SMS_PROVIDERS=arkesel,moolre`, `SMS_SENDER_ID`, `ARKESEL_API_KEY`/`MOOLRE_API_KEY`, and test each adapter with a sandbox number first (they have not been run against a live provider) |
| `AI_ENABLED` | Leave **unset** for the pilot start (AI off) |

Never put the `postgres` administrator URL on the API host. It is only used from Evans's machine for `db:migrate:supabase` and `platform-admin`.

## 3. First-time setup (each step needs approval)

1. Choose the host: any container platform with HTTPS, a health check on `/healthz`, and a region close to Supabase `eu-central-1`. Put the site behind HTTPS only (HSTS is sent by the API).
2. Review then apply migrations 021–028 with the runner (preview first): `npm run db:migrate:supabase`, then `-- --apply`. Verify `npm run db:check:supabase`.
3. Create the platform administrator: `DATABASE_TARGET=supabase npm run platform-admin -w backend -- "Evans" you@example.com` (prints a one-time password; change it at first sign-in).
4. Deploy API and worker with the variables above; confirm `/readyz` is 200 and the login page loads over HTTPS.
5. Sign in as the platform admin, create the pilot school and its headteacher (share the temporary password privately). The headteacher creates staff and guardian accounts.
6. Rotate the `postgres` password after step 3 and keep it out of `.env`.

## 3b. Deploying on Vercel (chosen 2026-09-29)

Layout (`vercel.json`): the web app is the static build of `frontend/dist`; `api/index.js` wraps the same Nest API as one Vercel Function (`/api/v1/*`, `/healthz`, `/readyz`); `api/cron.js` replaces the always-on worker. `.vercelignore` keeps `outreach/`, `.local/`, `.env*` and docs out of uploads.

1. **Apply the hosted migrations first** (from your machine, with the temporary `DATABASE_MIGRATION_URL` in `.env`): `npm run db:migrate:supabase` (preview: must list 021–028 as pending), then `npm run db:migrate:supabase -- --apply`, then `npm run db:check:supabase`. Remove `DATABASE_MIGRATION_URL` from `.env` afterwards and rotate the `postgres` password.
2. Create the project from the GitHub repo (Root Directory = repo root; the framework preset stays "Other"; `vercel.json` sets install/build/output).
3. Environment variables (**Production only**, so previews never touch the hosted database):

| Variable | Value |
| --- | --- |
| `DATABASE_TARGET` | `supabase` |
| `DATABASE_URL` | `school_app` session-pooler URL with `?sslmode=verify-full&sslrootcert=bundled` (the Supabase CA ships in `backend/certs`) |
| `WORKER_DATABASE_URL` | `school_worker` URL, same TLS options (used only by the cron function) |
| `DB_POOL_MAX` | `2` (each function instance keeps its own pool; raise only if Supabase connection limits allow) |
| `AUTH_MODE` | `password` |
| `MFA_REQUIRED` | `false` (pilot decision) |
| `MFA_ENCRYPTION_KEY` | any long random string (the app refuses to start in production without it, even with MFA off) |
| `TRUST_PROXY` | `1` |
| `CRON_SECRET` | random string of at least 16 characters (Vercel sends it to `/api/cron`) |

`ALLOWED_HOSTS`/`ALLOWED_ORIGINS` are not needed: on Vercel the deployment's own hostnames are trusted automatically. Add both when you attach a custom domain.
4. Deploy, then check `https://<your-domain>/readyz` returns 200 (it reports database and migration ledger).
5. Create the platform administrator with `DATABASE_TARGET=supabase npm run platform-admin -w backend -- "Evans" you@example.com` (needs the admin URL once more), sign in, create the pilot school and headteacher.

Serverless limits to know about:
- **Cron frequency depends on your Vercel plan.** `vercel.json` schedules `/api/cron` daily (`0 6 * * *`) because Hobby allows nothing more frequent. Audit exports and, later, queued SMS only move when it runs. On Pro change the schedule to `* * * * *`.
- The login rate limiter is per function instance, so it slows guessing but does not cap it globally. Use long unique passwords, and move it into the database before growing beyond the pilot.
- Functions are limited to 30 s (cron 60 s) and 4.5 MB request bodies; CSV imports (40 kB) and normal requests are well within that.
- Cold starts add about a second to the first request after idle.

## 4. Data protection gate (before any real learner record)

- Register with, or confirm exemption from, the Data Protection Commission (Act 843).
- Sign the Supabase DPA; record the region; document retention, deletion and breach-response procedures.
- Sign a controller/processor agreement with the pilot school that states plainly that the platform administrator can open the school's data for support (each entry is audited and visible to the headteacher), that SMS and AI features are off, and who to contact for corrections.
- Guardian consent/notice text approved by the school.

## 5. Backups and restore drill

- Enable Supabase point-in-time recovery, or schedule `pg_dump` to separate storage; target RPO ≤ 1 h, RTO ≤ 4 h.
- Before go-live, restore into a scratch project with external sends disabled, run `db:check:supabase` and `/readyz` against it, and record the time taken.

## 6. Monitoring

- Uptime check on `/readyz`; alert on 503.
- Structured JSON request logs (request ID, route, status, duration, school ID; no child data) — ship them to the host's log service; alert on 5xx rate.
- Weekly: `platform.*` audit events per school, worker queue age (a metric is still to be built), disk and connection usage in Supabase.

## 7. Known limits for the pilot

- Pilot sign-in is email + temporary password with forced change for every role (`MFA_REQUIRED=false`). TOTP MFA is built and can be switched on per deployment; SMS OTP (Arkesel/Moolre) is not built. Payments (mobile money) are not integrated: fees are recorded by the accountant only.
- Notices: headteacher-approved, in-app for every recipient; SMS is off until a provider is configured and tested.
- One API instance (in-memory login rate limiter); no automatic scaling.
- Terminal reports can be corrected only through a reasoned reopening and a new revision; payment reversals exist, fee waivers do not.
- The Anthropic adapter is untested against the live API; AI stays off.
- No offline mode: schools use the printable register during outages.

## 8. Pilot go-live checklist

- [ ] Data protection gate (section 4) complete
- [ ] Migrations 021–028 applied and verified; `postgres` password rotated
- [ ] Staging or first deployment passes: sign-in, create school, year/classes, learners, attendance, assessment, fees, promotion (use the synthetic demo school first)
- [ ] Backups enabled and a restore drill recorded
- [ ] Headteacher trained (accounts, registers, follow-up, scores, fees); one week of dual running with paper registers
- [ ] Support contact and incident procedure agreed with the school
- [ ] Rollback plan: keep the previous image tag; migrations here are additive, so rolling the image back is safe
