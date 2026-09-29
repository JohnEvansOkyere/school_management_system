# Engineering and edtech audit — solution checklist

Audit date: 2026-09-29 · Commit audited: `7f9fb42` · Auditor: Claude Code (Opus 5.5), main agent only, no subagents.

## 1. How this audit was run

| Check | Result |
| --- | --- |
| `npm run build` (API + web) | Pass. Web bundle 302 kB (86 kB gzip). |
| `npm test` (101 backend tests against real PostgreSQL 17, runtime role `school_app`) | **101/101 pass** (36 s). |
| `npx playwright test` (9 browser workflows) | **9/9 pass** this run (1.6 min). STATUS.md records an earlier 8/9 timeout. |
| `npm audit` | 0 vulnerabilities. |
| Live DB inspection (local disposable cluster) | 30 tables; every application table has RLS **and** FORCE RLS; no `school_id` table lacks a policy; 7 SECURITY DEFINER functions, all pin `search_path`; `school_app` has no DELETE/TRUNCATE grants. 55 of 87 foreign keys have no supporting index. |
| Code review | Core (`main.ts`, `access.ts`, `commands.ts`, `database.ts`, worker, identity), learners/imports, frontend shell/API client, migrations 001, CI, env and scripts. Other services were sampled, not line-reviewed. |

Local passing tests are not deployment, hosted verification or school acceptance.

## 2. What works well (keep it)

- **Tenant isolation is defence-in-depth**: restricted runtime role, FORCE RLS on every table, transaction-local `app.school_id`/`app.user_id`, live membership recheck on every request (`backend/src/core/access.ts`).
- **Retry-safe commands**: payload-bound operation receipts with advisory locks (`backend/src/core/commands.ts`); optimistic versions on mutable records.
- **Historical integrity**: immutable enrolment intervals with supersession, attendance roster snapshots, append-only observation versions, reviewed report revisions.
- **Human-in-the-loop by design**: guardian links, CSV identity matches, exceptional pickup, and report publication all require a reasoned headteacher review.
- **Safe guardian scoping**: separate academic/billing/pickup/contact rights, re-evaluated on every read.
- **Hosted DB hygiene**: TLS `verify-full` enforced, role-name checks prevent the app from using `postgres`, separate worker credential, preview-by-default migration runner.
- **Honest documentation**: STATUS/MEMORY clearly separate local evidence from acceptance. Early-years design (no scores, no diagnoses, school-supplied policy provenance) is sound pedagogy.

## 3. Checklist

Severity: **P0** breaks, or blocks any real school use · **P1** must fix before a pilot · **P2** will hurt at scale or over time · **P3** product/edtech gaps against the plan.

### P0 — broken now or blocks any real deployment

- [x] **API refuses every non-localhost request.** `backend/src/main.ts:15` rejects any `Host` other than `127.0.0.1/localhost/[::1]`; `:16` only accepts `http://` origins; `:30` binds `127.0.0.1:3018`. Any hosted deploy returns `403 Local host required` for all traffic.
  - Done 2026-09-29 (code and tests only; nothing deployed): `ALLOWED_HOSTS`, `ALLOWED_ORIGINS` (https), `PORT`, `HOST`, `TRUST_PROXY` in `core/config.ts`; API tests cover allowed/denied hosts and origins.
  - Fix: read `ALLOWED_HOSTS`, `ALLOWED_ORIGINS` (https), `PORT` and `HOST` from env; keep the localhost defaults for dev; set `trust proxy` to the platform's proxy count only.
  - Verify: API test with a configured host/origin passes; unknown host/origin still returns 403.
- [ ] **No real sign-in exists.**
  - Interim 2026-09-29: platform-admin-created accounts with temporary password and forced change (`AUTH_MODE=password`). Managed provider, SMS OTP (Arkesel/Moolre) and MFA remain open. Login only works with `DEV_AUTH=synthetic-local` from loopback (`identity.controller.ts:16`). No school can use the product until managed OIDC (or reviewed password + recovery) and MFA for headteachers/accountants ship.
  - Fix: choose the identity provider (Supabase Auth is the lowest-friction option given the DB choice), map provider subject → `users`, keep server-side sessions/CSRF, add MFA for privileged roles, reviewed account recovery for shared/recycled phone numbers.
  - Verify: login, logout, revocation, MFA challenge and cross-school denial tests against the provider sandbox.
