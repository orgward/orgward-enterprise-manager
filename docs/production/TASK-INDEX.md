# Implementation task index — revision 4

Saved task-specific drafts are linked in [WORK-PACKAGE-INDEX.md](WORK-PACKAGE-INDEX.md).
Read [their limitations and review sequence](WORK-PACKAGE-REVIEW.md); they are
not yet approved implementation packets.

Canonical source: `IMPLEMENTATION-BACKLOG.json`. 132 tasks/stories; 480 task acceptance cases, all planned/not run. T-01–T-108 retain their identifiers and criteria. T-109–T-132 add managed SaaS, complete business inventory, existing-enterprise migration, all-angle change consistency and enforceable implementation handoff. T-106 is the revision-3 portfolio qualifier; T-132 is the expanded final qualifier and its dependency closure covers every task.

Read SOLUTION-ARCHITECTURE.md, CHANGE-PROTOCOL.md, ../product/MIGRATION-AND-COVERAGE.md and IMPLEMENTATION-HANDOFF.md before selecting a slice. A planned task is not implementation-ready until a concrete independently reviewed packet passes the readiness contract; all current tasks remain planned and no such packet is yet claimed ready. Follow dependencies, not numeric order. Preserve parent acceptance when splitting into bounded slices; actual product evidence is still mandatory.

