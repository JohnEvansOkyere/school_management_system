# Status

Updated: 2026-09-28. **P1–P4 implementation authorized; active.**

Implemented locally: P1 synthetic sessions, live tenant/role checks, restricted PostgreSQL/FORCE RLS, settings, audit and durable private exports. P2 admissions/enrolment, school calendar/classes, historical transfers/withdrawal, reviewed guardian rights/initial portal, dated teacher assignments and minimal scoped rosters. Current and requested roster dates must be covered by the same unrevoked teacher grant; future/expired grants deny access. Assignment/review identity and reasons remain immutable.

Evidence: 57 real PostgreSQL/API tests and both builds pass. Five Chromium workflows verified (four existing flows plus the corrected teacher flow): head grant → eligible dated roster → reload → live revocation/cleared private data → retained history. 375px teacher screenshot inspected without overflow. Tests cover assignment overlap concurrency, idempotency, audit rollback, tenant/role denial, future/expired/revoked scopes, exclusive date bounds, superseded enrolments and paging. Guardian commit b519fa3 is remote-verified with passing GitHub API/build/browser CI. Teacher slice is ready for push; new remote CI pending.

Remaining: managed OIDC/MFA and provider choices/sandbox accounts; P2 imports, attendance, early years/collection, expanded portal and promotion; P3 finance/notices; P4 learning/report/subject scopes/AI and evaluation; academic/finance/school acceptance. No deployment, shared database changes, real communications or provider acceptance claimed. Next: school-open dates and attendance draft/save/submit/correction workflow.

Agents: main agent owns API/schema/integration/tests/status/memory; small_task (GPT-6 Luna High) built teaching UI; critical_review (GPT-6 Astra Medium) reviewed scope/history read-only. Class/grant share locks serialize reads with enrolment writes/revocation. Original instructions, client demo and unrelated outreach work preserved. Evans authorized ongoing feature pushes; deployment/shared DB/real messages remain unauthorized.