- [x] **Hosted schema is 7 migrations behind the code.** Supabase is at 012; code requires 013–019 (identity RLS, roster snapshots, imports, collection, early years). Deploying current code against Supabase breaks attendance, imports, collection and early-years endpoints, and leaves `users`/`sessions` without the 013 policies.
  - Done 2026-09-29: hosted ledger was already at 019; Evans applied 020 with the reviewed runner. Still open: the API refusing to boot on an older ledger (`/readyz` reports it today).
  - Fix: after review, apply 013–019 with `npm run db:migrate:supabase -- --apply`; add a startup check that refuses to boot when the migration ledger is behind the bundled migrations.
  - Verify: `npm run db:check:supabase` reports no pending files; the startup check fails on an older ledger in a test.
- [x] **Supabase admin credential still sits in `.env`.** `DATABASE_MIGRATION_URL` (the `postgres` administrator) is present although MEMORY.md records it as removed. `.env` also contains two stray `sslmode=` lines (URL fragments), and `DATABASE_TARGET` is set to `supabase`, so `npm run dev:api` runs local development against the hosted database (which is still at migration 012).
  - Done 2026-09-29: `DATABASE_MIGRATION_URL` and stray `sslmode=` lines removed, `DATABASE_TARGET=local`; `db:check:supabase` passes as `school_app`. Rotating the Supabase admin password remains Evans's call.
  - Fix: delete `DATABASE_MIGRATION_URL` and the stray lines now; rotate the Supabase admin password if the file was ever shared, synced or backed up; set `DATABASE_TARGET=local` for day-to-day development.
  - Verify: `grep -c DATABASE_MIGRATION_URL .env` returns 0; `npm run db:check:supabase` still passes with `school_app`.
- [ ] **No production build/serve path.**
  - Partly done 2026-09-29: `Dockerfile` (API + worker), API serves the built web app with SPA fallback and security headers, startup refuses a database behind the migrations, runbook in docs/DEPLOYMENT.md. Still open: an actual staging deploy and the browser suite against it. The SPA is only served by the Vite dev server with a proxy; there is no static hosting config, Dockerfile, process manager, or HTTPS/CSP setup for the web app.
  - Fix: serve `frontend/dist` from a static host/CDN (or from Nest with `ServeStatic`) behind HTTPS with a strict CSP; one deployment manifest for API + worker; `secure` cookies always on outside local.
  - Verify: a staging deploy passes the browser suite against the staging URL.

### P1 — fix before a pilot school uses it

- [ ] **No backups or restore drill.** Architecture targets RPO ≤1 h / RTO ≤4 h, but nothing is configured or rehearsed.
  - Fix: enable Supabase PITR (paid tier) or scheduled `pg_dump` to separate storage; write and rehearse a restore runbook that keeps external sends disabled.
  - Verify: timed restore into a scratch project; record RPO/RTO achieved.
- [ ] **No observability.** Only 5xx errors are logged (`core/errors.ts`); no access log, latency, queue age, worker health or alerting. A request ID is generated but not logged on success.
  - Partly done 2026-09-29: structured JSON request logs, `/healthz`, `/readyz` (DB + ledger via migration 020 function). Still open: worker heartbeat/queue age, error alerting.
  - Fix: structured request logs (request ID, route, status, duration, school ID — no child data), `/healthz` and `/readyz` (DB + migration ledger), worker heartbeat and queue-age metric, error alerting (e.g. Sentry with PII scrubbing).
  - Verify: an induced 500 and a stalled worker both raise an alert.
- [ ] **Login rate limiter is not deployable.** In-memory per-IP map (`main.ts:20`): behind a proxy every user shares one IP bucket (30 attempts/min for the whole school), it resets on restart, and doesn't work across instances. `scryptSync` (`identity.controller.ts:19`) blocks the event loop per attempt.
  - Fix: rate-limit by account + client IP in PostgreSQL or Redis; use async `scrypt`; this largely goes away with managed identity.
  - Verify: load test 50 concurrent logins; p95 of other endpoints unaffected.
