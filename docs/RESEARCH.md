# Research and demo evidence

Checked 2026-09-28. Product implications are design judgments; sources do not certify this SaaS. Refresh the relevant source when implementing a policy-dependent feature. No school interviews or live integrations were completed.

## 1. Ghana evidence

| Evidence | Implication for this product |
| --- | --- |
| UNICEF Ghana's [2025 Education Budget Brief](https://www.unicef.org/ghana/media/8671/file/EDUCATION%20BUDGET%20BRIEF%202025..pdf) describes foundational learning and inclusion gaps. Its [2025 FLAT announcement](https://www.unicef.org/ghana/press-releases/ghana-accelerates-foundational-learning-ministry-education-unicef-and-hempel) emphasizes attendance, assessment and instructional support. | Track specific learning needs, owned support and reassessment; measure pilot impact instead of claiming national improvement. |
| UNICEF's [early childhood overview](https://www.unicef.org/ghana/early-childhood-development) identifies two years of KG; NaCCA's [2019 KG curriculum](https://www.nacca.gov.gh/wp-content/uploads/2019/06/KINDERGARTEN.pdf) describes integrated learning through play. | Keep Nursery and KG distinct; use appropriate observations and narrative reporting. Confirm nursery policy separately. |
| NaCCA publishes [KG/Primary standards-based resources](https://nacca.gov.gh/learning-areas-subjects/new-standards-based-curriculum-2019/), [JHS CCP curriculum](https://nacca.gov.gh/wp-content/uploads/2023/06/ENGLISH-LANGUAGE.pdf) and the [National Pre-Tertiary Learning Assessment Framework](https://nacca.gov.gh/nplaf/). | Version levels, indicators and assessment policies; do not hardcode one school's subjects/weights as national rules. |
| WAEC's [BECE school information](https://waecgh.org/athletics/bece-school/) describes numerical grades 1–9 and continuous assessment; [2024 guidelines](https://waecgh.org/wp-content/uploads/2024/05/2024-BECE-GUIDELINES-SCHEME-AND-STRUCTURE.pdf) describe submission responsibilities. | Separate school, mock and official results. General pages contain older wording; obtain current-year circulars before exports or grading claims. No API was verified. |
| NaCCA's [secondary subject combination guidance](https://nacca.gov.gh/subject-combination-guidelines-secondary-education/) addresses pathways and school capacity. | SHS needs subject enrolment/combinations and policy review, beyond new class labels. |
| NaSIA publishes [inspection guidance](https://www.nasia.gov.gh/inspection/regulation-guides/) and a [2024 inspection handbook](https://www.nasia.gov.gh/wp-content/uploads/SCHOOL-INSPECTION-HANDBOOK_FINAL-NaSIA-APPROVED-VERSION-003-4TH-OCTOBER-2024.pdf). | Provide traceable school records; exports do not establish compliance. Review the applicable handbook before inspection templates. |
| DPC [compliance guidelines](https://dataprotection.org.gh/wp-content/uploads/2025/07/GUIDELINES-TO-DEMONSTRATE-DATA-PROTECTION-COMPLIANCE-1.pdf) reference Act 843 and controller registration. An official [Data Protection Bill, 2025](https://moc.gov.gh/wp-content/uploads/2023/03/DATA-PROTECTION-BILL.pdf) also surfaced. | Verify operative law and child-data duties with counsel/DPC before real data. The DPC indexed extract was available but direct fetch timed out; a bill is not proof of enactment. No statutory retention/breach deadline is assumed. |
| Bank of Ghana lists [approved institutions](https://www.bog.gov.gh/fintech-innovation/approved-institutions/). Paystack documents [Ghana mobile money](https://paystack.com/docs/payments/payment-channels/), [webhooks](https://paystack.com/docs/payments/webhooks/) and [verification](https://paystack.com/docs/payments/verify-payments/). | A candidate integration exists; recheck approval, merchant ownership, pricing and settlement. Paystack is researched, not selected. |
| UNICEF's [AI and children guidance v3, December 2025](https://www.unicef.org/innocenti/reports/policy-guidance-ai-children) addresses privacy, fairness, safety and accountability. | Staff assistance, minimized child data, evidence and human review; no autonomous consequential child decisions. |

Engineering references: [NestJS modules](https://docs.nestjs.com/modules), [runtime validation](https://docs.nestjs.com/techniques/validation), [OpenAPI contracts](https://docs.nestjs.com/openapi/introduction) and [PostgreSQL row security and bypass behavior](https://www.postgresql.org/docs/17/ddl-rowsecurity.html). The accepted backend is Node.js/TypeScript with NestJS and PostgreSQL; dependency versions and database tooling still need selection.

## 2. What the demo establishes

Reference: `/home/grejoy/Projects/demos/school-mangement`, inspected read-only. Read its agent/scope/architecture/README/STATUS files, package manifest and selected types, mock roster, grading, API, finance/performance and write-layer source. No browser/test rerun; its reported test counts are historical claims.

Useful patterns: React/Vite/TypeScript, module/API separation, runtime branding, deterministic fixtures, accessible shared controls and a separate parent shell. Reuse individual components only after ownership/branding review and verification.

Production gaps: data and role selection run in the browser; attendance writes use localStorage. `scopeTo()` rejects mixed-school fixture arrays but is not a real query authorization boundary. SaaS conversion requires new server contracts, not only swapping fetch functions.

Correct before reuse: A1–F9 bands are applied too broadly; JHS records carry programme labels; the demo covers KG–JHS rather than Nursery; subjects and its March 2026 clock are fixed; payroll fields are not a validated statutory specification. Inert actions and roadmap placeholders must not appear as working production features. Do not copy client identity, financial formulas or privacy assumptions unquestioningly.

## 3. Remaining discovery

Before implementation choices are locked: observe teacher/accounts work, interview guardians, confirm device/connectivity needs, sample actual registers/report cards/fee statements and validate willingness to pay. Before live use: academic/early years review, finance policy, current legal/provider requirements, data-processing contracts and support ownership. Confirm rights before redistributing curriculum or textbook content. No GES/EMIS/WAEC/NaSIA system integration was established by this research.
