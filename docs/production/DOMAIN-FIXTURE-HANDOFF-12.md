# Sentinel rules, remediation and Warden decisions — increment 12

Historical checkpoint. [Handoff 13](DOMAIN-FIXTURE-HANDOFF-13.md) covers the next
T-78–T-89 slice; requirements below remain mandatory and counts are historical.

Specification checkpoint, 2026-09-20; not implementation, executed domain tests or
independent approval. [User walkthrough](../product/SENTINEL-WARDEN-INTERACTIONS-12.md)
connects these requirements to the configurable SDLC lifecycle.

## Source-bound additions

T-69–T-76 now have **32 original acceptance vectors and 245 observations** in
`contracts/enterprise/domain-vectors-12.mjs`. Cumulative **268/480 definitions**,
**1,538 observations**, **79/132 tasks**; remaining **212 scenarios / 53 tasks**.
T-68 compiler vectors from increment 07 remain unchanged. All original task
objects/acceptance sentences and prior vector files are preserved.

`sentinel-rule-fixtures-12.mjs` supplies **28 named trigger/control pairs (56
subcases)** plus a pinned local rule profile. Those subcases elaborate T-70-AC1
and T-71-AC4; they are not 56 extra completed acceptance tests or additions to the
480 denominator. The source-bound vector digest includes the imported fixture
objects and profile. Registry changes require deliberate review of expectations.

The validator checks all 28 IDs, both inputs, source AT reference syntax, selected
severities, heuristic/compile-failure distinctions and profile thresholds. Ten
negative mutations exercise that structure guard. It does not execute Sentinel
or prove that a fixture faithfully represents every applicable enterprise case.

Reused read-only source files, already pinned in PORTFOLIO-SOURCES:
`claim-to-graph-mapping.md`, `integrity-rule-catalog-v1.md`,
`sentinel-v1-acceptance-tests.md`, `oadl-v0.1-spec.md` in the platform corpus.
No external research or sibling source edit. Local compatibility decisions below
apply PORTFOLIO-CONTRACT and SENTINEL-CONTRACT; they do not rewrite upstream OADL.

## Local compatibility and deterministic rule profile

| Concern | Required implementation behavior |
| --- | --- |
| Source default-global versus R-25 | Explicit intentional global remains global. Explicit unknown never defaults to global or disjoint. Imports from legacy omitted scope require a recorded normalization decision; unresolved ambiguity remains unknown. |
| Source exceptions suppress/downgrade versus fixed severity | Preserve canonical finding severity and rule reasons; store disposition and policy-bound enforcement separately. AT-28 tests permitted exception effect on disposition/enforcement, not deletion or rewriting of a CRITICAL contradiction. |
| R-01 and R-09 overlap | Keep independently traceable rule results, grouped into one contradiction case by subject/scope/conflicting authority set. R-09 locks severity CRITICAL. Group count is not raw rule-result count. |
| Missing authority versus contradictory authority | No source coverage is not proof of zero authority. Zero known authority is a gap; two proven overlapping canonical authorities are a contradiction; uncertain overlap produces R-25/owned clarification. |
| R-03 invalid accepted legacy data | Normal acceptance validates evidence/assertion before commit. Evaluate pre-existing or imported invalid records in isolated staging/audit fixtures; do not create a production bypass to seed the test. |
| R-13 incomplete transfer | Diagnose missing entity on staged legacy integration metadata; never manufacture a valid published TRANSFERS identity without its semantic entity key. Repair before projection/enablement. |
| Classification conflicts | Retain all scoped accepted claim values and evidence. Do not last-write-wins a node property to hide R-17/R-18; expose resolved property only for a nonconflicting query context. |
| R-14 manual capability | Documented accountable manual realization is legitimate; applicability is explicit, not missing software treated as universal failure. |
| R-16 heuristic | The local profile requires the stated consumer/incoming-canonical/local-master evidence and confidence >=0.8. Label heuristic and retain reviewer disposition/false-positive evidence. No independent authority or automatic correction follows. |
| R-19/R-20 invalid exception | Invalid imported/draft records generate diagnostics and cannot activate. This baseline requires finite expiry and review date; no perpetual exception activation. |
| R-24 duplicate IDs | Hard prepublication failure for duplicate canonical (tenant,type,id), with a critical diagnostic and last-good state. Same spelling across different types is not a duplicate. Tenant isolation still applies. |
| R-26–R-28 | Require supported property/process extension, exact accepted authority/inheritance revisions and source coverage. Base OADL is not silently expanded to accept these claims. |

