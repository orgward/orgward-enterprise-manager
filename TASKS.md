# Production implementation queue

This is the authoritative implementation queue for the full OrgWard Enterprise
Studio target. It condenses the product brief, P-01–P-12 first-release outcomes,
E-01–E-16 production gates and T-01–T-132 historical specification into
implementation-sized increments. The T-ranges identify coverage; they do not
set work order or create paperwork gates. Historical roadmaps, task indexes,
vectors and packet instructions under `docs/production/` remain reference material
for requirements and dependencies. Their old "next" directions and unrun-status
claims do not supersede the active checkbox, cursor, order or passing receipts here.

Work the first unchecked, dependency-ready item. A task is complete only when its
real state/API/UI behavior exists, focused behavior and recovery tests pass,
`npm run check` passes, and the implementation diff has been reviewed. Do not count
specification validators, manifests or generated vectors as product acceptance.
Never perform live effects, deployments, purchases or external communications
without explicit user authorization.

Work order (PR numbers are stable IDs, not numeric sequence):

1. PR-01–PR-05: completed foundation and founder-facing conversation, saved/editable
   design, maps, version history, instructions and usable UX.
2. PR-06: complete the saved-design-to-result journey with human/agent work,
   intervention, persisted evidence and restart recovery. A planning graph or
   static UI alone does not complete it.
3. PR-07–PR-10: deliver customer-usable governed software delivery and outcomes.
   PR-10 closes the observable outcome, learning and next-action journey; its
   standalone operations work follows the product journeys in PR-11.
4. PR-12–PR-15, then PR-17: deliver the complete enterprise portfolio and
   consistent customer-defined work.
5. PR-16 and PR-18: deliver managed SaaS and migration journeys.
6. PR-11 and PR-19: run broad core and final release qualification after the
   product paths they qualify exist.

Within each open task, complete its customer-visible end-to-end path before
standalone broad security, resilience, scale or operations qualification. Build
the authorization, tenant isolation, secret protection, explicit intervention,
approval-bound effects and durable audit controls needed for that path as part of
the path. If an earlier PR depends on part of T-39–T-44, deliver that part inside
the earlier PR; PR-11 closes their remaining standalone scope and qualification.
Broader qualification remains mandatory before release; this ordering does not
mark any P/E gate complete. Active section order below follows this list.

Active cursor: PR-01 through PR-05 are complete implementation tasks; PR-06 is
the first open task, and PR-07 follows it. Continue PR-06's saved-design-to-result
journey. The active checkboxes and passing implementation receipts determine
status; dated increment notes describe their own point in time. After a bounded
increment, add its actual behavior and test/demo receipt under its PR item and
record gaps or skipped checks explicitly. Advance the cursor and checkbox together
only when the whole PR outcome passes its required behavior checks and review.
Keep P/E release-gate status and evidence in their separate ledgers.

The default `npm test` runner uses Node's process-isolated test-file workers with
concurrency 2. Each PostgreSQL-backed test file lazily starts one temporary
loopback cluster; integration tests in that file create uniquely named empty
databases and close their pools at fixture teardown. The file's `after` hook stops
its disposable server and removes its private temporary cluster root; no SQL
`DROP DATABASE` cleanup is used. This bounds retained databases and WAL to one
file while keeping databases isolated. The disposable test server uses `fsync=off`,
`synchronous_commit=off`, `full_page_writes=off`, and bounded WAL to avoid
checkpoint/disk quota stalls; production database settings are unchanged.
Transactions, isolation, application restarts and migration rollback are exercised,
but test results do not prove PostgreSQL crash or power-loss durability.
No persistent PostgreSQL daemon is left running. Focused test invocations that do
not select PostgreSQL suites do not start it. Most recent implementation `npm run
check`, after the PR-06 saved-design → human checkpoint → dependent agent result
and restart increment, passed 223 of 224 tests with 0 failures and 1 optional
PostgreSQL backup/restore skip because client tools were unavailable
(`ORGWARD_PG_TOOLS_BIN` not set; 67.49s test runner, 70.02s wall). Focused
PostgreSQL persistence passed 1/1 (10.35s); `git diff --check` and the focused test
file syntax check passed. The full integration uses only the loopback OpenAI
fixture; no live provider call was made. Rendered-browser verification was
completed with the installed user-level `agent-browser` CLI against a seeded
loopback fixture. The browser-authored revision 3 journey inserted and bound a
required human checkpoint in the UI, completed both human checkpoints with
evidence, independently approved and executed the dependent task once against the
loopback provider, then restarted only the app and confirmed the result and
evidence persisted. Post-restart API reads returned 200; no console or page errors
were reported. No live provider call or screen-reader proof was performed. Logs:
`/tmp/orgward-pr06-human-agent-restart-check-20260924.log`,
`/tmp/orgward-tests-oaSTPM/node-test.tap.log`. The previous unverified-outcome
disposition receipt and focused migration/client results remain below.
The preceding full check after the PR-06 paused-run instruction amendment
increment passed 222 tests, failed 0, and skipped 1 optional PostgreSQL
backup/restore test because client tools were unavailable (`ORGWARD_PG_TOOLS_BIN`
not set; 223 total; 62.64s TAP; 62.71s runner wall). Focused persistence,
intervention-contract and served-client tests passed 50/50 in 55.4s. Logs:
`/tmp/orgward-pr06-p08-amend-check.log`,
`/tmp/orgward-pr06-p08-amend-check.tap.log`. `git diff --check` passed.
Rendered-browser verification was unavailable. The preceding full check after the
PR-06 saved-process entry-point increment passed 221 tests,
failed 0, and skipped 1 optional PostgreSQL backup/restore test because client
tools were unavailable (`ORGWARD_PG_TOOLS_BIN` not set; 222 total; 62.67s TAP).
Focused process-route and served-client tests passed 14/14. Log:
`/tmp/orgward-tests-Kl1ZAG/node-test.tap.log`. Tracked and untracked whitespace
checks passed. Rendered-browser verification was unavailable. The preceding full
check after the PR-06 dependency-wait visibility increment passed 221 tests,
failed 0, and skipped 1 optional PostgreSQL backup/restore test because client
tools were unavailable (`ORGWARD_PG_TOOLS_BIN` not set; 222 total; 58.32s TAP).
Focused process-task state and served-client tests passed 2/2. Log:
`/tmp/orgward-tests-2KzlbI/node-test.tap.log`. Tracked and untracked whitespace
checks passed. Rendered-browser verification was unavailable. The preceding full
check after the PR-06 reload-safe linked plan-instance route increment passed
221 tests, failed 0, and skipped 1 optional PostgreSQL backup/restore test because
client tools were unavailable (`ORGWARD_PG_TOOLS_BIN` not set; 222 total; 58.67s
TAP). Focused linked-plan navigation and served-client tests passed 5/5. Log:
`/tmp/orgward-tests-hYO2Mb/node-test.tap.log`. Tracked and untracked whitespace
checks passed. Rendered-browser verification was unavailable. The preceding full
check after the PR-06 saved-source process return increment passed 220 tests,
failed 0, and skipped 1 optional PostgreSQL backup/restore test because client
tools were unavailable (`ORGWARD_PG_TOOLS_BIN` not set; 221 total; 59.86s TAP).
Focused saved-source navigation and served-client tests passed 4/4. Log:
`/tmp/orgward-tests-blDjLg/node-test.tap.log`. Tracked and untracked whitespace
checks passed. Rendered-browser verification was unavailable. The preceding full
check after the PR-06 linked plan-instance return increment passed 219 tests,
failed 0, and skipped 1 optional PostgreSQL backup/restore test because client
tools were unavailable (`ORGWARD_PG_TOOLS_BIN` not set; 220 total; 59.07s TAP).
Focused linked-plan navigation and served-client tests passed 3/3. Logs:
`/tmp/orgward-tests-T6wI5W/node-test.tap.log`. Tracked and untracked whitespace
checks passed. Rendered-browser verification was unavailable. The preceding full
check after the PR-06 project-context navigation increment passed 217 tests,
failed 0, and skipped 1 optional PostgreSQL backup/restore test because `pg_dump`
was unavailable in the checked tool paths (218 total; 58.49s TAP). Focused
navigation and served-client tests passed 19/19. Logs:
`/tmp/orgward-tests-Vzsyq4/node-test.tap.log` and
`/tmp/orgward-execution-project-context-full-check.log`. Tracked and untracked
whitespace checks passed. The preceding full check after the PR-06 proposal
return-navigation increment passed 216 tests, failed 0, and skipped 1 optional
PostgreSQL backup/restore test because `pg_dump` was unavailable in the checked
tool paths (217 total; 58.06s TAP). Focused proposal return-navigation tests passed
5/5. Logs: `/tmp/orgward-tests-95Zppm/node-test.tap.log` and
`/tmp/orgward-proposal-return-nav-full-check.log`. Tracked and untracked whitespace
checks passed. The preceding full check after the PR-06 proposal-apply recovery
increment passed 215 tests, failed 0, and skipped 1 optional PostgreSQL
backup/restore test because PostgreSQL client tools were unavailable (216 total;
58.47s TAP). Focused proposal recovery tests passed 4/4. Logs:
`/tmp/orgward-tests-ozyKfe/node-test.tap.log`,
`/tmp/orgward-proposal-apply-recovery-full-check.log`, and
`/tmp/orgward-tests-KlGHv7/node-test.tap.log`. The preceding full check after the
PR-06 proposal review-state UX increment passed 214 tests, failed 0, and skipped 1
optional PostgreSQL backup/restore test because client tools were unavailable
(215 total; 59.87s TAP). Focused proposal review-state and served-client tests passed
3/3. Logs: `/tmp/orgward-tests-6KqZcY/node-test.tap.log`,
`/tmp/orgward-proposal-review-ui-full-check.log`, and
`/tmp/orgward-tests-NEgn67/node-test.tap.log`. The preceding full check after the
PR-06 saved-input proposal increment passed 212 tests, failed 0, and skipped 1
optional PostgreSQL backup/restore test because client tools were unavailable
(213 total; 58.70s TAP). Focused proposal tests passed 4/4. Logs:
`/tmp/orgward-tests-z29zlz/node-test.tap.log`,
`/tmp/orgward-proposal-full-check.log`, and
`/tmp/orgward-tests-ppypQD/node-test.tap.log`. The preceding full check after the
PR-06 mixed human-to-agent dependency increment passed 208 tests, failed 0, and
skipped 1 optional PostgreSQL backup/restore test because `ORGWARD_PG_TOOLS_BIN`
was unavailable (209 total; 56.35s TAP). Its focused persistence/API/upgrade set
passed 3/3 with no skips. Logs: `/tmp/orgward-pr06-mixed-human-agent-focused.log`,
`/tmp/orgward-pr06-mixed-human-agent-check.log`, and
`/tmp/orgward-tests-3kyrr4/node-test.tap.log`. The preceding full check after the
PR-05 SVG keyboard-focus repair passed 204 tests, failed 0, and skipped 1 optional
PostgreSQL backup/restore test because `ORGWARD_PG_TOOLS_BIN` was unavailable
(205 total; 54.75s TAP). Focused map-state coverage for that repair passed 8/8 with
no skips. Logs: `/tmp/orgward-pr05-svg-keyboard-focused.log`,
`/tmp/orgward-pr05-svg-keyboard-check.log`, and
`/tmp/orgward-tests-5AWpWS/node-test.tap.log`. The preceding full check after the
PR-05 saved-map search increment passed 201, failed 0 and skipped 1 optional
backup/restore test (202 total; 53.84s TAP); logs:
`/tmp/orgward-pr05-map-search-focused-final.log`,
`/tmp/orgward-pr05-map-search-ui-focused-final.log`,
`/tmp/orgward-pr05-map-search-check.log`, and
`/tmp/orgward-tests-I6mtAO/node-test.tap.log`. The preceding check covered
the graph-selection pointer fix with 199 passed and 1 optional skip (54.99s TAP;
57.52s wall). The earlier per-file-cluster check covered the T-08 fail-closed
restore guard, deterministic OIDC token clock, two-tenant HTTPS OIDC cookie-session
isolation, PR-05 process resource/system and capability link editing, and the
bounded worker-revocation heartbeat check: 192 passed, 0 failed, 0 skipped
(49.49s TAP; 52.00s wall). The immediately preceding check exposed a fixed-delay
race in the heartbeat test; a bounded wait for the
first payload write repaired it. That check remains diagnostic history. The
optional PostgreSQL backup/restore journey ran with the previously extracted
PostgreSQL 18.6 tools
by setting both
`ORGWARD_PG_TOOLS_BIN` and `ORGWARD_PG_TOOLS_LIBRARY_PATH`; no packages were
installed. Log: `/tmp/orgward-tests-7KTyzb/node-test.tap.log`; full output:
`/tmp/orgward-pr05-process-capability-check-repaired.log`. The focused heartbeat
repair passed 5/5 with no skips (`/tmp/orgward-execution-adapter-focused.log`). The earlier
188-test check exposed
a wall-clock boundary in the OIDC future-`iat` test; the fixed verifier and token
issue time are included in this passing run. Earlier configured attempts that
failed because the test runner dropped ordinary `LD_LIBRARY_PATH` remain diagnostic
history, not passing milestones. The preceding role-responsibility check passed
186 and skipped the optional recovery journey; the actor-label repair check passed
185 and skipped it as well. Their evidence remains in the increments below.

Repair follow-up: actor-human and actor-agent name/detail labels are now immutable;
the shared edit payload may repeat unchanged labels, while changed labels return
`INVALID_BLUEPRINT_EDIT` without changing project or blueprint version. The UI
renders those fields readonly and identifies them as fixed identity labels. The
older restricted-actor case and the actor organizational-role journey passed focused
coverage (2/2, no skips; 15.09s TAP time). The one repair `npm run check` passed:
186 total, 185 passed, 0 failed, 1 skipped because `ORGWARD_PG_TOOLS_BIN` was
unset and the PostgreSQL backup/restore client-tool journey could not run (49.81s
TAP time; 52.30s wall). Full
check logs: `/tmp/orgward-pr05-actor-roles-repair/check.log`,
`/tmp/orgward-pr05-actor-roles-repair/check.time`, and
`/tmp/orgward-pr05-actor-roles-repair/orgward-tests-k6FbbO/node-test.tap.log`;
focused TAP log: `/tmp/orgward-pr05-actor-roles-repair/orgward-tests-EwHIJM/node-test.tap.log`.
At that point, the failed check above remained as historical evidence and this
repair check superseded it.

## Now

- [x] PR-01 — Truthful product foundation and usable shared interactions (T-01–T-03).
  Make capability/maturity and sample/live state accurate in the API and UI; define
  executable versioned request, response, error and event behavior; provide shared
  accessible loading, validation, conflict, denial and recovery states. Prove the
  main shell and API behavior end to end without fixture knowledge.

## Single-node enterprise core

- [x] PR-02 — Transactional durable state and legacy import (T-04; E-04).
  Move authoritative product state from local JSON to PostgreSQL with migrations,
  transactions, concurrency control, idempotency, retention, corruption handling,
  restart recovery and a tested import path for existing local data.

