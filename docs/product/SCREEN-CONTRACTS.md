# UX and interaction acceptance contracts

Issue #1 proposed refinement: [CLOSED-LOOP-UX-19.md](CLOSED-LOOP-UX-19.md) details
selective clarification, proof/gap workbench, editable diagnostic routes, current
enterprise impact and distinct release/outcome states in these same screens.
CR-019 awaits independent review. These are functional acceptance requirements,
not claims that the demonstrator implements the controls.

Revision-3 supplement: PORTFOLIO-UX.md adds SC-13–SC-20 and role-based laptop workflows across all modules. Its screens inherit every global/visual/accessibility requirement below. The demonstrator still does not implement these contracts.

Revision 2. Complements `UX-SPEC.md`; overrides generic inspector-only descriptions there. These are target behavior, not claims about `/platform.html`. Stable screen IDs below are referenced by the executable backlog. Spec inspection is a separate review mode; ordinary customer actions must operate the named object.

## Global behavior (applies to every screen)

- Show workspace, current object/version, authenticated principal and data freshness. Keep selected object, filter, tab and pagination in a shareable URL. Back/forward and reload preserve context. Switching workspace clears incompatible selections and cancels subscriptions without losing drafts.
- Role preview is allowed only in marked demo mode. Production never allows a dropdown to assert a role. Effective rights come from the server; a control can explain a missing permission without exposing restricted object content.
- Every action has target, preconditions, validation, pending feedback, durable result and recovery. Disable repeated submission while pending; retries use the original command ID. Toasts supplement an object history entry or durable inbox item.
- Distinguish `loading`, `empty`, `filtered_empty`, `unavailable`, `stale`, `partial`, `forbidden`, `conflict`, `failed` and `success`. Unavailable is never replaced with a sample record or zero. Keep drafts through validation/network failures. Offer retry, repair or authorized escalation with correlation ID.
- No sample metric is styled as observed data. Demo mode labels the entire dataset and each live widget's source; “Live” applies to that exact visible record/command. An example row cannot acquire live status because another route implements a related capability.
- Creation opens a form, editing changes a draft, comparison shows a diff, approval records a decision, exporting returns a durable export job. A specification drawer is not any of those actions. Until implemented, label controls “Preview …” or “View specification” in demo mode.
- Screen-specific criteria below inherit the command, state and authorization rules in `../production/DELIVERY-CONTRACTS.md` and the acceptance suite in `../production/QUALIFICATION.md`.

## SC-01 — Install, sign in and select workspace

Entry: installation URL or invited-user link. Operator sees supported version, preflight results, configuration validation, identity connectivity and bootstrap status. No privileged bootstrap after initial owner exists; recovery is a documented audited operator process. User selects only permitted workspaces and can create one if authorized.

Fields: organisation/workspace name, business scope, timezone, locale, default currency, data classification/retention policy, owner and selected identity mapping. Secret input resolves into server-side secret references; values never reappear in detail views.

Commands: preflight, initialize, test identity, sign in/out, create/select/archive workspace, invite/revoke member. Failure cases: expired invite, identity outage, no workspaces, unsupported version, duplicate initialization, lost administrator access. Recovery must be explicit. Success: reload into the same authorized workspace; a revoked session cannot read it.

## SC-02 — Conversation, sources and brief review

Entry: create enterprise, reopen a saved brief, or propose a change to an existing business. Founder types intent, constraints, customers, economics and human decision boundaries. Optional documents show classification, source, import status, conflicting statements and retention.

Assistant asks questions tied to specific missing facts, can be corrected, explains sources and leaves unknowns unresolved. Generation is a cancellable job with budget and progress. Streamed text is provisional until the structured result is validated.

Review: goal, scope, customers/offering, economics assumptions, autonomy boundaries, known facts, assumptions, unknowns and exclusions, each editable with source references. Commands: save draft, correct a prior answer, resolve conflict, accept brief, generate/revise blueprint. Rejecting a proposal preserves conversation and existing published data. Timeout/provider failure offers resume or a new attempt; neither claims a generated blueprint. Acceptance opens SC-03 with the same workspace and brief IDs.

## SC-03 — Enterprise graph, object detail and versions

Map/list share selected ID, type/status/owner filters, search and version. Use labeled typed edges and keyboard-reachable list navigation. Large graphs load neighborhoods; “hidden by filter” explains missing dependencies. Unrelated workspaces never enter a graph query.