- [x] **Local DB script picks the wrong PostgreSQL.** `scripts/local-db.sh:5` uses `pg_config --bindir`; on this machine that resolves to Anaconda, which has no `pg_ctl`, so `npm run db:start` fails.
  - Done 2026-09-29: honours `PG_BIN`, prefers `/usr/lib/postgresql/*/bin`, fails clearly; `db:start` verified with Anaconda first on `PATH`.
  - Fix: honour `PG_BIN` if set, otherwise prefer `/usr/lib/postgresql/*/bin`, and fail with a clear message if `pg_ctl` is missing.
  - Verify: `npm run db:start` works with Anaconda first on `PATH`.
- [x] **Tests share one persistent database, so they get slower and flakier.** The local DB now holds ~15k guardian links, ~10k audit events and ~10k receipts from repeated runs; STATUS.md records a browser timeout caused by this.
  - Done 2026-09-29: `scripts/with-test-db.sh` clones a fresh database from a migrated template per run; browser suite 9/9 three runs in a row (~1 min each). An earlier series had one run time out while machine load average was ~44 from other processes.
  - Fix: create a fresh database from a migrated template per test run (`CREATE DATABASE … TEMPLATE`), or truncate synthetic fixtures before each suite; keep CI on a fresh cluster (already true).
  - Verify: the browser suite runs 10 times in a row without timeout.
- [ ] **Silent list caps contradict the "no silent truncation" rule.** Classes and years are capped at 100 (`learners.controller.ts:11,15`), the audit view at 50 (`tenancy.controller.ts:31`), and audit export at 500 rows with a `truncated` flag (`jobs/worker.ts:32`). A school with ~15 classes per year exceeds 100 classes in 7 years; a busy term produces >500 audit events.
  - Partly done 2026-09-29: classes (year filter), academic years and audit view are paged; tests use 150 classes and 2,000 audit events. Audit export is still capped at 500 rows.
  - Fix: page these endpoints like learners/admissions; filter classes by academic year; stream audit exports by date range into a private file (CSV) instead of a 500-row JSON blob in `outbox_jobs.result`.
  - Verify: API tests with 150 classes and 2,000 audit events.
- [ ] **CSV onboarding will reject typical Ghana school spreadsheets.** Exact header `admission_number,full_name,date_of_birth`, ISO dates only (`imports.service.ts` `validDate`), 200 rows / 40 kB / one class per batch, and no guardian columns. Excel in Ghana usually exports `DD/MM/YYYY` and headers like "Admission No.".
  - Fix: accept a documented header alias list and `DD/MM/YYYY` with an explicit format picker and preview; offer a downloadable template; add a reviewed guardian-contact import that creates **pending** links (never auto-verified).
  - Verify: fixtures exported from Excel/Google Sheets with Ghana locale import cleanly; ambiguous dates (e.g. 03/04/2015) require explicit format choice.
- [x] **Frontend crashes on non-JSON errors.** `frontend/src/lib/api.ts:3` calls `response.json()` unconditionally; a proxy 502/504 HTML page or network drop shows "Unexpected token <" and leaves no retry path.
  - Done 2026-09-29: `api.ts` maps network/HTML/5xx failures to a plain retry message; browser test covers a 502 HTML page and a refused connection.
  - Fix: check `content-type`, map network/5xx to a plain-language "Connection problem — your changes were not saved, try again" message, keep the operation ID for retry.
  - Verify: browser test with the API stopped mid-save.
