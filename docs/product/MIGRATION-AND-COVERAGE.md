# Business completeness, onboarding and migration

Revision 4 target. New companies and existing enterprises must reach the same operating model; a greenfield wizard is not sufficient. Applicable tasks: T-109–T-120, T-125–T-130. All behavior below is required future work, not current capability.

## MC-01 — Business inventory and completion evidence

An inventory includes business units/legal entities, offerings/customer journeys, recurring and exceptional activities, decisions, roles/delegations, resources/commitments, information and source systems, policies/obligations/controls, metrics and lifecycle/continuity obligations. Seed from interviews/chat, existing diagrams/docs/catalogues and authorized operational metadata. Show discovery coverage per source/team/period; do not infer completeness from the number of generated nodes.

Each inventory item has stable ID, source+revision, proposed canonical mapping, accountable reviewer, criticality, expected process/actions, execution mode, data sensitivity, current/target system of record and known unknowns. Non-recurring executive, exception, audit and wind-down work must be included. Owner attestation reviews missing/unknown/excluded items by dimension and unit. New discoveries reopen assessment, increase the denominator and route repair; past certification remains historical.

An activity is **represented** when its purpose, ownership, scope, inputs/outputs, constraints and dependencies are explicit. It is **runnable** when it has valid instructions/plan, eligible human/agent/adapter, resources, checkpoints and permissions. It is **qualified** when positive/negative/recovery outcomes are evidenced in the supported environment. It is **successful** only when its business measure is observed over the required window. Report separate percentages and counts with scoped denominators, never one “enterprise 100%” indicator.

No customer has to migrate all transactional data into OrgWard to represent all of its business. Where a CRM/ERP/bank/device remains authoritative, OrgWard models its contract and governs supported interaction; the UI must say which actions run there and what evidence is available here. Unsupported automation is a visible gap with owner and route to a qualified adapter or manual process, not silent removal from scope.

## MC-02 — Migration objects and phase authority

MigrationPlan: source inventory/version, target tenant/workspaces, data classifications/residency, source authority matrix, object/identity mapping version, transformation package hash, import scope, snapshot/cursor, validation profile, criticality, owners/reviewers, rehearsal/cutover/rollback criteria and epoch. Each batch tracks exact source identities, hashes/counts, transformation results, quarantined records, checkpoints and evidence. Transformations are deterministic and sandboxed, with no outbound side effects or secret-bearing output.

SourceAuthorityMatrix entries bind object type/field/business scope to source owner, current system of record, allowed OrgWard writes, conflict rule, refresh window and migration phase. Import does not automatically transfer ownership. Coexistence is single-writer per declared field/scope by default; multiple writers require an explicit reviewed conflict protocol. Timestamp precedence is insufficient for authority/policy/financial commitments.

| Phase | Permitted work | Exit / failure and recovery |
|---|---|---|
| discovery | Read-only inventory/profiling in approved scopes | Owner validates coverage and source permissions; unknown systems stay unresolved. No customer data leaves approved region. |
| mapping | Propose canonical identity/type/scope and field transforms | Reviewer resolves duplicates/conflicts; mappings preserve provenance and required history. No active grants imported. |
| staged | Resumable immutable snapshot import to isolated draft | Per-batch counts/hashes/reference checks; invalid rows quarantine under explicit atomic/partial mode. Retry by source identity/revision. |
| validated | Reconcile source↔target and domain invariants | Critical loss/collision/constraint gap is zero; every permitted difference has an approved explanation. Sampling supplements, never replaces, exact identity/count/hash checks. |
| shadow | Read/observe current operations without effects | Compare outputs/decisions under the same inputs and source coverage; no double execution, no auto-acceptance of observations. |
| rehearsed | Exercise isolated cutover/rollback on representative data and work | Preserve history, verify pending work policy, measure RPO/RTO and user acceptance. Failed rehearsal cannot be waived by a pretty map. |
| cutover_pending | Freeze approved scope, capture final deltas and validate bound request | Independent approval binds source watermark, mapping, target baseline, placement/authority epochs and rollback plan. Changed input invalidates approval. |
| cutover | Fence old writer/schedules, install new epoch and enable approved target scope | Old source epoch cannot dispatch; checkpoints survive crash. Unknown remote effects are reconciled before transfer. |
| hypercare | Compare live scoped operation, reconcile lag and resolve defects | Named observation window and pass criteria. Failure invokes approved rollback or forward recovery with explicit irreversible-effect limits. |
| complete | Customer accepts reconciled target scope; retire only authorized old paths | Source preservation/retention/export evidence and signed scope record. Unmigrated business remains visible and governed through coexistence. |

`failed`, `paused`, `rollback_pending`, `rolled_back`, `recovery_required` are explicit states reachable only under phase-specific rules. Resumption uses the same manifest/cursor or creates a new version; it cannot quietly skip validation. Imported historical success is tagged imported-source-attestation, not an OrgWard execution receipt. Original IDs are retained or mapped permanently. Secrets, sessions, live schedules and old approvals are not activated from imported data.

