# Product outcome contract

Revision-3 expansion: PORTFOLIO-CONTRACT.md and ENTERPRISE-MODEL.md preserve these eight outcomes while defining the whole OrgWard portfolio and bidirectional design/SDLC/integrity relationships. ENTERPRISE-SCENARIOS.md supplies 24 domain journeys; the full roadmap and qualification are in ../production/PORTFOLIO-ROADMAP.md and PORTFOLIO-QUALIFICATION.md. No original gate or outcome is removed.

Revision 2, 2026-09-18. Normative planning requirements; no implementation or customer approval is implied. Read this before the UX specification or implementation backlog. The original 12 P-gates remain fixed; the 16 E-gates qualify the broader production endpoint. Neither set can replace the other.

## Authority and traceability

The source intent is the founder's description in `../orgward-research/PRODUCT-BRIEF.md`: describe a business, design its complete scoped organisation, explore and edit it, manage humans and agents, intervene in execution, and retain outputs. Later user direction adds real software creation/delivery and a supportable enterprise installation. The SDLC reference is one application of this operating model.

Every implementation must trace **outcome → story → screen/command → persisted state → evaluation → evidence → gate**. `docs/production/IMPLEMENTATION-BACKLOG.json` holds stable story/task IDs. The documents in this directory and `docs/production/DELIVERY-CONTRACTS.md` supply their shared contracts. A screenshot, service name, stub endpoint, or test count cannot substitute for a completed story.

Research reused: `../orgward-research/SCHEMAS/org-core-v0.1.json`, `../orgward-research/CODE/studio-increment-01/blueprint.schema.json`, the brief and fixed gates; the existing pinned SDLC reference in `docs/sdlc/IMPLEMENTATION-PLAN.md`. No new research mission is started. The research micro-model is not a production schema or evidence of real-world completeness.

## Required outcomes

| ID | Outcome the customer can obtain | Observable completion |
|---|---|---|
| O-01 | Establish and control its own OrgWard installation | A customer operator installs the supported release, connects identity, configures a workspace, restores its data on a clean host, upgrades and obtains useful diagnostics without developer assistance. |
| O-02 | Turn business intent into a coherent, editable operating model | A founder describes a non-bank business, reviews sourced proposals and unknowns, changes a process/role, compares versions, and sees affected dependencies and gaps. |
| O-03 | Understand whether the designed business can operate | Commercial assumptions, capacity, funding/resource constraints, responsibilities, obligations and outcome measures are explicit; critical gaps have owners and next actions. |
| O-04 | Operate coordinated human and agent processes | An enabled assignment runs a real task; a human checkpoint stops progression, instructions are revised, authorized work resumes, and usable results survive restart. |
| O-05 | Create/change a real software system | Approved intent produces traced requirements/design, a real repository change and reviewed PR, independently evaluated artifact, authorized deployment and tested rollback. |
| O-06 | Learn whether outcomes happened | Technical, control and business measures have baselines, targets and observation windows; missing data remains unknown, and a failed outcome produces a reviewed follow-up. |
| O-07 | Explain and govern every material action | Users inspect authority, instruction/input versions, source provenance, decisions and effects; an auditor exports a verifiable chain and an operator resolves failures. |
| O-08 | Use the complete product without hidden knowledge | Each role completes its workflows using understandable, accessible screens and documented integrations; empty, denied, conflicting and failed states are recoverable. |

## Ten enterprise dimensions: required content and operating proof

All records carry stable ID, workspace, version, owner, provenance, epistemic state, applicable scope, effective dates and relationships. These are required product fields, not optional narrative headings.

