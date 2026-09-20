# Sentinel and governance module behavior

Concrete local rule profile/trigger-control definitions and compatibility decisions
are in [handoff 12](../production/DOMAIN-FIXTURE-HANDOFF-12.md) and
`contracts/enterprise/sentinel-rule-fixtures-12.mjs`. They preserve all R/AT IDs,
unknown-scope handling and separate severity/disposition/enforcement. They are
specified, not a qualified rule engine or independent reviewer evidence.

Revision 3 target; grounded in the platform source manifest. See `PORTFOLIO-COVERAGE.json` for every original R-01–R-28 rule and AT-01–AT-33 acceptance mapping. Preserve those IDs rather than replacing them with generic “integrity tests”.

## SN-01 — Ingest and propose

Start with versioned Markdown/ADR, YAML/OADL and Mermaid sources; source credentials remain server-side. Connector jobs record repository/document revision, allowlisted path, checksum, media type, classification, extraction version, time and coverage. Size/depth/archive limits, parser isolation, MIME validation, symlink/path-traversal protection, cancellation and deduplication precede extraction. Confluence/other systems use the adapter contract rather than pretending all connectors ship initially.

Evidence is a pointer plus a redacted excerpt of at most 300 characters for the base claim contract; raw source has separate retention/access. Missing/unreachable evidence is visible. Prompt injection in text is untrusted content; extractors cannot accept claims, execute instructions, invoke unrelated tools or grant authority. Confidence is not acceptance. Ambiguous canonical matches produce alternatives for review, never implicit identity merges.

## SN-02 — Claims and review

Base types: AUTHORITY, OWNERSHIP, REALIZATION, INTEGRATION, DECISION_GOVERNANCE, POLICY_CONSTRAINT, CLASSIFICATION. Required claim envelope: claim_id, tenant, type, typed subject/predicate/object or literal, proposed_by, confidence 0..1, status, timestamps, scope/validity normalization and evidence. USER_ASSERTED is permitted only with identified actor and justification. Supersedes is explicit; conflicting accepted claims are legal compiler inputs, not silently discarded storage errors.

Lifecycle: PROPOSED → ACCEPTED or REJECTED; ACCEPTED → SUPERSEDED; optional versioned extension supports RETRACTED/restoration. Review requires scoped permission and actor/time/rationale. Self-assertion and independent acceptance are separate capabilities where policy requires separation. Batch review validates each item's current version and scope. Revocation between loading and submitting invalidates permission server-side. All transitions emit immutable events and mark compile status pending.

## SN-03 — Compile and graph publication

Input manifest: accepted claim revisions, explicit scope/effective window, OADL profile, rule/extension packages, compiler version and previous snapshot. Canonical serialization, stable sort and identity algorithms are versioned. Wall-clock job metadata stays outside the semantic snapshot hash. Identical inputs produce byte-equivalent semantic graph/finding IDs and zero drift. Semantic relation identity includes typed endpoints, predicate, scope and semantic properties (for transfers, transferred entity), while retaining every source claim/evidence reference.

Build staging graph, validate all typed IDs/references, evaluate rules, calculate delta, then atomically publish snapshot+findings+manifest. Duplicate canonical typed IDs or unsupported required schema is a hard failure with exact path; no partial snapshot. Crash/retry/concurrent compiles publish at most one result for a manifest; stale compiles cannot replace a newer head. UI can read last-good with visible staleness, but a release requiring current integrity evidence blocks until fresh compile passes.

Graph nodes/edges follow source ontology; richer internal graph is distinct from ten-collection OADL interchange. Read models are reproducible and never authoritative mutable storage. Every finding includes rule ID/version, stable identity, canonical severity, reason, involved IDs, evidence/claim links, scope, coverage and snapshot. Explanation must identify actual failed predicate, not a model-generated generic paragraph.

## SN-04 — Findings, exceptions and drift

Workflow distinguishes open, under review, resolved by new compile, excepted with active decision, reopened and obsolete due to retired scope. Exceptions have owner, governed finding/scope, reason, evidence, effective time, review-by/expiry, approvers and compensating controls. Baseline enterprise policy requires finite expiry; any supported perpetual exception profile needs explicit justification and periodic review. Immutable denies remain non-overridable. Expiry/revocation re-evaluates enforcement and queues owner work; it never deletes the original finding.

Semantic severity is stable under the chosen rule profile. Disposition and deployment-blocking decision are separate columns. Critical contradiction remains critical even if a narrowly authorized temporary exception permits a particular effect. Superseding claims, splitting truly disjoint scopes or correcting classification resolve only on successful compile; accepting low-confidence or low-severity evidence never suppresses a contradiction.

