# Portfolio experience and functional interaction contracts

Revision-4 addition: MIGRATION-AND-COVERAGE.md adds SC-21 migration, SC-22 SaaS administration, SC-23 complete-business coverage and SC-24 impact/knowledge synchronization. All global interaction/accessibility and truthful-state requirements below apply. Current target is the 132-task revision-4 roadmap, not only the earlier catalogue.

Revision 3. Extends SC-01–SC-12 with SC-13–SC-20. Existing `UX-REVIEW-02.md` findings remain open; this document does not claim a new browser test or working UI. Primary qualification device is the user's **laptop**; responsive and assistive access remain requirements, not a mistaken assumption that the user operates only by phone.

## Experience principles that have functional consequences

Start with the user's job, not product-module jargon. Founder home shows design and critical business gaps; worker home shows assigned work and escalation; architect home shows changes and integrity; administrator home shows installation and controls. Persistent workspace/scope, branch/baseline, effective date and freshness appear wherever they change the meaning of a result. Global search and the command palette are permission filtered and link to canonical objects, not duplicate module-specific records.

Default to a small meaningful neighborhood and progressive disclosure. Explain why a question, gap or evaluation matters to the user's objective. Let users stay with plain language, forms, lists or matrices; expert graph/model controls are available without forcing a giant initial modeling exercise. Empty state starts a real task, not a fabricated dashboard. Required fields are contextual; “unknown” is a first-class answer with owner/next action.

Provide a persistent distinction between draft, accepted design, enabled operation, observed behavior and verified outcome. Color is supplemental: status text, icon and source timestamp carry meaning. Cards expose their denominator and scope. A branch with five unresolved conflicts cannot show “ready” because every object has a name. Product readiness lives under administration, not confused with the customer's business readiness.

Common behavior: every command has visible permission, input validation, pending state, durable outcome, history and recoverable errors. Draft preservation, expectedVersion conflicts, idempotent retry, keyboard equivalents, focus return, readable graph labels, list alternatives and linkable filtered state apply to all screens. Critical actions preview scope/effects and bind confirmation to a digest; reading a specification never counts as performing the action.

## Screen layout and navigation contract

On a laptop the design workspace has a compact context bar, lens/detail controls, central map/list/matrix, and optional resizable inspector. Compare opens a second synchronized pane, not overlapping drawers. User can pin selection and return to their previous lens with viewport/filter state intact. Collapsed navigation never hides blocking errors. On narrower widths, pane selection becomes explicit tabs with preserved context. Graph canvas has a skip link and equivalent searchable list; zooming the page never disables core commands.

Information density is role/task-dependent, not tiny type. Inherit the measured type/contrast/focus/reflow targets in SCREEN-CONTRACTS. Graph edges have predicate labels on selection and distinguish direction; canvas coordinates are not semantic facts. Validation appears at the relevant field and in a summary with actionable links. Long operations use durable job status with cancel/reconnect semantics, not indefinite spinners. “Unknown result” names reconciliation and does not offer unsafe replay.

## SC-13 — Cross-perspective design and refinement studio

Entry: selected business object from conversation, search, gap, process or release trace. Context: EM-01 tuple. Modes: map/list/matrix; single/split lens; D0–D5. Inspector tabs: meaning, relationships, ownership/authority, realization, evidence, changes and operational impact. Relationship editor displays typed endpoints, predicate, legal/organisational/time scope, rationale and source. Refinement wizard asks reuse/manual/new-system rather than assuming every capability requires code.

Commands: add/edit/link/unlink, select another lens, open reverse trace, create refinement, compare alternatives, propose process or SDLC change. Link removal previews impact; layout reset cannot remove semantics. Field changes create draft revisions and an impact preview; only authorized publish changes accepted design. Success: selected ID and related objects are consistent in both panes and survive reload. Failure: unavailable projection shows stale timestamp, unsupported extension names its required pack, forbidden dependency is redacted without leaking its count/name. Concurrent semantic edits route to SC-14, not silent overwrite. T-49–T-64 own the backend and interaction work.

