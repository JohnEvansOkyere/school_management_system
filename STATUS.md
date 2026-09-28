# Status

Updated: 2026-09-28. **P1–P4 implementation authorized; active.**

Implemented locally: P1 synthetic sessions, live tenant/role checks, restricted PostgreSQL/FORCE RLS, versioned settings, immutable audit and durable private export jobs. P2 academic-year/class setup, searched/paged admission review → decision → acceptance → atomic enrolment, dated transfers and withdrawal. Scheduled plans superseded by withdrawal retain their original history; capacity excludes cancelled plans. Headteacher capacity overrides require audited reasons.

Evidence: 43 real PostgreSQL/API tests, both builds and 3 Chromium workflows pass. Browser verifies setup, enrolment, transfer, withdrawal before a scheduled move, retained history after reload, private export download and denied teacher administration. 375px history screenshot inspected without overflow. Latest dependency audit reports zero vulnerabilities. Admissions/export commit 8fbe0e7 is remote-verified with passing GitHub API/build/browser CI; withdrawal is locally verified and ready for push.

Remaining: managed OIDC/MFA and provider choices/sandbox accounts; P2 guardian/class scopes, imports, attendance, early years/portal and promotion; P3 finance/notices; P4 learning/report/AI and evaluation; academic/finance/school acceptance. No deployment, shared database changes, real communications or provider acceptance claimed. Next: push withdrawal, then guardian rights and teacher assignments.

Agents: main agent owns implementation/integration/status/memory. Earlier small_task (GPT-6 Luna High) built admissions UI/paging; critical_review (GPT-6 Astra Medium) reviewed withdrawal read-only, identified the scheduled-transfer gap and reviewed the correction without further blockers. Original instructions, separate client demo and unrelated outreach note preserved. Evans authorized ongoing feature pushes; deployment/shared DB/real messages remain unauthorized.
