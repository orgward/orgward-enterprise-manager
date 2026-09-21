# OrgWard enterprise SaaS architecture — revision 4

Proposed issue #1 enrichment: [ADR-019/control protocol](CLOSED-LOOP-CONTROL-19.md).
CR-019 awaits independent review. It connects existing modules, enterprise truth,
workflow continuations, evaluation and acceptance without a second orchestrator.
Use its source-linked obligations during packet design; do not infer adoption or
runtime implementation from this link.

User-requested mandatory addendum: [ADR-010](ADR-010-CONFIGURABLE-WORKFLOW.md)
and [configurable workflows](../product/CONFIGURABLE-WORKFLOWS.md). Workflow
definitions (including SDLC itself) are editable versioned data. bpmn-js is the
selected diagram adapter; Temporal is the planned durable process runtime behind
an OrgWard adapter. This explicitly supersedes A-02's PostgreSQL-only **process
scheduler**, not PostgreSQL domain/outbox authority or brokered effects. Compiler,
projection and connector jobs may remain PostgreSQL-backed. No runtime is installed
or qualified by this decision; see its installation/recovery/compatibility slices.

Normative target, 2026-09-19. Architecture decisions below supersede open-ended alternatives in earlier planning, not the existing implementation. The current Node/JSON demonstrator is not this architecture. The product goal now explicitly includes managed enterprise SaaS and existing-enterprise migration alongside customer-owned self-hosting. Do not silently reduce it to a modeling tool or software pipeline.

## A-01 — Endpoint, support and business completeness

An enterprise maintains a coherent, versioned representation of its entire declared business, navigates/changes it from any authorized perspective, and directs its human, agent, software and external-system work through governed processes and evidence. Existing systems may remain authoritative integrations; a human or physical task remains real business work with a responsible performer, checkpoint and recorded result. Neither imported descriptions nor enabled agents prove the business operates successfully.

For every inventoried business activity record purpose/customer/outcome, accountable owner, applicable organisational/legal scope, process/case/decision, inputs/outputs, resources, information/system references, policies/risks/controls, performance measures and execution mode. Execution mode is exactly one of human, internal-agent, internal-deterministic, external-system, physical-attested, or explicitly unsupported. Composite activities decompose into independently governed child activities. Unknown work must have an owner and discovery action, never an invented implementation.

Maintain separate coverage dimensions: inventory coverage, semantic completeness, linked constraint coverage, enabled execution coverage, tested control coverage and measured outcome coverage. Denominators derive from signed inventory manifests plus subsequently discovered activities; additions can lower completeness. Exclusion requires accountable scope decision, reason and review date. Mandatory scope cannot be excluded just to reach 100%. “Complete” means complete against an identified, reviewed, dated scope with no critical unknowns; never objectively every undiscovered real-world behavior. Marketing/export screens state the scope and evidence date.

## A-02 — Runtime topology and trust boundaries

```text
Browser / customer API client
          | authenticated tenant session, commands and consistent queries
Gateway + BFF/API (no caller-asserted authority)
          |
Modular control plane: Studio | SDLC | Sentinel | Warden | Arbiter
                       Steward | Ledger | Overseer | Platform
          | transactional domain services + command/outbox/identity contracts
          +-- PostgreSQL authoritative records/revisions/jobs/outbox/policy
          +-- S3-compatible immutable artifact/evidence storage
          +-- rebuildable graph/search/read projections (not authority)
          |
Scheduler / compiler / projection / connector processes (leased/fenced jobs)
          |
Effect broker -- secret broker -- isolated worker pools / approved adapters
          | per-effect current policy and capability, egress allowlist
Customer systems / repositories / model providers / deployment targets
          |
Observed facts -> proposed claims -> review/compile -> governed correction
```

Start as an ESM Node modular application with separately runnable job processes and isolated execution workers; keep the current runtime family and package conventions. Do not split each product into microservices. PostgreSQL is the authoritative transactional store; use a PostgreSQL-backed queue/outbox for the baseline. S3-compatible storage holds immutable bytes; graph/search indexes are rebuildable projections. Use the current browser stack for early functional slices; any framework migration requires a bounded ADR, not a second app. API is REST `/api/v1` plus resumable event notifications; there is one domain command dispatcher regardless of UI entry point. Exact supported dependency/image/provider versions must be pinned in a release lock manifest with compatibility/security tests, not assumed from these technology names.

Managed SaaS uses regional **cells**: each cell contains control-plane instances, its database/storage boundary, schedulers and worker pools. A minimal global registry owns tenant placement, entitlement and provisioning state, not business graph/evidence contents. Dedicated cells and self-hosted installations use the same versioned domain contracts and artifacts. A customer-selected region is an explicit contract; model/connector egress must also satisfy residency policy. Moving cells is a migration with a fenced source epoch and verified destination, never a DNS-only change.

