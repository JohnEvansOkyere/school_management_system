Maintain a file called MEMORY.md. After any significant decision, about direction, format, content, approach, or strategy, add an entry:

## [Date], [Decision]
**What was decided:** [the choice made]
**Why:** [the reasoning]
**What was rejected:** [alternatives considered and why they were ruled out]

Read MEMORY.md at the start of every session before doing anything. Never contradict a logged decision without flagging it first.

## 2026-09-28, Compact planning before implementation
**What was decided:** Prepare a Ghana-focused Nursery/KG/Primary/JHS SaaS plan with an SHS extension path and staff-facing AI proposals. Preserve original instructions and existing files. Following Evans's clarification, keep four core specification files and a task-specific agent reading path; implementation awaits review.
**Why:** Ground the product in the demo and current research while limiting agent context and token cost.
**What was rejected:** A large set of overlapping specifications, reading every document each session, starting implementation now, or treating proposed stack/provider choices as approved.

## 2026-09-28, Backend stack accepted
**What was decided:** Evans approved Node.js + TypeScript + NestJS + PostgreSQL for the backend. Use one backend codebase for API and worker processes, with AI integrations inside it initially. This supersedes the earlier FastAPI/SQLAlchemy/Alembic proposal. Implementation remains pending authorization; database tooling and providers remain open.
**Why:** A shared TypeScript language with the proposed React frontend and NestJS module conventions suit the school's operational workflows and initial AI API integrations.
**What was rejected:** Proceeding with the earlier Python backend proposal or introducing a separate Python AI service before a concrete need exists.

## 2026-09-28, Project Codex model routing authorized
**What was decided:** Evans requested installation of the proposed routing setup. Use project-scoped Sol Medium as the main/default agent, Luna High for bounded small tasks, and read-only Astra Medium for critical reviews. Limit spawned agents to two and keep delegation guidance in AGENTS.md. Application implementation still awaits authorization.
**Why:** Balance implementation quality and usage cost while preserving project approval rules and keeping configuration local to this project.
**What was rejected:** Changing machine-wide settings, automatic main-model switching claims, silently upgrading unavailable models, or treating configuration validation as live routing proof.

## 2026-09-28, Implementation and feature pushes authorized
**What was decided:** Evans authorized implementation through P1–P4 with React/TypeScript, NestJS/TypeScript and PostgreSQL, routine decisions, continuous feature checks, and migrations only in dedicated disposable local databases. His subsequent instruction authorizes ongoing verified feature pushes to GitHub. Preserve original instructions and the separate client demo. This supersedes the planning-only authorization state without editing the original instructions.
**Why:** The current explicit goal supplies implementation and local migration authority; the follow-up supplies push authority.
**What was rejected:** Deployment, shared database changes, real messages, invented school approval, or calling local/mocked provider work externally verified.

## 2026-09-28, Local foundation tooling and identity boundary
**What was decided:** Use npm workspaces, pinned dependencies/lockfile, direct node-postgres transactions and reviewed checksum-tracked SQL migrations. Develop on Node 22.22.3 and a private disposable PostgreSQL cluster without a TCP listener. Synthetic local accounts support browser/API checks; managed OIDC/MFA remains a separate unresolved provider gate. Runtime is a non-owner role with FORCE RLS, and commands recheck live membership and CSRF.
**Why:** Explicit SQL supports tenant-inclusive constraints and transaction-local context, while the local identity path permits meaningful workflow tests before provider selection. Patched Nest 11.2.6 and Vite 7.3.6 resolve the initial audit findings.
**What was rejected:** Custom production password recovery, superuser runtime connections, SQLite/mock-only isolation evidence, importing the demo or touching a shared database.

## 2026-09-28, Durable jobs and historical enrolment commands
**What was decided:** Use a separate non-owner worker role with immutable job inputs, leased attempts, bounded retry/dead-letter states and live actor reauthorization. Audit export is the first private job; it sends nothing externally. Admission decisions use explicit transitions and payload-bound transactional operation receipts. Class dates use inclusive starts and exclusive ends; enrolment intervals cannot overlap and completed intervals cannot be rewritten. Capacity checks include scheduled arrivals/departures and headteacher overrides require an audited reason.
**Why:** These invariants provide a verified foundation for later attendance, report, payment and communication commands while preserving tenant boundaries and historical records. Native browser date automation was unreliable, so a Chromium regression suite verifies actual form fills, clicks, reloads and downloads.
**What was rejected:** Treating queued work as completed, retrying unknown operations indefinitely, overwriting class history, ignoring future reservations, treating a synthetic reviewer as school acceptance, or assuming provider approvals from local tests.

## 2026-09-28, Withdrawal preserves scheduled history through supersession
**What was decided:** Dated withdrawal closes effective enrolment with a required reason, optimistic version and transactional retry receipt. When withdrawal precedes a scheduled transfer, mark affected original intervals superseded and create the shortened effective interval; original dates/reasons remain immutable and visible. Capacity and later commands exclude superseded plans. Apply only forward migrations to the disposable local database.
**Why:** A scheduled move must not block an earlier departure or consume cancelled capacity; rewriting already closed history would destroy the record of the reviewed plan. Astra review identified the scheduled-transfer case, then reviewed the correction.
**What was rejected:** Rejecting all earlier departures, deleting planned enrolments, rewriting closed dates, retaining cancelled capacity, or treating local synthetic review as school acceptance.

## 2026-09-28, Reviewed guardian rights and fresh child authorization
**What was decided:** Headteachers create pending guardian links, verify explicitly with reasons and revoke with reasons; rights are separate academic/billing/pickup/contact grants. Replacing rights requires revocation and a new reviewed link. Snapshot guardian identity and retain immutable review history. Guardian list/detail reads recheck live membership and verified unrevoked own links; only academic rights expose birth date and effective class history. Use paged/searchable staff history so old active grants remain manageable.
**Why:** Sponsorship or shared identity does not imply academic or pickup authority. Fresh rights checks and transaction locks serialize revocation with reads. Candidate functions reveal only active guardian IDs/names to authorized heads, without widening membership access. Local synthetic verification enables workflow evidence while managed identity and real school review remain open gates.
**What was rejected:** Automatically verified links, editable historical grants, granting all child fields to billing-only guardians, cached rights as authority, phone/name-only matching, or silent history truncation.

## 2026-09-28, Dated whole-class teaching scope
**What was decided:** Headteachers grant class roster access to existing live teacher memberships with reviewed reasons and immutable date ranges/name snapshots. A teacher request requires one unrevoked assignment covering both today's Ghana date and the requested roster date; future/expired grants provide no current access. Revoke and regrant instead of rewriting assignment history. Roster reads lock grants and class rows, exclude superseded/out-of-date enrolments, and return only learner names/admission numbers and internal record IDs. Page/search staff history, class choices and rosters.
**Why:** Login role alone cannot authorize a class or expose learner birth/contact/finance records. Current and record-date checks prevent expired or scheduled grants from reopening access, while class locks serialize roster counts/items with enrolment changes. This establishes the scope for attendance and later reviewed learning workflows.
**What was rejected:** Unscoped teacher learner lists, caller-selected dates as sufficient authority, mutable historical assignments, silently capped class lists, treating class grants as employment records or timetable approval, and unrestricted personal learner profiles.