| Dimension | Required design records and fields | Evidence needed to claim enabled/operating |
|---|---|---|
| Purpose and strategy | Mission; desired outcomes; time horizon; prioritized goals; strategic choices/tradeoffs; constraints; goal owner; measure and review cadence | Published choices plus observed goal measurements; missed goals route to an accountable owner. |
| Customers, offerings, value and economics | Segments; customer need; offering/value proposition; channel; demand assumptions; pricing unit/currency; cost drivers; expected volumes; unit margin; funding/runway assumptions; sensitivity scenarios | Sourced assumption tests, actual versus forecast data, and a reviewable action on adverse scenarios. A projection is not revenue or proof of competitiveness. |
| Capabilities and processes | Capability outcome/owner; process trigger; input/output schemas; steps/branches; dependencies; service objective; exception and compensation paths | At least one non-software recurring process with a real human task and model task, measured output and failure recovery. |
| People and agents | Identity; human/agent kind; role eligibility; skills; availability/capacity; instruction versions; delegation; replacement/offboarding | Authenticated active assignments with effective dates and tested revocation; workload cannot be silently reassigned after approval. |
| Responsibility and authority | One accountable owner per governed object; permitted decisions/tools/data/environments; approval thresholds; separation of duties; escalation owner/deadline | Server-enforced policy plus denied-action evidence; organisational responsibility alone grants no tool permission. |
| Resources | Resource/provider; capacity and units; availability; reservation; budget/currency; consumed/remaining amount; procurement dependency; critical supplier/replacement | Reservations and usage reconciled to evidence; budget exhaustion and unavailable capacity block or escalate dependent work. |
| Information and technology | Data classification; schema; owner; source system; system/API dependency; residency/retention; access; quality/freshness; authoritative source; recovery needs | Working authorized integrations and freshness checks; no inferred direct access to another system's database. |
| Governance, risk and controls | Obligation source/version/applicability; risk likelihood/impact; control owner; test method; exception reason/expiry; residual-risk decision | Independent tests and accountable interpretation. Generated legal/regulatory text remains a proposal; applicability is never inferred as a compliance certificate. |
| Metrics and feedback | Measure/formula/unit; baseline/target; source; observation window; freshness; review owner/cadence; threshold/action | Actual observations; missing/late samples distinguish unknown from pass; approved corrective work is traceable. |
| Lifecycle | Proposed/approved/enabled/operating/suspended/retired transitions; launch dependencies; review date; succession; offboarding; decommission plan; retained evidence | Explicit launch authorization, suspension, handover and retirement workflows that revoke tools/schedules and preserve required history. |

The ten product areas map the research schema's separate capabilities/processes into one presentation area. Preserve both entity types and their distinct invariants; do not silently discard one because the UI has ten cards.

## Independent kinds of readiness

1. **Design coverage:** applicable requirements with structurally valid records / all applicable requirements in the published scope version. Unknown requirements remain in the denominator. Approved exclusions have owner, reason, evidence and review date, and remain visible. Zero applicable requirements yields `not_applicable`, not 100%.
2. **Enablement:** assignments, providers, authority and resources are configured and current. Enabled is not evidence of successful operation.
3. **Operating evidence:** required checks/observations pass for this version within their validity window. Changing inputs invalidates dependent evidence.
4. **Business outcomes:** observations against the agreed baseline/target/window; can be pass, fail, partial or unknown regardless of technical success.
5. **OrgWard product readiness:** fixed P/E gate receipts for the software release. Never mix this percentage with customer enterprise readiness or SDLC stage counts.

Critical gaps cannot be averaged away by high scores elsewhere. UI shows the exact numerator, denominator, scope version, timestamps and blocking records behind every score. Confidence describes evidence support, never permission or probability of business success.

## Reference journeys that must remain distinct

- **Founder/non-bank:** circular furniture subscription enterprise. Customer onboarding process checks stock/capacity, agent drafts a proposal from authorized facts, human approves it, result is saved internally; a margin assumption is falsified and a follow-up is proposed. No real purchase/payment/email is needed for this acceptance journey.
- **Existing enterprise:** import an owned operating model, reconcile duplicate IDs and source conflicts, version a changed process, assign a specialist and suspend an obsolete assignment. Never require starting over from the four-question wizard.
- **Engineering:** change a service in a real test repository, create a PR, build and verify immutable artifacts, deploy to an authorized isolated target, inject bad health, rollback and record the outcome.
- **Operator/auditor:** install, invite/revoke a user, resolve a crashed task, restore a clean installation, export evidence and upgrade while queued work exists.

The financial beneficial-owner scenario remains a regression fixture. Completing it alone does not satisfy these journeys.

## Scope decisions and limits

The first production target is one supported self-hosted enterprise topology and one working adapter for each required provider class. Multiple isolated workspaces and verified identity/data separation are required; selling broad public multi-tenant SaaS is not required. OIDC is the initial identity protocol; direct SAML/SCIM and additional provider implementations are extension candidates, with no false supported labels. Exact adapter versions and supported topology are recorded by T-01/T-08 before dependent implementation.

Accounting, payroll, payment execution, legal formation and procurement systems are represented through owned records, human steps and explicit integration contracts. This release does not silently become a replacement ERP, nor claim external registrations or transactions occurred. Where such a dependency is necessary for a customer's chosen scope, the readiness view must show it as unmet until evidence is attached. Additional adapters enter a visible extension register with owner and acceptance plan.

These requirements define what to build and how to evaluate it. They cannot guarantee commercial competitiveness, future security, legal sufficiency or production fitness merely because tasks are checked off; measured operating evidence and real customer qualification remain mandatory.