- [x] PR-03 — Authenticated identity, authorization and isolation (T-05–T-06;
  E-02–E-03). Add OIDC-backed human/workload identities, sessions, server-derived
  roles and policy enforcement. Prove command/query segregation of duties and
  cross-tenant/project denial through API, persistence, jobs and artifacts.
  Current increment: project-scoped artifact downloads now verify the caller's
  membership and the registered content hash. Principal-scoped execution service
  reads and actions now fail with a clear 503 if the backing store cannot enforce
  principal scope, rather than falling back to tenant-wide access. Authenticated
  create, approve, and start writes require an explicit principal-scoped store save.
  Authenticated execution also requires atomic dispatch authorization and renewable
  worker leases before it persists `RUNNING` or starts work. Linux command workers run
  in a mandatory bubblewrap namespace with host networking and user filesystems hidden,
  a read-only approved context/source set, and only the per-run workspace writable.
  Sandbox setup fails without direct-execution fallback; unallowlisted environment,
  symlink artifacts, and oversized artifact files fail closed. `npm run check` passes
  (111 tests). Missing principal-scoped saves are denied without tenant-only writes.
  Worker terminal writes now use one PostgreSQL transaction that locks current identity,
  project membership, run version and worker lease before recording success/failure.
  If membership or identity authorization has already been revoked, the worker can only
  record an interruption with no artifact metadata. Membership and principal revocation
  now commit access and lease cancellation before waiting for process shutdown, avoiding
  a lock cycle with terminal finalization. Generic execution saves cannot bypass this
  worker fence. A deterministic PostgreSQL test pauses a completed worker, revokes access,
  and verifies that success and artifact metadata are not published.
  All authenticated API reads now require server-mapped `workspace-read`, `workspace-write`
  or `tenant-admin` authority (with the identity directory restricted to tenant admins),
  in addition to the existing project membership scope. Role removal is tested against
  both bearer and cookie-session reads.
  Authenticated project creation and updates require explicit principal-scoped command
  methods; absent methods return unavailable without generic command writes. Authenticated
  SDLC list, detail, traceability, create and action routes now require
  principal-scoped store methods; API coverage proves they return unavailable without
  invoking generic tenant-scoped methods. Project list/detail APIs and the foundation
  project source likewise report unavailable instead of using unscoped store reads.
  Sandbox-setup failure is persisted with no host-side effect or artifacts and retains
  its evidence after restart. PostgreSQL coverage includes
  restart, cross-project denial, duplicate worker dispatch
  denial, cross-instance membership downgrade and principal-revocation cancellation,
  OIDC role-removal cancellation, session revocation, same-origin enforcement for
  cookie-authenticated writes, workload bearer identity without interactive sessions,
  and artifact integrity/scope checks. The standard check now includes OIDC token
  and browser-session suites. Durable worker leases
  prevent a second app from recovering a live `RUNNING` record and carry membership,
  role and identity revocation requests across app instances; expired leases are
  recovered transactionally. A temporary PostgreSQL 18.6 runtime under `/tmp` enables the
  repository check without installing system packages. The project-sharing form now
  tells owners that colleagues must sign in before their verified principal can be
  added. Served-asset checks pass; rendered viewport, keyboard and screen-reader
  checks remain unverified because no browser automation tool is installed here.
  PR-03 remains open: authorization is not yet enforced independently at every
  external effect boundary, and complete command/query segregation and cross-tenant
  proof across all jobs and artifacts still need implementation and evidence.
  Current increment: dynamic OpenAI run creation now checks owner/editor project
  membership and current workspace-write generation before resolving secret-binding
  metadata, while the run-save transaction remains the final authorization fence.
  PostgreSQL provider tests cover identical nonmember denial with active and absent
  bindings, zero pre-authorization broker lookups, eligible run version pinning, and
  membership downgrade between precheck and save with no run persisted. PR-03 remains
  open pending broader external-effect and isolation proof; release gates are unchanged.
  Provider dispatch now writes a unique per-run attempt reservation before network
  handoff. The broker revalidates under the shared lease lock, holds that lock through
  connected-socket plus `ClientRequest.finish` handoff, and consumes the response after
  releasing the transaction. Revocation before handoff cancels the reservation; once
  handoff may have occurred, failures and expired-lease recovery persist
  `outcome_unknown` and the run cannot dispatch again. Focused PostgreSQL tests cover
  both revocation orderings, one-call behavior and restart recovery. This is an OS
  handoff boundary, not confirmation that the provider received or completed work;
  provider runs use a 30-second lease with renewal cadence below the bounded provider
  timeout; command workers retain their existing shorter lease. Focused
  provider/secret/transport tests pass (14/14), and the final `npm run check` passes
  (160/160 in 28.14 seconds). PR-03 remains open and release gates are unchanged.
  Snapshot artifact discovery now traverses from the opened workspace directory descriptor, opens each child with no-follow flags, and hashes bytes read from the same file descriptor. A deterministic symlink-swap regression confirms an outside file hash is absent from run and event metadata. Focused execution/adapter tests pass (13/13). PR-03 implementation is complete; E-02/E-03 and release gates remain pending.
  OIDC principal identifiers remain stable hashes of issuer and subject, while persisted
  authorization bindings are now tenant-scoped. Migration 007 preserves existing
  principal IDs and audit references. PostgreSQL coverage verifies same-subject
  bindings, role changes, sessions, projects and revocation remain isolated by
  tenant, including concurrent first login and an upgrade from migrations 001–006.
  A PostgreSQL API journey also verifies workspace-write cannot approve, the
  requester cannot self-approve even with the approver role, a separate project
  member can approve, racing approvals produce one winner, approval does not start
  the worker, and the accepted approval survives restart.
  OIDC tenant values now require an explicit server-owned mapping to OrgWard tenant
  IDs; unknown mappings fail authentication, and OIDC mode will not start without
  configured bindings. The mapping is scoped to the configured issuer and audiences.
  Legacy JSON inspection mode is now enforced read-only: API mutation/dispatch
  requests fail closed, health identifies the mode, and startup leaves RUNNING
  execution records untouched instead of recovering them into local JSON. The
  enterprise-design UI displays a read-only notice and disables its create/edit
  controls while inspection mode is active.
  Approval records bind the approver's current authorization generation. The
  persistence transaction checks that authority while saving; dispatch rechecks it
  before leasing or starting work. A stale approval is interrupted without artifacts
  and requires explicit reapproval by a currently authorized project member. A
  PostgreSQL regression covers role-removal races, remove-and-readd, restart and
  successful reapproval. `npm run check` passes (111 tests). Project roster reads
  now require active owner/editor membership; reader, nonmember and cross-tenant
  requests are concealed. PostgreSQL API tests cover each authorization boundary.
  Authenticated SDLC release approval now locks and checks approver roles and
  authorization generation in the same PostgreSQL transaction as the case update;
  it validates persisted S9/requester/evidence state, records the generation, and
  binds idempotent replay to the server-verified approver. A role-removal race test
  proves the denial leaves the case and approval event unchanged. The later S9
  approval-consumption step now rechecks current approver roles and generation in
  the transaction that records the synthetic release. Tests verify stale denial,
  explicit reapproval, no external effect and restart recovery. `npm run check`
  passes (111 tests). OIDC token claims can remove persisted roles but cannot add
  them during bearer resolution or session creation; new principals begin role-empty,
  and all API bearers require a valid signed numeric `iat` with `exp > iat`. A
  regression proves older expanded tokens cannot restore roles after a newer reduced
  token, including same-second issuance, and verifies lease cancellation and cookie
  visibility. No trusted production regrant path exists yet; role enrollment remains
  a provisioning follow-up. Authenticated execution now treats dispatch authorization
  failure after child spawn as commit-unknown: it closes the child before finalizing
  only an interruption with no artifacts. A lease-bounded acknowledgment watchdog
  terminates workers whose dispatch acknowledgment stalls. PostgreSQL tests cover
  rollback after spawn, committed lease/lost acknowledgment and delayed acknowledgment,
  including lease state, process closure and prevention of a second spawn.
  The following identity increment supersedes the token-role behavior described above:
  persisted tenant-bound grants alone determine OrgWard roles, and provider group
  claims cannot grant or remove them. Exact operator-configured issuer/subject/tenant
  bootstrap entries grant a human tenant-admin plus workspace-read/write once, with
  a durable marker and audit event. Tenant admins can replace another active
  principal's exact allowlisted role set with an expected authorization generation
  and reason; actor and target locks, self/workload restrictions, last-admin checks,
  audit, lease cancellation and local worker signaling are enforced. Revocation now
  uses the same current-actor and target-generation fence. The Identity UI and README
  describe local role authority and bootstrap setup. Focused PostgreSQL lifecycle,
  tenant-isolation, worker-revocation and OIDC-session tests pass. The full
  `npm run check` passes. A delayed dispatch acknowledgment now keeps renewing its
  worker lease while the watchdog terminates the child; the PostgreSQL regression
  verifies the lease remains live until the request resolves. Cross-instance worker
  coverage starts its second app before dispatch so app startup time does not consume
  the five-second live lease under test. OIDC API tests now inject explicit local
  test grants, including read-only and roleless identities; production requests
  without persisted role authority still fail closed. Project creation, project
  updates and membership grants/revocations now recheck `workspace-write` and the
  captured authorization generation under transaction locks; PostgreSQL race tests
  demote the actor while each write is pending and prove no stale mutation commits.
  Worker cancellation now holds its lease through the short terminal-write window,
  preventing another instance from recovering the run before its interruption is
  persisted. Execution creation, the `RUNNING` transition, dispatch, and worker
  lease renewal now also enforce the executor's captured `workspace-write`
  generation. PostgreSQL races prove role removal prevents creation or dispatch,
  and a stale active worker is interrupted before it can continue. Lost dispatch
  acknowledgments retain lease renewal through terminal handling.
  PostgreSQL-authenticated project and execution-run list/detail reads, owner/editor
  project rosters, the tenant-admin identity directory, artifacts and foundation
  summaries now hold current identity, membership, role-generation and aggregate
  locks through response delivery (and artifact content verification); a stale
  in-flight reader receives no project, run, roster, identity-directory, foundation
  or artifact data, while nonmembers remain concealed. API races cover role-generation
  changes before project/run list/detail, roster, identity-directory, foundation and
  artifact disclosure, artifact integrity, restart and cross-project denial.
  Authenticated SDLC case list,
  detail and traceability reads now use PostgreSQL transaction methods that hold
  current identity, membership, authorization-generation and case locks through
  response delivery.
  Regression races demote the reader while each request is pending and verify a
  stale-generation error with no case payload. Authenticated SDLC creation, state
  changes and idempotent replays now recheck `workspace-write` and the captured
  authorization generation inside PostgreSQL transactions; release approval keeps
  its distinct approver check. Races prove stale creates and updates do not persist
  and stale replays disclose no case data. Legacy and versioned project detail routes,
  project lists and execution-run list/detail routes now require transaction-backed
  current-authority reads; they fail closed instead of falling back to membership-only
  store methods. Tests cover project role-generation races and unavailable-store denial
  for project and execution queries. Test-only file-store adapters explicitly model
  the authority callback contract and do not claim to prove PostgreSQL fencing. The
  authenticated SDLC command pre-read now checks `workspace-write` and the captured
  role generation under the principal-authority transaction before evaluating a
  mutation; the save transaction remains the final fence. A PostgreSQL race demotes
  the actor during that authority read and verifies a 409 with no case mutation, while
  membership-only store methods are denied. SDLC mutations and execution approval/start
  pre-reads require editor membership as well as transaction-backed current authority
  (`workspace-write` for SDLC and start, `execution-approver` for approval); the final
  principal-scoped save and atomic dispatch checks remain. PostgreSQL tests
  verify stale-generation conflict without mutation and conceal reader command attempts
  while allowing reader queries. Reader execution attempts produce no worker marker.
  Service tests deny membership-only command reads without using their fallback. The
  authenticated foundation summary no longer counts SDLC cases through a membership-
  only diagnostic store when the atomic principal snapshot is unavailable; it marks
  that source unavailable instead. A regression supplies a membership-only diagnostic
  result and proves it is never invoked or disclosed. Execution approvals now bind
  the approver's project-membership generation as well as identity-role generation;
  atomic dispatch checks that the approver is still an active owner/editor at the
  same generation. Revoking or downgrading an approver also requests cancellation
  for active runs they approved. A PostgreSQL restart regression proves revoke/re-add
  cannot revive an old approval, execution is interrupted without artifacts, and
  fresh approval restores execution. Approval request hashes now include the
  executor profile ID/version; execution refuses to enter `RUNNING` if the server's
  current profile version differs from the version the approver reviewed. A PostgreSQL
  restart regression proves a changed profile cannot run under the old approval and
  a newly approved run uses the current profile. Worker termination now signals both
  the sandbox process group and wrapper; a heartbeat regression confirms isolated
  payload writes stop after revocation. The dispatch-uncertainty regression now
  injects rollback inside the actual PostgreSQL authorization transaction. Workload
  role administration rejects execution/release approval roles, while approval
  pre-read, principal-scoped save and dispatch transactions independently require
  a human actor. PostgreSQL regressions cover an invalid persisted workload grant,
  bypassed pre-read, and a legacy workload approval; dispatch interrupts the legacy
  run with no command start or artifacts.
  SDLC release approval and consumption now require a human actor in the database
  transaction, even when a legacy workload principal retains release-approver and
  control-owner roles. Workload role administration rejects execution-approver,
  release-approver, and control-owner grants. API regressions prove workload
  approval and consumption of a legacy workload approval leave the S9 case unchanged
  and create no synthetic release.
  Legacy persistence preview and apply now revalidate human tenant-admin authority
  inside their PostgreSQL transactions, and import audit events record that actor;
  a request-time demotion regression proves the in-flight preview/apply is denied
  without writing aggregates or import records. Bubblewrap no longer starts a
  nested session, so worker revocation reaches the sandbox payload process group;
  the dispatch-uncertainty regression proves interrupted work is persisted without
  an orphan worker. Browser session role disclosure now holds locks on the current
  session and principal through response creation; an API race proves demotion waits
  for that response, and later reads show the reduced roles. Stores without this
  transaction-backed read fail closed. `npm run check` passes: 29/29 persistence
  tests, 5/5 OIDC tests, and the sandbox revocation test. `git diff --check` and JavaScript
  syntax checks pass. A route/store audit found current authenticated reads and
  mutations fenced at persistence, identity/session disclosure, execution, artifact
  and import boundaries. Public health/meta routes disclose no tenant data; no live
  external-effect adapter exists yet. A two-tenant HTTPS OIDC cookie-session
  PostgreSQL journey also verifies tenant-scoped project lists, concealed foreign
  project/message reads and writes despite forged scope headers, unchanged project
  state and audit counts, and the same denials after app restart. The focused journey
  passes 1/1; the configured full check passes 190/190 with no skips. PR-03
  implementation is complete. E-02/E-03
  remain pending integrated production qualification and are not promoted here.
  Managed SaaS still needs a durable customer onboarding and lifecycle workflow,
  provider-specific independent review, and stronger effect-boundary fencing.
  The current Linux sandbox does not yet enforce CPU/memory or persistent-workspace
  quotas, and is not a complete T-21 isolation qualification.

