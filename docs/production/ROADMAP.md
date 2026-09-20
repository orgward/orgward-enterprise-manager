# OrgWard production product roadmap

Current revision-4 endpoint: PORTFOLIO-ROADMAP.md and SOLUTION-ARCHITECTURE.md add managed enterprise SaaS, existing-business migration and all-angle knowledge consistency. The backlog has 132 tasks/480 unrun acceptance cases; T-132 is final qualification. Earlier revision descriptions below are preserved history, not the current scope limit.

Status: active product contract. This supersedes any interpretation that completion of the synthetic Financial SDLC MVPX means production readiness.

Revision 3 expansion (2026-09-19): [PORTFOLIO-ROADMAP.md](PORTFOLIO-ROADMAP.md) is the master full-target roadmap. It adds the named governance modules, sixteen perspectives, progressive refinement, explicit enterprise scenarios and cross-product contracts. The canonical backlog now contains 108 tasks/384 acceptance cases; all are planned/not run. The revision-2 baseline below is retained as history and the earlier core endpoint, not the whole portfolio. T-106, not T-48 alone, qualifies the expanded target. P/E gate denominators remain fixed.

Revision 2 (2026-09-18): `../product/UX-REVIEW-02.md` identified missing domain, interaction and implementation detail. The execution authority for future tasks is `IMPLEMENTATION-BACKLOG.json`, interpreted with `../product/OUTCOME-CONTRACT.md`, `../product/SCREEN-CONTRACTS.md`, `DELIVERY-CONTRACTS.md` and `QUALIFICATION.md`. `TASK-INDEX.md` gives the dependency map. All 48 expanded tasks and 144 acceptance scenarios are currently planned/not run; historical slice receipts are reusable evidence only within their original scope.

## Product endpoint

Deliver a self-hostable enterprise operating and software-delivery platform in which an organization can:

1. design and version its business, operating model, responsibilities, controls, systems, and evidence;
2. connect real source repositories, work tracking, knowledge, identity, secrets, infrastructure, and observability providers;
3. turn approved intent into traced requirements, architecture, plans, code, tests, artifacts, deployments, observations, and learning;
4. run real human and agent work through durable workflows with explicit authority, budgets, isolation, pause/resume, rollback, and audit controls; and
5. install, operate, upgrade, back up, restore, and support its own isolated copy under documented service objectives.

“Production-ready” means every gate in `PRODUCTION-READINESS.json` has objective evidence from the releasable product revision. A reference scenario, mocked provider, generated fixture, passing unit suite, or attractive UI cannot by itself complete a production gate.

The product is extensible rather than pretending to embed every industry, country, model provider, SCM, cloud, and tool. Stable contracts, policy enforcement, adapters, and evidence make those extensions governable.

## Current truth

The repository currently contains:

- a useful but deterministic enterprise-design vertical slice;
- a synthetic financial SDLC reference scenario and mutation suite;
- local JSON persistence intended for private development;
- a first controlled-execution foundation with server-side profiles, independent approval, isolated run workspaces, real process invocation, generated artifacts, hashes, and logs; and
- a responsive product catalogue that sketches the intended journey, with documented sample/live-data ambiguity, inaccessible interactions and missing forms; and
- a revision-2 outcome/story/screen/data/effect/qualification contract intended to guide implementation, whose acceptance is not yet exercised.

It does **not** yet contain enterprise identity, real tenant security, a production database, a durable queue, hardened workload isolation, SCM integration, real model-provider execution, secret management, deployment adapters, HA, disaster recovery, signed releases, a complete admin plane, or production validation. It must not be sold or represented as production-ready.

## Fixed production acceptance gates

| Gate | Acceptance evidence required |
|---|---|
| E-01 Installation and upgrades | A versioned release installs on the supported clean topology, validates configuration, upgrades from the previous supported version, rolls back safely, and produces diagnostics without exposing secrets. |
| E-02 Identity and authorization | OIDC-authenticated humans and workload identities, mapped groups/roles, server-enforced RBAC/ABAC, session controls and segregation-of-duties tests cover every command and query. |
| E-03 Isolation | Cross-tenant/project API, database, object storage, cache, queue, worker and artifact attacks fail; isolation is verified dynamically and documented. |
| E-04 Persistence | PostgreSQL migrations, transactions, optimistic/pessimistic concurrency, idempotency, retention and corruption handling pass restart and concurrent-load tests. |
| E-05 Secrets | No credential enters browser state, prompts, logs or artifacts; secret references resolve just-in-time through a supported manager with rotation, revocation and audit evidence. |
| E-06 SCM | A real repository can be onboarded, read at an immutable revision, changed on a branch, checked, committed, proposed through a pull request and reconciled from webhooks without over-broad credentials. |
| E-07 Workers | Leased durable jobs run in hardened ephemeral isolation with CPU/memory/time/filesystem/network limits, cancellation, retries, crash recovery and orphan cleanup. |
| E-08 Agents/models | At least one real model/coding provider executes bounded context packages with budgets, structured output, evaluation, traceability and safe failure/provider substitution. |
| E-09 Assurance/artifacts | Reproducible builds, required tests/scans, dependency policy, SBOM, provenance attestation, signing and immutable artifact storage gate promotion. |
| E-10 Environments/releases | Dev/stage/prod-like targets have protected configuration, policy-based approval, deployment health, progressive delivery where applicable, rollback and complete effect evidence. |
| E-11 Operations | Metrics, traces, structured/redacted logs, immutable audit export, alerts, SLOs and incident runbooks diagnose tested failures end to end. |
| E-12 Recovery | Encrypted backup, point-in-time/defined recovery, restore into a clean installation and documented RPO/RTO pass recurring drills. |
| E-13 Administration | Administrators manage organizations, projects, identities, providers, policies, budgets, quotas, retention, legal holds and capability enablement without direct database edits. |
| E-14 Secure SDLC | Threat model, secure defaults, dependency/container scanning, vulnerability response, audit evidence and independent security review have no unresolved release-blocking findings. |
| E-15 UX/API | The complete workflows are usable without fixture knowledge, meet the chosen accessibility/browser baseline, expose stable versioned APIs/events, and provide actionable errors/recovery paths. |
| E-16 Qualification | Load/soak/failover/chaos evidence, HA behavior, a remediated penetration test and a real isolated pilot prove design → governed code → deployment → observation → rollback/learning. |

