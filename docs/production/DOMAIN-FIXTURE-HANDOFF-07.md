# Concrete domain test handoff — increment 07

Historical checkpoint. [Increment 08](DOMAIN-FIXTURE-HANDOFF-08.md) extends this
baseline to 92 definitions across 29 tasks; the counts below describe increment
07 at its original receipt, not current cumulative coverage.

`contracts/enterprise/domain-vectors-07.mjs` contains 38 concrete test definitions
for T-02–T-07, T-49, T-68, T-77, T-119 and T-123: 11 tasks, 226 explicit expected
observations. IDs refer to the original unchanged backlog scenarios. Their
status is not_run and independent review is pending. These are not completed
implementation packets or actual product test results.

Each vector supplies initial data, an ordered interaction/fault schedule,
expected values and the intended acceptance-test path. Assertions compare real
observations through JSON pointers; they do not ask the implementation to report
a boolean “passed”. Expected bytes/counts/states are authored ahead of feature
implementation. Compound matrices must execute every listed case, not one
representative row.

## Collecting actual observations

1. Instantiate the named tenant/principal/domain fixtures under the actual
   registered schemas. Use generated test-only identity keys and secret canaries;
   never real credentials. IDs are fixture identifiers, not customer data.
2. Pin the application revision, configuration/profile, dependency/provider
   versions, seeded input manifest and vector digest. Resolve current policy,
   membership, review and placement facts through real repositories, not request
   booleans. A missing required fixture field must fail setup, not get a random
   permissive default.
3. Use a real browser and API for UI journeys; real PostgreSQL connections,
   independent readback and process crash/restart for transaction/race paths;
   instrumented certified test adapters for effect qualification. Test adapter
   contracts do not count as qualification of an unrelated live provider.
4. Inject faults at the named durable boundaries. Coordinate races with explicit
   barriers, not flaky sleeps. Record attempted/accepted provider operations
   independently of controller labels; query authoritative tables from a
   separate connection. Check the outbox/audit/revision together.
5. Emit an observation document with the specified paths and attach raw browser,
   API, database and provider traces. Stable-sort sets where the vector gives a
   canonical ordered set; do not change actual semantic order or filter failures.
6. Invoke `assertDomainObservation(vector, observation)` from the actual
   acceptance test. Missing fields, changed expected values and out-of-bound
   timings fail. Link raw results and observed environment to the existing AC ID.

The comparator cannot authenticate observations. Independent review must reject
an adapter that copies expected values, replaces real persistence with in-memory
booleans, tests only helper functions, or trusts the application’s own pass label.
For qualified integration evidence the adapter/test must be inspected alongside
raw traces and system-under-test revision. No receipt is created by merely
calling the comparator on synthetic data.

## Important semantic decisions captured

- Empty live data is zero; outage is unavailable or dated stale; sample content
  never fills a live result. Maturity comes from the safe build snapshot chosen
  in ENGINEERING-DECISIONS-06, with revision mismatch visible.
- Concurrent version-7 commands produce one version-8 commit, one conflict and
  atomic result/audit/outbox. A crash after commit returns the same result on
  replay; a changed payload under the same key conflicts.
- Identity revocation respects the existing 30-second qualification target and
  cannot revive authority by switching to a service administrator. Secret rotation
  retains the credential version of historical attempts and reconciles unknown
  remote outcomes.
- Valid time and recorded time remain separate. Late observations cannot rewrite
  the accepted view seen historically. All lenses and SDLC share one context tuple.
- Sentinel output is stable under claim order/job time; semantic transfer identity
  includes the transferred entity and unions provenance without merging distinct
  meaning. Failed/obsolete compiles never replace last-good/newer heads.
- Publication invalidation is atomic and immediately protects effect dispatch
  while projections lag. Multi-pane current views wait or say pending; they
  cannot combine two generations and call it current.
- Cutover source fence precedes target eligibility. Crash can safely leave zero
  writers temporarily, never two; recovery restores one. Irreversible outcomes
  block fictional rollback and require reviewed forward recovery/compensation.

## Coverage and limits

The vectors elaborate 38/480 scenarios. **442 scenarios across 121 other tasks
still lack this concrete-vector layer.** Presence of a vector does not prove it
fully covers every nuance of its original scenario; a domain reviewer must
check that and split/add vectors where necessary. T-01 contract-wide aggregate
fixtures and T-08 installation matrices are not silently counted as covered.

The checker verifies structure, IDs and the comparator with synthetic documents.
Its positive self-tests construct documents from expected values intentionally;
these test the comparator, not the application. It separately mutates each
assertion and rejects absent observations. No browser, database race, provider
effect or 30-second revocation measurement has run by virtue of this check.

All original 480 acceptance statuses remain unrun. All 132 independent packet
reviews remain pending. Continue authoring concrete vectors by dependency and
risk, integrate approved slices, then implement and run them; do not convert
the specification coverage percentage into release readiness.