- [ ] **Data-protection gate.** Ghana's Data Protection Act, 2012 (Act 843) requires registration with the Data Protection Commission and a lawful basis for child data; Supabase region, processor contract and retention are not yet documented.
  - Fix: register (or confirm Veloxa's status), sign Supabase DPA, choose region, write retention/deletion and breach-response procedures, draft school controller/processor agreement.
  - Verify: signed documents referenced in STATUS.md before any real learner record is loaded.

### P2 — will hurt at scale or over time

- [ ] **Unbounded table growth.** Expired sessions and old command receipts are never purged.
  - Fix: worker job that deletes sessions >30 days past expiry and receipts older than the retry window (e.g. 30 days); needs a narrow DELETE grant to `school_worker` only.
- [ ] **55 of 87 foreign keys lack an index.** Fine at one school; becomes join/lock cost across many tenants.
  - Fix: add composite `(school_id, fk)` indexes for FKs used in joins or history screens; verify with `EXPLAIN` on the guardian portal, roster and report queries at 50-school synthetic volume.
- [ ] **Worker throughput and leases.** One job per school per second, 30 s lease with no heartbeat, serial loop (`jobs/worker.ts`). Long exports will be retried while still running.
  - Fix: extend lease while working, process a small batch per cycle, expose queue-age metric.
- [ ] **Single long page for all modules.** `frontend/src/main.tsx` mounts every permitted module for a headteacher at once, and each module fetches its data on mount (each call is a DB transaction). This is slow on 3G and hard to use.
  - Fix: add a router with role landing pages (teacher → today's register; head → incomplete registers/approvals; guardian → my children), lazy-load modules, keep school/period in the URL.
  - Verify: Lighthouse on a throttled "Slow 4G" Moto G profile; first usable screen < 3 s.
- [ ] **Dense code style.** Services put many statements on single very long lines (99 lines over 400 characters). Reviews and diffs are hard and bugs hide.
  - Fix: add Prettier + ESLint (typescript-eslint, `no-floating-promises`) in CI; format in one dedicated commit so history stays readable.
- [ ] **No frontend unit tests, coverage or automated accessibility checks.**
  - Fix: Vitest + Testing Library for module state logic; `@axe-core/playwright` in the existing browser suite at 375 px.
- [ ] **Dates computed in two places.** Most "Ghana today" logic uses PostgreSQL `Africa/Accra`; `early-years.service.ts:57` uses Node's clock. Clock skew between app host and DB can disagree near midnight.
  - Fix: take "today" from the database in the same transaction everywhere.
- [ ] **Connection pool of 5** per process with every request in a transaction and row locks. Morning register submission is the peak.
  - Fix: make pool size configurable; load test 30 teachers submitting registers at once against the Supabase session pooler.

### P3 — edtech/product gaps against the plan (PRODUCT.md §2–3, DOMAIN_RULES)

- [ ] **Attendance follow-up loop missing.** No missing-register tracking for heads, no repeated-absence follow-up tasks, no absence notices. Attendance currently records but does not yet drive action, which is where the educational value is.
- [ ] **Printable contingency register** (PRODUCT.md §3) is not built; no print stylesheet exists. Ghana schools need this for power/network outages.
- [ ] **Offline tolerance.** Full offline is deferred correctly, but add a minimal "unsaved changes kept in memory + retry" state for registers and a service worker for the app shell only (no child data in storage).
- [ ] **Promotion / end-of-year roll-over** is not built; without it the second academic year requires manual re-enrolment of every learner.
- [ ] **Accountant role has no UI or endpoints.** Fees, receipts and reconciliation (P3) are the most-requested features in Ghana private schools and the likely purchase driver.
- [ ] **Family channel.** No SMS/WhatsApp notice path; most guardians will not log into a web portal. Plan approved notices with delivery status via a Ghana SMS provider sandbox first.
- [ ] **Primary/JHS learning workflows** (subjects, continuous assessment + exam weighting, terminal reports, BECE-oriented JHS records) are not started; the product currently serves Nursery/KG reporting only.
- [ ] **AI features** (staff lesson/progress drafts) are not started. Build the evaluation harness (factual grounding, cross-school/child access, cost) before the first prompt, per ARCHITECTURE §5.
- [ ] **Outreach vs. product readiness.** 500 schools are being invited while the app cannot yet run outside localhost. Make sure demo meetings use the separate demo and promise only dated milestones.

## 4. Suggested order

1. P0 items 4 (secret cleanup) and the `local-db.sh` fix — minutes, no approval needed beyond Evans's review.
2. Host/origin config + production serving + health/readiness + logging → deploy a **staging** environment on synthetic data.
3. Managed identity + MFA → hosted migrations 013–019 (explicit approval) → backups/restore drill.
4. Onboarding fixes (CSV formats, guardian import, promotion), attendance follow-up and printable register.
5. Finance (P3) and SMS notices, then Primary/JHS assessment and AI with its evaluation suite.

Items touching hosted migrations, deployment or real messages still need Evans's explicit approval per AGENT.md.