- [x] PR-04 — Secret handling and supported installation (T-07–T-08; E-01, E-05).
  Current increment extends tenant-admin encrypted credential-reference management
  with a server-side broker that checks the persisted tenant, approved run credential
  binding, current principal/project authority, and unexpired uncanceled PostgreSQL
  worker lease before and after provider use. Rotation and revocation cancel matching
  leases transactionally across app instances; revocation advances the secret version
  and clears ciphertext. Approval hashes bind credential reference/version while
  preserving the previous hash for credential-free profiles. Credential-bound command
  profiles fail before spawn. A broker-aware, server-configured provider HTTP profile
  now sends a bounded request only after the PostgreSQL dispatch lease commits and
  renews. Its fixed destination is bound into approval by digest and hidden from run
  views. Local provider fixture tests cover independent approval, restart, stale
  credentials, cross-tenant denial, redirect rejection, safe failure, canary output
  quarantine, rotation during use, and credential expiry before and during HTTP
  provider use. Each new credential generation requires a future UTC expiry; expiry
  is checked before and after use, and aborts the in-flight provider request.
  Migrated null-expiry references remain visible and require rotation. Full
  `npm run check` passed (130/130 tests), and `git diff --check` passed. PR-04
  remains open: upstream token revocation remains incomplete. A bounded T-08
  preflight/readiness increment is recorded below; supported clean-host install,
  TLS, bootstrap, and upgrade proof remain incomplete. OpenAI model-access
  validation is implemented in the bounded increment below. No T-07/E/P gate is
  promoted.

  Bounded T-07 increment: tenant admins can stage a separately encrypted OpenAI
  candidate, validate access to one requested model through the fixed OpenAI model
  retrieval endpoint, and transactionally activate only the current validated and
  unexpired candidate whose model-access validation is no older than 15 minutes.
  Validation outage keeps the candidate retryable. The opt-in
  server-configured `provider-openai` profile resolves the current active OpenAI
  generation when a new run is created; the CLI registers it only when both
  `ORGWARD_OPENAI_CREDENTIAL_REFERENCE` and `ORGWARD_OPENAI_MODEL` are configured,
  and approval pins that reference, version, model, and fixed Responses API
  destination. Replaced approvals fail before dispatch. The
  adapter posts bounded `store:false` requests to `api.openai.com/v1/responses` with
  no tools; test loopback overrides are server-injected. Generic fixed-version
  `provider-http` remains unchanged and cannot use OpenAI candidate metadata. Lease
  cancellation is committed with activation. First activation reports upstream
  revocation `not_applicable`; replacing a prior generation reports `unconfirmed`
  because no admin revocation call has been confirmed. This field summarizes the
  latest unresolved predecessor; durable per-generation obligations are now retained
  and summarized for tenant admins. OpenAI model-access validation is implemented but
  no live provider call was performed in testing. Actual upstream revocation is not
  implemented. Externally staged raw keys cannot be safely auto-deleted at the
  provider; only independently proven OrgWard-created dedicated key targets could
  be eligible for a future provider-side revocation flow. T-08 remains open. This
  does not close T-07.

  Revocation-provenance foundation: migration 016 adds an all-or-none tuple for
  provider organization, project, dedicated service-account and API-key IDs, plus
  an explicit OrgWard-created exclusive-account provenance marker. Existing
  externally staged keys retain null target metadata and cannot become deletion
  targets. A fixed-origin Admin API helper uses bounded HTTPS requests and accepts
  only a matching service-account ID with `deleted: true`; uncertain responses
  remain unconfirmed. Focused tests passed 14/14 and `npm run check` passed 172
  tests with 1 skipped. That foundation alone did not claim upstream revocation.

  Managed-provisioning increment: migration 017 and the tenant-admin command route
  now record intent, expected version, reason, fixed organization/project mapping,
  and a stable opaque provider resource name before any OpenAI effect. The Admin API
  key can only come from an absolute protected file and stays server-side. Tenant
  project IDs come only from a unique server allowlist. The provider client uses
  `https://api.openai.com`, bounded 8-second requests and 8 KiB responses, and
  rejects redirects. It creates a no-key service account, assigns member role, then
  creates only `api.model.read` and `api.responses.write` scopes with at most
  31,536,000 seconds lifetime. The key stays encrypted as a candidate; validation
  and activation use the existing flow and copy exact IDs plus exclusive-account
  provenance. External calls occur only after each durable sent state commits; a
  restart, timeout, authority change, or uncertain response becomes `unresolved`
  and is never replayed automatically. Discard/replacement of a managed candidate
  is rejected until its provider target can be retained safely. Active managed
  generations create exact-target local revocation obligations. The reconciler
  described below confirms eligible targets; incomplete or externally staged
  targets remain `unconfirmed`.
  Fixture tests cover authority, project isolation, raw-key separation, API order
  and scopes, sent-state replay, ambiguous failures, candidate discard, activation,
  local revocation, and authority loss while a key response is in flight with exact
  returned IDs retained on the unresolved command. Optional Admin-key and tenant
  project-map setup is documented with the installer configuration. No live OpenAI
  call was made. Focused suites passed 44/44 in 37.33s; the final `npm run check`
  passed 173/174 with one skipped in 31.30s. PR-04/T-07 remains open.

  Bounded T-07 revocation-reconciler increment: migration 018 adds durable per-
  obligation claims, 30-second leases, attempt counts, and due times. Startup and a
  15-second interval recover eligible work; local rotation and revocation wake the
  worker. Claims commit before HTTP and use `SKIP LOCKED`, so app instances do not
  dispatch the same live claim. Only complete OpenAI targets with
  `orgward_created_exclusive_service_account` provenance are claimable, and the
  stored organization must equal the configured server-side Admin organization.
  Each attempt retrieves the exact account in its stored project before deletion;
  after an ambiguous delete, restart reconciliation confirms absence from that exact
  project without issuing another delete. Provider failures and mismatches release
  the lease with bounded exponential retry. Per-generation evidence is recorded;
  the reference summary changes to confirmed only after every generation resolves.
  Raw/incomplete targets remain unconfirmed. Managed-key staging also requires the
  provider response to include matching `created_at`/`expires_at` values for the
  requested bounded TTL; invalid responses retain returned IDs as unresolved and do
  not stage plaintext. Focused OpenAI revocation and secrets tests passed 15/15 in
  4.60s; logs: `/tmp/orgward-pr04-t07-focused-final.log`. No live OpenAI call was made.
  Final `npm run check` passed 176/177 in 32.80s; one recovery journey was skipped
  because PostgreSQL client tools were unavailable (`ORGWARD_PG_TOOLS_BIN` is needed).
  Logs: `/tmp/orgward-pr04-t07-check-final.log` and
  `/tmp/orgward-tests-SxvJPQ/node-test.tap.log`.
  PR-04/T-07 and PR-04/T-08 remain open: external staged targets remain unresolved,
  provider-side expiry and deletion still depend on provider/API behavior, and clean-
  host installation, TLS, bootstrap, and upgrade qualification are incomplete.
  After aligning the helper's Admin-key limit with preflight, the focused helper suite
  passed 11/11, including acceptance at 2,048 bytes and rejection above that limit.

  Bounded T-08 increment: `npm run preflight` and startup share one configuration
  parser for Node runtime, listener/auth mode, OIDC provider settings and tenant /
  bootstrap mappings, paired OpenAI profile settings, secret-key presence, and
  PostgreSQL configuration. Preflight performs read-only PostgreSQL connectivity,
  server-version, and migration-ledger/checksum inspection; it prints specific
  remedies without displaying URLs or credential values. Local execution workspace
  access is checked when that feature is enabled. `/livez` is dependency-free;
  `/readyz` checks the PostgreSQL migration ledger and returns 503 on failure.
  Focused tests cover unsafe/missing configuration, repeat no-mutation preflight,
  bad database configuration, a sparse migration ledger rejected without writes,
  and readiness after database loss. A PostgreSQL installation journey now retries
  after shutdown before first login, proves one configured bootstrap grant, creates
  and retains a project across restart, and verifies a second administrator's role
  demotion of the initial owner is not restored on retry. This does not establish
  clean-host installation or public TLS termination. A separate disposable-Postgres
  migration journey now seeds a populated schema at the 001–006 baseline and
  verifies upgrade through 012 retains the project, single owner membership,
  principal/session authority and audit event. Injected failure while applying 007
  rolls back the whole migration transaction; retry reaches 012, and restart is
  idempotent. At this point the only populated upgrade baseline evidenced is
  001–006; other legacy versions and recovery scenarios remain unqualified.

  A private release-bundle builder now packages runtime source, public assets,
  workers, migrations, the production lockfile, preflight and operator examples,
  plus a SHA-256 manifest/checksum; it excludes tests, source control, data,
  credentials, logs and installed dependencies. Its extracted-bundle integration
  test checks artifact contents, missing-key and insecure-public-URL failures,
  then starts and restarts the bundle against disposable PostgreSQL with a signed
  loopback OIDC fixture and verifies readiness and retained project data. The
  default extracted-bundle smoke remains network-independent and may use test-host
  dependencies when the offline npm cache is unavailable. The explicit
  `npm run qualify:release-install` path performs fresh registry-backed
  `npm ci --omit=dev --ignore-scripts --no-audit --no-fund` in the extracted bundle
  without a module-copy fallback, then runs the same PostgreSQL, signed loopback
  OIDC, readiness, project-retention and restart journey. This is same-host fresh
  dependency-install evidence; it does not prove clean-host setup, public TLS/Caddy
  termination, external OIDC operation, or broader platform support. Loopback TLS
  is separately exercised by the browser journey below. The latest opt-in run
  passed 2/2 tests with no skips in 5.05s using npm 11.19.0, pg 8.16.3 and the
  lockfile integrity recorded by the test (`/tmp/orgward-pr04-qualify-release-install.log`);
  the disposable PostgreSQL cluster and extracted bundle were removed afterward.
  The same opt-in journey then passed 2/2 in 5.55s inside bubblewrap with the host
  filesystem read-only, fresh temporary work/home/npm-cache directories, and the
  PostgreSQL client tools mounted read-only; registry and loopback access remained
  available to the test. It also passed 2/2 in 5.45s using the official Node 22.23.3
  Linux x64 release (SHA-256 checked against its release manifest) and bundled npm
  10.9.9; the fresh bundle install resolved pg 8.16.3. Both runs use the host OS and
  the test harness uses checkout dependencies read-only, so this is isolated
  same-host/runtime evidence rather than clean-host/OS qualification. No system
  packages were installed; temporary PostgreSQL and bundle files were removed.
  The checksum-verified Node 22 archive remains under `/tmp` for this session only.
  The extracted installed bundle now also runs behind an ephemeral HTTPS proxy
  trusted by the test client and uses a signed local OIDC authorize/code/token/JWKS
  fixture with disposable PostgreSQL. It follows `/auth/login` through
  `/auth/callback`, checks Secure/HttpOnly/SameSite cookies, creates and reads a
  project with the browser session and exact HTTPS Origin, rejects a mismatched
  Origin, proves the session and project survive a bundle-process restart, then
  logs out and verifies session denial. The base browser smoke verifies TLS for
  the loopback name using its test proxy; actual Caddy is separately qualified
  below. Neither proves public certificate issuance, external identity-provider
  behavior, or E-01. The fresh dependency path remains opt-in;
  the default suite stays network-independent. Startup and preflight now accept
  protected `ORGWARD_DATABASE_URL_FILE` and `ORGWARD_SECRET_ENCRYPTION_KEY_FILE`
  inputs, exclusive with any configured inline values; readers require absolute
  paths and reject symlinks, non-regular, oversized (16 KiB URL / 1 KiB key),
  unreadable, or group/other-accessible files. They accept one terminal newline
  and redact paths and contents from diagnostics. The installed-bundle journey
  now uses these files for both the database URL and encryption key across
  preflight, startup and restart. The bundle
  example documents generic secret-manager file delivery, not qualification of any
  particular manager. Inline compatibility remains. T-08 and E-05 remain open.
  The bundle guide/examples specify Node 22+, PostgreSQL 16+, unprivileged service
  execution, loopback behind HTTPS, tenant/first-owner mapping, secret-manager key
  delivery, writable paths, and backup-aware upgrade/rollback. PR-04/T-08 remain
  open; no E-01 or clean-host acceptance is claimed.
  An opt-in `npm run qualify:release-caddy` reuses the extracted installed-bundle
  browser journey with an actual Caddy v2 process. It adapts the bundled Caddyfile
  only for the ephemeral loopback host/upstream, adds `tls internal`, disables
  trust-store installation, runs Caddy unprivileged with temporary data/config
  directories, trusts the generated root only in the test client's TLS context,
  and verifies the Caddy TCP/UDP listener is loopback-only. The test exercises a
  failed Caddy startup and cleanup, checks logs for secret disclosure, then proves
  OIDC login/callback, secure session cookie, project operations, Origin denial,
  app restart/session retention and logout through Caddy. Evidence used an Ubuntu
  Caddy 2.6.2 package extracted to `/tmp`, without system installation. Standard
  `npm test`/`npm run check` remains network-independent and uses the existing
  local TLS proxy when `ORGWARD_CADDY_BIN` is absent. This is same-host loopback
  Caddy evidence only: it does not qualify public DNS, certificates, firewall,
  service integration, external IdP, production Caddy configuration, clean-host
  install or E-01. T-08 remains open.
  Operator commands `npm run db:backup` and `npm run db:restore` use protected
  service and separate restore URL files. The service acquires a shared database
  advisory lock before migrations/store initialization and holds it through worker
  shutdown; backup/restore require the exclusive lock. Each persistence transaction
  also takes a transaction-scoped shared lock. Unexpected loss of the service lock
  fences persistence, stops workers, keeps `/livez` available and returns 503 from
  DB-backed readiness. Backup verifies the
  complete source migration prefix/checksums and execution aggregate state hashes,
  then publishes a private PostgreSQL custom-format dump plus manifest and verified
  copies of the configured projects, SDLC, execution-run and execution-workspace
  roots. Every stored execution artifact reference must match a copied workspace
  file hash. Symlinks, hardlinks, special files, cross-device/overlapping roots,
  changing files and tampered snapshots are rejected. Recovery limits are 512 MiB
  per file, 50 GiB total bytes, 100,000 total file/directory entries and 64 MiB
  serialized manifest. Restore verifies/stages files and transactionally restores
  only a distinct empty database, then publishes a new isolated filesystem staging
  root without overwriting an existing path; DB and filesystem publication are not
  one atomic cutover. Protected status path identity is checked on updates.
  Credentials use a temporary protected pgpass file, not process arguments/logs.
  Disposable PostgreSQL tests cover active-service denial, lock loss while keeping
  dependency-free `/livez` available and `/readyz` at 503, migration
  checksum/state-hash checks, unsafe/tampered trees, artifact hash matching,
  isolated restore and restart retention. The restored app now starts against the
  restored database and all four staging roots, serves the recovered execution
  artifact with its byte hash before and after restart, and closes its HTTP listener.
  New artifact records declare `sha256-raw`; readers and backup/restore reject
  unknown markers. Unmarked legacy records remain readable when either the old
  canonical Buffer digest or raw SHA-256 matches, without rewriting persisted data.
  The artifact API reports raw-byte SHA-256. Recovery manifests store raw SHA-256
  and, for execution workspace files no larger than 1 MB, the legacy digest used
  to validate older references. The generated recovery guide maps each
  `ORGWARD_*_DIR` to the staging tree and requires
  isolated offline preflight before operator-planned activation. Focused recovery,
  artifact and persistence run passed 44/44 in 26.06s with PostgreSQL tools configured;
  the default full check skipped the recovery journey because those tools were not configured.
  Each fixture closes its unique database pool; the PostgreSQL-backed test file then
  stops its own temporary cluster and removes that file-scoped root, avoiding
  invocation-wide database accumulation and SQL database-drop/checkpoint stalls.
  Manifest validation enforces the
  total 50 GiB cap across all roots, not only per root. SHA-256 detects
  corruption but does not authenticate the backup. Direct writers, recovery
  retention, operator quiescence and production cutover remain unqualified. PR-04/
  T-08 remain open.
  A later configured recovery run passed the focused backup/restore journey 1/1
  with no skips, then `npm run check` passed 178/178 with no skips in 31.67s. Both
  used extracted PostgreSQL 18.6 tools from `/tmp` (no system installation); logs:
  `/tmp/orgward-pr04-t08-database-recovery.log` and
  `/tmp/orgward-pr04-t08-check.log`. This confirms the recovery test is runnable
  when its documented optional tools are configured; standard checks remain
  network-independent and skip that journey when unavailable.
  A separate `npm run release:install` operator command now requires a detached
  Ed25519 signature and independently supplied SPKI public key. The builder signs a
  fixed domain-separated statement containing the SHA-256 of the exact final archive
  bytes, using an external owner-only PEM at `ORGWARD_RELEASE_SIGNING_KEY_FILE`, and
  emits `<archive>.sig`; `.sha256` is informational. The installer pins archive bytes
  and verifies the signature before decompression or install side effects, then accepts
  only bounded gzip USTAR, rejects links/extensions/unsafe paths, and checks exact
  manifest inventory and hashes before locked no-overwrite publication. Ephemeral-key
  tests cover signed CLI install, absent/malformed/swapped signature or key, archive
  tampering despite a recomputed checksum, and unchanged staging/destination on denial.
  The key and signature are never sourced from the archive. This proves signature
  verification only; producer authenticity still depends on independently trustworthy
  distribution of the public key. Existing same-host/trusted-parent limits remain, as
  do clean-host, public TLS, external IdP, and generic tar qualification. PR-04/T-08
  remain open. Focused builder/bundle/installer tests passed (3/3), including invalid-key no-output checks; final `npm run check` passed 162/162 in 28.98s.
  A revoke audit-reason sanitizer now decrypts any active and staged ciphertext under
  the secret-row lock, persisting `redacted_sensitive_reason` when either credential
  appears and `reason_unverified_redacted` when a present envelope cannot be verified
  (including key-unavailable revocation). Revocation still clears both envelopes and
  cancels leases. Focused PostgreSQL tests prove event/response non-disclosure for
  active+staged matches, a missing active envelope, and no-key revocation. Focused
  secrets tests passed 3/3; final `npm run check` passed 162/162 in 31.69s. An earlier
  full-check attempt stalled in the persistence worker and was stopped after 261s;
  the final clean run completed successfully.

  Bounded T-08 upgrade increment: a populated database at migration 017 now upgrades
  through 018 while retaining an eligible managed OpenAI revocation target. The
  test verifies provider/account provenance survives and new reconciler claims start
  unclaimed with zero attempts and a due timestamp. The existing 001–006 upgrade
  journey continues to cover the full migration sequence, rollback, retry and restart.
  Focused upgrade tests passed 2/2 with no skips in 2.09s; `npm run check` passed
  179/179 with no skips in 33.40s (35.64s wall). Logs:
  `/tmp/orgward-pr04-t08-upgrade-017-focused.log`,
  `/tmp/orgward-pr04-t08-upgrade-017-check.log`, and
  `/tmp/orgward-tests-ty9OxR/node-test.tap.log`. PostgreSQL 18.6 tools were extracted
  under `/tmp` and configured for the run; no system dependencies changed. PR-04/T-08
  remains open for clean-host and production-environment qualification.

  Bounded T-08 legacy credential upgrade increment: a populated database through
  migration 011 receives migration 012 with an active legacy OpenAI credential and
  an unresolved predecessor-revocation summary, then upgrades through migration 018.
  The journey proves the credential envelope, provider, model and version survive;
  the inferred predecessor obligation remains unconfirmed with no provider target,
  provenance or claim, and zero attempts; and the configured reconciliation worker
  sends no request to a loopback provider fixture before or after application
  restart. The focused PostgreSQL journey passed 1/1 with no skips (1.79s total,
  1.40s test time); log: `/tmp/orgward-pr05-t08-legacy-revocation-upgrade-timing.log`.
  The first full-check attempts failed because the extracted `pg_dump` subprocess
  lacked its runtime library path; configuring the runner-supported
  `ORGWARD_PG_TOOLS_LIBRARY_PATH` repaired this environment issue without installs.
  The single final `npm run check` passed 188/188 with no skips (49.79s TAP; 52.24s
  wall), including backup/restore. Logs are recorded in the latest-check note above.
  No live provider call was made. PR-04/T-08 remains open for clean-host and
  production-environment qualification; the externally staged target is intentionally
  still unresolved and ineligible for automatic provider deletion.

  Bounded T-08 recovery-integrity increment: restore now writes a protected status
  journal and a target-side restore guard before invoking `pg_restore`. If the
  restore result or guard installation is uncertain, the verified filesystem stage
  and source backup are preserved, and the guard blocks service startup, backup,
  and any retry even when a different status path is supplied. The guard is removed
  only after the database, schema, and artifact references are verified and the
  verified filesystem roots are published. There is no automatic resume;
  uncertain outcomes require operator inspection and reconciliation. Focused
  PostgreSQL recovery coverage
  passed 1/1 with no skips (4.84s TAP), including lost-acknowledgment handling,
  alternate-status-path denial, startup and backup refusal, and normal guard
  removal. The single repaired `npm run check` passed 188/188 with no skips
  (51.44s TAP; 53.96s wall). Logs: `/tmp/orgward-t08-restore-target-guard-final.log`,
  `/tmp/orgward-t08-oidc-future-skew-focused.log`, and
  `/tmp/orgward-t08-oidc-future-skew-check.log`. No live provider call was made.
  At that point PR-04/T-08 remained open for clean-host and production-environment
  qualification.

  PR-04 implementation is complete. The latest configured `npm run check` passed
  192/192 with no failures or skips (49.49s TAP; 52.00s wall); log:
  `/tmp/orgward-pr05-process-capability-check-repaired.log`. This implementation status does
  not pass E-01/E-05: clean-host/public TLS/external IdP and production/provider
  qualification remain open. Externally staged keys without exact OrgWard-created
  dedicated-account provenance remain unconfirmed and are not automatic deletion
  targets.