## A-03 — Module ownership and repository boundaries

Target packages under `src/modules/{studio,sdlc,sentinel,warden,arbiter,steward,ledger,overseer,platform}/` own commands, schemas, transitions, repositories and events for their domain. Shared mechanisms live under `src/platform/{identity,db,commands,jobs,events,artifacts,effects,secrets,projections,observability}/`; they must not own competing business semantics. Routes adapt transport to domain commands; UI contains no authoritative workflow/policy logic. Workers depend on task contracts and broker capabilities, never direct tenant database credentials. `contracts/` carries portable protocol/schema/examples, `migrations/` reviewed database changes and `tests/{contract,integration,acceptance,security,operations}/` scoped verification. These are target paths, not existing implemented packages.

Use one transaction for tightly coupled domain invariants in the modular control plane through explicit service interfaces. Asynchronous consumers update projections and initiate new authorized commands; they cannot bypass another module's write API. Do not introduce distributed transactions or generic cross-module table writes. A deployment boundary can change later only with preserved transaction/effect invariants and compatibility tests.

## A-04 — Tenant and identity boundary

Tenant is a security/billing/placement boundary, workspace a collaboration scope, legal entity a business concept. Never conflate them. Tenant context is derived from authenticated session membership and validated placement; `x-orgward-tenant` is not authentication. Every tenant-owned table/index/job/cache/object/search/subscription includes tenant scope; database-level isolation and repository authorization both apply. Service accounts are tenant/capability scoped. Administrative platform identity grants no implicit business-data or risk-approval rights.

Session version/security epoch changes on revocation; effect dispatch checks current membership/delegation, cell fencing epoch and policy epoch. Browser optimistic state, signed download URLs, event streams and retrieval caches honor revocation within qualification bounds. SaaS support access requires customer-approved scoped, expiring grants, recording and independent review; ordinary support sees redacted health metadata. Break-glass is separately controlled, never a universal bypass.

## A-05 — Canonical persistence and version strategy

Authoritative records, not an eventually consistent graph, decide command validity. Required logical tables/contracts:

| Family | Key and mandatory content | Constraints / access pattern |
|---|---|---|
| tenant, placement, membership | tenant ID, region/cell, security/placement epoch, lifecycle; membership principal/roles/effective interval | Strong isolation; only authenticated placement registry can route. Tenant creation idempotent. |
| object + object_revision | `(tenant,id)` plus immutable revision ID, type/schema, typed payload, provenance, classification, recorded/valid intervals | Composite tenant references; ID not label. Mutable head points to immutable version; optimistic concurrency on head. |
| relation + relation_revision | typed source/target revision policy, predicate/version, scope, validity, semantic properties | Endpoint existence/type/scope checked atomically; no silently dangling relation. In/out adjacency indexes. |
| branch/baseline/review | base digest, candidate manifest, expected head, author, accepted review/evidence, effective date | Published baseline is a complete immutable revision manifest; approval binds its digest. |
| dependency + constraint | dependency source field path/version, consumer ID/revision, sensitivity, recompute/invalidate action; versioned rule | Reverse index; consumer cannot claim fresh result without dependency manifest. Missing dynamic dependencies block protected use. |
| command/result + outbox | tenant/operation/commandId, canonical request hash, result, event IDs, causation | Unique idempotency identity; changed payload rejects. Domain state, result and outbox share transaction. |
| compile/projection job + watermark | baseline input hash, profile versions, tenant security epoch, cursor, lease/fence, completed manifest | Obsolete job cannot advance head; partial results never marked current. |
| run/attempt/effect | pinned inputs, state, capabilities, checkpoints, reservation, effect key, provider reference, reconciliation | Fresh authority at dispatch; monotonic attempts/fences; unknown external result cannot be blindly replayed. |
| source/mapping/migration | source revision/hash/cursor, source-of-record matrix, identity mapping, transformation version, checkpoint and cutover epoch | Resumable and deduplicated; active external side effects never inferred from imported records. |
| evidence/audit/export | immutable references, hashes, authorship, causal IDs, retention/classification, key metadata | Transactional intent, verifiable gaps; expiry/deletion honors holds and disclosed trust limits. |
| inventory/coverage | activity/source manifest, owners, applicability, required facets, unknowns, exclusions and assessment version | Denominators versioned; unreviewed gaps prevent scoped completeness certification. |

Typed JSON payloads are allowed only under registered schemas with stable predicates and migrations; not arbitrary bags of opaque JSON. Index hot tenant/type/scope/time/owner/state queries and relation adjacency. Choose relational indexes first; add specialized indexes only after query fixtures show need. Historical revisions cannot be mutated by an import, merge, recalculation or model output. Views may denormalize but record baseline and projection watermark.

## A-06 — Change transaction and knowledge consistency

