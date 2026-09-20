# OrgWard Enterprise Studio

Development workspace with enterprise-design, synthetic SDLC-reference, and controlled-execution surfaces. It is **not production-ready**; production maturity is tracked separately in `PRODUCTION-READINESS.json` against `docs/production/ROADMAP.md`.

## Unified product specification

Hard requirement: [configurable enterprise/SDLC workflows](docs/product/CONFIGURABLE-WORKFLOWS.md)
with equivalent diagram/forms, substeps, bounded loops, conditions, registered
actions, simulation, versions and safe run migration. [ADR-010](docs/production/ADR-010-CONFIGURABLE-WORKFLOW.md)
selects bpmn-js modeling and a planned Temporal runtime adapter; neither is installed
by this specification. Sixteen additional WF acceptance obligations are mandatory.
Latest [handoff 13](docs/production/DOMAIN-FIXTURE-HANDOFF-13.md): 316/480 original
scenarios defined across 91 tasks, plus those sixteen unrun obligations. The earlier
checkpoint counts below are historical.

[Governance and agent interactions](docs/product/GOVERNANCE-AGENT-INTERACTIONS-13.md)
details current reviewer eligibility, ownership/access changes, independent audit
verification and shared-budget specialist work through configurable SDLC. These are
required future features; 164 original scenarios still need this definition layer.

[Sentinel to Warden to SDLC](docs/product/SENTINEL-WARDEN-INTERACTIONS-12.md)
details evidence-backed findings, reviewed repairs, timeboxed exceptions and
protected policy decisions. All 28 Sentinel rules now have trigger/control
definitions under a pinned local profile; they have not run against an engine.
At checkpoint 12, 212 original scenarios still needed this layer. No new UI/backend is implemented.

[Business and Sentinel interactions](docs/product/BUSINESS-SENTINEL-INTERACTIONS-11.md)
walk through commitments, staffing, physical work, configurable processes, outcome
measurement, safe source intake and claim review back into SDLC. These are required
future scenarios, not functioning screens. At checkpoint 11, 244 scenarios still needed this
definition layer; full seeds/adapters and independent reviews remain pending.

[SDLC process and user interactions](docs/product/SDLC-INTERACTIONS-09.md) explains
business intent through real code review, protected release and measured outcome,
including human decisions, changes during work and failure recovery.
[Domain test definitions](docs/production/DOMAIN-FIXTURE-HANDOFF-09.md) now cover
164 original scenarios across 53 tasks, adding all T-25–T-48 core SDLC, release,
audit, recovery and qualification scenarios to the prior foundation coverage.
316 scenarios still lack this layer; actual schemas/seed adapters and independent
packet reviews remain required. A source-bound index detects scenario drift.
These are unrun product tests; comparator self-tests are not acceptance evidence.

Start with the concise [product intent](docs/product/PRODUCT-INTENT.md).
The [engineering decisions and model assignments](docs/production/ENGINEERING-DECISIONS-06.md)
now specify the 73 missing secondary commands and recommend models for all
132 tasks. They remain pending independent review; domain acceptance fixtures
and actual implementation are still required. Earlier draft counts below are
historical and must not be read as approved implementation readiness.

Increment 05 adds the [132-task packet register](docs/production/WORK-PACKAGE-INDEX.md)
and [packet review](docs/production/WORK-PACKAGE-REVIEW.md). These are saved,
schema-checked boundary drafts, not approved implementation packets. All 480
scenarios remain unrun; 205 explicit elaboration/review decisions remain,
including 73 additional command contracts. The roadmap still requires real
implementation and independent qualification.

Revision 4 makes the target enterprise SaaS for new and existing businesses. Read the [architecture review](docs/product/ARCHITECTURE-REVIEW-04.md), [solution architecture](docs/production/SOLUTION-ARCHITECTURE.md), [change/knowledge protocol](docs/production/CHANGE-PROTOCOL.md), [migration and coverage contract](docs/product/MIGRATION-AND-COVERAGE.md) and [implementation handoff](docs/production/IMPLEMENTATION-HANDOFF.md). Current backlog: **132 tasks and 480 unrun acceptance cases**; T-132 qualifies the expanded target. The revision-3 inventory below is historical. Specification validation is not implementation; no task has a reviewed implementation packet yet.

Start with the [full portfolio roadmap](docs/production/PORTFOLIO-ROADMAP.md) and [revision-3 review](docs/product/UX-REVIEW-03.md). They preserve the original outcomes and expand design, multi-perspective maps, versioning, progressive system detail, bidirectional SDLC, Sentinel, Warden, Arbiter, Steward, Ledger and Overseer. The [current task index](docs/production/TASK-INDEX.md) and [canonical backlog](docs/production/IMPLEMENTATION-BACKLOG.json) contain 132 tasks and 480 task acceptance cases, all unrun (the historical revision-3 baseline had 108 tasks/384 cases). [Enterprise scenarios](docs/product/ENTERPRISE-SCENARIOS.md), [model contract](docs/product/ENTERPRISE-MODEL.md), [portfolio UX](docs/product/PORTFOLIO-UX.md) and [qualification](docs/production/PORTFOLIO-QUALIFICATION.md) define the supported target and failure/recovery behavior. The [revision-2 UI findings](docs/product/UX-REVIEW-02.md)—including static success/data, missing forms and keyboard defects—remain open. Documentation and structural checks do not make the application production-ready.