- [x] PR-05 — Editable, versioned enterprise design (T-09–T-10, T-12–T-18 except
  T-11; P-01–P-06, P-11). Persist the complete linked enterprise model; support
  iterative conversation, integrity/readiness, economics/resources, map/list
  navigation, editing/comparison/publication, and explicit human/agent assignments
  with editable authority and instructions.

  Bounded PR-05 increment implemented: authenticated workspace-write members can
  edit proposed capability/process/role fields from the selected map object and
  save an immutable blueprint version. Process triggers, role proposed
  instructions, and capability/process ownership by unique human-readable role
  name are validated; relations, integrity, summary, provenance, audit, and a
  versioned event update transactionally. The map panel shows before/after values
  and affected links, and preserves drafts/retries across same-project conflict
  reloads. Focused persistence evidence covers denial, replay, stale versions,
  immutable history, and restart. This does not implement general enterprise
  model editing, publication, or operational authority; PR-05 remains open.

  Coverage/readiness increment: the authenticated project response now drives a
  six-lens dashboard from saved blueprint area/object status, integrity gaps,
  assumptions/unknowns, confidence and provenance counts. It labels content as
  proposed, treats provenance as origin rather than evidence, shows explicit
  unknown/out-of-scope states and next actions, and discloses the shared
  customer/value/economics area overlap without percentages. Cards drill into an
  area-filtered map list and preserve route/filter/selection context for return.
  Model and PostgreSQL tests cover missing/unknown/out-of-scope scope, gaps,
  confidence/provenance, immutable edit/restart summary consistency; the view
  uses no new API. Keyboard semantics and responsive styles are implemented.
  Browser viewport and screen-reader verification remain unverified because no
  browser automation dependency/CLI is installed in this workspace. This is
  proposed design coverage, not business or release readiness; PR-05 remains
  open.

  Proposed identity binding increment: workspace-write owners/editors can propose
  an existing actor-to-role binding only when the target is an active owner/editor
  in the same tenant/project and its human/workload type matches the blueprint
  actor. PostgreSQL stores the target principal in a dedicated restricted table,
  pinned to an immutable blueprint version and membership/identity generations;
  registry reads are owner/editor-only and omit stable principal identifiers.
  Proposal checks, registry insert, versioned project event/audit and idempotency
  result commit in one transaction. Ordinary project JSON and events contain no
  target identity; the proposal event retains the verified proposer as its audit
  actor. UI selection uses authorized roster names and labels every binding
  `proposed` with no execution authority; old-version or changed-membership
  proposals are not silently restored. Focused PostgreSQL coverage exercises
  cross-tenant, nonmember, reader, actor-type, unlinked-role, stale-version,
  duplicate, replay, revoke/regrant, restart and identity-privacy cases. This
  adds no enabled assignment or execution authority, and PR-05/P-06 remain open.

  Version-pinned organizational assignment increment: an owner/editor with
  workspace-write can transition a current eligible registry proposal from
  proposed to enabled through an idempotent project command. The transaction
  rechecks and locks the pinned actor/role relationship, proposal, target
  identity and project membership, including saved identity/membership
  generations, before updating the restricted registry and appending an
  identity-free project event. Enabled means organizational responsibility
  only; no platform permissions, approval authority, tools, dispatch or
  execution authority are changed. Registry reads report old-blueprint and
  later-ineligible rows without restoring or carrying them forward. UI groups
  proposed and enabled assignments separately. Focused PostgreSQL evidence
  covers successful transition, denial, scope, replay, changed target type and
  generations, staleness, privacy and unchanged platform roles. PR-05/P-06
  remain open.

  Role scope statement increment: generated roles now keep human-readable
  `proposedScopeStatements` separate from decision references; they are proposed
  content and are not platform permissions or dispatch authority. Versioned role
  editing records before/after scope text and instructions, while a legacy edit
  migrates prose out of the old `authority` array and carries forward only links
  to existing decisions as `decisionIds`. Earlier blueprint versions remain
  unchanged. The actor binding role picker previews linked responsibilities,
  linked decisions, proposed scope and instructions with an explicit no-access
  note. Model and PostgreSQL tests cover input rejection, legacy-link handling,
  immutable history and restart persistence. PR-05/P-06 remain open.

  Role proposal metadata increment: roles can now carry bounded
  `proposedToolStatements` and `proposedEscalationRules` alongside scope and
  instructions. These values are versioned design content only; they are not
  consulted for authorization, dispatch, worker behavior or platform
  permissions. The editor accepts up to 12 entries of at most 240 characters,
  supports empty lists, and version history records before/after values. The
  actor-binding preview shows both lists and an explicit empty state. Focused
  model/PostgreSQL tests cover bounds, immutable versions, restart persistence
  and unchanged role status. Existing blueprints with absent fields remain
  readable as empty lists. PR-05/P-06 remain open.

  Saved-version comparison increment: the selected map object's detail/history
  panel now compares any two stored blueprint versions, defaulting to previous
  and current. It shows allowlisted object-field changes, status/epistemic labels,
  and added/removed human-readable links; it reports when the object is absent
  from either side. The pure helper normalizes omitted legacy optional text,
  tracks links by stable blueprint endpoint/type while displaying names, and
  excludes provenance and restricted identity-binding data. Accessible native
  version selectors and a live comparison result are included. Focused model
  tests cover content/link changes, connected-object rename, missing objects,
  legacy field normalization and identity-data exclusion. PR-05/P-06 remain
  open.

  Founder-facing commercial-edit increment: workspace writers can edit the saved
  customer, offering, and economics records from the selected map object. Each save
  creates a proposed immutable blueprint version and records before/after detail;
  existing links, economics ownership and metric references are retained. The UI
  makes clear that edited assumptions are not verified evidence or operational
  activation. PostgreSQL API coverage proves all three edits, reader and cross-tenant
  denial, stale-version conflict, persisted version history, and restart retention.
  Focused persistence tests passed 32/32 with no skips in 24.95s. `npm run check`
  passed 179/179 with no skips in 32.48s (34.69s wall); logs:
  `/tmp/orgward-pr05-commercial-edit-focused.log`,
  `/tmp/orgward-pr05-commercial-edit-check.log`, and
  `/tmp/orgward-tests-lftn0t/node-test.tap.log`. `git diff --check` passed. At this
  point the editor supported commercial, capability, process and role fields; the
  following model-area increment expands that coverage. Publication, relation and
  ownership editing, and accessible browser/screen-reader qualification remain open.

  Broader founder-facing model-edit increment: selected-map editing now supports
  name/detail changes for existing generated goal, strategy, resource, information,
  system, risk, control, metric, feedback-loop, and lifecycle records, in addition to
  customer, offering, economics, capability, process, and role editing. Type-specific
  whitelists keep these changes to descriptive text; owners, references, links,
  authority data, identity records, and operational status are retained. Actor
  identity and decision records remain uneditable through this command. PostgreSQL
  API coverage verifies representative saves across the added areas, owner/reader
  denial, stale-version conflict, relation preservation, proposed status, immutable
  version history and restart persistence. Focused persistence tests passed 32/32
  with no skips in 27.34s. `npm run check` passed 179/179 with no skips in 35.81s
  (38.23s wall); logs: `/tmp/orgward-pr05-model-area-edit-focused.log`,
  `/tmp/orgward-pr05-model-area-edit-check.log`, and
  `/tmp/orgward-tests-seGAVN/node-test.tap.log`. `git diff --check` passed. At that
  point new record types supported descriptive edits only; the ownership increment
  below expands their accountability links. Publication, interactive browser and
  screen-reader qualification, and the full founder-to-operating journey remain
  incomplete.

  Proposed ownership-design increment: for generated records that already carry an
  owner role relation (goal, strategy, economics, capability, process, resource,
  information, system, risk, control, metric, feedback loop, and lifecycle), the map
  editor lets workspace writers select one uniquely named existing blueprint role.
  The blueprint stores the role ID in `owner`; derived `owns` links are rebuilt, and
  immutable version details record the before/after role names. The UI labels this
  as proposed accountability with no platform access or task authority. Reader
  denial, invalid and ambiguous names, stale versions, relation changes, restart
  retention, and unchanged tenant memberships/platform roles are covered. Actors,
  decisions, restricted identity bindings and authority data are not editable through
  this command. Focused model/PostgreSQL tests passed 44/44 with no skips in 28.54s;
  `npm run check` passed 180/180 with no skips in 34.95s (37.35s wall). Logs:
  `/tmp/orgward-pr05-owner-design-focused.log`,
  `/tmp/orgward-pr05-owner-design-check.log`, and
  `/tmp/orgward-tests-hFfLXK/node-test.tap.log`. `git diff --check` passed. PR-05
  remains open: these fields are proposals, and other relation edits, publication,
  browser/screen-reader qualification, and the full founder-to-operating journey
  remain incomplete.

  Offering-to-customer relationship increment: workspace writers can select
  existing customer records for an offering with an accessible “Customers served”
  checkbox group. The API accepts only `servesCustomerIds` on offering edits, and
  the model rejects duplicate, unknown, or non-customer targets. Saving rebuilds
  derived `serves` relations and records before/after customer names in immutable
  version history. The UI describes the links as proposed and grants no access,
  assignments, or operational status. PostgreSQL coverage verifies add/remove/replace,
  replay, stale-version conflict, reader and cross-tenant denial, invalid targets,
  derived-link state and restart/version retention; project memberships and platform
  roles remain unchanged. Focused model tests passed 12/12 and the targeted
  PostgreSQL edit journey passed 1/1, each with no skips; logs:
  `/tmp/orgward-pr05-serving-links-model-focused.log` and
  `/tmp/orgward-pr05-serving-links-focused.log`. The single fixed-tree `npm run check`
  passed 180/180 with no skips in 35.13s TAP time (37.55s wall); logs:
  `/tmp/orgward-pr05-serving-links-check.log` and
  `/tmp/orgward-tests-ELNHrY/node-test.tap.log`. `git diff --check` passed. PR-05
  remains open for other relationship families, publication, browser/screen-reader
  qualification and the full founder-to-operating journey.

  Process information-flow increment: the selected process editor lets workspace
  writers select existing information records as proposed process inputs and
  outputs. The model stores those record IDs in the existing `inputs`/`outputs`
  fields, validates that each target is an information record, and preserves all
  existing non-information references, including decisions. It rebuilds derived
  `input-to` and `produces` relations and saves immutable before/after history with
  readable information names; the accessible checkbox groups and explanatory copy
  describe flows as proposed. The focused PostgreSQL edit journey passed 1/1 with no
  skips in 6.93s, covering add/remove/replace, duplicate/unknown/wrong-type targets,
  reader and cross-tenant denials, replay, stale version, derived links, retained
  decision output, restart history, and unchanged platform permissions. The single
  fixed-tree `npm run check` passed 180/180 with no skips in 36.17s TAP time
  (38.75s wall). Logs: `/tmp/orgward-pr05-process-info-flow-focused.log`,
  `/tmp/orgward-pr05-process-info-flow-check.log`,
  `/tmp/orgward-pr05-process-info-flow-check.time`, and
  `/tmp/orgward-tests-RM62y3/node-test.tap.log`. PR-05 remains open: other relation
  families, publication, browser and screen-reader qualification, and the complete
  founder-to-operating journey are not covered by this increment.

  Feedback-loop evidence increment: workspace writers can select existing metric
  records for the generated feedback loop's `evidence` references. The API accepts
  `evidenceMetricIds` only for feedback-loop objects, and the model rejects duplicate,
  unknown, or non-metric targets. Saving rebuilds derived `evidences` relations and
  stores readable metric names in immutable before/after history; the accessible
  checkbox group labels these as proposed monitoring and leaves decision links
  unchanged. PostgreSQL coverage verifies add/remove/replace, invalid targets, a
  rejected attempt to use the field on a process, reader and cross-tenant denial,
  replay, stale-version conflict, derived links, decision-reference retention,
  restart history, and unchanged project memberships/platform roles. The focused
  PostgreSQL edit journey passed 1/1 with no skips in 7.85s. The single fixed-tree
  `npm run check` passed 180/180 with no skips in 38.70s TAP time (41.38s wall).
  Logs: `/tmp/orgward-pr05-loop-evidence-focused.log`,
  `/tmp/orgward-pr05-loop-evidence-check.log`,
  `/tmp/orgward-pr05-loop-evidence-check.time`, and
  `/tmp/orgward-tests-wc2kf4/node-test.tap.log`. PR-05 remains open for other
  relationship families, publication, browser and screen-reader qualification, and
  the complete founder-to-operating journey.

  Metric information-source increment: workspace writers can select one existing
  information record as the source read by a metric that reads information or has
  no current source. The `readInformationId` field accepts one existing information
  ID or an explicit clear; economics-reading metrics and edits to other object
  types cannot use it. A cleared source has no derived `read-by` relation and remains
  editable after restart. Immutable edit history records the before/after source
  names, while ownership, consumer-loop links and economics sources are preserved.
  The accessible single-select UI labels the source as a proposal and states that it
  does not verify evidence or change operational status. Focused PostgreSQL coverage
  passed 1/1 with no skips in 9.98s, covering clear/restart/re-add/replace, invalid
  duplicate/unknown/wrong-type values, field misuse, reader and cross-tenant denial,
  replay, stale version, derived relation changes, history retention and unchanged
  memberships/platform roles. The single fixed-tree `npm run check` passed 180/180
  with no skips in 40.40s TAP time (42.99s wall). Logs:
  `/tmp/orgward-pr05-metric-source-focused.log`,
  `/tmp/orgward-pr05-metric-source-check.log`,
  `/tmp/orgward-pr05-metric-source-check.time`, and
  `/tmp/orgward-tests-skqJkw/node-test.tap.log`. PR-05 remains open for other
  relationship families, publication, browser and screen-reader qualification, and
  the complete founder-to-operating journey.

  Goal/economics metric-link increment: the editor accepts one existing metric ID
  or explicit null for the scalar `goal.metric` and `economics.metric` fields.
  It rejects unknown/wrong-type IDs and field misuse, preserves all other refs,
  and leaves capability `metrics[]` untouched. The accessible single-select lists
  None and existing metrics, labels the link as proposed, and immutable version
  history records readable before/after metric names. Focused PostgreSQL coverage
  passed 1/1 with no skips in 14.19s TAP time (13.78s test body), including add,
  remove, replace, clear/re-add, validation, reader/cross-tenant denial, replay,
  stale version, derived `measures` links, restart/history, and unchanged permissions.
  The one fixed-tree `npm run check` passed 180/180 with no skips in 45.60s TAP
  time (48.00s wall). Logs:
  `/tmp/orgward-pr05-goal-economics-metric-focused.log`,
  `/tmp/orgward-pr05-goal-economics-metric-check.log`,
  `/tmp/orgward-pr05-goal-economics-metric-check.time`, and
  `/tmp/orgward-tests-CjOYYh/node-test.tap.log`. At that point PR-05 still needed
  other relationship families, publication, browser/screen-reader qualification,
  and the full founder-to-operating journey; publication evidence follows.

  Internal blueprint publication increment: an authenticated `workspace-write`
  identity with current project-owner membership can publish only the exact latest
  blueprint ID/version at the expected aggregate version. The locked transaction
  recomputes schema/integrity, derived links and summary consistency; it blocks
  invalid structure and requires explicit `acknowledgeDisclosures: true`. Publication
  appends an immutable internal-baseline record and one project event without
  changing the blueprint version or its proposed status. Its stable digest covers
  the canonical full pinned blueprint plus a snapshot of area states, all unresolved
  gaps, unknown/out-of-scope areas, assumptions and unknowns. The owner-only UI
  previews that exact version and disclosures, requests acknowledgment, and labels a
  later edit as a newer proposed draft. PostgreSQL coverage passed 1/1 with no skips
  in 2.29s TAP time (1.93s test body), covering owner/editor/reader/tenant denial,
  malformed acknowledgment, invalid/nonlatest targets, replay/idempotency conflict,
  stale versions, publication/edit race, retained disclosures/digest, immutable
  blueprint/event, restart, privacy and unchanged roles/memberships/assignments.
  The single fixed-tree `npm run check` passed 181/181 with no skips in 44.31s TAP
  time (46.76s wall). Logs:
  `/tmp/orgward-pr05-publication-focused.log`,
  `/tmp/orgward-pr05-publication-check.log`,
  `/tmp/orgward-pr05-publication-check.time`, and
  `/tmp/orgward-tests-7W1JGJ/node-test.tap.log`. At this increment, PR-05 remained
  open for additional relationship editors, browser/screen-reader qualification,
  and the full founder-to-operating journey; this publication is private and does
  not enable operations or claim readiness.

  Offering-to-capability enablement increment: the offering editor accepts the
  dedicated `enabledByCapabilityIds` field and validates that every target is a
  distinct existing capability. The model updates only the offering's `enabledBy`
  IDs, preserves its `serves` references, rebuilds derived `enables` relations, and
  stores readable capability names in immutable before/after history. The accessible
  checkbox group describes the links as proposed design and says they do not
  activate services or grant authority. Focused PostgreSQL coverage passed 1/1 with
  no skips in 2.20s TAP time (1.86s test body), covering add/remove/replace,
  duplicate/unknown/wrong-type targets, field misuse, reader and cross-tenant denial,
  replay/idempotency conflict, stale versions, derived links, restart/history, and
  unchanged project memberships/platform roles. The single fixed-tree `npm run check`
  passed 182/182 with no skips in 43.14s TAP time (45.52s wall). Logs:
  `/tmp/orgward-pr05-enabledby/focused.log`,
  `/tmp/orgward-pr05-enabledby/check.log`,
  `/tmp/orgward-pr05-enabledby/check.time`, and
  `/tmp/orgward-tests-ygEOZg/node-test.tap.log`. Browser qualification remains
  unverified because Chrome is missing required host libraries; no system packages
  or repository dependency were added, and screen-reader verification remains
  unverified. PR-05 remains open for other relationship families, browser and
  screen-reader qualification, and the complete founder-to-operating journey.

  Metric-to-feedback-loop increment: metric editors can select one existing
  feedback-loop record for the scalar `consumerLoop` reference or explicitly clear
  it with `consumerLoopId: null`. The API accepts the field only for metrics, and
  the model rejects unknown or non-feedback-loop targets while preserving `reads`
  and all other references. Derived `feeds` links point from metric to loop and
  disappear when cleared. Immutable history records readable before/after loop
  names; the accessible single-select labels the link as proposed and says it does
  not activate monitoring. Focused PostgreSQL coverage passed 1/1 with no skips in
  2.18s TAP time (1.80s body), covering invalid targets/field misuse, reader and
  cross-tenant denial, clear/restart/re-add, derived links, replay/idempotency
  conflict, stale version, retained source/history, and unchanged memberships and
  platform roles. The single fixed-tree `npm run check` passed 183/183 with no skips
  in 44.79s TAP time (47.03s wall). Logs:
  `/tmp/orgward-pr05-feeds/focused.log`, `/tmp/orgward-pr05-feeds/check.log`,
  `/tmp/orgward-pr05-feeds/check.time`, and
  `/tmp/orgward-tests-lZ2PuX/node-test.tap.log`. Browser qualification remains
  unverified because Chrome is missing required host libraries; no system packages
  or repository dependency were added, and screen-reader verification remains
  unverified. PR-05 remains open for other relationship families, browser and
  screen-reader qualification, and the complete founder-to-operating journey.

  Risk-to-control relationship increment: risk editors can select one existing
  control through `mitigatingControlId` or clear the proposed link with null. The
  risk-only API validates the target type. In one versioned edit, the model updates
  `risk.control` and every `control.mitigates` array together, removing only this
  risk ID from previous controls, preserving other risk IDs and unrelated control
  fields, and adding the risk to the selected control. Derived `mitigates` relations
  therefore remain consistent when changed or cleared. The accessible single-select
  records readable before/after control names and explains that a proposed mitigation
  does not accept risk or grant authority. Focused PostgreSQL coverage passed 1/1
  with no skips in 2.36s TAP time (1.96s body), covering link/change/clear/restart/
  re-add, target validation and field misuse, reader/cross-tenant denial, replay and
  idempotency conflict, stale versions, exact relation consistency, preserved
  unrelated risk references, retained history, and unchanged memberships/platform
  roles. The single fixed-tree `npm run check` passed 184/184 with no skips in 48.78s
  TAP time (51.27s wall). Logs:
  `/tmp/orgward-pr05-risk-control/focused.log`,
  `/tmp/orgward-pr05-risk-control/check.log`,
  `/tmp/orgward-pr05-risk-control/check.time`, and
  `/tmp/orgward-tests-5M6gLB/node-test.tap.log`. Browser qualification remains
  unverified because Chrome is missing required host libraries; no system packages
  or repository dependency were added, and screen-reader verification remains
  unverified. PR-05 remains open for other relationship families, browser and
  screen-reader qualification, and the complete founder-to-operating journey.

  Capability-to-metric relationship increment: capability editors can update the
  dedicated `capabilityMetricIds` selection. The model validates distinct existing
  metric targets and replaces only metric-typed entries in `capability.metrics`,
  preserving non-metric/legacy references and unrelated fields. Existing derived
  `measures` edges remain metric-to-capability. The accessible checkbox group calls
  these proposed measurement references; immutable history records readable metric
  names. Focused PostgreSQL coverage passed 1/1 with no skips in 2.24s TAP time
  (1.85s body), covering add/remove/replace, duplicate/unknown/wrong-type targets,
  field misuse, reader/cross-tenant denial, replay/idempotency conflict, stale
  versions, derived edges, a preserved non-metric legacy reference, restart/history,
  and unchanged memberships/platform roles. The single fixed-tree `npm run check`
  passed 185/185 with no skips in 48.17s TAP time (50.49s wall). Logs:
  `/tmp/orgward-pr05-capability-metrics/focused.log`,
  `/tmp/orgward-pr05-capability-metrics/check.log`,
  `/tmp/orgward-pr05-capability-metrics/check.time`, and
  `/tmp/orgward-tests-ExExLs/node-test.tap.log`. Browser qualification remains
  unverified because Chrome is missing required host libraries; no system packages
  or repository dependency were added, and screen-reader verification remains
  unverified. PR-05 remains open for other relationship families, browser and
  screen-reader qualification, and the complete founder-to-operating journey.

  Actor-to-role assignment increment: the selected-map editor now exposes
  accessible role checkboxes for generated human and agent actors. Workspace
  writers can replace only role-typed references through `assignedRoleIds`; the
  model requires distinct existing roles, preserves non-role legacy references,
  and rebuilds derived actor-to-role `assigned-to` links. Immutable history stores
  readable before/after role names. UI copy limits the meaning to proposed
  organizational assignment; it does not change actor identity/type, platform
  permissions, authority, or execution. The focused PostgreSQL journey passed 1/1
  with no skips (2.58s TAP time; 2.65s wall), covering add/remove/replace,
  duplicate/unknown/wrong-type targets, field misuse, reader/cross-tenant denial,
  replay/idempotency conflict, stale version, exact derived role links, preserved
  non-role refs, immutable history/restart, binding eligibility and rejection of a
  removed role, plus unchanged memberships/platform roles. Logs:
  `/tmp/orgward-pr05-actor-roles/focused.log` and
  `/tmp/orgward-pr05-actor-roles/focused.time`. The one full check then failed on
  an older actor-edit test assertion that expects name/detail edits to be forbidden;
  the focused slice itself passed. Repair: actor-human/actor-agent name/detail
  labels are immutable and rendered readonly; unchanged labels remain accepted in
  the shared payload, while changed labels are denied without version mutation.
  The older restricted-actor regression was updated; focused repair coverage passed
  2/2, 0 skipped (15.09s TAP). Repair check passed 185, failed 0, skipped 1 because
  optional PostgreSQL backup/restore tools were unavailable (49.81s TAP; 52.30s
  wall). Logs: `/tmp/orgward-pr05-actor-roles-repair/` and
  `/tmp/orgward-pr05-actor-roles-repair/orgward-tests-k6FbbO/node-test.tap.log`.
  Browser qualification remains unverified because Chrome is missing required host
  libraries; no system packages or repository dependency were added, and
  screen-reader verification remains unverified. PR-05 remains open for other
  relationship families, browser/screen-reader qualification, and the complete
  founder-to-operating journey.

  Role-responsibility increment: role editors can replace responsibility refs
  through `responsibilityIds`, limited to existing goal, capability, process, or
  system records. Derived `accountable-for` edges retain canonical role→target
  direction; non-family legacy references, role instructions/scope/tool/escalation
  content, and actor assignments/bindings are preserved. UI/history describe these
  as proposed accountability only; permissions and execution authority do not
  change. The focused PostgreSQL journey passed 1/1, 0 skips (2.88s TAP), covering
  replacement/removal/empty state, target validation, derived edges, legacy refs,
  replay/staleness, history/restart, preview and unchanged access. Log:
  `/tmp/orgward-pr05-role-responsibilities-focused-2.log`. The single fixed-tree
  `npm run check` passed 186, failed 0, skipped 1 (49.37s TAP; 51.76s wall); the
  optional PostgreSQL recovery journey was skipped because `pg_dump`/`pg_restore`
  and `ORGWARD_PG_TOOLS_BIN` were unavailable. Logs:
  `/tmp/orgward-pr05-serving-links-check-current.log`,
  `/tmp/orgward-pr05-serving-links-check-current.time`, and
  `/tmp/orgward-tests-M1WkYV/node-test.tap.log`. Browser and screen-reader
  qualification and the complete founder-to-operating journey remain open.

  Process resource/system dependency increment: process editors can replace only
  the typed `resource` and `system` references already modeled on a process. The
  API rejects duplicate, unknown, wrong-type, and process-inapplicable fields; the
  model preserves nonmatching legacy references, inputs/outputs, capability,
  ownership, and other process data. Derived resource→process `resources` and
  system→process `supports` links retain their direction. Edits synchronize the
  edited process across system reverse lists, retain other process targets, and
  produce one derived edge per relationship. The accessible editor
  describes these as proposed design links only; they do not allocate resources,
  operate systems, or grant authority. Focused model coverage passed 13/13; the
  PostgreSQL/API journey passed 1/1 and the UI static assertion passed 1/1. Coverage
  includes reader/cross-tenant denial, target validation, add/remove/replace,
  replay/conflict, stale versions, history/restart, reverse-list cleanup and
  re-addition. The configured fixed-tree `npm run check` after the consistency repair
  passed 190/190 with no skips (50.99s TAP). Log:
  `/tmp/orgward-tests-aBwDng/node-test.tap.log`. PR-05 remains open for other
  relationship families, publication, browser/screen-reader qualification, and
  the complete founder-to-operating journey.

  Capability-to-process relationship increment: process editors can replace or
  clear the single capability link. The process `capability` field and capability
  `realisers` lists reconcile across the blueprint while retaining other process
  links; the derived `realises` edge is unique. The accessible picker labels this
  as proposed design intent, and version history records readable before/after
  names. Model and API validation reject malformed, unknown, wrong-type and
  process-inapplicable fields. Focused model tests passed 14/14; the PostgreSQL/API
  journey passed 1/1 with reader and cross-tenant denial, replay/conflict, stale
  version, clear/re-add, unchanged authorization generations, and restart checks;
  the UI assertion passed 1/1. The current full check passed 192/192 with no skips.
  Logs: `/tmp/orgward-pr05-process-capability-model.log`,
  `/tmp/orgward-pr05-process-capability-persistence.log`,
  `/tmp/orgward-pr05-process-capability-ui.log`, and
  `/tmp/orgward-pr05-process-capability-check-repaired.log`. PR-05 remains open for
  other relationship families, the early end-to-end founder journey, and browser/
  screen-reader qualification.

  Decision authority-design increment: decision records now let workspace writers
  edit the proposed decision-maker role and governed business-design scope from the
  selected map object. The API and model accept only existing same-blueprint role
  and eligible design references, retain other fields/references, and rebuild the
  derived `decides` and `governs` links. Immutable history and comparison display
  readable role and scope names. The accessible editor says this is proposed design
  only: it is not endorsement or approval and grants no platform permission,
  approval right, agent action, or execution authority. Focused model, PostgreSQL/API,
  and served-UI checks passed 3/3 with no skips (2.75s); log:
  `/tmp/orgward-pr05-decision-editor-focused.log`. The first full run exposed a
  stale regression that still rejected all decision edits; it now verifies that a
  decision-inapplicable owner field is rejected. The repaired configured
  `npm run check` passed 194/194 with no failures or skips (51.24s); full log:
  `/tmp/orgward-pr05-decision-editor-check-repaired.log`; TAP log:
  `/tmp/orgward-tests-7Qpsjb/node-test.tap.log`. The initial failure remains at
  `/tmp/orgward-pr05-decision-editor-check.log` and
  `/tmp/orgward-tests-j8rgNZ/node-test.tap.log`. `git diff --check` passed. PR-05
  remains open for remaining relationship/model editing, rendered browser and
  screen-reader qualification, and the founder-to-operating journey.

  Strategy-to-goal traceability increment: workspace writers can link a strategy
  to existing same-blueprint goals. The immutable edit retains the strategy owner
  and unrelated references, rebuilds strategy-to-goal `supports` relations, and
  records readable goal names in history. The accessible editor describes these
  links as proposed design intent, not goal achievement or authority to act.
  Focused model, PostgreSQL/API, and served-UI checks passed 3/3 with no skips
  (2.95s); log: `/tmp/orgward-pr05-strategy-goals-focused.log`. The configured
  `npm run check` passed 196/196 with no failures or skips (50.71s TAP); logs:
  `/tmp/orgward-pr05-strategy-goals-check.log` and
  `/tmp/orgward-tests-x0OWM3/node-test.tap.log`. PR-05 remains open for other
  relationship families, the early end-to-end founder journey, and browser/
  screen-reader qualification.

  Process decision-flow increment: workspace writers can select existing
  same-blueprint decisions separately as proposed process inputs and outputs.
  Replacing decision links preserves information and unrelated references, while
  information-only updates preserve decision links; derived edges use
  decision-to-process `input-to` and process-to-decision `produces` directions.
  Immutable history records readable decision names. Separate accessible selectors
  distinguish decision flow from information flow and state that links do not
  approve decisions, trigger execution, or change permission state. Focused model,
  PostgreSQL/API, and served-UI checks passed 3/3 with no skips (3.47s); log:
  `/tmp/orgward-pr05-process-decision-flows-focused-final.log`. Configured
  `npm run check` passed 197/197 with no failures or skips (54.75s TAP); logs:
  `/tmp/orgward-pr05-process-decision-flows-check.log` and
  `/tmp/orgward-tests-KAGTau/node-test.tap.log`. `git diff --check` passed. PR-05
  remains open for the other relationship families, browser and screen-reader
  qualification, and the founder-to-operating end-to-end journey.

  Feedback-loop steering-goal increment: workspace writers can select or clear an
  optional same-blueprint goal reference. Immutable versions rebuild the derived
  `steers` relation and show readable before/after goal names, while preserving
  evidence, decision links, owner, cadence, and threshold. The editor describes
  the link as proposed steering intent, not achievement evidence or approval;
  no authority or permission state changes. Focused model, PostgreSQL/API, and
  served-UI checks passed 3/3 with no skips (3.35s); log:
  `/tmp/orgward-pr05-feedback-goal-focused-final.log`. Configured `npm run check`
  passed 198/198 with no failures or skips (54.11s); logs:
  `/tmp/orgward-pr05-feedback-goal-check.log` and
  `/tmp/orgward-tests-1wygzw/node-test.tap.log`. `git diff --check` passed.
  PR-05 remains open for other relationship families, browser and screen-reader
  qualification, and the founder-to-operating end-to-end journey.

  Feedback-loop decision-design increment: workspace writers can select, replace,
  or clear the proposed decision links for a feedback loop. The model validates
  same-blueprint decision records and updates only `decisionIds`; `authorises`
  remains a derived blueprint relation. Immutable history records readable before
  and after decision names, while evidence, steering goal, owner, cadence, and
  threshold are preserved. The selector states that the design link does not
  approve decisions or authorize work. Focused model, PostgreSQL/API, and served-UI
  checks passed 3/3 with no skips (3.66s); log:
  `/tmp/orgward-pr05-feedback-decisions-focused-repaired.log`. Configured
  `npm run check` passed 199/199 with no failures or skips (55.57s); logs:
  `/tmp/orgward-pr05-feedback-decisions-check.log` and
  `/tmp/orgward-tests-fotjjx/node-test.tap.log`. `git diff --check` passed.
  Rendered browser spot check: accessible list/editor labels and proposal-only helper
  copy observed for process, feedback-loop, decision, and strategy; a strategy edit
  rendered as immutable version 2 with before/after history. Screenshot:
  `/tmp/orgward-pr05-rendered-final.png`; concise evidence log:
  `/tmp/orgward-pr05-rendered-browser-summary.log`; detailed interaction log:
  `/tmp/orgward-pr05-rendered-browser.log`; app/cluster lifecycle log:
  `/tmp/orgward-pr05-rendered-server.log`. This is not a full end-to-end or
  screen-reader pass. PR-05 remains open for other relationship families, the
  complete founder-to-operating end-to-end journey, and screen-reader qualification.

  Graph-selection UX increment: pointerdowns originating within `.graph-node` no
  longer start or capture background panning, allowing node clicks to reach object
  selection while empty-canvas panning remains available. Focused map-state coverage
  passed 4/4; app/map-state syntax checks passed. The single configured `npm run
  check` exited 0 with 199 passed, 0 failed, and 1 optional PostgreSQL
  backup/restore test skipped because client tools were not configured (200 total).
  Logs: `/tmp/orgward-pr05-graph-selection-focused.log`,
  `/tmp/orgward-pr05-graph-selection-check.log`, and
  `/tmp/orgward-tests-zV1p5S/node-test.tap.log`. `git diff --check` passed. A
  rendered recheck was attempted once in a disposable loopback app, but its
  unconfigured development identity returned HTTP 500 on project creation before
  a graph could load; seeded OIDC cookie and development headers did not establish
  an authenticated enterprise session. That attempt did not verify graph selection.
  Logs: `/tmp/orgward-pr05-graph-recheck.log` and
  `/tmp/orgward-pr05-graph-recheck-server.log`; app and database were stopped and
  removed. PR-05 remains open for browser and screen-reader qualification and the
  complete founder-to-operating journey.

  Graph-selection keyboard UX increment: graph nodes and list rows expose selected
  state with `aria-pressed`; the shared click/keyboard selection handler restores
  focus to the newly rendered selected control. Blank-canvas clearing remains
  unchanged and does not focus a node. Focused map-state coverage passed 5/5;
  app/map-state syntax checks passed. The configured `npm run check` exited 0 with
  200 passed, 0 failed, and 1 optional PostgreSQL backup/restore test skipped because
  client tools were not configured (201 total). Logs:
  `/tmp/orgward-pr05-graph-keyboard-focused.log`,
  `/tmp/orgward-pr05-graph-keyboard-check.log`, and
  `/tmp/orgward-tests-B3GSEe/node-test.tap.log`. `git diff --check` passed. No browser
  rerun was attempted because the recorded disposable fixture reports
  `development_unverified` identity and project-creation HTTP 500. PR-05 remains
  open for rendered browser and screen-reader qualification and the complete
  founder-to-operating journey.

  Graph-selection rendered follow-up: seeded a disposable loopback project through
  the API using a valid hashed OIDC principal, then opened it with read-only browser
  headers and no session cookie. Clicking the “Review and steer the enterprise”
  graph object opened its detail panel; after selection rerender, the graph control
  remained focused and exposed `aria-pressed=true`. This confirms the bounded graph
  selection/selected-state behavior only; it is not a full end-to-end or
  screen-reader pass. Screenshot: `/tmp/orgward-pr05-graph-selection-after-fix.png`;
  accessible snapshot and interaction log: `/tmp/orgward-pr05-graph-selection-rendered.log`;
  concise result: `/tmp/orgward-pr05-graph-selection-rendered-summary.log`;
  app/cluster lifecycle: `/tmp/orgward-pr05-graph-selection-rendered-server.log`.
  Browser, app, and disposable database were stopped and removed. PR-05 remains
  open for the complete founder-to-operating journey and screen-reader qualification.

  Saved-map search increment: founders can search the interactive graph and list
  by object name, detail, type, or design area. Search intersects with the current
  area/type filters, removes links whose endpoints are hidden, reports live match
  counts and empty results, and keeps the selected object's details available if
  the search filters it out. Search does not place the entered phrase in the URL.
  Focused map-state coverage passed 6/6; the served-UI assertion passed 1/1, both
  with no skips. The single configured `npm run check` passed 201, failed 0, and
  skipped 1 optional PostgreSQL backup/restore case because `ORGWARD_PG_TOOLS_BIN`
  was unavailable (202 total; 53.84s TAP). Logs:
  `/tmp/orgward-pr05-map-search-focused-final.log`,
  `/tmp/orgward-pr05-map-search-ui-focused-final.log`,
  `/tmp/orgward-pr05-map-search-check.log`, and
  `/tmp/orgward-tests-I6mtAO/node-test.tap.log`. `git diff --check` passed. PR-05
  Rendered browser follow-up loaded the disposable sample and verified a one-object
  search in graph and list views, live empty-state text, zero dangling links, retained
  selected-object details when filtered out, and search-input focus. No browser error
  overlay appeared. Desktop and 390x844 screenshots:
  `/tmp/orgward-pr05-map-search-browser.png` and
  `/tmp/orgward-pr05-map-search-mobile.png`; interaction summary:
  `/tmp/orgward-pr05-map-search-browser-summary.log`. Browser, app and database were
  stopped and removed. This is not a full end-to-end, keyboard, or screen-reader pass.
  PR-05 remains open for the founder-to-operating journey and screen-reader qualification.

  Founder edit/version browser follow-up: the disposable fixture's `/auth/session`
  endpoint reported `workspace-write`, but the fixture manually seeded a session
  while calling `createApp` without an `oidcAuthenticator`. API middleware therefore
  never bound that cookie to `request.identity`; project creation fell back to the
  development principal, whose membership insert violates the OIDC-principal
  foreign key and surfaced as HTTP 500 (“Workspace unavailable”; correlation ID
  `correlation-309c4022-e426-41db-a5c1-70c7513a0a40`). This is fixture misconfiguration,
  not evidence that authenticated OIDC project creation fails. The browser edit,
  before/after comparison, and reload persistence steps were not reached. The
  browser was closed and the app/cluster were stopped and removed; no retry was made.
  Summary and snapshots:
  `/tmp/orgward-pr05-founder-edit-failure-summary.log`,
  `/tmp/orgward-pr05-founder-edit-auth-home.log`,
  `/tmp/orgward-pr05-founder-edit-created-snapshot.log`,
  `/tmp/orgward-pr05-founder-edit-initial-snapshot.log`, and
  `/tmp/orgward-pr05-founder-edit-selected-snapshot.log`; app/cluster lifecycle:
  `/tmp/orgward-pr05-founder-edit-auth-server.log`. This attempt adds no passing
  founder edit/history evidence. PR-05 remains open for the complete founder-to-
  operating journey and screen-reader qualification.

  Corrected rendered founder-edit follow-up: with the disposable app configured
  with OIDC cookie middleware, authenticated project creation returned HTTP 201.
  The browser completed the four saved founder discovery answers, opened the
  interactive map, selected “Focused launch strategy,” edited its detail, and
  saved immutable Version 2. The rendered comparison showed the Version 1 and
  Version 2 detail values and the affected-link view; after browser reload, the
  selected strategy, edited detail, saved version, and comparison/history remained
  visible. This verifies the bounded saved-chat-to-edit/history path through page
  reload, not an app restart, full PR-05 end-to-end, keyboard, or screen-reader
  qualification. Screenshots:
  `/tmp/orgward-pr05-founder-edit-strategy-before.png`,
  `/tmp/orgward-pr05-founder-edit-strategy-after.png`, and
  `/tmp/orgward-pr05-founder-edit-rendered-reload.png`; accessible snapshots and
  result log:
  `/tmp/orgward-pr05-founder-edit-strategy-before.snapshot`,
  `/tmp/orgward-pr05-founder-edit-strategy-after.snapshot`,
  `/tmp/orgward-pr05-founder-edit-rendered-reload.snapshot`, and
  `/tmp/orgward-pr05-founder-edit-rendered-reload.log`; app/API fixture log:
  `/tmp/orgward-pr05-founder-edit-corrected-server.log`. The browser, app and
  disposable database were stopped and removed. PR-05 remains open for the
  complete founder-to-operating journey and screen-reader qualification.

  Keyboard/accessibility UX increment: in one corrected disposable OIDC fixture,
  Tab-only navigation reached the discovery answer, and Tab then Enter submitted
  it; the next assistant question rendered while focus returned to the answer
  field. The old conversation container had no live-region semantics, and no live
  status announced that new prompt. Map search narrowed to one strategy, but the
  filtered graph result followed 19 type filters, two view buttons, and three zoom
  controls in the tab order (25 Tab presses from search). Enter then selected the
  strategy with focus retained and `aria-pressed=true`. The UI now writes only the
  current prompt into a persistent polite status, and a “Skip controls to first map
  result” toolbar button focuses the first filtered graph/list item (disabled when
  no results match). Focused tests passed 24/24. The configured `npm run check`
  exited 0 with 203 passed, 0 failed, and 1 optional PostgreSQL backup/restore test
  skipped because `ORGWARD_PG_TOOLS_BIN` was unavailable (204 total; 55.03s TAP).
  Logs: `/tmp/orgward-pr05-keyboard-focused.log`,
  `/tmp/orgward-pr05-keyboard-check.log`, and
  `/tmp/orgward-tests-6gT0PX/node-test.tap.log`. Pre-fix browser evidence:
  `/tmp/orgward-pr05-kbd-summary.log`,
  `/tmp/orgward-pr05-kbd-initial.png`,
  `/tmp/orgward-pr05-kbd-selection.png`,
  `/tmp/orgward-pr05-kbd-selection.snapshot`, and
  `/tmp/orgward-pr05-kbd-selection-summary.log`. `git diff --check` passed. The
  corrected fixture was stopped and removed. No post-fix rendered rerun, actual
  screen-reader pass, app-restart pass, or complete founder-to-operating journey
  was performed; PR-05 remains open.

  Graph keyboard-focus repair follow-up: the SVG graph root now uses a named
  `group` role instead of `img`, removing the image semantics that flatten its
  interactive descendants; list focus and selected-detail restoration are unchanged.
  Rendered keyboard focus could not be confirmed in this attempt. Focused
  map-state checks passed 8/8 with no skips (`/tmp/orgward-pr05-svg-keyboard-focused.log`).
  The single configured `npm run check` passed 204, failed 0, and skipped 1 optional
  PostgreSQL backup/restore journey because `ORGWARD_PG_TOOLS_BIN` was unavailable
  (205 total; 54.75s TAP). Logs: `/tmp/orgward-pr05-svg-keyboard-check.log` and
  `/tmp/orgward-tests-5AWpWS/node-test.tap.log`; `git diff --check` passed. The one
  corrected disposable OIDC fixture seeded a project successfully (HTTP 201), but
  agent-browser rejected the private cookie import with `Network.setCookies: Invalid
  cookie fields`; no page was loaded and no screenshot was captured. Browser, app,
  database, and private import file were cleaned up. Rendered graph-focus/Enter and
  list-jump verification remains open, as do screen-reader and full founder-to-
  operating journey checks. PR-05 remains open.

  Final rendered SVG-focus verification: direct URL-scoped cookie setup succeeded
  in one corrected disposable OIDC fixture; authenticated project creation returned
  HTTP 201. The loaded project was nonblank with no error overlay, and browser
  errors/console were empty. Search narrowed the map to “Focused launch strategy.”
  The skip button focused the first graph result itself (`document.activeElement`
  was the SVG `<g class="graph-node">`, with `aria-label="strategy: Focused launch
  strategy"`; its SVG ancestor had `role="group"`). Pressing Enter selected that
  same strategy, kept focus on the rerendered selected graph node, set
  `aria-pressed=true`, and rendered matching object details. In list mode, the same
  jump button focused the selected `.list-row` for that strategy and its details
  remained visible. Result log: `/tmp/orgward-pr05-svg-keyboard-final.result.log`;
  snapshots: `/tmp/orgward-pr05-svg-keyboard-final.initial.snapshot`,
  `/tmp/orgward-pr05-svg-keyboard-final.map.snapshot`,
  `/tmp/orgward-pr05-svg-keyboard-final.filtered.snapshot`, and
  `/tmp/orgward-pr05-svg-keyboard-final.list.snapshot`; screenshots:
  `/tmp/orgward-pr05-svg-keyboard-final.png` and
  `/tmp/orgward-pr05-svg-keyboard-final-list.png`. Browser, app, database, and
  private cookie file were removed. This bounded map journey is not a full E2E,
  app-restart, or screen-reader pass. PR-05 remains open.

  Internal-baseline and actor-proposal browser journey: one corrected disposable
  OIDC fixture loaded an authenticated founder project, saved four discovery
  answers as blueprint v1, and rendered the coverage disclosures: 3 open gaps,
  3 untested assumptions, 3 recorded unknowns, and no unknown/out-of-scope areas.
  After acknowledgment, the UI confirmed “Published internal design baseline:
  blueprint v1”; authenticated API readback confirmed the publication referenced
  the exact current blueprint id/version 1 and retained disclosure counts. The
  copy states publication stays within the private project and does not verify
  evidence, grant permissions, enable assignments, or change operational status.
  The founder then proposed binding organizational human actor “Founder” to the
  “Founder / enterprise owner” role and existing project owner. Readback showed
  status `proposed`, blueprintVersion/currentBlueprintVersion 1, and eligible
  membership. No enable action was taken. The UI explicitly states proposed or
  enabled organizational assignment grants no platform access, permissions,
  approval authority, tool dispatch, or execution authority; workspace membership
  remained owner. Browser loaded without an error overlay, and console/errors were
  empty. Result log: `/tmp/orgward-pr05-baseline-binding-result.log`; snapshots:
  `/tmp/orgward-pr05-baseline-binding-initial.snapshot`,
  `/tmp/orgward-pr05-baseline-binding-coverage.snapshot`,
  `/tmp/orgward-pr05-baseline-binding-actor-filter.snapshot`,
  `/tmp/orgward-pr05-baseline-binding-actor-detail.snapshot`,
  `/tmp/orgward-pr05-baseline-binding-proposal.snapshot`, and
  `/tmp/orgward-pr05-baseline-binding-published.snapshot`; screenshots:
  `/tmp/orgward-pr05-baseline-binding-initial.png`,
  `/tmp/orgward-pr05-baseline-binding-disclosures.png`,
  `/tmp/orgward-pr05-baseline-binding-actor-detail.png`,
  `/tmp/orgward-pr05-baseline-binding-proposal.png`, and
  `/tmp/orgward-pr05-baseline-binding-published.png`. Fixture lifecycle log:
  `/tmp/orgward-pr05-internal-publication-binding-server.log`; all disposable
  processes and the private cookie file were removed. This does not qualify the
  complete founder-to-operating journey, app restart, or screen-reader behavior.
  PR-05 remains open.

  Role Version 2 browser follow-up stopped before fixture setup: the initial
  agent-browser `click #map-tab` command was issued before opening the app and
  returned `Element not found: #map-tab`. No OIDC fixture, database, project, or
  browser page was started; the empty browser session was closed. This is a setup
  sequencing failure, not a product finding. At that checkpoint, role proposal
  edits, v1/v2 history, reload persistence, and the v2-pinned actor proposal were
  unverified; the completed follow-up below supersedes that status. PR-05 remains
  open.

  Completed role Version 2 browser follow-up: one corrected disposable OIDC
  fixture was opened at the app base URL, waited to network idle, and navigated
  through fresh accessible snapshots. After saving the four founder answers,
  the founder selected “Founder / enterprise owner” and edited proposed role
  instructions, scope statements, tool statements, and escalation rules. Saving
  created blueprint v2; Version 1 → 2 comparison and history showed before/after
  values for all four fields. Reload in the same named browser session preserved
  the v1/v2 history and all edited values. The founder then proposed the existing
  human “Founder” actor to “Founder / enterprise owner”; API readback confirmed
  status `proposed` and `blueprintVersion=currentBlueprintVersion=2`, eligible
  membership, with no enable action. The UI says organizational binding proposals
  do not grant platform access, permissions, approval authority, tool dispatch, or
  execution authority; project membership remained owner. Accessible labels and
  helper text were present at the supported 390×844 viewport. No error overlay or
  browser errors/console entries appeared. Result log:
  `/tmp/orgward-pr05-role-v2-final.result.log`; snapshots:
  `/tmp/orgward-pr05-role-v2-final-home.snapshot`,
  `/tmp/orgward-pr05-role-v2-final-project.snapshot`,
  `/tmp/orgward-pr05-role-v2-final-blueprint.snapshot`,
  `/tmp/orgward-pr05-role-v2-final-map.snapshot`,
  `/tmp/orgward-pr05-role-v2-final-role-search.snapshot`,
  `/tmp/orgward-pr05-role-v2-final-role-editor-before.snapshot`,
  `/tmp/orgward-pr05-role-v2-final-role-draft.snapshot`,
  `/tmp/orgward-pr05-role-v2-final-version2.snapshot`,
  `/tmp/orgward-pr05-role-v2-final-reload.snapshot`,
  `/tmp/orgward-pr05-role-v2-final-actor-search.snapshot`,
  `/tmp/orgward-pr05-role-v2-final-actor-panel.snapshot`,
  `/tmp/orgward-pr05-role-v2-final-actor-panel-mobile.snapshot`, and
  `/tmp/orgward-pr05-role-v2-final-binding-v2.snapshot`; screenshots:
  `/tmp/orgward-pr05-role-v2-final-home.png`,
  `/tmp/orgward-pr05-role-v2-final-role-before.png`,
  `/tmp/orgward-pr05-role-v2-final-version2.png`,
  `/tmp/orgward-pr05-role-v2-final-reload.png`,
  `/tmp/orgward-pr05-role-v2-final-actor-panel.png`,
  `/tmp/orgward-pr05-role-v2-final-actor-panel-mobile.png`, and
  `/tmp/orgward-pr05-role-v2-final-binding-v2-mobile.png`. Fixture lifecycle log:
  `/tmp/orgward-pr05-role-v2-final-server.log`; browser sessions, app, database,
  and private cookie file were removed. This is not a screen-reader or complete
  founder-to-operating qualification.

  PR-05 implementation acceptance complete. Current fixed-tree evidence: focused
  map-state coverage passed 8/8; the single configured `npm run check` passed 204,
  failed 0, and skipped 1 optional PostgreSQL backup/restore journey because
  `ORGWARD_PG_TOOLS_BIN` was unavailable (205 total; 54.75s TAP). Rendered browser
  checks covered saved discovery, interactive graph/list navigation and focus,
  versioned role edits and comparison, reload persistence, internal publication
  with disclosures, and a human assignment proposal pinned to the current version;
  the role editor path also rendered at 390×844. Source and behavior coverage
  support both human and workload actor bindings; the rendered proposal journeys
  exercised the human case, while PostgreSQL tests cover agent/workload binding.
  No actual screen-reader pass or complete founder-to-operating/restart journey is
  claimed; those remain PR-11 qualification and PR-06 respectively. Release-gate
  statuses remain in their separate ledger and were not changed.

