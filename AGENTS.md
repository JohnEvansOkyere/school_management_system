# Agent entry point

Read [MEMORY.md](MEMORY.md) first, then [AGENT.md](AGENT.md) and [STATUS.md](STATUS.md). AGENT.md contains Evans's instructions; this file does not override them.

**Current scope: documentation for review. Do not begin implementation until Evans authorizes it.**

## Read only what the task needs

| Task | Additional reading |
| --- | --- |
| Scope or next milestone | Relevant section of [PRODUCT.md](docs/PRODUCT.md) |
| Foundation, auth, schema, infrastructure | Relevant sections of [ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| School feature | Matching section of [DOMAIN_RULES.md](docs/DOMAIN_RULES.md), plus the relevant architecture boundary |
| AI | Architecture §5 plus the underlying domain rule |
| Ghana policy or demo adaptation | Relevant source/finding in [RESEARCH.md](docs/RESEARCH.md) |

Use heading searches and bounded reads. Do not load unrelated specifications, reread unchanged documents or create per-task boilerplate files.

Inspect working state; implement one bounded slice; verify its actual behavior. Keep school isolation, historical records and human approval intact. Never equate mocks, local tests, deployment and school acceptance.

Update STATUS.md briefly after work and append only significant decisions to MEMORY.md. Keep task acceptance evidence in the handoff; follow AGENT.md's reporting and authorization rules.

## Model routing and delegation

Project Codex configuration uses GPT-6 Sol with Medium reasoning for the main agent.
Use subagents when a concrete, bounded task benefits from delegation:
- Route small, clearly specified edits, documentation and focused searches to `small_task` (GPT-6 Luna, High).
- Route school isolation, permissions, schema, historical-record reviews and difficult debugging analysis to `critical_review` (GPT-6 Astra, Medium; read-only).
- Handle ordinary implementation in the main agent. Avoid delegation for trivial work and overlapping file edits.
- Report which agent/model was used. The main agent verifies the combined result and owns STATUS.md and MEMORY.md updates.

Routing is the main agent's judgment, not an automatic switch of its own model or a spending guarantee. If a configured model/agent is unavailable, report it and keep the task in the main agent; do not silently upgrade to a more expensive model.
Delegation does not authorize application implementation, migrations, deployment or external communications. Current scope and AGENT.md approval rules still apply.

KEEP PUSHING NEW FEATURES IMPLEMENTATION TO GITHUB AFTER TESTING.