## SC-14 — Baselines, branches, review and merge

List shows branch purpose, base revision, author, scope, state, pending review, conflict count and affected running work. Compare separates content, typed relations, scope and view-layout differences. Reviewer can inspect source evidence and comments, approve the exact digest, request changes, or reject with reason. Three-way conflict view shows base/current/proposed and permitted resolutions, including explicit authority conflict escalation.

Commands: branch, save draft, request review, rebase, resolve, publish, abandon, compare effective dates, create compensating revision. Changing content invalidates existing approvals. No auto-merge of policy/authority conflicts. Publishing future-effective design does not alter today's context. Offline/reconnected edits show server version and retained local draft, then reconcile; revoked users cannot publish or retain fresh restricted data. Revert explains already-executed effects and routes recovery separately. Success: new immutable baseline plus actor/rationale, reverse impact and stale dependents. T-53/T-63 own this with existing T-13.

## SC-15 — Sentinel source, claim and integrity workbench

New user connects an authorized sample-sized source set or imports an artifact, sees ingestion coverage and can reach evidence-backed findings without filling the enterprise model first. First-15-minute target: review up to three prioritized findings, inspect actual evidence, make an authorized resolution proposal and see the next compile delta. With fewer findings, show the true number; never create three to meet the target.

Source view: connector scope, immutable revision, last success, coverage, excluded/redacted items and errors. Claim review: type, subject/predicate/object, scope/validity, proposer/extractor, confidence, exact evidence excerpt/pointer, contradictions and review history. Batch acceptance requires per-item eligibility preview; ambiguous identities or scopes block only the invalid items under explicit partial-batch semantics.

Integrity Inbox prioritizes contradictions, policy violations, unknowns and drift with filters and accessible queue navigation. Finding detail shows rule/profile/version, stable ID, canonical severity, disposition, source coverage, evidence age, impacted objects and concrete remediation choices: supersede claim, split scope, reclassify, request exception, reject unsupported proposal. Finding dismissal is not resolution. Changing accepted claims shows pending/stale until successful compile; failed compile retains the last good snapshot with failure banner. Diff opens added/removed/changed relations, not a whole graph requiring visual guessing. T-65–T-75 and source AT-01–AT-33 define semantics.

## SC-16 — Policy authoring, evaluation and enforcement

Warden policy workspace shows policy owner, version, applicability, priority/conflict semantics, immutable denies, required evidence, approval mode, expiry and affected effects. Author using validated typed conditions; any advanced expression uses a restricted deterministic language, never arbitrary shell/code. Draft → simulate against recorded redacted requests → peer review → staged activation → monitored version is the lifecycle.

Decision detail explains each matched condition, missing data, allowed/denied outcome, obligation, authority chain, budget and policy version. Commands: simulate, compare, request activation, activate if authorized, revoke, roll back policy version, inspect blocked work. Rollback never resurrects revoked grants or retroactively authorizes effects. Policy unavailable/ambiguous/stale results block protected effects with actionable escalation. An authorized exception shows its scope and expiry next to the unchanged underlying finding severity. T-76–T-78.

## SC-17 — Decisions, delegations and conflict resolution

Arbiter inbox groups decisions by risk/deadline and displays exact requested effect/design digest, governed scope, alternatives, evidence, conflict-of-interest/eligibility, quorum, veto and due time. Decision-right editor distinguishes accountable owner from eligible approver. Delegation form requires scope, grantor authority, expiry, substitute and revocation consequences.

