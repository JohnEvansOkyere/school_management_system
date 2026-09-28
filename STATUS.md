# Status

Updated: 2026-09-28. **P1–P4 implementation authorized; active.**

Implemented locally: P1 web/API, synthetic sessions, live tenant/role checks, restricted PostgreSQL/FORCE RLS, versioned settings, immutable audit and durable private export jobs. P2 admission review → offer/waitlist/decline → acceptance → atomic enrolment, academic-year/class setup, search/paging and dated transfers with immutable history. Capacity includes scheduled arrivals/departures; headteacher overrides require audited reasons.

Evidence: 38 real PostgreSQL/API tests and both builds pass. Chromium verifies school setup, admission/enrolment, transfer/reload, private export download and denied teacher administration; scheduled/active/ended history labels are verified. 375px history screenshot inspected without horizontal overflow. Dependencies report zero vulnerabilities. Foundation commit 85f89b0 is remote-verified; its GitHub CI passed. Jobs/admissions slice ready for push; expanded browser CI awaits remote evidence.

Remaining: managed OIDC/MFA and provider choices/sandbox accounts; P2 guardian/class scopes, imports, attendance, early years/portal and promotion/withdrawal; P3 finance/notices; P4 learning/report/AI workflows and evaluation; academic/finance/school acceptance. No deployment, shared database changes, real communications or provider acceptance claimed. Next: push this verified slice, then guardian rights and teacher assignments.

Agents: main agent owns implementation/integration/status/memory. small_task (GPT-6 Luna High) built bounded admissions UI/pagination; critical_review (GPT-6 Astra Medium) reviewed isolation/history/jobs read-only. Its decision-history and scheduled-capacity findings were addressed with audit history and regression tests. Original instructions and separate client demo preserved. Evans authorized ongoing feature pushes; deployment/shared DB/real messages remain unauthorized.
