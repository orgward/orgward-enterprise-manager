# One change protocol for every entry point

Revision 4. Normative target for T-121–T-124 and all earlier mutation tasks. This supplies deterministic decisions, not a claim of an implemented synchronization engine.

## CP-01 — Command envelope and ownership

Command: `commandId`, `operation`, `expectedHead`, `context {workspaceId, branchId, effectiveAt}`, `payload`, `reason`, optional `sourceRevision`/`previewDigest`. Session supplies tenant/principal/security epoch; clients cannot grant them. Response: command result, new/pending baseline, impact ID, authoritative generation, projection watermark, status and recovery actions. Missing precondition is rejected, not assumed current. Each operation registers allowed roles/scopes, input/output schema, touched fields, constraints, effects and events. Layout operations use view-preference storage and cannot edit semantic objects.

All entry points—including bulk/API/agent/import—use the same registry and domain command path. Agents propose semantic changes unless specifically granted that operation under current policy. External observations always enter the observed/proposed lane; no direct accepted-authority write from telemetry.

## CP-02 — Dependency vocabulary and invalidation

Every derived consumer declares inputs as `{objectId, revision, fieldPaths, scope, dependencyKind, transformVersion}`. Rule dependencies include applicability and field sensitivity. Indirect retrieval adds its source manifest; missing dependency capture makes result `untracked`, not fresh. Permitted dependency kinds and mandatory actions:

| Kind | Meaning | Material change action |
|---|---|---|
| semantic | Definition/reference needed to interpret a model object | Revalidate object and outgoing constraints; mark invalid references. |
| realization | Process/system/component/artifact implements an intent | Reassess coverage and mark satisfaction evidence stale. |
| evaluation | Test/rubric/context/assumption determines a result | Keep historical result but mark applicability stale; enqueue independent rerun. |
| authorization | Policy/identity/scope/approval/evidence required for effect | Invalidate future grant; protected dispatch reads current epoch and denies stale tuple. |
| derivation | Formula, projection, metric or generated proposal | Recompute from pinned inputs or mark unavailable; never overwrite accepted source fact. |
| observation | Evidence of actual behavior/outcome | Preserve observations; reassess interpretation/coverage against new baseline. |
| operational | Active schedule/run/commitment consumes a design | Classify queued/running/completed; revalidate, pause or reconcile according to effect policy. |
| view_only | Layout/filter/personal presentation | Refresh presentation only; no semantic publication or evidence invalidation. |

Renaming a display label is semantic only for consumers declaring that field (e.g. generated text); it must not invalidate every authority grant. Changing a canonical property authority is material to dependent lineage/evals/approvals even if no diagram edge moves. Classification tightening invalidates access and caches immediately. Deleting a referenced object blocks or requires an explicit retirement/migration command; no cascade that quietly removes obligations.

## CP-03 — Deterministic publication protocol

1. Authenticate/resolve tenant and operation; canonicalize request. Same idempotency key with different payload → conflict; identical accepted command → original result, subject to current read authorization.
2. Validate typed payload, expected head, scope and effective date. Build candidate revision manifest in staging; no accepted state change yet.
3. Traverse reverse dependencies to a fixed point over `(object, consumer, scope, relevant field)` with visited set; cycles are legal dependencies, not infinite loops. Compare old/new material fields; use conservative invalidation if sensitivity is unknown. Persist sorted impact paths and whether traversal is complete. Over-budget traversal continues as a job; protected publication remains blocked until complete.
4. Evaluate structural/semantic constraints under the selected profile. Distinguish draft warnings from publication blockers, protected-effect blockers and unresolved accepted-claim contradictions. List required approvals and requested exceptions; approved preview binds candidate digest, base head, dependency/constraint generation and scope.
5. In a transaction lock/recheck relevant heads and tenant mutation generation, current actor/policy/scope and approval eligibility. If any changed, abort with conflict and recompute; never publish a stale preview.
6. Commit immutable revisions, baseline pointer, dependency deltas, command result, audit/outbox and incremented generation **together**. Write an authoritative invalidation barrier for affected protected contexts before acknowledging publication. A task policy may additionally stop new dispatch. No window in which publication is accepted but old approval remains valid for the new context.
7. Jobs compile claims, recompute projections and notify affected owners from the committed manifest. Results publish only if their input manifests still match the requested generation; an obsolete job remains historical. Retry is idempotent by consumer+input digest.
8. Query responses expose baseline/generation and watermark. Clients may display explicitly stale last-good views but cannot mix revisions in a single authoritative comparison. Requests requiring current consistency wait within a bounded timeout or return pending/unavailable, not stale-as-current.

Reference fixtures in `contracts/enterprise/consistency-cases.json` exercise the safety decisions. They do not replace database race/failure tests required by T-123/T-130.

## CP-04 — In-flight work and impact UX

Queued work: revalidate at dispatch; stale context requires successor plan/evaluation/approval. Running computation without external effects: retain pinned version; allow bounded finish only when policy permits, label result historical/stale for new intent. Revoked permission or tighter data classification stops new reads/tool grants and requests pause/cancel. Already-dispatched effect: record stop intent and reconcile actual provider result; no claim that changing the blueprint undid a transaction. Completed work: never rewrite inputs/results; link new correction/compensation separately.

SC-24 impact preview lists affected object/field and dependency path, current/pending/historical version, conflict/control reason, required reviewer, queued/running/completed work, risk of irreversible effect and proposed recovery. Users can navigate back to the initiating lens without losing context. Publish is disabled for incomplete impact or unmet mandatory review. Permission filtering must not leak hidden object counts; authorized reviewers may see aggregate redacted impact only when policy permits.

## CP-05 — Freshness, contradiction and reconciliation

Knowledge states: current-with-evidence, current-asserted, proposed, stale, contradicted, missing, unsupported, and historically-valid. They are not interchangeable. Recompute does not create evidence of real-world truth. Automated reconciliation compares source cursors/manifests to accepted mappings and creates proposals; it never changes an accepted business decision merely because a system behaves differently. Record source outages and observation coverage separately from fact deletion.

Maintain freshness SLAs per source/consumer with owner, expiry and action on expiry. Scheduled reconciliation detects missed events and restores completeness with checksums/counts/cursors. Overlapping edits from source systems and Studio follow explicit per-field source-of-record rules; unresolved ambiguity creates a conflict case. No timestamp-based last-write-wins on authority, policy, commitments or identity. Invalid references, orphaned definitions, untracked derived fields and expired evidence create owned repair work visible in all impacted lenses.

## CP-06 — Counterexamples that must remain failing

- New baseline acknowledged while old approval dispatches under that baseline.
- Tenant support admin mutates business authority through an internal endpoint.
- Old projection replaces a newer head after a slow compile finishes.
- Circular dependency silently omitted to keep impact traversal small.
- Bulk import or canvas gesture bypasses validation used by forms.
- Connector output promotes observed bypass into accepted authority.
- A merge discards a mandatory control, or a revert rewrites completed execution.
- Evidence loss shows green readiness, or a changed label invalidates unrelated all-tenant work.

Every counterexample needs API/backend concurrency assertions and user-visible recovery, not only a unit test of a policy helper. Store dependency path and decision inputs as structured audit data, not private model chain-of-thought.