Selected severities for source ranges: R-02 HIGH, R-06 HIGH, R-12 HIGH,
R-14 WARN, R-16 WARN, R-21 WARN, R-23 WARN, R-26 HIGH. Other source-fixed
severities remain unchanged; R-01/R-09/R-24 CRITICAL. This is a versioned local
profile decision, not a claim that the source had a single severity for each range.
OADL policy display mapping is explicit INFO→low, WARN→medium, HIGH→high,
CRITICAL→critical; do not confuse an OADL policy field with a finding's disposition.

Profile assessment clock: 2026-10-01T00:00:00Z. R-21 triggers for **more than 10
distinct accepted claim identities materially changed in a 3,600-second window**;
10 is the nontrigger boundary. Duplicate delivery and metadata-only job changes
do not inflate churn. A claim changed repeatedly in that window counts once.
R-23 triggers at evidence age **greater than 31,536,000 seconds**, not at equality.
Bind clock/window/cutoff in the input manifest; no hidden wall-clock read inside
semantic compilation. Additional threshold/unknown/negative-age cases belong in
the reviewed packet. Invalid future evidence time is not automatically fresh.

## Task-specific implementation and evidence obligations

| Task | User-visible result and persistence | Required failure/recovery proof |
| --- | --- | --- |
| T-69 | Typed graph/provenance, two distinct transfers when only transferred entity differs, loss-aware OADL export | Shuffled-input deterministic IDs, no unknown-scope invention, forbidden top-level collections rejected, supported references round-trip |
| T-70 | Base rule findings with exact failed predicate, scope, inputs, evidence and repair | All 30 trigger/control cases, source gaps/manual applicability, severity locked, only repaired finding resolved after fresh publication |
| T-71 | Property/process read lineage links observed source to declared authority | All 26 advanced trigger/control cases, explicit inheritance versus absent authority, extension rejection, stale evidence cannot imply resolved compliance |
| T-72 | First-session queue, exact evidence, keyboard repair, retained context and traced delta | Acknowledge/snooze cannot resolve; failed compile shows last-good/stale and safe retry; scope split requires proof of disjointness |
| T-73 | Independent timeboxed exception with exact permitted effect scope, rationale, control and dates | Invalid evidence/authority denied; expiry equality and queued revocation race block new effects; repair retains exception/decision history |
| T-74 | Semantic delta separated from coverage/freshness drift, linked corrective proposal | Source outage does not retract design; late observations preserve valid/recorded time; obsolete compile cannot advance head; stale SDLC approvals blocked |
| T-75 | Complete AT-01–AT-33 and R-01–R-28 qualification receipts, first-session and useful-findings evidence | Missing cases, critical failures or deterministic mismatches block; AT-33 safe failure/export; measured scale and honest disagreement/false positives |
| T-76 | Reproducible policy decisions with governing versions and explainable conditions/obligations | Missing context/injected code denied; rollback preserves revocations; valid Arbiter approval cannot defeat immutable deny or digest binding |

Expand every shorthand trigger/control into full typed schema-valid fixtures with
tenant/workspace, explicit scope/time, stable IDs, principal/grants, source bytes,
evidence and compatible profile versions. Seed unrelated prerequisites to avoid
accidental unrelated findings; declare unavoidable companions explicitly. A control
means **no target-rule finding**, not a globally clean graph. Never skip remaining
rules because one seed has several findings. Legacy malformed cases use isolated
staging, not weakened production validation. The ordered source catalog is retained;
rules lacking a dedicated AT (including R-08, R-14–R-16, R-22, R-26–R-28) still need
their own executable tests and cannot disappear in an AT-only coverage report.

Finding identity binds rule/profile version and normalized semantic contradiction
key, not display text, evidence order or timestamp. Evidence/provenance changes
remain visible separately. An independent profile migration must compare old/new
findings and disclose changed interpretation; don't call changed rule output business
drift without labeling its cause. Relation identity includes semantic properties.

## Remediation, exceptions and active SDLC work

Default inbox order: canonical severity descending, then configured due/impact
priority, then first-seen time and stable ID. Bind ordering profile to the query and
permission-filter before pagination/ranking; hidden counts cannot leak. A filter
does not lower severity or remove a release blocker. Repair actions create drafts
with expected claim version/head; review binds exact digest. Recompile publication
changes resolution only for the matching accepted set and current generation.

