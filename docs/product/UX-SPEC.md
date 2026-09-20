# OrgWard unified product experience specification

Revision-3 supplement: read PORTFOLIO-CONTRACT.md, ENTERPRISE-MODEL.md, ENTERPRISE-SCENARIOS.md and PORTFOLIO-UX.md for the expanded whole-portfolio target. SC-01–SC-12 remain binding; SC-13–SC-20 add cross-perspective editing, branch/merge, Sentinel and governance workbenches. The canonical backlog has 108 tasks and 384 unrun task acceptance cases. The revision-2 body below is historical baseline, not a limit on the new scope.

Status: product contract revision 2, 2026-09-18; specified, not customer-validated or implemented. The audit in `UX-REVIEW-02.md` found revision 1 insufficient for deterministic implementation. The interactive implementation at `/platform.html` is an incomplete capability catalogue with known functional and visual defects; opening its screens is not completing the workflows below.

## Implementation reading order and authority

1. `OUTCOME-CONTRACT.md`: original intent, eight customer outcomes, ten enterprise dimensions and distinct readiness meanings.
2. This document: product principles, personas, objects and primary journeys.
3. `SCREEN-CONTRACTS.md`: exact visible fields, actions, persistence, permission, failure/recovery and visual interaction requirements for SC-01–SC-12.
4. `../production/DELIVERY-CONTRACTS.md`: canonical aggregates, commands/events, transitions, effect/authority semantics and definition of done.
5. `../production/IMPLEMENTATION-BACKLOG.json` and `TASK-INDEX.md`: 48 stable stories/tasks, dependencies and 144 specific acceptance scenarios.
6. `../production/QUALIFICATION.md`: integrated real-world scenarios, supported baseline, performance/recovery/accessibility and release evidence.

The detailed contracts take precedence over the earlier shorthand below. The fixed P/E gate wordings remain required; tasks never replace or shrink their acceptance sets. Unresolved product policy requires an explicit contract decision before dependent implementation. No implementation acceptance is passed by this revision.

## 1. Product promise

OrgWard gives an enterprise one governed place to describe itself, design how it should operate, turn intent into coordinated human and agent work, create and change software systems, authorize external effects, observe results, and retain the evidence needed to explain every decision.

The product must make three questions answerable from any screen:

1. **What are we trying to achieve?** Intent, owner, measure, scope and current outcome.
2. **What is allowed to happen next?** State, authority, policy, evidence, checkpoint and available commands.
3. **Why should I trust this?** Provenance, confidence, evaluation, artifacts, history and links to upstream/downstream records.

## 2. Experience principles

- **Intent before tooling.** Users begin with outcomes and constraints, not pipelines or prompts.
- **One enterprise graph.** Strategy, capabilities, roles, processes, systems, changes, tasks, releases and outcomes remain linked records.
- **Proposed is visibly different from enabled.** Generated content never silently becomes authority, assignment or production truth.
- **State explains action.** Every enabled or disabled action has a visible reason and recovery path.
- **Humans govern effects, not keystrokes.** Checkpoints attach to material authority boundaries and risks.
- **Agents are accountable work principals.** Their instructions, context, tools, budgets, outputs and evaluations are inspectable.
- **Evidence travels with work.** A user can trace from intent to outcome without reading hidden chat history.
- **Enterprise administration is part of the product.** Identity, policies, integrations, secrets, environments, retention, backup and health are first-class experiences.
- **Maturity is never implied.** Demonstrator, configured, enabled, verified and operating states are explicit.

## 3. Personas and authority

| Persona | Primary outcomes | Representative authority |
|---|---|---|
| Enterprise owner | Define direction, accept business risk, delegate accountability | Approve enterprise scope and high-risk outcomes |
| Product/change owner | Turn needs into governed change and measured outcomes | Propose scope, prioritize and accept requirements |
| Enterprise architect | Maintain coherent capabilities, information and systems | Approve architecture standards and exceptions |
| Control owner | Interpret obligations and validate controls | Approve control design and risk treatment |
| Delivery lead/developer | Plan and implement changes | Create work and artifacts; no self-release authority |
| Human operator | Perform assigned tasks and checkpoints | Act only within assigned instructions and tools |
| Agent principal | Execute bounded internal work | Use explicitly granted tools, data, budgets and environments |
| Release approver | Authorize a protected effect | Promote immutable evaluated artifacts to an environment |
| Platform administrator | Operate the OrgWard installation | Configure identity, providers, quotas, retention and recovery |
| Auditor | Reconstruct decisions and evidence | Read/export immutable history; no mutation authority |

Role membership comes from authenticated identity and policy, never from a browser-supplied role claim.

## 4. Information architecture

The proposed global product navigation is organized around user goals and must be validated through customer task completion:

1. **Command center** — portfolio health, decisions, interventions, outcomes and production readiness.
2. **Enterprise** — business conversation, organisational blueprint, maps, versions, gaps and assignments.
3. **Change portfolio** — intents, impact, governance, requirements, architecture, delivery plans and status.
4. **Work & agents** — process/task graphs, instructions, assignees, runs, checkpoints, budgets and artifacts.
5. **Releases** — repositories, builds, assurance, environments, approvals, deployments and rollback.
6. **Evidence** — lineage, evaluations, provenance, audit events, exports and retention.
7. **Administration** — organisations, projects, identities, policies, connectors, secrets, quotas, backups and system health.

Context selectors choose organisation and workspace. Production displays the authenticated principal and effective role; an optional role preview is clearly marked as demo-only and never says authority changed. The founder starts with business design, the operator with assigned work, and the administrator with installation health. Product release readiness belongs under Administration/review mode, separate from enterprise business readiness.

## 5. Core product objects

| Object | Purpose | Required relationships |
|---|---|---|
| Organisation / workspace | Security, data and policy boundary | principals, policies, projects, environments |
| Business brief | Scoped intent, assumptions and unknowns | conversation, owner, blueprint versions |
| Enterprise object | Goal, offering, capability, process, role, system, information, control, metric, lifecycle record | area, owner, provenance, status, relations |
| Blueprint version | Immutable coherent enterprise snapshot | prior version, change set, integrity result |
| Assignment / instruction set | Enabled responsibility for a human or agent | principal, role, scope, authority, tools, escalation |
| Change case | Governed container from intent through outcome | owner, stage, gates, enterprise snapshot, lineage |
| Requirement / decision | Atomic expected behavior or approved design | intent, evidence, verification, affected objects |
| Work item / task graph | Executable plan with dependencies and contracts | assignee, inputs, outputs, checkpoints, state |
| Run / attempt | One durable execution of a task or process | principal, context, lease, logs, artifacts, budget |
| Evidence / evaluation | Immutable proof and assessment | source, subject, hash, evaluator, result, validity |
| Repository / change set | Version-controlled implementation | immutable base, branch, commit, PR, requirements |
| Build / artifact | Assured deliverable | source revision, checks, SBOM, provenance, signature |
| Environment / release | Governed external effect | artifact, policy decision, approval, health, rollback |
| Observation / outcome | Technical, control and business result | release, measures, window, evaluator, follow-up |

## 6. Primary end-to-end journeys

### J-01 — Establish an enterprise

1. Administrator creates or installs an organisation and connects identity.
2. Enterprise owner creates a workspace and describes the business conversationally.
3. OrgWard drafts a business brief and blueprint with assumptions, confidence and sources.
4. Owner and specialists edit objects, resolve gaps and publish a blueprint version.
5. Roles and instruction sets are assigned to authenticated humans and configured agents.

Acceptance: the published blueprint is immutable, prior versions remain inspectable, proposed/enabled states are visible, and every assignment has bounded authority.

### J-02 — Propose and govern a change

1. Change owner describes an outcome and constraints.
2. OrgWard discovers relevant enterprise context and shows coverage/provenance.
3. Impact, obligations, controls, requirements and architecture are drafted and independently evaluated.
4. Missing evidence or human interpretation pauses the case with an actionable finding.
5. Authorized owners approve scope and design; the case produces an executable work graph.

Acceptance: the user can navigate intent → impacted objects → requirements → decisions → work with explicit gate results.

### J-03 — Execute human and agent work

1. Delivery lead selects or edits an instruction set and assigns a principal.
2. OrgWard creates durable tasks with inputs, outputs, dependencies, tools, budget and checkpoints.
3. A worker leases a task and executes in the configured isolation boundary.
4. Logs and artifacts stream to the run; the user can pause/cancel where policy permits.
5. Mandatory human checkpoints cannot be bypassed; changed instructions create a new version before resume.

Acceptance: restart, retry, cancellation and failure never present ambiguous success; each attempt is reconstructable.

### J-04 — Create and release a software system

1. A real repository is selected at an immutable base revision.
2. A coding agent receives a bounded context package and creates a branch/change set.
3. Builds, tests, security checks, SBOM, provenance and evaluations produce an immutable candidate artifact.
4. Policy decides whether promotion is denied, needs human approval or may proceed.
5. A distinct release approver promotes the evaluated artifact to a configured environment.
6. Health and outcome signals determine completion, rollback or follow-up work.

Acceptance: no implementation principal can self-authorize release; deployed bytes match evaluated bytes; rollback is tested.

### J-05 — Operate, learn and audit

