# Status

Updated: 2026-09-28. **P1–P4 implementation authorized; active.**

Completed: inspected the existing instructions and client demo; researched Ghana education and relevant safeguards; drafted four focused specifications and a lightweight agent entry point.

Accepted backend: Node.js + TypeScript + NestJS + PostgreSQL. Architecture, layout and engineering references updated to match. Database tooling/providers remain open; implementation has not started.

Codex routing configured: `.codex/config.toml` defaults to Sol Medium and limits spawned agents to two; `.codex/agents/small_task.toml` uses Luna High; `.codex/agents/critical_review.toml` uses Astra Medium in read-only mode. AGENTS.md guides delegation without authorizing application implementation. Installed TOML parsed and matched the staged files; Codex CLI 0.155.1 loaded configuration for `features list` successfully. Live agent/model routing has not been exercised. Start a new trusted-project session to load the configuration.

P1 foundation slice implemented: React/TypeScript web, NestJS API, private disposable PostgreSQL, restricted runtime role/FORCE RLS, synthetic sessions, live school/role checks, CSRF/origin controls, versioned school settings and immutable audit. Migration checksums and build/test CI added. Original instructions/configuration and separate client demo preserved.

Evidence: 14 real PostgreSQL/API tests pass, both builds pass, npm audit reports zero vulnerabilities. Browser sign-in → settings save → visible audit → persisted reload verified; 375px layout visually inspected with no horizontal overflow. CI configuration added, remote CI result not yet verified. Main agent owns implementation; critical_review (GPT-6 Astra Medium) reviewed isolation read-only and identified jobs/auth/test gaps; origin defense and rollback test added.

Remaining: P1 durable worker and managed OIDC/MFA; P2–P4 workflows; provider selection/sandbox acceptance; academic/finance/school review. No external integration, deployment or school acceptance claimed. Next: push this verified slice, then durable jobs and learner enrolment/guardian scopes. Evans authorized ongoing feature pushes; no deployment/shared DB/real-message permission.

Future updates: record the current task, changed paths, verification result, known blockers and next bounded action. Do not copy specifications into this file.