| Task / story | Deliverable | Dependencies |
|---|---|---|
| T-01 / US-01 | Freeze executable domain and API contracts | None |
| T-02 / US-02 | Correct demonstrator truth and navigation semantics | None |
| T-03 / US-03 | Build usable shell and shared form states | T-01, T-02 |
| T-04 / US-04 | Create transactional persistence and legacy import | T-01 |
| T-05 / US-05 | Authenticate humans and workload principals | T-01, T-04 |
| T-06 / US-06 | Enforce authorization and workspace isolation | T-04, T-05 |
| T-07 / US-07 | Broker and rotate secret references | T-05, T-06 |
| T-08 / US-08 | Package clean self-host installation | T-04, T-05, T-06, T-07 |
| T-09 / US-09 | Persist the enterprise graph and complete area schema | T-01, T-04, T-06 |
| T-10 / US-10 | Make conversation and brief review iterative | T-03, T-09 |
| T-11 / US-11 | Generate sourced enterprise proposals with a real model | T-09, T-10, T-22 |
| T-12 / US-12 | Evaluate integrity and readiness evidence | T-09 |
| T-13 / US-13 | Edit, compare and publish enterprise versions | T-03, T-09, T-12 |
| T-14 / US-14 | Unify graph, list and object navigation | T-03, T-09, T-13 |
| T-15 / US-15 | Make business economics and assumptions actionable | T-09, T-12, T-13 |
| T-16 / US-16 | Manage resources, capacity and lifecycle | T-09, T-12, T-13 |
| T-17 / US-17 | Assign, delegate and offboard humans and agents | T-03, T-06, T-09 |
| T-18 / US-18 | Version editable role and task instructions | T-13, T-17 |
| T-19 / US-19 | Design executable process graphs and triggers | T-16, T-18 |
| T-20 / US-20 | Run durable leased tasks with crash recovery | T-04, T-06, T-19 |
| T-21 / US-21 | Isolate execution and broker bounded tools | T-06, T-07, T-20 |
| T-22 / US-22 | Execute real bounded model tasks with evaluation | T-07, T-18, T-21 |
| T-23 / US-23 | Implement pause, checkpoints, resume and cancellation | T-18, T-20, T-21, T-22 |
| T-24 / US-24 | Complete the non-software operating journey | T-11, T-14, T-15, T-16, T-23 |
| T-25 / US-25 | Discover governed change context and impact | T-09, T-12, T-13, T-22 |
| T-26 / US-26 | Author and evaluate traced requirements | T-25 |
| T-27 / US-27 | Approve architecture delta and recovery design | T-26 |
| T-28 / US-28 | Compile change plans into the shared work engine | T-19, T-23, T-27 |
| T-29 / US-29 | Onboard and read real repositories securely | T-07, T-21 |
| T-30 / US-30 | Create, evaluate and review agent code changes | T-22, T-28, T-29 |
| T-31 / US-31 | Build immutable candidates with independent assurance | T-21, T-30 |
| T-32 / US-32 | Publish SBOM, provenance and signed artifacts | T-07, T-31 |
| T-33 / US-33 | Approve protected releases with bound authority | T-06, T-32 |
| T-34 / US-34 | Deploy and reconcile actual environment effects | T-07, T-21, T-33 |
| T-35 / US-35 | Rollback and recover incompatible releases | T-34 |
| T-36 / US-36 | Measure technical, control and business outcomes | T-15, T-24, T-34 |
| T-37 / US-37 | Review learning and corrective changes | T-13, T-25, T-36 |
| T-38 / US-38 | Route durable work and decision notifications | T-06, T-20, T-23 |
| T-39 / US-39 | Export verifiable audit and lineage | T-04, T-06, T-32, T-36 |
| T-40 / US-40 | Administer policies, providers, quotas and retention | T-06, T-07, T-08, T-16, T-38 |
| T-41 / US-41 | Back up and restore complete enterprise state | T-04, T-07, T-08, T-20, T-39 |
| T-42 / US-42 | Upgrade supported releases and recover failed migration | T-08, T-20, T-40, T-41 |
| T-43 / US-43 | Operate telemetry, incidents and diagnostics | T-20, T-34, T-38, T-41 |
| T-44 / US-44 | Publish stable integration and import/export contracts | T-01, T-06, T-09, T-29, T-39, T-40 |
| T-45 / US-45 | Qualify accessible usable complete workflows | T-03, T-24, T-35, T-37, T-38, T-39, T-40, T-44 |
| T-46 / US-46 | Perform independent security and supply-chain review | T-06, T-07, T-21, T-32, T-34, T-39, T-40, T-44 |
| T-47 / US-47 | Qualify scale, soak and redundant recovery | T-20, T-35, T-41, T-42, T-43, T-46 |
| T-48 / US-48 | Qualify integrated customer outcomes and release | T-24, T-35, T-37, T-39, T-40, T-41, T-42, T-43, T-44, T-45, T-46, T-47 |
| T-49 / US-49 | Canonical scoped and temporal enterprise model | T-01, T-04, T-06, T-09 |
| T-50 / US-50 | Organisation, legal entity and federation scopes | T-49, T-17 |
| T-51 / US-51 | Sixteen synchronized lens projections and cross-lens queries | T-14, T-49 |
| T-52 / US-52 | Advanced process, case and decision modeling | T-19, T-49, T-51 |
| T-53 / US-53 | Branching, temporal baselines and semantic three-way merge | T-13, T-49 |
| T-54 / US-54 | Progressive business-to-system refinement and reverse trace | T-49, T-51, T-53, T-25 |
| T-55 / US-55 | Loss-aware interchange and versioned extension schema | T-44, T-49 |
| T-56 / US-56 | Commitments, contracts and economic scenario semantics | T-15, T-49, T-53 |
| T-57 / US-57 | Workforce, suppliers and resource capacity planning | T-16, T-17, T-49 |
| T-58 / US-58 | Customer, offering and value-stream lifecycle | T-49, T-51, T-56 |
| T-59 / US-59 | Risk, obligation interpretation and control effectiveness | T-12, T-49, T-53 |
| T-60 / US-60 | Strategy, outcome hypotheses and safe simulation | T-15, T-36, T-49 |
| T-61 / US-61 | Semantic information and system architecture refinement | T-49, T-54, T-55 |
| T-62 / US-62 | Physical, service and non-digital extension profiles | T-49, T-52, T-55, T-57 |
| T-63 / US-63 | Bulk editing, collaboration and migration conflict workbench | T-53, T-55, T-38 |
| T-64 / US-64 | Explainable multi-axis business and module readiness | T-12, T-49, T-51, T-59, T-60, T-58 |
| T-65 / US-65 | Sentinel source onboarding and safe ingestion | T-07, T-21, T-55 |
| T-66 / US-66 | Evidence-backed claim extraction and identity proposals | T-65, T-22, T-49 |
| T-67 / US-67 | Scoped claim review and lifecycle commands | T-66, T-06, T-53 |
| T-68 / US-68 | Deterministic claim compiler and atomic snapshot publication | T-67, T-49 |
| T-69 / US-69 | Typed integrity graph and compatible OADL projection | T-68, T-55 |
| T-70 / US-70 | Sentinel base authority, governance and coverage rules | T-69, T-59 |
| T-71 / US-71 | Property/process lineage and advanced Sentinel rules | T-70, T-61 |
| T-72 / US-72 | Actionable Sentinel inbox and remediation UX | T-70, T-71, T-03 |
| T-73 / US-73 | Governed Sentinel exceptions and expiry | T-72, T-80 |
| T-74 / US-74 | Semantic drift, source coverage and impact feedback | T-68, T-72, T-37 |
| T-75 / US-75 | Qualify Sentinel source acceptance and first-session value | T-73, T-74, T-45 |
| T-76 / US-76 | Warden versioned policy model and deterministic decisions | T-49, T-59, T-06 |
| T-77 / US-77 | Warden enforcement, capability revocation and effect reconciliation | T-76, T-21, T-23, T-33 |
| T-78 / US-78 | Warden simulation, rollout and operational controls | T-76, T-77, T-40 |
| T-79 / US-79 | Arbiter decision rights and bounded delegation | T-50, T-17, T-76 |
| T-80 / US-80 | Arbiter version-bound reviews, appeals and decisions | T-79, T-38, T-77 |
| T-81 / US-81 | Arbiter authority conflicts and constrained emergency access | T-80, T-70 |
| T-82 / US-82 | Steward semantic catalogue and ownership handover | T-61, T-79 |
| T-83 / US-83 | Steward quality, retention and remediation lifecycle | T-82, T-59, T-40 |
| T-84 / US-84 | Steward data contracts and semantic execution lineage | T-82, T-71, T-77 |
| T-85 / US-85 | Ledger durable governance event chain and reconciliation | T-39, T-49, T-77 |
| T-86 / US-86 | Ledger independently verifiable exports, holds and key lifecycle | T-85, T-41, T-83 |
| T-87 / US-87 | Overseer agent identity and autonomy envelopes | T-18, T-22, T-77, T-79 |
| T-88 / US-88 | Overseer multi-agent handoff and shared-budget supervision | T-87, T-23, T-85 |
| T-89 / US-89 | Overseer independent evaluations and adversarial qualification | T-87, T-88, T-31 |
| T-90 / US-90 | Bidirectional design, integrity and SDLC context pinning | T-54, T-68, T-71, T-84, T-25 |
| T-91 / US-91 | Intent-derived requirements, evaluations and trace completeness | T-90, T-26, T-89 |
| T-92 / US-92 | Multi-repository, legacy and data-migration delivery | T-91, T-30, T-31, T-35 |
| T-93 / US-93 | Architecture alternatives and governed regeneration | T-90, T-91, T-27, T-53 |
| T-94 / US-94 | Environment promotion, progressive delivery and operational acceptance | T-92, T-93, T-34, T-35, T-77, T-86 |
| T-95 / US-95 | Software incidents and governed design feedback | T-94, T-74, T-37, T-43 |
| T-96 / US-96 | Governed enterprise transactions and long-running operations | T-52, T-56, T-77, T-80, T-85 |
| T-97 / US-97 | Connector catalogue and resilient integration lifecycle | T-44, T-65, T-77 |
| T-98 / US-98 | Role-based portfolio shell, search and accessible interaction | T-51, T-63, T-72, T-78, T-80, T-82, T-87, T-45 |
| T-99 / US-99 | Modular self-host packaging and customer-controlled operations | T-08, T-42, T-97, T-85 |
| T-100 / US-100 | Industry and jurisdiction packs with scoped interpretation | T-55, T-59, T-79, T-97 |
| T-101 / US-101 | Organisation simulation, case exceptions and operating learning | T-52, T-60, T-64, T-96 |
| T-102 / US-102 | Enterprise continuity, handover and supplier failure | T-57, T-81, T-96, T-101 |
| T-103 / US-103 | Cross-module security, privacy and authority qualification | T-46, T-75, T-78, T-81, T-84, T-86, T-89, T-96, T-99, T-100 |
| T-104 / US-104 | Portfolio load, compiler scale and failure qualification | T-47, T-75, T-85, T-94, T-97, T-99 |
| T-105 / US-105 | Independent customer installation and portfolio user acceptance | T-48, T-98, T-99, T-102, T-103, T-104 |
| T-106 / US-106 | Integrated portfolio round-trip release qualification | T-75, T-78, T-81, T-84, T-86, T-89, T-95, T-96, T-101, T-105, T-107, T-108 |
| T-107 / US-107 | Extension certification and compatibility laboratory | T-55, T-62, T-97, T-99, T-100, T-103 |
| T-108 / US-108 | Portfolio retirement, portability and structural reorganisation | T-50, T-53, T-55, T-63, T-86, T-99 |
| T-109 / US-109 | Scoped whole-business inventory and completeness certification | T-64, T-108 |
| T-110 / US-110 | Managed SaaS tenant provisioning and regional placement | T-08, T-99 |
| T-111 / US-111 | Enterprise identity onboarding and SaaS access lifecycle | T-110, T-05, T-06, T-79 |
| T-112 / US-112 | SaaS entitlements, metering, quotas and safe subscription lifecycle | T-110, T-77, T-40 |
| T-113 / US-113 | SaaS operator plane and customer-controlled support access | T-110, T-111, T-85, T-43 |
| T-114 / US-114 | Residency, encryption ownership and tenant cell relocation | T-110, T-111, T-86, T-99 |
| T-115 / US-115 | Existing-enterprise discovery and source inventory | T-65, T-97, T-109 |
| T-116 / US-116 | Migration identity mapping, transformations and staging | T-115, T-55, T-63 |
| T-117 / US-117 | Source-of-record ownership and incremental coexistence | T-116, T-84, T-124 |
| T-118 / US-118 | Migration validation, shadow operation and rehearsal | T-117, T-52, T-86 |
| T-119 / US-119 | Fenced cutover, rollback and migration hypercare | T-118, T-114, T-77, T-80 |
| T-120 / US-120 | New and migrated enterprise activation and scope sign-off | T-109, T-119, T-24, T-127 |
| T-121 / US-121 | Unified semantic command registry for every edit surface | T-49, T-53, T-55, T-76 |
| T-122 / US-122 | Field-level dependencies and constraint impact fixed point | T-121, T-61, T-90 |
| T-123 / US-123 | Atomic publication barriers and consistent projection watermarks | T-122, T-68, T-85 |
| T-124 / US-124 | Continuous knowledge reconciliation and explicit truth states | T-74, T-84, T-121 |
| T-125 / US-125 | Customer-defined concepts, constraints and governed actions | T-55, T-107, T-121, T-122 |
| T-126 / US-126 | Unified business workbench and executable activity forms | T-52, T-96, T-125, T-88 |
| T-127 / US-127 | Role adoption, safe templates and graduated autonomy | T-98, T-109, T-87 |
| T-128 / US-128 | Generated enterprise variation matrix and architectural conformance | T-109, T-123, T-124, T-125 |
| T-129 / US-129 | SaaS isolation, fairness, public-edge and service qualification | T-112, T-113, T-114, T-104, T-128 |
| T-130 / US-130 | Migration and cross-perspective consistency qualification | T-120, T-123, T-124, T-126, T-128, T-129 |
| T-131 / US-131 | Enforce complete bounded implementation packets | T-01 |
| T-132 / US-132 | Full enterprise SaaS and migration release qualification | T-106, T-109, T-110, T-111, T-112, T-113, T-114, T-115, T-116, T-117, T-118, T-119, T-120, T-121, T-122, T-123, T-124, T-125, T-126, T-127, T-128, T-129, T-130, T-131 |