1. Operators see service objectives, queues, failures, interventions and connector health.
2. Business/control/technical outcomes are evaluated separately.
3. Learning proposes enterprise or system changes but never rewrites truth silently.
4. Auditors trace and export the entire decision/evidence chain.
5. Administrators back up, restore, upgrade and diagnose the installation.

Acceptance: a clean restore and audit export reconstruct the same authorized state and evidence.

## 7. Screen contracts

| Screen | User must be able to see | Primary commands | Backend capabilities |
|---|---|---|---|
| Command center | decisions due, blocked work, active runs, outcome misses, system health, readiness gates | open intervention, assign owner, inspect trace | query projections, policy tasks, telemetry, readiness ledger |
| Enterprise map | version, coverage, linked objects, evidence/confidence, gaps, status | edit, compare, publish, assign | versioned graph store, integrity evaluator, impact analysis |
| Change workspace | stage, intent, impact, requirements, architecture, plan, assurance, authority, outcome | advance, repair, approve, pause, resume | durable workflow, evaluators, policy/authority, evidence store |
| Work graph | dependency DAG, assignees, instructions, checkpoints, run state, budget | start, pause, cancel, retry, reassign, edit instruction | queue/leases, worker plane, assignment/policy, events |
| Run detail | immutable context, principal, tools, logs, artifacts, checks, costs | approve, execute, cancel, retry, compare attempts | isolated executor, secret refs, artifact/log storage |
| Release center | repository, candidate, assurance, environments, approvals, health, rollback | promote, reject, rollback | SCM/build/artifact/deployment/observation adapters |
| Evidence explorer | lineage graph, event chain, hashes, evaluations, retention | verify, filter, export | append audit/evidence store, signing, export jobs |
| Administration | identity, roles, policies, connectors, secrets refs, quotas, backup, system health | configure, test, rotate, disable, restore | auth, admin policy, provider registry, secret manager, operations |

## 8. Universal state and interaction rules

- Every mutation displays its target, expected effect, required authority and whether it is reversible.
- Destructive/external-effect actions use a review step containing immutable artifact/environment identifiers.
- Disabled actions expose the missing role, evidence, configuration or preceding state.
- Long-running commands immediately return a durable job identifier and continue asynchronously.
- Loading, empty, partial, stale, degraded, denied, failed, interrupted and offline states have designed recovery paths.
- Optimistic conflicts never overwrite silently; users compare and retry against the current version.
- Lists support search, filters, saved views, pagination and keyboard navigation.
- Times show local display plus canonical UTC in detail; identities and sources are resolvable.
- Notifications link to the durable object/event; transient toasts are never the only evidence.
- Accessibility target: WCAG 2.2 AA for production qualification.

## 9. Backend service boundaries implied by the UX

1. Identity and policy service.
2. Organisation/project/tenant service.
3. Enterprise graph and version service.
4. Conversation/agent orchestration service.
5. Change-case workflow and evaluation service.
6. Task graph, durable queue and worker coordination service.
7. Execution isolation and tool-broker service.
8. SCM/build/artifact/deployment provider services.
9. Secret-reference and credential-broker service.
10. Evidence, audit, lineage and export service.
11. Observation, outcome and telemetry service.
12. Administration, installation, upgrade, backup and health service.

Every service exposes versioned commands/queries/events, idempotency, tenant context, authenticated principal, correlation/causation IDs, optimistic version, policy decision and audit evidence as applicable.

## 10. Demonstrator rules

The interactive demonstrator must label capability maturity at the actual record/action level. Current violations are tracked in UX-REVIEW-02 findings F-01/F-02 and T-02:

- **Live** — this exact visible record/action is connected to a functioning backend, with source and freshness; a related implementation on another page is insufficient.
- **Foundation** — a bounded backend slice exists but production conditions remain missing.
- **Specified** — the experience and contract are defined; backend is not implemented.

Specified controls use Preview or View specification labels in demo mode. Real creation, editing, comparison and approval commands must perform their SC contract, not merely open an inspector. Sample metrics carry sample labels; empty/unavailable/disabled data never fall back to manufactured success. A separate review inspector may explain backend contracts; it must not dominate ordinary customer task flows.

## 11. Review questions for product validation

1. Does the navigation match how an enterprise would divide design, change, work, release, evidence and administration?
2. Are the right roles and authority boundaries represented?
3. Does each end-to-end journey include the information and intervention points a real customer needs?
4. Is any critical business, delivery, control, operational or installation workflow missing?
5. Are maturity and proposal/enabled/verified distinctions clear enough to prevent false trust?
6. Which screen should become the primary daily home for each persona?

The main information architecture remains subject to observed task completion in T-45/T-48. Backend increments are accepted against the linked story, screen, service and qualification contracts. Approval of a document does not waive usability validation, failure behavior, integrated outcomes or production gates.