Commands: approve, reject, request evidence, abstain, recuse, appeal, delegate, escalate, request timeboxed exception. Every vote is authenticated and version-bound; quorum progress is server-derived. Duplicate votes do not count twice. Decision changes preserve previous votes and invalidate dependent approvals as policy specifies. Break-glass requires designated role, narrowly scoped request, reason, short expiry and independent review; cannot bypass immutable deny or artifact mismatch. No eligible reviewer produces blocked/escalated state, never auto-approval. T-79–T-81.

## SC-18 — Stewardship, semantic catalogue and lineage

Steward catalogue shows term/entity/property, definition, canonical ID, domain, owners/custodians, scope, classifications, authority/inheritance and quality commitments. Views: glossary, property lineage, responsibility matrix, quality backlog and retention impact. Physical source mappings are explicit links, not mistaken for the semantic definition itself.

Commands: propose definition, assign ownership, accept handover, resolve duplicate, classify, link source, version data contract, launch quality test, request restricted access, propose correction. Deleting/merging terms shows dependent claims/contracts/processes/evaluations. Owner transfer is two-party or approved substitute; unclaimed records remain visible. Quality failure shows observed sample scope and creates an issue, not a silent correction to the system of record. Sensitive evidence is redacted before display/search/export. T-82–T-84.

## SC-19 — Agent governance and autonomy supervision

Overseer inventory distinguishes agent definition, version, evaluation result, identity, assignment, session and run. Autonomy envelope displays allowed data/tools/effects/environments, goals/non-goals, budget and checkpoint conditions; proposed permission is not an active capability. Dependency view shows parent/child delegations and aggregate spend, not only each agent's local budget.

Commands: create/version profile, evaluate, compare provider, request enablement, assign, suspend, revoke, inspect context, intervene and retire. Explain what suspension stops now and which remote effects remain uncertain. Change of model/tools/instructions invalidates relevant evaluation and activation eligibility. Multi-agent handoff includes immutable output, evaluation and bounded capability intersection; agents cannot appoint a privileged approver. Evaluation view exposes failing cases and independent reviewer, not a single opaque quality score. T-87–T-89.

## SC-20 — Governance Ledger, module lifecycle and portfolio qualification

Evidence explorer joins a selected business outcome to design, claims, compiled snapshot, decisions, policy, task, artifact, effect and observation with explicit gaps. Export preview names included records, redactions, retention/legal holds, schema/module versions and verifier requirements. Commands: request export, verify export, compare evidence revision, apply authorized hold, request deletion, investigate chain gap. Failure must distinguish corrupt evidence, unavailable verification key, unauthorized scope and incomplete chain.

Installation view lists enabled/disabled/unavailable modules with dependencies, schema compatibility, health and actual qualification—not a marketing completion percentage. Enable/disable/upgrade previews affected jobs and unsupported commands, drains safely and records recovery steps. Full-portfolio qualification shows PF requirements, journeys and tests with `not_run/pass/fail/blocked/not_applicable` evidence; exceptions require a reason and cannot excuse a mandatory baseline requirement. T-85–T-86, T-99, T-103–T-108.

## Role-based walkthroughs and user-study acceptance

Recruit at least two representatives for each of founder/process owner, frontline worker, enterprise/data architect, engineer/release operator, policy/reviewer/auditor, and customer administrator; individuals may cover at most two groups. Include keyboard-only and screen-reader participants or qualified independent evaluators. Use two non-bank businesses and the financial reference, an existing imported organisation, and a multi-entity design. Do not teach implementation internals before the task.

Tasks: describe/correct/publish; find and edit a dependency in two lenses; refine into manual process and software case; resolve a branch conflict; review evidence and conflicting authority; approve/reject a bound action; interrupt an agent; recover an unknown effect; export/verify history; install/restore without developer help. Capture success, error, time, assistance, backtracking and whether users distinguish design/observation/readiness. Target ≥90% completion for supported core tasks, **zero unauthorized/unintended effects**, and no critical blocker without remediation and rerun. Small-sample usability results are directional, not statistical proof of universal usability. A screenshot or viewport test alone does not pass these stories.
