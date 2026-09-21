# Enterprise SaaS, migration and consistency qualification — revision 4

Proposed additional issue #1 qualification: after CR-019 review, T-132 must execute
the 24 CL obligations and four supplementary cases from the linked contract,
including [nonlinear E2E and recovery](../product/CLOSED-LOOP-UX-19.md). Integrate
with SQ-03/08 and existing PQ/RS journeys; no separate orchestration island or
replacement of original criteria. All CL product results currently remain not_run.

Mandatory configurable-workflow overlay: T-132 also requires WF-01–WF-16 from
`contracts/enterprise/workflow-obligations-10.json`, including both UI editors,
changed SDLC execution, active-run migration, broker safeguards and qualified
self-host/runtime replay/recovery. Original SQ/PQ/Q scenarios and P/E denominators
remain intact. No fixed-stage-only implementation meets the user's endpoint.

Additional required product acceptance for T-132. Retain original P/E gates, Q/PQ journeys, Sentinel R/AT and ES/F/PC/X scenarios. Abstract protocol fixtures and the specification checker are not substitutes for these future tests.

| ID | Complete role journey and expected persisted result | Mandatory counterexample/recovery |
|---|---|---|
| SQ-01 | Founder inventories every business dimension/unit, reviews unknowns, publishes design, connects performers, executes meaningful work and signs a dated scope assessment. Persist denominator, attestations, sources, outputs and outcomes separately. | Unknown critical activity, unsupported effect or untested mandatory control prevents operating certification. New discovery invalidates pending certificate, not historical evidence. |
| SQ-02 | Migration owner discovers two unrelated source estates, maps identities, stages history, validates counts/hashes/invariants, shadows, rehearses, approves final deltas, cuts over scoped work and accepts hypercare. | Duplicate identity, missing reference, authority conflict, changed watermark, crash after fencing, pending remote effect and irreversible post-cutover work must reach safe recovery without duplicate effects or fabricated history. |
| SQ-03 | Change process/authority/classification through all ten entry points; inspect dependency impact, review/publish, then check all affected perspectives, claims/evals, approvals, queued work and historical runs. | Race dispatch against publication while projections lag. Old approvals fail against invalidated context immediately. Layout changes do not invalidate semantics; cycles/traversal limits cannot hide impact. |
| SQ-04 | Admin provisions isolated SaaS tenant, verifies identity, configures quotas, inspects metering, grants/revokes support and restricts/resumes service. Operator maintains cells with limited metadata access. | Cross-tenant routing/search/exports/logs, usage replay, entitlement-as-authority, support escalation and restriction during irreversible work. No leakage, duplicate usage attribution or lost reconciliation. Live charging is separately authorized. |
| SQ-05 | Operator relocates tenant and restores backup under residency/key policy; reconciles jobs, usage and artifacts within measured recovery objectives. | Denied geography/provider, key rotation, old placement epoch/lease and revoked grants during failover. Exactly one logical writer, no revived authority, historical evidence remains verifiable. |
| SQ-06 | Customer defines typed concept/relation/rule/form/action, evolves schema and executes actual human/agent/external cases with outputs and permitted compensation. | Core-semantic override, arbitrary authorization code, self-approval and unsupported physical action are denied before effect; data/history and actionable repair remain available. Templates do not grant authority. |
| SQ-07 | Independent users/operators execute the supported variation matrix, accessible role journeys, tenant fairness and migration drills on pinned topology/providers; publish measured limits/support matrix. | New variant, omitted mandatory case, noisy tenant, inaccessible workflow or missing restore proof blocks the relevant qualification. Exclusions cannot remove required target behavior. |
| SQ-08 | Independent reviewer traces every task to working UI/API/state/effect and revision-bound results; demonstrates greenfield and migrated business operation plus Sentinel/SDLC correction. | Any missing module, unsupported-scope misrepresentation, unrun mandatory test or failed control keeps enterprise-SaaS readiness false despite earlier T-106 or specification success. |

## Data, load and evidence

Reuse Q/PQ latency, 24-hour soak, graph/claim/job and restore targets. Add simultaneous idle, interactive, bulk-import, compiler and bursty-agent tenants; record workload proportions and verify protected control/recovery capacity for normal tenants. Reconcile usage from immutable event IDs exactly. Migration fixtures include legal scopes, historical schemas, classified attachments, active work and external operation IDs. Do not infer managed-SaaS reliability from a single-enterprise benchmark.

Run datastore/API concurrency and real isolated-adapter tests, not helper-function booleans. Inject delay/crash between publication, cutover and effect boundaries. Assert immutable revisions, atomic invalidation, no obsolete consumer-head promotion, one valid writer epoch, no leaked secrets and no unaccounted accepted effect. Never assume exactly-once remote execution.

Eighteen AI invariants and eight SQ journeys start not_run in ENTERPRISE-ARCHITECTURE.json. Passing needs completed owning tasks and receipts containing revision, deployment mode, tenant/cell/hardware/profile/provider versions, fixture manifests, actor scopes, commands/results, timing and unresolved findings. T-132 requires all original and expanded acceptance, not merely the architecture checker.

Approved implementation packets remain absent. Increment 05 supplies 132 boundary drafts in WORK-PACKAGE-INDEX, not automatically ready packets. Future agents resolve their explicit domain/operation gaps, create bounded concrete packets from IMPLEMENTATION-HANDOFF, obtain legitimate independent review and satisfy dependencies before starting. Structural validation catches missing cases and false states; it cannot establish reviewer authenticity, correctness of every business interpretation or actual production behavior.
