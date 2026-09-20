# SDLC, release and operations scenarios — increment 09

Historical checkpoint. [Increment 10](DOMAIN-FIXTURE-HANDOFF-10.md) adds the
mandatory configurable-workflow decision/16 obligations and extends original
scenario vectors to 188 across 59 tasks. Counts below describe increment 09.

Read the user-facing [SDLC process and interactions](../product/SDLC-INTERACTIONS-09.md)
alongside these definitions. It explains the complete actor journey, review
boundaries, shared enterprise context and recovery behavior; the vector file
specifies independently observable expectations.

Added: **72 definitions, 364 expected observations, T-25–T-48**. Cumulative:
**164/480 original scenarios, 929 observations, 53/132 tasks**. Remaining:
**316 scenarios across 79 tasks** lack this layer. All definitions remain unrun
and pending independent review. All 132 original tasks remain planned and all
480 canonical acceptance statuses remain not_run.

## Scope and evidence boundary

`contracts/enterprise/domain-vectors-09.mjs` contains initial fixtures, ordered
interactions/fault schedules and expected observations. The source-bound index
retains the exact original scenario hashes. Earlier vector files are unchanged.
Definitions are not application code, provider calls or usable test adapters.

The fixture materialization, independent observation, matrix completeness and
review requirements in [handoff 08](DOMAIN-FIXTURE-HANDOFF-08.md) apply. The
complete C-01 schema seeds and actual `tests/acceptance/` adapters still need
implementation in legitimately reviewed bounded packets. These scenarios do not
approve their own contracts, establish reviewer identity or satisfy dependencies.

Additional SDLC requirements for adapters:

- Resolve symbolic commit/artifact/configuration/evidence identifiers to actual
  immutable bytes and hashes. Keep that mapping in the receipt. API schemas must
  never be loosened to accept fake digests used as readable fixture labels.
- Real-repository qualification needs an owned isolated repository and explicit
  scoped credentials for branch/commit/PR operations. This specification does
  not authorize any current remote write. T-30 uses a real coding provider on an
  existing service, not the fixed local scaffold or a prerecorded patch.
- Inspect exact reviewed head versus integrated source. Candidate checks and
  signatures must bind the actual integrated revision; a changed merge result
  cannot inherit unrelated branch evidence. Required review of integration
  changes follows the configured branch policy.
- T-31 checks actual candidate bytes and locked build inputs; T-32 verifies outside
  the producing worker. Record tool/scanner/trust policy versions and distinguish
  cryptographic validity, historical trust and current promotion eligibility.
- T-33 races require independent database connections and explicit durable
  barriers. If revocation wins before dispatch, no call occurs. If provider
  acceptance already occurred, revoke future authority and reconcile the existing
  effect; do not claim remote cancellation or resend the operation blindly.
- T-34/T-35 positive qualification needs a real isolated deployment target,
  independent running-digest/health probes and approved effect scope. Fault
  adapters may model timeout/replay cases but cannot replace that positive proof.
  Domain release/attempt state is `effect_unknown`; a UI may render “Unknown
  effect.” Older fixtures using `unknown-effect` for broker display labels are
  not a second lifecycle enum; materialization must map boundary labels explicitly.
- Outcome evaluation computes formulas independently from raw deduplicated
  observations, source/window/freshness and minimum samples. Unknown data is not
  zero. Follow-up benefit is expected, causality is a hypothesis until evidenced.
- Restore/upgrade tests use disposable explicitly selected targets and preserved
  source backups; never destroy customer storage. Compare identities, history,
  manifests and provider effects, not only counts or health endpoints.
- A 24-hour test must actually last 24 hours. Synthetic timestamps cannot satisfy
  soak duration, load percentiles or failover evidence. Representative-user and
  independent security reviews require real participants/reviewers, not fabricated
  roles or generated signoffs. No such test or review ran in this increment.
- All matrix rows run. Record missing/skipped cases as failures of qualification;
  per-case zero violations must not hide an unexecuted row. T-48 success-shaped
  assertions describe future qualification results, not current gate status.

## Human-review and exception decisions

The primary user journey separately records intent/scope acceptance, requirement
acceptance, architecture acceptance, work enablement, code review, release approval
and outcome/follow-up disposition. These are distinct durable decisions, not a
single Approve all button. Policy may automate eligible low-risk validations, but
cannot eliminate mandatory human checkpoints or required independent reviewers.
Reading a notification, approving a PR or granting a model budget is not deployment
authority. A configured eligible actor may fill multiple nonconflicting roles;
conflict/quorum rules and explicit separation remain binding.

Expedited incident handling uses a configured policy with named scope/expiry and
mandatory controls. No emergency backdoor is introduced. Mandatory governance
interpretations, decision rights, provider support and customer-specific policies
still require their owning modules and approved configuration. The core vectors
do not claim full coverage of all Sentinel/Arbiter/Warden scenarios.

## Checks and next work

Definition validation: 164 synthetic positive comparisons, 1,093 negative
comparisons, 13 invalid-vector mutations and 10 source/index mutations. These
exercise the comparator/registry, not domain behavior. Run `npm run check` and
`node ops/check-spec.mjs --self-test --verify-sources`; store actual command output
and a revision-bound tree receipt. Preserve fixed P/E gates and earlier evidence.

All T-01–T-48 now have this vector layer; this is **not** completion of the core
backlog. Five later tasks have vectors from increment 07 (T-49, T-68, T-77,
T-119, T-123). Next bounded definition slice: T-50–T-67, enterprise model,
perspectives, processes and Sentinel ingestion/claim review before later compiler
and governance work. Continue to resolve schemas, adapters and independent packet review;
do not replace implementation readiness with a scenario count.