- [ ] PR-06 — Durable human/agent work and private operating journey (T-19–T-24,
  then T-11; P-07–P-10, P-12; E-07–E-08). Run process/task graphs through leased,
  crash-recoverable work with pause/resume/cancel, mandatory human checkpoints,
  isolated tools and one real bounded model provider. Then enable sourced proposal
  generation and prove the complete private design-to-result journey across restart.
  Priority slice: start from a saved, edited business design; assign human and agent
  work; exercise an intervention or escalation; then review the persisted outcome
  and evidence after restart. Complete this customer path before broad standalone
  resilience and operations qualification, while keeping authorization, tenant
  isolation, safe tool bounds and auditable state transitions in the path.

  Earlier P-07 planning-only graph increment (historical): a workspace writer
  can select a saved process and persist a proposed graph pinned to its blueprint
  version. Nodes are derived
  only from that process and its upstream process producers, with saved input/output
  links, role references, dependency edges and observable `planned` state. Workspace
  writers can append an immutable graph revision that edits task title/detail,
  dependencies and role references from the pinned blueprint. Earlier revisions
  remain inspectable; inputs/outputs and source version remain pinned. Task and graph
  states remain `planned`. A task may also retain a blueprint actor ID only when that
  actor is linked to its selected role in the pinned blueprint and an enabled
  owner/editor identity binding is revalidated transactionally. Project graph data
  and events contain only actor/role IDs; target principals and display names remain
  in the restricted binding registry. Readers can inspect the graph but cannot read
  resolved identity. Revoked, changed-generation, or old-blueprint bindings are
  rejected and displayed unresolved; no assignment grants platform access or
  execution authority. Role references do not select a person by themselves. At
  that increment, no execution run was created or dispatched. Focused
  model/PostgreSQL coverage verifies edit validation, cycle and role/reference
  denial, immutable prior revision, replay, expected-version conflict,
  access/project isolation, restricted identity privacy,
  enabled-binding revalidation, revoke/regrant staleness and restart retention. Explicit
  person assignment, run-state transitions, lease/recovery controls and the complete
  P-07 journey remain open; PR-06 and release gates remain open.

  PR-06 linked task-request increment (historical bounded increment; PR-06 remains
  open): at that increment, an assigned agent task could create an immutable run
  reference for its saved plan, revision, instance and task. PostgreSQL validates
  writer/project access, current
  graph revision for new instances, enabled workload binding and same-instance
  dependencies in the transaction that stores the approval request and idempotent
  command result. Run records were then the only runtime status source; retry after
  a terminal failure starts a new server-generated instance. The request waits for
  independent approval and never dispatches automatically. UI copy states that
  the enabled binding is traceability only: the selected configured profile runs
  through the OrgWard worker after approval and does not execute as or impersonate
  the bound workload. Human-assigned tasks were rejected pending a durable human
  checkpoint lane. Focused persistence/API/state and migration checks passed
  8/8 in 4.34s (`/tmp/orgward-tests-KkWXRb/node-test.tap.log`). Final `npm run
  check` passed 206/207 in 52.54s, with 0 failures and 1 skipped
  (`/tmp/orgward-tests-pP4arb/node-test.tap.log`; command log
  `/tmp/orgward-pr06-task-check-final.log`). Rendered browser verification was
  unavailable because no browser tool or CLI is installed; no rendered E2E claim
  is made. Human checkpoints, execution as the bound workload, and the complete
  founder-to-operating journey remain open.

  PR-06 canonical task-runtime and human-checkpoint increment (bounded; PR-06
  remains open): migration 020 adds one durable process-task runtime keyed by
  tenant/instance/task. Existing linked agent runs are backfilled with their
  pinned actor/role references and status, without inventing historical target
  principals or generations; those legacy agent links are identified as workload
  tasks. Run approval, execution, terminal and recovery status changes update the
  canonical runtime in the same PostgreSQL transaction. Human tasks can be started
  by the currently authorized identity bound to the pinned actor/role, then
  completed with a durable succeeded/failed outcome and evidence; a dependency can
  advance only after its canonical runtime is succeeded. Root human starts receive
  a server-generated instance ID that same-command replay returns. Replay,
  changed-input conflict, stale membership, wrong-assignee denial, project isolation
  and private-principal response checks are covered. After app restart, agent
  runtime statuses/run links and a completed human review status are asserted;
  evidence on a separate root human runtime is also asserted. Start/completion
  events are exercised before restart, but post-restart event reads are not
  asserted. The Execution UI derives status from these runtime rows, supports agent
  approval requests and assigned human checkpoints, and keeps human work separate
  from executor runs. Focused state/API/PostgreSQL
  and migration checks passed 3/3 in 3.46s (`/tmp/orgward-tests-6zvl6Q/node-test.tap.log`).
  Final `npm run check` passed 207/208 in 56.87s, with 0 failures and 1 optional
  backup/restore journey skipped because PostgreSQL dump client tools were absent
  (`/tmp/orgward-tests-9W65CW/node-test.tap.log`; command log
  `/tmp/orgward-pr06-canonical-human-runtime-check.log`). Rendered browser
  verification was not run. Pause/resume, escalation, override, actual execution
  as the bound workload identity, and the full operating journey remain open;
  PR-06 and release gates remain open.

  PR-06 human task escalation increment (bounded; PR-06 remains open): migration
  021 adds `ESCALATED` to the canonical human task runtime and requires each human
  state transition to append one matching immutable event for the same task
  instance. The assigned current human can escalate an in-progress task with a
  required reason and optional evidence; ordinary completion is blocked while it
  is escalated. Runtime reads expose only safe assignment/owner capability flags
  and sanitized event actors. Only a current project owner with workspace-write
  can resolve with a required reason to resume, succeed or fail; succeeded also
  requires verification/work evidence. Resume revalidates the original active
  human, owner/editor membership, identity and membership generations, and the
  enabled binding pinned to the task’s blueprint version. Commands, runtime
  transitions and audit events commit atomically with idempotent replay. Execution
  UI shows escalation details to project readers and renders resolution controls
  only when the server reports owner capability. Focused persistence/API, state,
  served-UI and migration tests passed 5/5 in 4.76s
  (`/tmp/orgward-tests-MLGtsf/node-test.tap.log`). Final `npm run check` passed
  207/208 in 60.57s, with 0 failures and 1 optional PostgreSQL backup/restore
  test skipped because dump client tools were unavailable
  (`/tmp/orgward-tests-phsOhR/node-test.tap.log`; command log
  `/tmp/orgward-pr06-human-escalation-check.log`). The passing journey verifies
  owner/assignee denials, reason/evidence validation, resume/succeed/fail,
  replay/conflict, dependency gating, stale-binding denial, private-principal
  responses, and restart retention. No rendered browser or screen-reader check
  was run. Separate pause/override controls, execution as the bound workload and
  the full founder-to-operating journey remain open; PR-06 and release gates
  remain open.

  PR-06 rendered agent task-to-result journey (bounded; PR-06 remains open): a
  loopback-only disposable app/database loaded a saved business design and graph
  revision 2 with an enabled workload actor binding. In Execution, the founder
  requested the linked root task; a distinct human approver approved it; the
  founder then ran the selected configured local command profile. The task row
  and linked run rendered SUCCEEDED, with COMPLETED result, exit code 0, stdout,
  and an evidence hash. After browser page reload, the same task instance, run
  link and saved evidence rendered again. The UI explicitly disclosed that the
  configured profile runs through the OrgWard worker after separate approval
  and does not execute as or impersonate the bound workload. No live provider or
  external effect was used. There was no error overlay; browser page-error and
  console captures were empty. Screenshots:
  `/tmp/orgward-pr06-rendered-initial.png`,
  `/tmp/orgward-pr06-rendered-runtime.png`, and
  `/tmp/orgward-pr06-rendered-runtime-reloaded.png`; accessible snapshots,
  redacted run details and diagnostics are listed in
  `/tmp/orgward-pr06-rendered-journey.log`. No source changed, so no tests or
  `npm run check` were run. This verifies browser reload against the same
  running app/database, not app-process restart, screen-reader behavior, a real
  model-provider run or the complete founder-to-operating journey. PR-06 and
  release gates remain open.

  PR-06 pre-dispatch task withdrawal increment (bounded; PR-06 remains open):
  migration 022 adds `CANCELLED` as a workload task terminal state only when a
  linked run is atomically withdrawn from `AWAITING_APPROVAL` or `APPROVED`.
  The current authorized requester can cancel through a locked, expected-version
  write; the immutable run reference, canonical runtime status/timestamp, one
  append-only cancellation event, audit/outbox records and idempotent command
  result commit together. Replay does not duplicate history, and cancel-versus-
  approve uses the same row/version fence. The migration matches the runtime
  event causation ID to exactly one linked run cancellation event, and rejects
  later SQL changes to status, version, outcome, evidence, timestamps or events.
  A `RUNNING` task is rejected with a clear error and UI disclosure; no worker
  termination is attempted, and stale approval recovery remains `INTERRUPTED`.
  Focused PostgreSQL/API, served-UI and migration checks passed 6/6 in 6.63s
  (`/tmp/orgward-tests-Llcb25/node-test.tap.log`). Final `npm run check` passed
  207/208 in 54.93s, with 0 failures and 1 skipped because PostgreSQL client
  tools were unavailable for the optional backup/restore journey
  (`/tmp/orgward-tests-YsDaw8/node-test.tap.log`). `git diff --check` is clean.
  The linked-run-withdrawal path is verified across app restart; RUNNING remains
  nonwithdrawable and no worker abort is provided. Pause/resume, real provider
  execution as the bound workload, complete founder-to-operating qualification,
  and release gates remain open.

  PR-06 linked OpenAI task-approval increment (bounded; PR-06 remains open):
  assigned agent tasks can request approval with a configured `provider-openai`
  profile only after project, saved plan, task, actor binding and dependency
  preflight succeeds. Credential-reference metadata is resolved on the same
  PostgreSQL transaction client and the active secret row remains locked while the
  immutable run linkage and command result are saved. The run stores only the
  reference, generation and non-secret profile/model metadata; replay does not
  resolve a newer generation. Approval revalidates and locks the pinned generation,
  while execution and broker-lease checks deny expired, revoked or rotated bindings
  before credential decryption or provider transport. Focused fixture coverage
  verifies preflight ordering, lock serialization, replay, privacy and stale-
  generation denial. The focused linked-task journey passed 1/1 in 5.59s and the
  existing OpenAI broker/transport regression passed 1/1 in 2.19s
  (`/tmp/orgward-pr06-openai-focused-final.log`,
  `/tmp/orgward-pr06-openai-provider-focused.log`). Final `npm run check` passed
  207/208 in 57.01s with 0 failures and 1 optional PostgreSQL backup/restore test
  skipped because client tools were unavailable (`/tmp/orgward-tests-0ClUv3/node-test.tap.log`).
  No live provider request was made; linked live-model execution remains
  unqualified. PR-06 and release gates remain open.

  PR-06 linked OpenAI task-to-result increment (bounded; PR-06 remains open):
  a fresh root task pinned the current credential generation, received independent
  approval, and executed once against the loopback-only Responses fixture. The run
  and canonical task runtime reached `SUCCEEDED`; output and an evidence hash were
  retained without exposing credential material. After app restart, the linked run,
  task status, output, and evidence remained readable. Focused PostgreSQL journey
  passed 1/1 (`/tmp/orgward-pr06-openai-success-focused.log`). Final `npm run check`
  passed 207/208 in 57.76s, 0 failures, and 1 optional PostgreSQL backup/restore
  skip due to unavailable client tools (`/tmp/orgward-tests-1aFKqj/node-test.tap.log`).
  `git diff --check` passed. No rendered browser or live provider call was run;
  live-model, browser, and full founder-to-operating qualification remain open.
  PR-06 and release gates remain open.

  PR-06 pre-dispatch pause/resume increment (bounded; PR-06 remains open): the
  requester can pause a linked run while it awaits approval or after approval.
  Pause atomically updates the run and canonical task runtime; an existing approval
  is invalidated. Resume revalidates the immutable task instructions and assignment,
  same-instance dependencies, current workload binding, execution profile and
  credential generation, then returns to `AWAITING_APPROVAL` for a new independent
  approval. Stale validation leaves the run paused; paused requests can still be
  cancelled. Database guards require matching run/runtime events and reject direct
  or started-state transitions. The UI explains that pause is pre-dispatch only.
  Focused persisted journey and served-client checks passed 2/2; migration-upgrade
  repair regression passed 1/1. Final `npm run check` passed 207/208 in 62.84s,
  with 0 failures and 1 optional PostgreSQL backup/restore skip because client tools
  were unavailable. Logs: `/tmp/orgward-pr06-pause-resume-focused-rerun.log`,
  `/tmp/orgward-pr06-pause-resume-upgrade-repair.log`,
  `/tmp/orgward-pr06-pause-resume-check-final.log`, and
  `/tmp/orgward-tests-4K32Cw/node-test.tap.log`. An initial full check caught and
  led to repair of the migration-count expectation; its diagnostic log remains at
  `/tmp/orgward-pr06-pause-resume-check.log`. `git diff --check` passed. Rendered
  browser verification was unavailable because no browser automation tool is
  installed. No live provider call was made; PR-06 and release gates remain open.

  PR-06 mixed human-to-agent dependency increment (bounded; PR-06 remains open):
  a dependent agent task now requires a verified succeeded human checkpoint with
  nonempty evidence, a matching task-reference event and content hash, and its
  matching audit record. Assigned-human completion and an owner-approved success
  override both qualify; failed, escalated, incomplete, or malformed legacy success
  does not. Later revocation of an assignee does not erase valid terminal history.
  API/UI validation and migration 024 enforce evidence on assigned-human success.
  Focused persistence/API/upgrade checks passed 3/3; `npm run check` passed 208/209,
  with 0 failures and 1 optional backup/restore skip because PostgreSQL client tools
  were unavailable. Logs: `/tmp/orgward-pr06-mixed-human-agent-focused.log`,
  `/tmp/orgward-pr06-mixed-human-agent-check.log`, and
  `/tmp/orgward-tests-3kyrr4/node-test.tap.log`. `git diff --check` passed. This
  slice had no rendered-browser or live-provider check; PR-06 and release gates
  remain open.

  PR-06 saved-input proposal increment (bounded; PR-06 remains open): a successful
  linked OpenAI task run now persists a review-only proposal for one information
  output, citing only the pinned task input envelope. The complete provider prompt
  is capped at 16 KiB UTF-8 and rejects oversized saved content before creating a
  task run; task, target, and source text are marked untrusted. Only a workspace
  owner can apply the proposal, as a new immutable proposed-design blueprint
  version with citation provenance; assignments and runtime state do not change.
  Focused proposal tests passed 4/4. The single `npm run check` passed 212/213,
  with 0 failures and 1 PostgreSQL backup/restore skip because client tools were
  unavailable. Logs: `/tmp/orgward-tests-z29zlz/node-test.tap.log`,
  `/tmp/orgward-proposal-full-check.log`, and
  `/tmp/orgward-tests-ppypQD/node-test.tap.log`. `git diff --check` passed.
  Rendered-browser verification was unavailable; only the loopback provider fixture
  ran, with no live provider call. PR-06 and release gates remain open.

  PR-06 proposal review-state UX increment (bounded; PR-06 remains open): the
  review shows Apply only to the current project owner while the exact pinned
  blueprint ID/version is still current. Editors and readers can review without an
  owner-only action; stale proposals show a clear message and no Apply action.
  Applied state still derives from the append-only project event, and the API
  continues to enforce owner access and version freshness. Focused review-state and
  served-client tests passed 3/3. The single `npm run check` passed 214/215, with
  0 failures and 1 PostgreSQL backup/restore skip because `pg_dump` was unavailable.
  Logs: `/tmp/orgward-tests-6KqZcY/node-test.tap.log`,
  `/tmp/orgward-proposal-review-ui-full-check.log`, and
  `/tmp/orgward-tests-NEgn67/node-test.tap.log`. `git diff --check` passed.
  Rendered-browser verification was unavailable; no live provider call was made.
  PR-06 and release gates remain open.

  PR-06 proposal return-navigation increment (bounded; PR-06 remains open): the
  saved proposal review links back to the same project route. It labels the link
  “Open updated design” after an apply event and “Open current design” otherwise;
  it omits the link if project state or the project ID is unavailable. Focused
  return-navigation and served-client tests passed 5/5. The single
  `npm run check` passed 216/217, with 0 failures and 1 PostgreSQL backup/restore
  skip because `pg_dump` was unavailable in the checked tool paths (58.06s TAP).
  Logs: `/tmp/orgward-tests-95Zppm/node-test.tap.log` and
  `/tmp/orgward-proposal-return-nav-full-check.log`. Tracked and untracked
  whitespace checks passed. Rendered-browser verification was unavailable; no live
  provider call was made. PR-06 and release gates remain open.

  PR-06 saved-process Execution entry-point increment (bounded; PR-06 remains
  open): the selected saved process exposes “Plan this process in Execution,”
  carrying its project and process ID so the task planner preselects that process.
  Execution validates the project and process against current visible state; stale
  or malformed references fall back safely and clear the route. The link honors
  the existing unsaved-change confirmation. Focused process-route and served-client
  tests passed 14/14. The single `npm run check` passed 221/222, with 0 failures and
  1 optional PostgreSQL backup/restore skip because client tools were unavailable
  (`ORGWARD_PG_TOOLS_BIN` not set; 62.67s TAP). Log:
  `/tmp/orgward-tests-Kl1ZAG/node-test.tap.log`. Tracked and untracked whitespace
  checks passed. Rendered-browser verification was unavailable. PR-06 and release
  gates remain open.

  PR-06 paused-run instruction amendment increment (bounded; PR-06 remains open):
  the requester can add an objective, requirements and reason as an append-only
  intervention revision while a linked task is paused and unstarted. The pinned
  plan work item remains unchanged; the event records actor/time/reason and a
  hash-linked instruction snapshot. Resume revalidates the pinned task, dependencies,
  workload binding, profile and credential generation, then creates a successor
  approval request whose hash covers the latest revision; earlier approval hashes
  cannot dispatch it. The worker and provider receive the amended objective and
  requirements. The complete proposal prompt remains under the 16 KiB UTF-8 limit;
  oversized amendments are rejected before persistence or provider dispatch. The
  paused-run UI exposes the edit form and displays each amendment in activity history.
  Focused persistence, contract, and served-client tests passed 50/50 in 55.4s.
  The single `npm run check` passed 222/223, with 0 failures and 1 optional
  PostgreSQL backup/restore skip because client tools were unavailable
  (`ORGWARD_PG_TOOLS_BIN` not set; 62.64s TAP, 62.71s runner wall). Logs:
  `/tmp/orgward-pr06-p08-amend-check.log` and
  `/tmp/orgward-pr06-p08-amend-check.tap.log`. `git diff --check` passed.
  Rendered-browser verification was unavailable; the provider path used only a
  loopback fixture, with no live provider call. PR-06 and release gates remain open.

  PR-06 dependency-wait visibility increment (bounded; PR-06 remains open): tasks
  without a runtime now show `WAITING` while one or more dependencies have not
  succeeded. Dependency-free tasks and tasks with succeeded dependencies remain
  `PLANNED`; a task's own runtime status takes precedence. The task row retains its
  dependency guidance. Focused process-task state and served-client tests passed
  2/2. The single `npm run check` passed 221/222, with 0 failures and 1 optional
  PostgreSQL backup/restore skip because client tools were unavailable
  (`ORGWARD_PG_TOOLS_BIN` not set; 58.32s TAP). Log:
  `/tmp/orgward-tests-2KzlbI/node-test.tap.log`. Tracked and untracked whitespace
  checks passed. Rendered-browser verification was unavailable. PR-06 and release
  gates remain open.

  PR-06 reload-safe linked plan-instance route increment (bounded; PR-06 remains
  open): linked run details now route to the exact project, plan revision and
  instance. Reloading validates visible project access and confirms the saved plan
  and instance still exist before restoring selection and focus. Changing project
  or instance updates the route; starting a normal new run clears the instance
  target. Stale or malformed references fall back with an unavailable-reference
  message. Focused linked-plan route/UI tests passed 5/5. The single `npm run
  check` passed 221/222, with 0 failures and 1 optional PostgreSQL backup/restore
  skip because client tools were unavailable (`ORGWARD_PG_TOOLS_BIN` not set;
  58.67s TAP). Log: `/tmp/orgward-tests-hYO2Mb/node-test.tap.log`. Tracked and
  untracked whitespace checks passed. Rendered-browser verification was unavailable.
  PR-06 and release gates remain open.

  PR-06 saved-source process return increment (bounded; PR-06 remains open): saved
  process-plan cards link to the exact source process in that project's saved map.
  The link is shown only when project, pinned blueprint/version, current blueprint
  and map graph all contain matching valid process references; malformed or stale
  source context omits it. Focused saved-source navigation and served-client tests
  passed 4/4. The single `npm run check` passed 220/221, with 0 failures and 1
  optional PostgreSQL backup/restore skip because client tools were unavailable
  (`ORGWARD_PG_TOOLS_BIN` not set; 59.86s TAP). Log:
  `/tmp/orgward-tests-blDjLg/node-test.tap.log`. Tracked and untracked whitespace
  checks passed. Rendered-browser verification was unavailable. PR-06 and release
  gates remain open.

  PR-06 linked plan-instance return increment (bounded; PR-06 remains open): a
  process-task run detail offers “Open linked plan instance” when its project is
  visible and its plan, revision and instance references are valid. Returning keeps
  the project context and selects the exact saved revision and instance; unavailable
  or malformed links are omitted. Focused linked-plan navigation and served-client
  tests passed 3/3. The single `npm run check` passed 219/220 with 0 failures and 1
  optional PostgreSQL backup/restore skip because client tools were unavailable
  (`ORGWARD_PG_TOOLS_BIN` not set; 59.07s TAP). Logs:
  `/tmp/orgward-tests-T6wI5W/node-test.tap.log`. Tracked and untracked whitespace
  checks passed. Rendered-browser verification was unavailable. PR-06 and release
  gates remain open.

  PR-06 project-context navigation increment (bounded; PR-06 remains open): the
  Enterprise design Execution link carries the active project. A valid, accessible
  project route opens Execution's process-plan view with both project selectors
  aligned; its Enterprise design link returns to the same project. Missing,
  malformed or unavailable project IDs retain the existing fallback behavior.
  Focused route and served-client tests passed 19/19. The single `npm run check`
  passed 217/218, with 0 failures and 1 PostgreSQL backup/restore skip because
  `pg_dump` was unavailable in the checked tool paths (58.49s TAP). Logs:
  `/tmp/orgward-tests-RVV1h6/node-test.tap.log` and
  `/tmp/orgward-execution-project-context-full-check.log`. Tracked and untracked
  whitespace checks passed. Rendered-browser verification was unavailable. PR-06
  and release gates remain open.

  PR-06 proposal-apply conflict recovery increment (bounded; PR-06 remains open):
  definitive 4xx denials discard the failed idempotency command and reload current
  run, project and membership state. Version-stale proposals lose the Apply action;
  a changed project version can be retried with a fresh expected version, and lost
  owner access is rechecked. Network errors, timeouts, 429 and 5xx retain the same
  command for idempotent replay. Focused recovery and served-client tests passed 4/4.
  The single `npm run check` passed 215/216, with 0 failures and 1 PostgreSQL
  backup/restore skip because `pg_dump` was unavailable. Logs:
  `/tmp/orgward-tests-ozyKfe/node-test.tap.log`,
  `/tmp/orgward-proposal-apply-recovery-full-check.log`, and
  `/tmp/orgward-tests-KlGHv7/node-test.tap.log`. `git diff --check` passed.
  Rendered-browser verification was unavailable; no live provider call was made.
  PR-06 and release gates remain open.

  PR-06 required human checkpoint insertion (bounded; PR-06 remains open): an
  authorized graph editor can add one distinct bound-human checkpoint before a
  chosen task in a new immutable revision. The checkpoint inherits the target's
  dependencies, and the target waits on it; the same-instance verified-success
  gate requires human evidence before downstream agent work can be requested.
  The pinned blueprint actor/role and current enabled binding are validated;
  replay does not duplicate the node, prior revisions and instances stay pinned,
  and the new revision survives application restart. The mixed human-to-agent
  PostgreSQL journey confirms the dependent agent remains blocked after its
  original human prerequisite succeeds and becomes startable only after the
  inserted checkpoint succeeds with evidence. Focused model tests passed 20/20,
  the PostgreSQL persistence file passed 44/44, and served-client coverage passed.
  The single `npm run check` passed 223/224, with 0 failures and 1 optional
  PostgreSQL backup/restore skip because client tools are unavailable
  (`ORGWARD_PG_TOOLS_BIN` not set; 61.466s TAP, 61.56s runner wall). Logs:
  `/tmp/orgward-tests-js24jS/node-test.tap.log`,
  `/tmp/orgward-tests-5k8hy7/node-test.tap.log`,
  `/tmp/orgward-pr06-human-checkpoint-check.log`, and
  `/tmp/orgward-tests-kfX0IU/node-test.tap.log`. `git diff --check` passed.
  Rendered-browser verification was unavailable because `agent-browser` is not
  installed. Process-level pause across linked work remains open; the existing
  per-run pre-dispatch pause does not establish the P-08 process boundary. A safe
  larger slice needs one durable instance fence shared by starts, approvals,
  dispatch and human transitions, plus reconciliation of already dispatched work
  before resume. PR-06 and release gates remain open.

  PR-06 durable process-instance pause/resume and owner recovery increment
  (bounded; PR-06 remains open): a persisted instance fence blocks new work,
  pauses at the safe boundary after known work drains, preserves unresolved
  provider attempts without retry, and requires current authority/dependency
  checks plus fresh independent approval after recovery. Current project owners
  can recover a linked paused run with an append-only reason while retaining the
  original requester and approval history; the recovering owner cannot approve
  that fresh request. Focused PostgreSQL persistence and served-client tests each
  passed 1/1, and the provider suite passed 9/9 after repairing deferred-send
  race sequencing. The first full-check attempt stalled in that sequencing test
  and ended with 215 passed, 3 failed, 1 canceled and 1 skipped; later persistence
  tests hit temporary disk exhaustion while the stalled provider test kept its
  cluster open.
  After repairing the test and removing only three confirmed orphan PostgreSQL
  roots, the single final `npm run check` passed 223/224, with 0 failures and 1
  optional PostgreSQL backup/restore skip because PostgreSQL client tools are
  unavailable (`ORGWARD_PG_TOOLS_BIN` not set; 67.35s TAP, 67.44s runner wall).
  Logs: `/tmp/orgward-pr06-owner-recovery-npm-check.log` and
  `/tmp/orgward-tests-lVyIv4/node-test.tap.log` (failed initial attempt),
  `/tmp/orgward-pr06-owner-recovery-npm-check-final.log`, and
  `/tmp/orgward-tests-JBItgv/node-test.tap.log`. `git diff --check` passed.
  Rendered-browser verification was unavailable because `agent-browser` is not
  installed. PR-06 and release gates remain open.

  PR-06 unverified provider outcome disposition increment (bounded; PR-06 remains
  open): a current project owner can terminally mark an eligible built-in,
  read-only OpenAI model task `ABANDONED_UNVERIFIED` after an `outcome_unknown`
  handoff, with a required reason, evidence, and explicit duplicate-cost/work
  acknowledgement. The append-only control event binds the actor, authz generation,
  unresolved run/attempt IDs and acknowledgement; the attempt remains unchanged.
  Generic provider-http and tool/effect-capable tasks are denied. Late provider
  output, new work, resume and human complete/escalate/resolve actions receive the
  terminal-specific denial; retry requires a distinct instance and fresh
  independent approval. Focused persistence passed 1/1 after the terminal-fence
  repair (10.16s), served-client/API passed 1/1 (0.51s), and migration upgrade tests
  passed 5/5 (3.41s). The single final `npm run check` passed 223/224 with 0
  failures and 1 optional PostgreSQL backup/restore skip because client tools were
  unavailable (`ORGWARD_PG_TOOLS_BIN` not set; 65.80s TAP, 68.58s runner wall).
  The initial focused persistence run exposed a migration 027 syntax error and hung
  after reporting it; the guarded CASE syntax was repaired and focused persistence
  passed. `git diff --check` and targeted Node syntax checks passed. Logs:
  `/tmp/orgward-pr06-abandonment-full-check-20260924.log`,
  `/tmp/orgward-tests-8VOk9i/node-test.tap.log`. Rendered-browser verification was
  unavailable because `agent-browser` is not installed, and no live provider call
  was made. PR-06 and release gates remain open.

  PR-06 saved-design → human checkpoint → dependent agent result/restart increment
  (bounded; PR-06 remains open): extended the existing PostgreSQL integration
  journey rather than adding another fixture. It creates and edits a saved process
  plan revision with a required inserted human checkpoint, proves the dependent
  OpenAI-compatible agent request remains gated until that checkpoint succeeds,
  then independently approves and executes the request against the loopback
  fixture. After closing and reopening the application, the same pinned instance
  retains the checkpoint's success evidence/event, dependent run, generated
  proposal/citations and evidence hash. Focused persistence passed 1/1 in 10.35s;
  `git diff --check` and `node --check tests/persistence.test.mjs` passed. The one
  full `npm run check` passed 223/224, with 0 failures and 1 optional PostgreSQL
  backup/restore skip because client tools were unavailable (`ORGWARD_PG_TOOLS_BIN`
  not set; 67.49s test runner, 70.02s wall). Logs:
  `/tmp/orgward-pr06-human-agent-restart-check-20260924.log`,
  `/tmp/orgward-tests-oaSTPM/node-test.tap.log`. The integration receipt is
  API/service-level. Rendered-browser verification of the UI-authored revision 3
  journey also passed: the required bound-human checkpoint was inserted before
  the dependent task in the editor, saved as an immutable revision, completed
  with the existing required human checkpoints and evidence, and gated the
  dependent OpenAI-compatible task until success. A different authorized actor
  independently approved it; the loopback provider was called once. After an
  app-only restart, the same browser session showed the revision, checkpoint
  evidence, approval history, result, proposal and evidence hash still present;
  post-restart API reads returned 200 and no console/page errors were observed.
  Screenshots: `/tmp/orgward-pr06-plan-revision3-with-ui-checkpoint.png`,
  `/tmp/orgward-pr06-ui-checkpoint-completed.png`,
  `/tmp/orgward-pr06-ui-created-approval.png`, and
  `/tmp/orgward-pr06-ui-checkpoint-agent-after-restart.png`. No live provider
  call or screen-reader proof was performed. PR-06 and release gates remain open;
  the active cursor remains PR-06.

