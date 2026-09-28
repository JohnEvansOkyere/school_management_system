# Status

Updated: 2026-09-28. **P1–P4 implementation authorized; active.**

Implemented locally: P1 synthetic sessions, live tenant/role checks, restricted PostgreSQL/FORCE RLS, settings, audit and durable private exports. P2 admission review/enrolment, academic years/classes, search/paging, historical transfers/withdrawal, reviewed guardian rights and initial child portal. Guardian links begin pending, require headteacher verification and retain revoked grants/identity; academic fields are excluded from billing/pickup/contact-only access. Cancelled scheduled enrolments remain in history without consuming capacity.

Evidence: 50 real PostgreSQL/API tests, both builds and 4 Chromium workflows pass. Two browser sessions verify pending denial, billing-only views, academic details/reload and immediate revocation. 375px guardian screenshot inspected without overflow. PostgreSQL tests cover tenant/role/child denial, immutable reviews, atomic rollback, race handling and paging beyond 500 historical links. Withdrawal commit 3022857 is remote-verified with passing GitHub API/build/browser CI. Guardian slice is ready for push; remote CI pending.

Remaining: managed OIDC/MFA and provider choices/sandbox accounts; P2 teacher assignments, imports, attendance, early years/collection, expanded portal and promotion; P3 finance/notices; P4 learning/report/AI and evaluation; academic/finance/school acceptance. No deployment, shared database changes, real communications or provider acceptance claimed. Next: teacher class assignments and scoped daily rosters.

Agents: main agent owns API/schema/integration/tests/status/memory; small_task (GPT-6 Luna High) built guardian UI/paging; critical_review (GPT-6 Astra Medium) reviewed isolation/history read-only and its history-pagination finding was fixed. Original instructions, client demo and unrelated outreach work preserved. Evans authorized ongoing feature pushes; deployment/shared DB/real messages remain unauthorized.