One change protocol applies to conversation, form, diagram, matrix, bulk edit, API, connector, workflow result, migration and approved learning. `CHANGE-PROTOCOL.md` is normative. A proposal cannot write accepted truth. At commit, determine affected dependencies under the same revision/security fence, persist the new baseline and invalidation marker atomically, and enqueue recomputation. Protective freshness checks read authoritative epochs; they do not wait for asynchronous graph/UI updates. A bounded traversal that hits its limit produces incomplete impact and blocks publication of protected changes rather than claiming no further impact.

Constraint evaluation can accept independent facts without approving an effect. For example two accepted contradictory source claims remain compiler inputs, but protected deployment cannot use an unresolved mandatory contradiction. A view's publication success is distinct from semantic validation, accepted design, runnable configuration and deployed outcome.

## A-07 — Policy, effects and durable work

Policy is versioned data evaluated by a deterministic restricted interpreter: typed comparisons, set/scope membership, conjunction/disjunction and explicit missing-data semantics. No arbitrary code, network, nondeterministic clock reads or model output inside authorization. Evaluation time is a bound input; rules link strategic→domain→runtime lineage. Immutable deny dominates; then explicit deny; then required obligations/quorum; only then positive grant. Conflicting or incomplete mandatory context yields deny/escalate, not an implicit allow. Extensions cannot redefine precedence.

Workflow definitions include typed tasks, guarded branches/joins, bounded loops/subprocesses, human tasks, timers, case discretion and compensation. Definitions may be cyclic only with explicit termination bounds; instantiated scheduling dependencies remain valid and fenced. Process success means required outputs/evals/checkpoints, not all nodes merely visited. Case discretion records the authorized actor and new plan version. Human workers receive real forms, due dates, workload, evidence and escalation, not a graph-only console.

External effects require a durable intent, current capability, budget reservation, target/config/input/evidence digest, idempotency identity and adapter reconciliation contract. Secrets resolve just in time, isolated workers receive narrow credentials, no tenant can upload an arbitrary control-plane executable. No promise of exactly-once remote effects: unknown outcome remains reconciliatory work. Protected effects fail closed on unavailable policy/audit durability or stale dependencies.

## A-08 — SaaS lifecycle and operational ownership

Tenant states: requested → provisioning → awaiting-admin/identity → ready → active; active may enter restricted/suspended, migrating or decommissioning; deletion completes only after retention/export/disposal policy. Billing delinquency restricts new discretionary work according to contracted grace policy; it must not delete evidence, bypass safety or abruptly abort already-accepted irreversible work. Entitlements affect available features, never authorization to perform an effect. Metering deduplicates immutable usage events; uncertain model costs remain reserved/unreconciled. No payment provider or live charge is enabled by this specification.

Provisioning is a resumable saga with compensation for owned resources and precise failure state. Tenant isolation is tested at every boundary including support, metrics, search, object URLs and cross-cell routing. Apply weighted per-tenant queue limits and separate protected control/recovery capacity from discretionary agents. Canary upgrades per cell, compatible rolling schemas, regional restore and tenant-scoped export/delete are required. SaaS qualification adds public edge/session/abuse and cross-tenant tests to existing single-enterprise acceptance; passing self-host alone is insufficient.

## A-09 — Migration and customer adoption

New enterprise: guided inventory/design → explicit scope review → sandbox process validation → scoped activation. Existing enterprise: discover source inventory → map identities and meanings → stage/import → validate lineage/counts/constraints/history → shadow observe → rehearsal → approved phased cutover → reconcile → hypercare → retire old integrations where authorized. `MIGRATION-AND-COVERAGE.md` defines exact states and checks. Default to coexistence, not a forced replacement of specialist systems.

Every fact type/field/scope has a declared system of record and read/write authority for each migration phase. Do not enable symmetric dual writes by default. Migration transfers operational ownership only at a fenced epoch after approvals and validation; importing a task named completed does not prove it ran in OrgWard. Running work is drained or explicitly bridged, not silently replayed. Customer training, role acceptance and rollback rehearsals are release obligations.

## A-10 — Engineering order, compatibility and assurance

Implement from contracts inward: reviewed schemas/protocol examples → database migrations/repository tests → domain transitions/permission tests → API and outbox/job handling → usable UI → cross-module/failure/real-adapter acceptance. A successful schema/protocol test is **specification evidence only**. Keep original routes behind explicitly labeled development compatibility until a verified import/cutover; do not expose the header-trusting demonstrator as production SaaS.

The original 108 tasks remain; T-109–T-132 add explicit completeness, managed SaaS, migration and knowledge-consistency obligations. T-106 qualifies the revision-3 portfolio baseline; T-132 becomes the final expanded endpoint. Original P/E gates stay fixed and must still pass; SaaS/migration/consistency qualification is additional. Exact commercial policies, customer jurisdictions and provider permissions require explicit configuration/owner decisions—not LLM guesses. No document can guarantee correctness without implementation evidence and independent review.