Delta distinguishes added/removed/changed relation, authority/classification/policy, evidence coverage and freshness. One relation addition means one semantic addition, retaining historical snapshots. Source outage/removal is not proof of intentional design deletion: coverage gaps and actual retractions differ. Drift spikes have configured thresholds and evidence; acknowledge/snooze does not erase drift. Operational read claims produce R-26–R-28 findings under the explicit property/process extension, including authority inheritance provenance.

## SN-05 — Rule applicability and qualification

Implement source rules with fixture pairs for trigger/nontrigger, scope, missing coverage, evidence and deterministic rerun. R-01 contradiction, R-24 canonical duplication and R-09 mandatory severity cannot be configured away by an end user. Severity ranges in the source require versioned rule-profile choices and migration tests, not ad hoc runtime tuning. Applicability exemptions (e.g. manual capability for R-14) are recorded and inspectable. R-16 is explicitly heuristic; its confidence threshold and false positives are measured separately.

Sentinel baseline qualification requires all AT-01–AT-33 plus R-01–R-28 tests under documented profiles, boundary/failure tests, first-session workflow and historical/current evidence labeling. Performance AT-31 uses the portfolio load fixture and measured compile threshold in PORTFOLIO-QUALIFICATION. Valuable-findings target: at least 70% of a stratified set of 30 findings across contradictions/policy/unknown/drift rated actionable by two eligible domain reviewers, with disagreements retained; report sample selection and false-positive rate, not a made-up precision statistic.

## Governance modules: minimum internal contracts

These are derived design requirements for future modules, not assertions about source implementation.

| Module | Persisted model and decision boundary | Negative/recovery obligations |
|---|---|---|
| Warden | PolicyPackage/version, typed EffectRequest, DecisionReceipt, CapabilityGrant, Reservation, Revocation. Deterministic policy input includes current identity, accepted design/policy context, required evaluations and target digest. Default deny missing authority; protected uncertainty blocks. | TOCTOU after queue, policy outage, conflicting rules, replay, stale approval, budget race, revoked delegation; idempotent outcome reconciliation and fail-closed protected effect. |
| Arbiter | DecisionRight scoped by action/resource/legal unit, Delegation chain, Case, Vote, Quorum, Decision, Appeal, Exception. Requester cannot manufacture an eligible approver; policy defines conflicts of interest and independent roles. | Reviewer leaves/recuses, quorum loses eligibility, conflicting decisions, expiry, parallel votes, appeal and no reviewer; explicit escalation and supersession preserve history. |
| Steward | Definition/version, OwnershipAssignment, Custodian, PropertyAuthority, Classification, DataContract, QualityAssessment, Remediation. Definitions and observed physical mappings are different records. | Competing owners, orphan assets, sensitive evidence, renamed source columns, contract incompatibility, offboarding and retention conflict; do not silently rewrite source-of-record data. |
| Ledger | GovernanceEvent, EvidenceReference, ChainCheckpoint, ExportManifest, VerificationResult, RetentionHold. Hash chains/signatures prove recorded integrity within trust/key assumptions, not factual truth. | Duplicate/out-of-order/missing events, tamper, unavailable signer, key rotation/revocation, partial export and legal hold; independently verify gaps and stop unsafe protected effects. |
| Overseer | AgentDefinition/version, InstructionVersion, EvaluationSuite/Result, AutonomyEnvelope, Assignment, Delegation, Session. Uses shared workflow/effect broker and current Warden decisions. | Prompt injection, poisoned retrieval, tool escalation, planner-as-evaluator, provider drift, multi-agent budget multiplication, recursive delegation, stale activation and intervention race. |

Public APIs/events for these records must be typed and versioned before implementation, including forbidden/conflict/stale/unknown-effect responses. No module writes another module's authoritative tables directly; command/outbox/projection boundaries can remain in one process. Shared identities, policies, evidence and task engine must not fork into unrelated per-module truth.

Warden policy lineage has three explicit layers: strategic non-negotiable boundaries, domain-scoped interpretation/action classes, and runtime compiled checks. Each runtime rule links to its governing domain/strategic versions and accountable owner. Activation tests compatibility, blocked-behavior regressions, ambiguous-context contradictions and explanation. Conflict escalation moves from local containment to domain reconciliation, cross-domain Arbiter decision and executive scope when strategic constraints are affected; timeout does not imply consent. T-76/T-78/T-81 must implement this lineage and escalation. Store structured decision reasons, alternatives, references and evaluation results; do not require or expose a model's private chain-of-thought as audit evidence.