## Governed software delivery

- [ ] PR-07 — Intent-to-plan engineering workflow (T-25–T-28). Connect approved
  enterprise intent to context/impact, traced requirements, architecture alternatives
  and recovery design, then compile accepted work into the shared durable engine.

- [ ] PR-08 — SCM, agent changes and immutable assurance (T-29–T-32; E-06, E-09).
  Let a user onboard a repository, request a bounded agent change, review its diff,
  and inspect reproducible build/test results. Keep credentials scoped and publish
  the required security checks, SBOM, provenance, signatures and immutable candidate
  evidence as part of that path.

- [ ] PR-09 — Authorized environments, release and rollback (T-33–T-35; E-10).
  Let a user review an exact candidate, approve a protected environment action,
  observe its result and recover through rollback. Bind authority to principals,
  actions, assets, risks and environments; reconcile ambiguous effects and prove
  health, progressive delivery where applicable, and restart-safe idempotency.

- [ ] PR-10 — Outcomes and customer next actions (T-36–T-38). Connect
  technical/control/business observations to reviewed learning in a usable customer
  journey with a durable inbox and next actions. Include the authority, audit and
  recovery behavior needed for this journey; broader operations acceptance is in
  PR-11.

## Complete enterprise portfolio

- [ ] PR-12 — Canonical enterprise model and synchronized perspectives (T-49–T-64).
  Add temporal/scoped truth, organization/legal scopes, sixteen consistent lenses,
  advanced processes/decisions, branching and merge, refinement/reverse trace,
  economics/resources/value lifecycles, simulation, bulk collaboration and
  explainable multi-axis completeness.

