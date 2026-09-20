# Business domains and Sentinel claim intake — increment 11

Historical checkpoint; [handoff 12](DOMAIN-FIXTURE-HANDOFF-12.md) now covers the
next T-69–T-76 slice. Requirements below remain in force; counts are historical.

Saved specification increment, 2026-09-20. No feature implementation or independent
approval. Read [user interactions](../product/BUSINESS-SENTINEL-INTERACTIONS-11.md),
the canonical task-specific drafts and the unchanged architecture/change contracts.
The configurable-workflow requirement and ADR-010 remain mandatory.

## Coverage and exact source binding

`contracts/enterprise/domain-vectors-11.mjs` adds **48 original acceptance vectors**
and **244 expected observations** for T-56–T-67. Each maps to the unchanged original
acceptance sentence through `domain-vectors.index.json` and its SHA-256. Cumulative:
**236/480 scenarios**, **1,293 observations**, **71/132 tasks**. Remaining:
**244 scenarios across 61 tasks** without this layer. Sixteen additional mandatory
WF obligations remain separate and unrun. All 132 tasks remain planned, all 480
original acceptance statuses not_run, and approved implementation packets absent.

| Owner | Concrete cases now specified | Independent observations needed |
| --- | --- | --- |
| T-56 | Reciprocal promises; currency/unit/interpretation unknowns; partial-performance cure; economic posting identity | Immutable terms/performance rows, source identities, exact money values and separate governance events; no payment from design |
| T-57 | Supplier substitution; hard/soft capacity races; cancellation/offboarding; personnel privacy | Calendar and skill versions, locked reservation balances, handover acknowledgment, authenticated forbidden reads and network disclosure scan |
| T-58 | Need-to-outcome journey; missing realization; retirement with agreements; CRM aggregate privacy | Shared canonical references, blocked enablement, agreement disposition and historical outcome links, authorized aggregate provenance |
| T-59 | Interpreted obligations; unreviewed/expired evidence; supersession; failed operating control | Reviewer eligibility, versioned applicability, time-bound test records, atomic invalidation and corrective work |
| T-60 | Two priced staffing alternatives; invalid conversion; reproducible assumption changes; business failure | Pinned formula/units/seed/inputs, independently calculated values, immutable experiment bytes, absence of actual-metric/policy writes |
| T-61 | Multi-repo/environment service; authority/interface conflict; physical mapping rename; SDLC impact | Logical/physical IDs, exact deployment digests, old mappings, complete dependency paths and stale protected approvals |
| T-62 | Manual asset work; unsafe unsupported action; damaged delivery; attestation versus sensor | Actual work-order and evidence form, reservation transitions, broker non-dispatch, discrepancy and provenance types |
| T-63 | Atomic/partial batches; stale/revoked/confidential rows; lost response; comment versus decision | Row outcomes and transaction boundaries, retained permitted drafts, shared editor semantics, command/outbox/notification identities |
| T-64 | Independent axes; exclusion abuse; evidence/module outage; business versus installation | Versioned denominators, policy-bound dispositions, stale last-good assessments, source-typed requirement/evidence drilldowns |
| T-65 | Pinned source coverage; hostile artifacts; interrupted ingestion; connector revocation | Actual immutable bytes/checksums and manifest, parser isolation/open-file traces, current read authority, retained evidence access/hold checks |
| T-66 | Typed evidence-backed proposal; injection/identity ambiguity; bounded failure; shared evidence | Provider/extractor manifest, source offsets/excerpt validation, tool/effect logs, budget reservations and distinct provenance links |
| T-67 | Acceptance-to-compile lag; forged reviewers; concurrent supersession; contradictory authorities | Session-derived review events, authoritative claim transitions, compiler manifests, graph snapshots and preserved conflicting provenance |

## Binding decisions for implementation packets

1. Preserve original drafts and source hashes. Their example payloads do **not**
   provide complete aggregate schemas. Extend bounded reviewed packets with every
   required operation, source/reference type, role matrix, state transition, index,
   transaction, outbox event and migration. `expectedHead` and `expectedVersion`
   are distinct preconditions; current security/policy/placement also applies.
2. Money examples use integer minor units with explicit currency. The earlier
   RecordCommitment draft's `amount` example has no normative conversion into these
   values: the reviewed schema must specify scale/rounding and migrate explicitly.
   Never assume amount=100 means 100 minor units. No mixed-currency aggregate without
   a sourced rate, date and reviewed conversion policy. These are software fixture
   semantics, not legal or accounting advice/qualification.
3. Performance events are append-only and deduplicated by source event identity.
   The damaged-delivery example uses 10 promised, 7 delivered, 2 of those rejected:
   accepted=5 and outstanding=5. Do not subtract the damaged units twice. A cure
   changes future obligations by reviewed version, not prior receipt bytes.
4. Capacity constraints apply to overlapping resource/calendar intervals with
   compatible units. Hard race: 8 available, two requests of 6, exactly one wins;
   do not pin which concurrent actor wins. Soft case is a separate authorized
   profile: 8 nominal, permitted maximum 10, two requests of 5, excess 2 explained.
   Skill availability is not authority to act. Revocation takes effect independently
   of pinned workflow/instruction versions.
