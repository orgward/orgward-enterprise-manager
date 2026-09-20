# Hard requirement: user-editable enterprise and SDLC workflows

Normative user-requested addendum, increment 10. Required, not implemented.
Applies to business processes and **the SDLC process itself**, including subproducts'
review, evaluation and remediation workflows. ADR-010 fixes architecture choices.

## The experience

Open **Processes → SDLC → Edit workflow**. Select the shipped default, fork a
workspace-specific profile or edit an authorized draft. Switch among Diagram,
Outline, Steps table, Criteria and Run preview without losing selection or data.
Both diagram and forms are complete editors, not a diagram plus a JSON-only escape
hatch. A novice can insert a human review; an architect can drill into substeps and
typed contracts. Advanced users may edit/import validated definitions but cannot
bypass the same command path or permission checks.

Example: insert “Privacy review” before release; perform security and performance
checks in parallel; repeat implementation → tests while tests fail, at most three
iterations and within one shared budget; if still failing, escalate to the named
human. Change a criterion to require a successful accessibility evaluation. Save,
simulate both pass/fail paths, compare effects, request review and publish version 2.
New starts can use v2 after enablement. Existing runs remain pinned to v1 unless an
explicit reviewed migration at a safe boundary is eligible.

Default S0–S11 stage IDs remain traceable aliases for the supplied SDLC template.
Customers may rename, split, combine, reorder, nest or conditionally include steps.
Screens derive progress and next actions from the selected profile and execution,
not a fixed array index or exactly twelve nodes. Historical reference-engine stages
remain preserved as imported/template provenance. Required controls are independent
of labels: deleting “Security” cannot delete the mandatory security obligation.

## Node and field contract

A profile owns ID, tenant/workspace/scope, schema/revision, author, owner, provenance,
description, input/output schemas, default calendar, start triggers, shared budgets,
mandatory policy profile, dependency manifest and lifecycle. Publication stores
immutable definition digest, compiler/interpreter/action-registry versions, compiled
digest and review receipts. Layout/viewport preferences are separate from semantics.

Each stable node ID has label, purpose, typed input bindings/output schema, owner/
performer rule, entry criteria, required postconditions/evaluations, timeout/retry,
failure/escalation/compensation route, classification and evidence dependencies as
applicable. Parameters are typed values or allowed field references, never secret
values or arbitrary evaluated code. Node kinds and exact behavior:

| Kind | Editing and execution semantics |
| --- | --- |
| Sequence | Ordered children; next eligible only after predecessor's required outputs/criteria. Reorder previews data/authority impact. |
| Action | Registered operation + exact version, approved adapter and input/output mapping. Human, agent, deterministic and external effect modes remain distinct. |
| Human task/approval | Typed form, eligible role/scope, decision schema, due date, quorum/conflict rules and escalation. Decisions bind run/node/iteration/context/output. |
| Evaluation | Named independent evaluator/version, exact input artifacts, rubric/test suite, freshness and required result. Generator self-rating is not independent evidence. |
| Choice | Ordered explicit cases or declared disjoint cases; evaluated inputs and selected route are recorded. Mandatory default/unknown route prevents silent dropping. |
| Parallel | Fixed branch set per invocation; join-all or explicitly configured first-success. Skipped/failed branches are tracked; first-success cancels/reconciles losers before protected continuation. |
| Repeat/for-each | Explicit body, stop condition, positive iteration/item bound, duration and shared budget; unique invocation/iteration IDs. Exhaustion routes failure or owned escalation. |
| Subprocess | Exact child profile revision/digest, typed argument/result map, cancellation propagation and capped inherited budget. No floating latest or unrestricted recursive calls. |
| Timer/event wait | Deadline/calendar/timezone plus DST overlap/gap/misfire policy; authenticated correlated event and deduplication rule. Timeout has an explicit route. |
| Compensation | Separate authorized action referencing completed effects in reverse dependency order where appropriate. Partial/unknown compensation stays recovery-pending; it does not erase the original effect. |

Baseline authoring permits structured sequence/choice/parallel/repeat/subprocess
constructs. Arbitrary irreducible jumps or unbounded cycles are rejected with a
specific repair; BPMN import must report unsupported constructs, not flatten them.
Instantiated scheduling dependencies remain acyclic: a loop creates new iteration
instances, not a reused completed task. Template recursion is rejected in v1; use
bounded repeat or finite explicit subprocess nesting. A later supported recursion
profile requires explicit depth, budget, qualification and interoperability rules.

**Loops and retries differ:** a loop is intended business rework with new input/
evaluation/decision lineage; a retry repeats a transiently failed attempt under
the same logical operation identity. Neither repeats an unknown external effect.
Nested loop/fan-out budgets share the parent reservation; no multiplication of
authority, money, concurrency or time. Bound nesting, expansion size and event
history; exhaustion is visible. Continue-as-new/runtime history compaction preserves
logical run/iteration/effect IDs and counters rather than resetting limits.

V1 `repeat-until` evaluates after each completed body (minimum one iteration);
pre-test repetition is a choice around repeat. For-each snapshots its ordered item
set at entry, caps item count/concurrency, and records skipped for an empty set;
skipped work is not passing evaluation evidence. Join-all failure cancels/reconciles
active branches before its failure route. Join-first-success may select a winner's
data, but protected next effects wait for loser reconciliation. Sibling outputs
need explicit names and a deterministic reducer, never last-write-wins merging.

## Criteria and action configuration

Structured criterion builder: choose permitted field/evidence, operator, typed
literal or reference, unit, evidence age/window, and all/any/not grouping. Support
typed comparisons and existence tests under a deterministic restricted expression
AST. No JavaScript, SQL, shell, network, random value or model instruction in
criteria. Explicit unknown propagates; missing is not zero/false/success. An unknown
protected precondition blocks and creates owned clarification. A process branch
may route unknown to a review node, but not treat it as permission.