Open `/platform.html` for the initial future-product catalogue. It sketches enterprise setup, business design, governed change, requirements and architecture, human/agent work, repository and assurance, release, outcomes, evidence, administration, and recovery. Capability labels and inspectors describe intent but have known inaccuracies recorded in the review; sample statuses must not be treated as actual operations. The revised UX contract is `docs/product/UX-SPEC.md` with its linked detailed contracts.

This specification is intentionally broader than the implemented backend. It is the experience and boundary contract for subsequent production increments, not evidence that the displayed external effects or enterprise services already exist.

## Enterprise design

The first workflow:

1. create a project and describe a business through four focused chat questions;
2. save the resulting scope, assumptions, unknowns, and a versioned organisational blueprint;
3. explore the linked design in blueprint, graph, and list views.

The generator is a deterministic, knowledge-backed design assistant. It reuses the OrgWard research primitives and integrity rules without sending data to an external model. Real LLM-backed task execution belongs to the original release gate P-09 and is not enabled in that workflow yet.

## Financial SDLC reference

Open `/sdlc.html` for the fully executable MVPX reference track based on `orgward/orgward-autonomous-stack@11fb942f4ea7aee0767ae6132294778dec08d74c`.

It implements the synthetic beneficial-owner scenario through:

```text
Intent → Context → Impact → Governance → Requirements → Architecture
→ Plan → Implementation → Assurance → Authority/Release
→ Observation → Outcome → Learning
```

The SDLC surface provides durable ChangeCases, stage/gate history, provenance and evidence hashes, enterprise impact analysis, requirement and architecture critics, bounded context packages, a provider-neutral command execution adapter, twelve-dimensional assurance, segregation-of-duties release approval, immutable release evidence, outcome evaluation, and follow-up proposals. Its completion percentage refers only to that synthetic reference contract.

Its mutation lab proves that missing AML evidence, stale standards, forged provenance, omitted dependencies, unresolved interpretation, defective requirements, invalid architecture, cyclic plans, failed checks, artifact tampering, and unauthorized release stop at their intended gates. All data and release effects are synthetic.

## Controlled execution foundation

Open `/execution.html` for the first real-execution increment. When the server operator enables `ORGWARD_ENABLE_LOCAL_EXECUTION=true`, a user can request a server-configured system-generation profile, a different identity must approve the immutable request, and the worker invokes a fixed absolute executable without a shell inside a per-run workspace. The included generator creates a runnable Node.js service, tests, container recipe, traced manifest, logs, artifact hashes, and an append-oriented event history.

This does not yet provide enterprise authentication, strong workload isolation, a durable queue, Git integration, a real coding-model provider, deployment, HA, or production operations. Those remain explicit gates in the production roadmap.

## Run privately

Node 22 or newer is required. There are no third-party runtime dependencies.

```bash
cd /srv/orgward/orgward-enterprise-studio
npm start
```

Open `http://127.0.0.1:4310/platform.html` for the unified product specification, `http://127.0.0.1:4310` for enterprise design, `http://127.0.0.1:4310/sdlc.html` for the SDLC reference, or `http://127.0.0.1:4310/execution.html` for controlled execution. The default listener is loopback-only. Set `PORT` to change the port and `ORGWARD_DATA_DIR` to change enterprise-design project storage:

```bash
PORT=4320 ORGWARD_DATA_DIR=/path/to/private/projects npm start
```

The local generator is disabled by default. Enable it explicitly only on a development host:

```bash
ORGWARD_ENABLE_LOCAL_EXECUTION=true npm start
```

Enterprise projects default to `data/projects/`; SDLC cases default to `data/sdlc/`. Both are written atomically with mode `0600` and kept out of source control. This private product does not add public deployment or enterprise authentication.

For a phone, keep the service loopback-only and use an SSH client that supports local port forwarding: forward the phone's local port `4310` to VPS destination `127.0.0.1:4310`, then open `http://127.0.0.1:4310` in the phone browser. Both product surfaces are responsive at a 390 px viewport; the organisational map opens in touch-friendly List mode on narrow screens and retains the Graph toggle.

## Verify

```bash
npm run check
```

`npm run check:spec` separately validates outcome/screen/gate coverage, stable story IDs, dependency acyclicity, evidence requirements and index consistency; it also checks eight deliberately invalid plan mutations. It validates the delivery contract, not product behavior or completeness of implementation.

The check runs JavaScript syntax validation plus the enterprise-design and SDLC domain, mutation, command-adapter, API, persistence, concurrency, isolation, security, and failure-path tests. Actual receipts live in `ops/checks/`. The original product gates remain in `DELIVERY-STATUS.json`; the separate merged SDLC contract is tracked in `SDLC-DELIVERY-STATUS.json`.

## What the saved blueprint contains

Every generated version covers the fixed product areas:

- purpose and strategy;
- customers, offerings, value, and economics;
- capabilities and processes;
- people and agents;
- responsibility and authority;
- resources;
- information and technology;
- governance, risk, and controls;
- metrics and feedback;
- lifecycle.

Objects retain status, confidence, and provenance. Integrity checks reject missing areas, invalid status, duplicate IDs, and dangling graph links. They surface incomplete ownership, role authority, process inputs/outputs, and missing provenance as actionable gaps. Generated content is explicitly a proposed design, not an enabled assignment or evidence of business readiness.

## Enterprise-design increment boundary

This increment stops after chat → saved blueprint → interactive map. Editing and version comparison, enabled human/agent assignments, runnable processes, intervention controls, real LLM-backed work, the full readiness dashboard, and the complete end-to-end release demo remain for later bounded increments under the unchanged 12 release gates.