Detail shows typed fields from `OUTCOME-CONTRACT.md`, provenance, confidence, owner/authority, inbound/outbound links, gaps, evidence and history. Edit opens a persisted draft. Validate field errors and references inline. Deleting/retiring a referenced object displays affected processes, roles, controls and scheduled work; no dangling links.

Compare displays field/edge additions, changes and removals with author/rationale. Publish revalidates the complete draft and expected base version; concurrent changes open compare/rebase. A changed published version does not rewrite a running task's pinned inputs. Commands: add/edit/link/retire object, save, compare, resolve, publish. Read-only and no-results states retain useful navigation.

## SC-04 — Business coverage, economics and capacity

Default view answers “what stops this business from operating?” with critical gaps and owned next actions across all ten areas. Separate design, enablement, evidence and outcome views; product E-gates belong to Administration.

Economics editor: currency, price/unit, volume assumptions, fixed/variable costs, period, funding, source/confidence. Compare scenarios; label forecast versus actual and formula/version. Capacity editor: resource units, calendar/availability, reservation, budget, usage and dependent processes. Never sum incompatible units/currencies without an explicit dated conversion source.

Gap detail: scope requirement, reason/severity, evidence age, owner, due date, proposed remedy and linked task. Commands: assign gap, test assumption, create experiment, reserve resource, approve justified exclusion, open corrective change. Exclusion cannot hide a critical unmet dependency without a recorded risk decision. Empty observations show “Not measured”.

## SC-05 — People, agents, instructions and delegation

Directory supports invite, status, workload, role eligibility and offboarding; agent profiles show provider, tool scopes, limits and last evaluation. Assignment form includes principal, role, accountability, workspace/object scope, effective dates, instruction version, tools/data/environment scope, budget, escalation owner and deadline.

Instruction editor includes objective, inputs, output schema, procedure, constraints, prohibited actions, checkpoint triggers and evaluation rubric. System proposals are editable. Enabling requires policy validation and appropriate owner authorization; a generated role title grants no permission.

Compare instruction versions and show affected queued/running tasks. Revoke prevents new tool calls and schedules, then pauses/reconciles in-flight work. Offboarding requires handover of accountable objects; cannot erase authored audit records. Self-delegation cannot exceed the delegator's effective authority.

## SC-06 — Process designer and human inbox

The mandatory [configurable-workflow contract](CONFIGURABLE-WORKFLOWS.md) applies
here and to SC-08 SDLC authoring: equivalent Diagram/Outline/Steps/Criteria editors,
subprocesses, parallel/conditional paths, bounded loops, simulation, version diff,
review/publication/enablement and explicit active-run migration. No source-code edit
is required for a supported process reconfiguration. The shipped stage rail is a
template; current eligibility comes from the pinned compiled definition and policy.

Graph editor supports trigger/manual/schedule/event, typed inputs/outputs, task dependencies, conditions, human tasks, agent tasks, checkpoints, timeouts and compensation. Side panel edits each node contract. Preview execution order and invalid edges/cycles before publication. Versioned schedule states include enabled, paused and retired with timezone and duplicate-trigger policy.

Human inbox shows assigned item, inputs, instructions, evidence, due date and decision options. Commands: claim, submit output, request clarification, hand over, approve/reject checkpoint. Acknowledging a notification does not complete work. An absent assignee escalates to a named owner; delegation is audited. Successful process outputs link back to the enterprise object and readiness evidence.

## SC-07 — Runs, attempts and intervention

List separates process runs, task attempts and queue state; counts derive from the same filtered query. Detail shows pinned input/instruction/graph versions, principal, allowed tools, budget reserved/used, lease, progress, redacted logs, artifacts and independent evaluations.

Commands and semantics: pause stops new scheduling/tool calls at the specified boundary; cancel requests termination and shows `cancel_requested` until acknowledged; retry creates a distinct attempt; resume binds an approved revision and checkpoints. “Override” requires a specific permitted exception with reason/expiry and cannot override immutable deny rules or failed artifact identity.

Show pending versus effective intervention, late output rejection, interruption/reconciliation and retry eligibility. Downloaded artifacts include identity/hash and safe content handling. A process exit code of zero is not a successful task until output contract and required evaluations pass. Failed test output remains downloadable to authorized users.

## SC-08 — Governed change case

Create form accepts arbitrary intent, affected enterprise scope, desired outcomes/measures, risk, constraints and owner; creating a case must not open the same hard-coded bank example. Tabs display real context, impact, obligations/interpretations, requirements, architecture, work, assurance and evidence objects.