Partial components are recorded as `in_progress`; gates are binary and remain uncompleted until all acceptance evidence in the row passes.

## Delivery phases and dependency order

These phases group work; the task DAG is authoritative for execution order. Complete useful enterprise workflows alongside engineering delivery. Do not defer the original business-design and human/agent operating purpose until after the software pipeline.

### Phase 0 — Truthful foundation and executable contracts (current)

- Maintain separate reference, first-release, and production-readiness ledgers.
- Preserve synthetic scenarios as conformance fixtures.
- Establish controlled real execution with no browser-selected commands.
- Expose maturity and disabled capability states honestly in API and UI.
- T-01/T-02 establish executable schemas and repair the observed demonstrator truth problems; T-03 establishes usable shared interactions. Existing static maturity labels do not complete these tasks.

Exit evidence: controlled executable creates a runnable system only after independent approval; artifacts, logs, hashes, tenant scope, restart persistence, and failure state are tested. This phase does not complete a production gate.

### Phase 1 — Single-node enterprise core

- PostgreSQL persistence and migrations; transactions, locks, idempotency, retention.
- OIDC/SAML-ready authentication, SCIM-ready identity mapping, RBAC/ABAC and service identities.
- Encrypted secret references and external secret-manager adapter.
- Durable workflow engine/queue with leases, retries, cancellation, pause/resume and crash recovery.
- Install, upgrade, diagnostics, backup and restore for one supported self-hosted topology.

Task groups: T-04–T-08, then T-09–T-18 for the editable enterprise model, iterative conversation, readiness, economics/resources and human/agent instructions. T-19–T-24 implement the complete non-software process through real model output, human intervention and persistence. Follow dependencies: real proposal generation T-11 waits for T-22. Backups and upgrades mature in T-41/T-42, not by merely naming them here.

### Phase 2 — Governed engineering system

- Git provider abstraction, repository onboarding, branches, commits, pull requests and webhooks.
- Real agent/model provider abstraction with server-side credentials, budgets and evaluation.
- Container/microVM worker isolation, network policy, resource quotas and egress control.
- Build/test/security/quality pipelines, provenance, SBOM and signed artifact registry.
- Environment, release, deployment, rollback and observation adapters with policy decisions at every external effect.

Task groups: T-25–T-35, reusing the same enterprise graph, assignment, process, queue and artifact contracts as Phase 1. No separate fixture-only workflow may count as the general system.

### Phase 3 — Outcomes and customer operations

- T-36/T-37 connect technical, control and business observations to accepted learning and versioned corrective work.
- T-38–T-44 complete durable inbox, verifiable audit/export, administration, recovery, upgrade, incident operations and integration compatibility.
- Retain the Phase 1 enterprise model and workflows as real operating capabilities; do not replace them with software-delivery dashboards.

### Phase 4 — Production qualification

- HA and horizontal scale; load, soak, chaos and failover evidence.
- Security review, dependency/supply-chain controls, penetration test and remediation.
- Accessibility and supported-browser verification.
- Operational SLOs, telemetry, alerting, incident and support runbooks.
- At least one isolated pilot installation completes design → governed code → deployment → observation → rollback/learning using real integrations.

T-45–T-48 execute Q-01–Q-07, including non-bank business operations, customer installation, independent security review, accessibility, restore, redundant-topology failure and measured load. See QUALIFICATION for thresholds and required artifacts. All original 12 gates and production 16 gates must retain independent acceptance and traceable receipts.

## Non-negotiable architecture boundaries

- Browsers and prompts never select raw executables, shell fragments, filesystem roots, credentials, or authority roles.
- Planning/implementation principals cannot grant their own approval or deployment authority.
- Every external effect is tied to an immutable request, policy decision, principal, environment, evidence set and idempotency key.
- Agent/model output is untrusted proposed work until independent checks and required approvals pass.
- Workers use ephemeral isolation, minimal credentials, bounded network/filesystem access and explicit resource/time budgets.
- Control-plane, worker-plane, evidence-plane and secret-plane responsibilities remain separable.
- All mutable enterprise truth is versioned; audit/evidence history is append-oriented and exportable.

## Immediate next increment

Start T-01 (executable schemas/API/event fixtures and supported-baseline decisions) and T-02 (demonstrator data truth), then T-03/T-04 (usable shared UX and durable state). Continue eligible dependencies to the full enterprise design/edit/assignment/run/intervention outcome, then governed software delivery and customer operations. No production gate is marked complete until its entire acceptance set is exercised against the supported installation topology. This review does not authorize auto-starting implementation beyond its saved specification increment.
