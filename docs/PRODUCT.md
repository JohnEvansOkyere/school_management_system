# Product and delivery plan

Status: proposal for review, 2026-09-28; backend stack accepted by Evans. Supporting evidence: [RESEARCH.md](RESEARCH.md).

## 1. Purpose and audience

Help schools keep reliable records and act on learning needs: **record → understand → assign support → communicate → reassess**. AI assists educators within that workflow. Better administration is useful, but improved learning must be measured; software alone cannot resolve poverty, teacher shortages or inadequate facilities.

Requested coverage is Nursery, Primary and JHS, extensible to SHS. Include KG explicitly, separately from Nursery. Proposed first market: private/independent day schools with roughly 100–1,500 learners. This is a hypothesis to validate with schools, not established market research. Public-school procurement, fees and reporting need separate discovery.

One school is one tenant; campuses belong to a school. A proprietor group can later administer several explicitly authorized schools. Families may have multiple children and guardians; records remain school-scoped.

## 2. First complete pilot

| Area | Included | Deferred |
| --- | --- | --- |
| Foundation | School setup, roles, audit, calendar, import/export, backups | Group-wide administration |
| Learners | Admissions, enrolment history, verified guardians, transfers/promotion | Admissions marketing CRM |
| Attendance | Daily register, corrections, missing-register tracking, follow-up | Persistent offline queue after device research |
| Early years | Observations, narrative progress, authorized collection records | Detailed childcare routines |
| Learning | Versioned curriculum/assessment, report approval, intervention tracking | Content marketplace, autonomous tutoring |
| Finance | Fees, installments, concessions, receipts, allocation, reconciliation, simple expenses | Full accounting, payroll and statutory filings |
| Families | Simple portal and approved notices with delivery status | Extensive two-way messaging |
| Staff/scheduling | Directory, assignments, manual timetable with conflict checks | Full HR and automatic timetable optimization |
| AI | Staff lesson/progress drafts and evidence summaries | Direct child chat and consequential automated decisions |

Library, transport tracking, boarding, biometrics and SHS workflows are later scope. Do not show inert demo actions as available product features.

## 3. Daily experience

Teachers land on today's register, lessons and follow-ups. Accountants land on collections and reconciliation. Headteachers see incomplete registers, support actions and report readiness. Guardians see their children, updates, published progress and permitted fee details. Settings and broad analytics are secondary.

Design for 360/375px phones, keyboard/screen reader access, readable printouts and plain language. Preserve school/period context through navigation; clear private caches when switching school. Show unsaved, saved, queued and published states accurately. Confirm consequential actions using actual affected records and totals.

The first pilot is online with small payloads and retry-safe writes. Provide printable contingency registers and audited later entry. Do not claim full offline support or persist child records in unrestricted localStorage. English UI is proposed initially; select further languages and channels through family research and human translation review. Do not assume email, WhatsApp, smartphone or MoMo access.

## 4. Outcomes and pilot

Propose 2–3 consenting schools, including early years and JHS. Observe current work and establish a baseline, then evaluate one term. Include teachers, finance staff and guardians using shared/basic phones.

| Intended benefit | Measure |
| --- | --- |
| Reliable attendance follow-up | Register completion; time from confirmed absence to reviewed contact |
| More useful learning support | Completed intervention/reassessment; progress on comparable reviewed rubrics |
| Less administrative burden | Observed register/report preparation time and correction effort |
| Financial clarity | Reconciliation variance, unresolved payments and time to close |
| Better family communication | Verified reach, acknowledgement where available and resolved queries |
| Useful AI | Factual accuracy, educator acceptance/editing time, cost and privacy failures |

Targets are agreed after baseline. Attendance or product usage alone does not prove learning gains. Track hosting, storage, provider, AI and support costs per active school. Subscription pricing and payment/messaging charges remain unvalidated; keep SaaS charges separate from learner fees.

## 5. Build order and acceptance

Evans authorized P1–P4 implementation and disposable local migrations on 2026-09-28. Current completion and verification evidence is tracked in [STATUS.md](../STATUS.md); provider and school acceptance remain separate gates.

| Phase | Deliverable | Exit evidence |
| --- | --- | --- |
| P0: discovery | Agree pilot scope, school examples and reviewers; refine remaining tooling | Teacher/accounts/guardian findings; approved report and fee examples |
| P1: foundation | Web/API, identity, two-school isolation, roles, audit/jobs, CI | Real PostgreSQL and API access-denial tests; authenticated browser slice |
| P2: daily work | Learners/guardians, imports, attendance, early years and portal | Save/reload, corrections, historical enrolment and unauthorized-child denial |
| P3: money/messages | Fees, receipts, reconciliation and approved notices | Finance totals signed off; duplicate callbacks safe; provider sandbox evidence |
| P4: learning/AI | Assessments, published reports, support plans, timetable and staff AI | Academic review, immutable reports, AI evaluation and reviewed actions |
| P5: pilot | Approved live onboarding and measured operation | Privacy/provider/security gates, restore drill and school acceptance |
| P6: expansion | Selected later modules and SHS | Fresh scope/policy review and module acceptance |

Each task implements a small complete workflow through UI, API and database. Do not build all screens before enforcing server rules. Tests should cover real failure modes, not merely mirror code. Local verification, deployment and external acceptance are separate evidence levels.

## 6. Decisions for Evans

Accepted stack: **React/TypeScript, Node.js + TypeScript + NestJS + PostgreSQL**, in one modular backend codebase with API and worker processes. Implementation through P1–P4 is authorized; external provider and pilot decisions remain open.

The following recommendations remain for review:

- First market and scope: private day schools; complete pilot defined above.
- AI: educator/staff assistance first, with reviewed actions.
- Finance: fees subledger first; full payroll/accounting later.
- Connectivity: online pilot first; managed offline attendance only if field evidence requires it.

During dependent phases, select identity/hosting/payment/message/AI providers, budget and regions; confirm current legal duties, retention, school grading policy, nursery care rules and support ownership. These details need resolution before their features go live, not a separate document for each unknown.