Each finding identifies source, failing criterion, severity, responsible role and repair command. Requirements editor supports atomic statement, source, priority and acceptance scenarios; architecture compares baseline/target interfaces, data migration, alternatives, fitness rules and rollback. Editing an accepted upstream record marks dependent plan/evaluation/approval stale.

Stage rail derives from one canonical state contract shared with the reference engine. Distinguish stage progress from gate decisions; observation and release effects are explicit child records even if grouped in a stage. Commands advance only when required evidence and authority pass; pause, repair, resubmit and withdraw are durable actions. Full trace to generated work and repository revision is navigable.

## SC-09 — Repositories, builds, promotion and rollback

Repository onboarding displays provider, installation permission scope, allowed repositories/branches, immutable base and connectivity. Change view shows diff, requirements coverage, checks, review status, PR URL and merge result. Conflicts require a new evaluated revision.

Build detail: exact source, build recipe, dependencies, test/scanner results, SBOM, provenance, signature and downloadable candidate. Missing required check is blocked, never green. Promotion review: environment, candidate digest, required evidence, policy version, approvers, risk, expected effect and rollback candidate. Approval expires or invalidates when the bound tuple changes.

Deployment timeline includes requested/accepted/running/healthy/failed/unknown-effect states, provider reference, logs and observation window. Rollback uses the previous verified artifact plus schema compatibility check; irreversible migration explicitly disables automated rollback and routes to an approved recovery plan. Unknown remote result offers reconciliation, not an unsafe duplicate action.

## SC-10 — Observations, experiments and learning

Measures define technical/control/business category, formula, unit, baseline/target, source, sample minimum, observation window, freshness and accountable owner. Display failures independently; technically healthy deployment may have failed business outcome. Missing data is unknown.

Commands: ingest authorized observations, assess, create experiment, accept/reject/defer follow-up. Compare expected versus actual, explain confidence/limitations, retain decision rationale. Accepted learning creates a new governed draft/change case; never silently changes published policies, budgets or instructions.

## SC-11 — Evidence, audit and decision inbox

Search/filter by workspace, object, principal, action, period and result; paginate and preserve filters in URLs. Lineage edges name relationships and navigate real records. Verification exposes hash/signature/key status and gaps; hash equality alone proves neither truth nor trusted authorship.

Export form sets authorized scope, time range, redaction, purpose and format. Durable job supports progress/retry/expiry; manifest identifies records, schema versions and chain gaps. Legal hold prevents deletion and reports why. Notification opens a durable object and remains distinct from its business decision. Revoked readers cannot use cached download links.

## SC-12 — Administration and operations

Subsections: members/roles; policies/delegation; connectors/secret references; environments; quotas/budgets; data classification/retention/holds; installation/version; health/queues; backup/restore; diagnostics; product readiness.

Each configuration has draft/test/apply/history/disable flow and affected-resource preview. Provider rotation validates new credentials before cutover and invalidates old ones; user sees only references. Config changes cannot strand runs silently. Backup and restore show integrity, scope, key availability, last drill and recovery point. Upgrade shows supported path, migration/preflight, queue drain and recovery instructions. Readiness links canonical gate IDs, actual revision-bound receipts and unresolved findings.

## Visual and accessible interaction criteria

Product design targets: main text 16px, table/form text at least 14px, secondary metadata at least 12px; 1.4+ line height for reading. Headings express task hierarchy, not oversized decoration. Use semantic color tokens with text contrast at least 4.5:1 (3:1 large text) and 3:1 meaningful control/focus boundaries; these are acceptance targets to measure, not a claim of conformance.

Use native buttons/links for actions; every pointer action has keyboard equivalent and visible focus. Inspector/dialog announces its title, focuses appropriate content, closes with Escape and returns focus; modal surfaces contain focus, nonmodal panels have an explicit keyboard path back. Errors attach to labels and are summarized; async changes use status announcements without stealing focus.

Reflow at 320 CSS px and 400% zoom preserves reading and commands. Large tables/graphs may have contained scroll with equivalent list/detail access; page-wide overflow fails. Sticky headers and drawers must not obscure focused content. Touch commands target 44px where feasible; reduced motion and forced-colors remain usable. Supported qualification includes keyboard and screen-reader sessions, not only screenshots.

Command center should foreground role-relevant decisions and outcomes; software production gates move under Administration except for administrators. Founder home starts at business design; operator home starts at assigned work. Banking language and personas belong to selectable fixtures, never the universal default.