## MC-03 — Running processes and irreversible effects

Choose per process: drain to completion under old owner; pause at a supported checkpoint and bridge with full pinned state; or retire and replace with a reviewed new process. Unsupported in-flight state stays with old engine until drained. Never reconstruct a run from a status label alone. Track both original and target run IDs and exactly which system is authorized to dispatch next.

During cutover, fencing protects logical dispatch but cannot recall already accepted remote work. Reconcile operation IDs first. On rollback, restore allowed authority/placement references only after validating current security, commitments and external effects; do not replay old outbox events or revive revoked grants. Irreversible data/financial/physical action requires forward recovery or compensation, not a false universal rollback promise.

## MC-04 — Managed SaaS and customer administration

Provisioning supports invited/approved enterprise signup, domain/identity setup, tenant-specific region and deployment tier, initial owner recovery, quotas and supported module selection. Tenant activation requires privacy/security settings, policy defaults and a tested least-privilege identity path. Trial/sandbox mode is visibly separate from live work and cannot perform live protected effects by default.

SaaS lifecycle includes subscriptions/contracts, immutable usage events, rate/worker/model/storage limits, overage policy, exportability, planned maintenance, health and support cases. Entitlement denial never masquerades as a missing business object. Suspension/restriction preserves evidence and safety-critical reconciliation; resumption rechecks authority. Payment collection is an optional certified provider contract and is not enabled by documentation or user interface previews.

Platform operators see tenant placement and operational metadata, not unrestricted business contents. Support access requires explicit scope/reason/expiry, customer consent under agreed policy and audit; export diagnostics redact sensitive data. Tenant relocation/residency changes require the same rehearsal/fencing/reconciliation as migration. Customer can see supported geography/provider restrictions and choose not to enable incompatible integrations.

## SC-21 — Existing-enterprise discovery and migration workbench

Entry: create enterprise → new design or migrate existing; returning owner reopens plan by ID. Views: source inventory, profiling, identity/mapping conflicts, staged counts and diffs, source-authority matrix, validation exceptions, shadow comparison, running-work disposition, rehearsals, cutover review and hypercare. Each phase shows owner, preconditions, accepted evidence, timestamps and next allowed command.

Fields: source scopes/classification, target scopes, source revision/cursor, identity matching rules, transform version, permitted differences, per-process transfer policy, approval/rollback window. Commands: discover, map, stage, quarantine/repair, validate, shadow, rehearse, request cutover, approve, execute, pause, reconcile, rollback, accept scope. Read access does not authorize cutover. A paused/failed import retains safe draft; missing evidence blocks phase advance with actionable repair. Keyboard users can review mapping tables and conflicts without canvas operations.

## SC-22 — Tenant, subscription and service operations

Customer admin sees placement/residency, identity/domain status, module entitlements, quota/reserved/actual usage, service health, maintenance, support grants, lifecycle and export/closure. Provider operator sees permitted control-plane metadata and provisioning/recovery jobs; business objects stay inaccessible without a separately approved grant.

Commands: request/provision tenant, test identity, activate, request quota/change plan, grant/revoke support, schedule maintenance, restrict/resume, relocate, export/decommission. Each is policy-bound and audited; “change plan” cannot silently charge a customer. Stale billing/metering is labelled unknown; duplicate events do not increase charges/usage. Provisioning failures show owned partial resources and retry/compensation. User can cancel a request without misrepresenting completed irreversible effects.

## SC-23 — Business coverage and operational completeness

Matrix axes: enterprise dimension/unit and inventory/representation/constraints/runnable/tested/outcomes. Each cell links to actual scoped items, unknowns, exclusions, evidence age and accountable next action. Drill to uncovered activity, inspect required facets, select human/agent/internal/external/physical execution, propose missing model or connector, and rerun assessment. Exclusion form demands reason, authority, expiry and impact; critical controls cannot be excluded to game a score.

Commands: accept inventory, assign discovery gap, map activity, review exclusion, propose process/action, request validation, certify dated scope, reopen on discovery. Success means exact scope/denominator and evidence persisted. Concurrent imports or newly discovered activities invalidate a pending certificate; the UI shows why. An enterprise with every activity described but no execution shows represented, not operationally ready.

## SC-24 — Impact, constraints and knowledge synchronization

Entry from any edit lens/API-generated proposal, claim, migration or observed drift. Compare current/candidate fields and typed links; inspect affected paths, stale evaluations/approvals, conflicts, active work, projection lag and required reviewers. Show “why affected” and “why not affected” from registered dependency sensitivity. The initiating lens/selection is retained through review.

Commands: preview, refine proposal, resolve conflict, request review, publish if eligible, revalidate, recompute, inspect lag, repair missing dependency, reconcile source and request compensation. Unsupported or partial impact prevents protected publication. Pending recomputation never appears fully synchronized. Running external work is shown separately from design state; successful publication is not successful deployment or completed compensation.