Exception lifecycle is requested → reviewed → active → expired/revoked/superseded
or no-longer-applicable. Denied requests remain auditable. Store validity as a
half-open interval [effectiveAt, expiresAt), with reviewAt <= expiresAt; a missed
mandatory review blocks subsequent use under this profile. Scope includes affected
finding/rule, entity/legal scope, target/environment, artifact/context and action.
Re-evaluate required reviewer eligibility at protected use. Scheduler notification
lag cannot extend expiry: broker reads authoritative time/epochs and current policy.
Reassessment notifications deduplicate by exception revision and invalidation cause.

A corrected finding can resolve while exception history remains. An acknowledged
finding cannot resolve merely because a process step is complete. A temporary
exception is neither retroactive authorization nor evidence an unknown remote
effect failed. Already-dispatched work still follows reconciliation/compensation.

The review/remediation process itself can be edited in diagram or structured forms:
add scoped review, parallel evidence collection, bounded rework and escalation.
It uses the shared versioned workflow runtime; Sentinel is not a second scheduler.
Simulation is effect-free; new definitions don't mutate active runs. Changing the
diagram cannot remove mandatory review, evidence, expiry or Warden broker checks.
Affected T-76 packets map their WF contributions, preserving the additional sixteen
workflow obligations without changing original acceptance IDs.

## Warden decision semantics

Activation requires registered typed AST, strategy→domain→runtime lineage, independent
review and regression fixtures. Runtime context includes authenticated actor and
delegation, tenant/scope, target/environment, artifact/config/input digests, accepted
baseline/Sentinel snapshot, evaluations, budget, command identity and current epochs.
Policy evaluation is deterministic over a bound clock and input manifest; receipt
timestamps/transport IDs are excluded from semantic comparison, not from audit.

Precedence: immutable deny → explicit deny → required obligations/quorum → positive
grant. Missing/unknown mandatory context denies or routes owned clarification;
`obligations` is non-executable until re-evaluation confirms satisfaction. A pure
`allow` decision is not itself a dispatched effect: T-77 broker still verifies
freshness, capability, budget reservation, effect intent and exact tuple. Rollback
creates a new activation pointing to old policy content with current security/
placement/revocation state; it cannot replay old permission records. Policy UI
explanations expose structured inputs/reasons under caller permission, not secret
values or private model reasoning. Arbitrary JavaScript/SQL/network evaluation is
forbidden in the policy expression interpreter.

## Independent qualification, not checkbox counting

T-75 requires each AT and applicable rule's actual fixture/results, raw commands,
revision, source/profile hashes, hardware/provider versions and independent review.
Nonfunctional tests retain 100,000-claim full compile <=120 seconds, 10 warm and
3 cold measurements and all inherited Q/PQ failure/load requirements. This vector
adds a strict maximum for the measured runs; report each timing, not only an average.
First session target is <=15 minutes to inspect up to three real prioritized
findings and make an authorized resolution proposal with next compile delta.
Fewer real findings means fewer displayed findings, not fabricated examples.

Freeze a stratified sample before review: eight contradiction, eight policy, seven
unknown and seven drift findings. Two eligible independent domain reviewers rate
each with rationale; retain disagreements and false-positive labels separately.
For the saved arithmetic fixture, 21 both-actionable +3 A-only +2 B-only +4 neither
=30. Report joint 21/30=70%, A 24/30=80%, B 23/30, disagreement 5/30. Use joint
agreement for the conservative >=70% target; do not average away disagreement or
substitute adjudicated ratings without retaining originals. This is a declared local
measurement decision, not fabricated reviewer evidence. The sample fixture is not
an actual study, and its constructed 70% does not qualify the product.

No declaration of implementation readiness: full aggregate seeds, observation
adapters, database races, real UI/API/effect tests and independent packet review
remain necessary. Comparator synthetic reports are constructed from expectations.
All original 480 acceptance statuses remain not_run, all 132 tasks planned,
approved packets zero; P gates 4/12, E gates 0/16, additional WF 0/16.
No research mission used here; shared usage stays 1/5 with four available.

Next bounded definition slice: T-78–T-89 (policy lifecycle, Arbiter, Steward, Ledger
and Overseer). T-77 already has increment-07 high-risk effect vectors; preserve
them and add only identified gaps. This does not authorize skipping dependency
receipts or treating later task definitions as approved implementation packets.