- [ ] PR-13 — Evidence ingestion and integrity operations (T-65–T-75). Safely
  onboard sources, extract evidence-backed identity/claim proposals, review and
  publish atomic snapshots, run typed integrity/lineage rules, manage exceptions,
  and provide an actionable remediation inbox with drift and coverage feedback.

- [ ] PR-14 — Governance and supervised agents (T-76–T-89). Implement versioned
  policy decisions/enforcement, decision rights and appeals, semantic/data
  stewardship, verifiable governance ledger, agent identities/autonomy envelopes,
  multi-agent handoffs, shared budgets and independent adversarial evaluation.

- [ ] PR-15 — Integrated portfolio round trip and extensibility (T-90–T-105,
  T-107–T-108, then T-106). Join enterprise truth, integrity and SDLC context;
  support multi-repository/legacy delivery, progressive promotion, incidents,
  governed enterprise transactions, connectors, role-based portfolio UX, modular
  self-hosting, packs, simulation, continuity, portability and retirement. Finish
  the customer-visible portfolio round trip before broad security, scale and
  complete portfolio qualification.

## Consistent customer-defined work

- [ ] PR-17 — Consistent changes and customer-defined work (T-121–T-127). Route
  form/map/chat/matrix/API/import/learning edits through one semantic command model;
  compute field-level impact, enforce atomic publication watermarks, reconcile truth
  continuously, and support typed customer concepts/actions, executable work forms,
  safe templates, role adoption and graduated autonomy.