5. Simulation formula is explicit: fulfilled=min(demand,capacity);
   marginMinor=fulfilled*(priceMinor-costMinor)-fixedMinor. Design A yields 20,000
   USD minor units; B 22,000. Revised demand 5 for A yields 15,000. No randomness is
   needed for this formula; seed 17 is retained provenance, not invented stochastic
   uncertainty. Demand is an assumption. These values cannot populate actual profit.
6. Atomic bulk mode commits zero rows if any row fails. Explicit partial mode
   commits eligible rows with independently checked preconditions and enumerated
   results. Each row's state/result/outbox is atomic; batch progress is durable.
   Revalidate shared invariants under lock; a cross-row invariant requires an atomic
   group, not independent partial writes. A batch-level stale head or revoked
   session rejects the batch before new commits. Never leak hidden row metadata.
   Notifications may be physically redelivered; logical inbox identities deduplicate.
7. Bulk workflow edits create new definitions, not live-run patches. Map T-63's
   contribution to the applicable WF obligations in its reviewed packet; diagram/
   form equality is semantic equality, not identical layout. Preserve safe-run
   migration, review separation and effect-time checks from ADR-010.
8. Exclusion, risk acceptance and test success are different fields. Keep original
   inventory and justification visible even when a permitted assessment uses a
   derived scoped denominator. Non-overridable controls cannot be waived. A permitted
   exception carries scope/expiry and cannot be counted as operating-test evidence.
9. Ingestion bounds in AC2 are test-profile limits, not certified product capacity.
   Validate paths after canonicalization, reject symlink/hardlink escapes and check
   streaming expanded bytes/entries/depth before writing each unsafe entry. Parser
   sandbox and filesystem-open observations prove no neighboring read; a safe error
   alone does not. Archive preflight may inspect metadata but must not materialize
   rejected content into the extraction workspace. Keep temporary use bounded.
10. Source-job identity includes tenant/source/revision/path scope/parser profile;
    an intentional new parser version is a new lineage, not a duplicate old job.
    All discovered entries need an explicit disposition. Coverage incomplete is
    not semantic deletion. Revoked connector credentials stop new reads; existing
    cached evidence follows its independent reader permissions and retention/hold.
11. Extraction uses the seven base claim types and at-most-300-character redacted
    excerpts. Materialized tests must bind exact byte offsets and Unicode handling
    to the source artifact; count Unicode code points in the excerpt limit. Do not
    truncate inside a redaction token or leak omitted text via errors. Model output
    is a candidate, validated as a whole response before proposal publication.
    A failed response publishes no subset; separate source jobs can still succeed.
    Timeout spend stays reserved/unknown until reconciled; retry cannot reset it.
12. Evidence deduplication is scoped by tenant/classification/retention policy.
    Deduplicating bytes never deletes distinct claim-to-evidence links or creates
    cross-tenant existence probes. Confidence never replaces acceptance/authority.
    Forged actor/scope fields cannot make a reviewer eligible. Conflict storage
    retains both accepted claims; downstream policy decides protected-use blocking.
13. Supersession is atomic over original revision, eligible successor and review/
    outbox. Concurrent candidates yield one winning transition, one conflict; never
    auto-rebase the loser into a second supersession. Duplicate command with changed
    payload conflicts. Exact replay returns the original result subject to current
    read authorization. Review acceptance alone does not publish a fresh graph.

## How to turn these definitions into actual tests

For each vector, materialize full schema-valid tenant/workspace/actor/grant records,
immutable source bytes, histories, calendars, expected references and control
profiles. Symbolic IDs/digests in `initial` are fixture aliases, not production
hashes or permission to weaken schemas. Pin actual fixture/provider/runtime versions.
Matrices execute every row from a fresh seed unless explicitly sequential. Aggregate
assertions report all rows; record row identities/results so an omitted row cannot
appear to pass. Bounds are measured values, not a self-reported `withinLimit` flag.

Collect observations independently from database records, outbox, broker/provider
logs, compiled bytes and authenticated UI/API responses. Derive boolean assertions
from those records; do not implement a test-only endpoint returning expected values.
Inspect raw source offsets and redactions, not only excerpt length. A malicious
archive test must exercise real parser/isolation behavior; a malformed JSON unit
test is insufficient. Real external integrations use authorized isolated systems,
not live financial/physical/legal actions.

`assertDomainObservation` is only the shared comparator. Its synthetic positive
documents are constructed from expectations; its mutation tests exercise comparator
rejection, not actual business behavior. Intended `tests/acceptance/t-XX.test.mjs`
paths are future targets, not existing runnable tests. Full field/transition schemas,
seed materialization, observation adapters and legitimate independent review still
block packet readiness. No status promotion is authorized by this increment.

## Checkpoint and next bounded slice

Run `npm run check` and `node ops/check-spec.mjs --self-test --verify-sources`;
save raw output and the final tree manifest in the increment-11 receipt. Existing
demonstrator tests are regression checks only. Original P-01–P-04 remain historically
verified; P-05–P-12 pending. Production remains 0/16. Additional WF remains 0/16.
No research was started; shared mission usage remains 1/5, four available, with
RM-WORKFLOW-10 still awaiting reconciliation into the read-only sibling ledger.

Next: T-69–T-76, completing Sentinel graph/rules/inbox/exception/drift/qualification
definitions and Warden policy semantics. T-68 already has increment-07 vectors;
retain them and add only targeted gaps if review finds one. This next slice is
definition work, not permission to skip prerequisites and implement those tasks.