V1 truth table: `all` returns false if any operand is false, otherwise unknown if
any is unknown, otherwise true; `any` returns true if any is true, otherwise unknown
if any is unknown, otherwise false; `not unknown` remains unknown. Empty all/any
groups are invalid. `exists` over an authorized missing optional value is false;
it is not a probe for denied objects/fields. Comparison with unknown yields unknown;
type/unit mismatch is a validation error. Ordered choice selects the first true
case only when preceding cases are false; an earlier unknown routes clarification.
Disjoint choice requires exactly one true with no unresolved overlap; multiple true
or unresolved mandatory inputs block. Default applies only when all ordinary cases
are false, not when any are unknown.

Test the expression with saved sample inputs; show values used, truth/unknown and
explanation, not hidden model reasoning. Store expression version and dependency
fields so changed definitions/thresholds invalidate dependent results. Units/time
windows must be compatible. Sensitive fields remain redacted by caller authority.

Action editor shows operation version, allowed input mappings, output contracts,
effect class, idempotency/reconciliation, required capabilities, environment, tool/
data scopes, limits, retries and compensation support. Values outside the action's
registered schema cannot be saved as enabled configuration. Adding a plugin is an
operator-reviewed registry extension, not uploading executable code into the API
process. Renaming an action or making a criterion optional cannot weaken Warden's
mandatory effect-time checks or Arbiter's reviewer eligibility.

## Commands, permissions and persistence

Registered commands (not currently implemented routes): CreateWorkflowDraft,
ApplyWorkflowPatch, ValidateWorkflow, SimulateWorkflow, RequestWorkflowReview,
PublishWorkflow, EnableWorkflowVersion, RetireWorkflowVersion,
PreviewRunMigration, ApproveRunMigration, ApplyRunMigration. Queries expose profile
versions, compiled diagnostics, trace/run instances and permitted action/criterion
registry. All use `/api/v1` command/query conventions and the common change path.

Patch operations include insert/remove/move node, set typed field, bind port,
change branch/join/loop, pin subprocess and set per-node criteria/action parameters.
Patches bind expected aggregate version and branch head; stable node IDs survive
rename/reorder. Publish binds semantic digest, dependency generation, mandatory
policy, registry and simulation/review evidence. Concurrent conflict opens a
three-way semantic comparison. Successful publication does not automatically enable
an environment or start runs. Retry after lost response returns the existing result.

Designer can edit permitted drafts; reviewer can accept within scope and conflict
rules; operator can enable eligible versions; run owner can request intervention;
only separately authorized migration reviewer can approve run migration. Agents
may propose patches under delegated scope, never self-authorize protected actions.
Read-only users can inspect permitted definitions and runs, not access hidden input
schemas, field names or secret-bearing samples via validation/autocomplete errors.

Editor commands share one undo/redo history while drafting. Undo is a new inverse
draft command under concurrency checks, not a database rollback or erasure of audit.
Removing a referenced node previews consumers and requires repair; cut/paste creates
new identity with origin reference. Layout drag never changes semantic edges. Template
inheritance is pinned; upgrades offer a three-way diff with explicit override ownership,
not silent propagation into published customer workflows.

## Simulation and validation

Compiler checks schema/registry versions, references/port compatibility, reachable
exit paths, branch ambiguity, join token accounting, mandatory checkpoint coverage,
bounded repetition/expansion, source/classification access and failure/compensation
routes. Findings include exact node/edge/field, criterion, owner and remedy. Invalid
drafts may be retained for editing but cannot publish/enable protected execution.

Simulation uses the same compiled semantics with fixture action results, virtual
clock and seeded recorded branch inputs. It displays step eligibility, data mappings,
selected branches, blocked criteria, cost bounds and expected effects **without real
effects**. Simulation does not prove model quality, external behavior or production
performance. Runtime conformance replays equivalent actual recorded inputs through
both paths and compares next-step decisions. Test pass, fail, unknown, timeout,
denied, cancellation, duplicate event, exhausted loop and partial compensation.

## Changing active processes

Default: new runs pin newly enabled version; existing runs retain full old profile,
compiler/interpreter/action versions, instructions and evidence. Current security,
policy and revocation still apply at each effect. Do not freeze old authorization
merely because the old process definition is pinned.

Optional migration: request pause → reach acknowledged safe boundary → preview
old/new node/port/state mapping and required invalidations → reconcile all pending
effects → independent scoped review → atomically fence predecessor and create a
linked successor execution under the new definition. Missing nodes/inputs, running
uninterruptible action, unknown effect or incompatible compensation blocks migration.
No replay of already completed work, transfer of expired approvals, or mutation of
historical outputs. Unsupported in-flight migration means drain/restart with explicit
reconciliation, not a hidden live graph patch. Rollback of a profile likewise creates
a newly enabled revision; it cannot undo prior external work.

## Hard qualification conditions

Workflow editor must let an authorized laptop user modify the shipped SDLC template
in both representations, add nested/parallel/rework paths and typed criteria, compare,
simulate, review, enable and execute without editing application source or deploying
new orchestrator code. Keyboard-only structured editing covers every supported
diagram action. Reload, denied, offline, conflict and failed validation retain drafts
and explain recovery. Runtime overlay shows actual node/iteration state and links to
inputs, evidence, actions and approvals. Required policy controls remain enforced
even if the diagram omits, renames or reroutes their visual steps.

WF-01–WF-16 in `contracts/enterprise/workflow-obligations-10.json` are mandatory
additional acceptance for owning tasks and final qualification. Fixed P/E gate
denominators and original scenarios are preserved; no diagram or simulation-only
receipt satisfies runtime qualification.