## Managed SaaS, migration and final qualification

- [ ] PR-16 — Managed SaaS foundation (T-109–T-114). Add whole-business inventory,
  isolated tenant/cell provisioning, enterprise identity onboarding, entitlements,
  metering/quotas, safe subscription lifecycle, operator/support controls, residency,
  customer-owned keys and tenant relocation without granting business authority.

- [ ] PR-18 — Existing-enterprise migration and activation (T-115–T-120). Discover
  sources and ownership, map identities and transformations, stage imports, operate
  with fenced source-of-record coexistence, rehearse and validate, then cut over with
  rollback/hypercare and owner-approved activation evidence.

- [ ] PR-11 — Core operations and production qualification (T-39–T-48;
  P-01–P-12, E-01–E-16). Complete verifiable audit export, admin controls,
  backup/restore, upgrade recovery, telemetry/incidents and stable
  import/export/integration contracts. Qualify accessible supported-browser
  workflows, security/supply chain, scale/soak, redundant recovery and an isolated
  customer installation. Close gates only from evidence produced by the releasable
  revision and after its product journeys exist.

- [ ] PR-19 — Full enterprise SaaS release qualification (T-128–T-132). Generate and
  execute the enterprise variation/conformance matrix; qualify SaaS isolation,
  fairness, public edge, service operations, migration and cross-perspective
  consistency; enforce bounded implementation handoffs; adjudicate the final release
  only after the complete T-01–T-132 dependency closure and applicable P/E gates pass.

## Completed closed-loop foundation

- [x] CL-01 — Durable intent clarification and reconciliation.
- [x] CL-02 — Proof obligations, results and derived acceptance.
- [x] CL-03 — Bounded repair/clarify/re-plan/re-architect/stop routing.
- [x] CL-04 — Durable loop counters, pending recovery and exactly-once claims.
- [x] CL-05 — Workspace questions, proof gaps, failures and next allowed action.
- [x] CL-06 — End-to-end intent, clarification, failure, repair, human decision and
  restart behavior across API and UI.

## Review rule

Review code after implementation for correctness, persistence, concurrency,
authority, isolation, failure handling and usability. Record concrete remaining
work here; do not create metadata-only completion loops.
