# Production implementation queue

This is the active delivery queue for the full OrgWard Enterprise Studio target.
It condenses the product brief, P-01–P-12 first-release outcomes, E-01–E-16
production gates and canonical T-01–T-132 backlog into implementation-sized
increments. The T-ranges are coverage references, not paperwork gates.

Work the first unchecked, dependency-ready item. A task is complete only when its
real state/API/UI behavior exists, focused behavior and recovery tests pass,
`npm run check` passes, and the implementation diff has been reviewed. Do not count
specification validators, manifests or generated vectors as product acceptance.
Never perform live effects, deployments, purchases or external communications
without explicit user authorization.

The default `npm test` runner starts one temporary PostgreSQL cluster on loopback
for the entire test invocation and shares it across Node test workers. Each
integration test still creates a uniquely named empty database; worker teardown
drops it, and runner teardown removes any leftovers and stops/removes the cluster.
No persistent PostgreSQL daemon is left running. Focused test invocations that do
not select PostgreSQL suites do not start it. The latest full check passed 153
tests in 30.14s, compared with 31.25s before sharing the cluster.

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
  external-effect adapter exists yet. PR-03 implementation is complete. E-02/E-03
  remain pending integrated production qualification and are not promoted here.
  Managed SaaS still needs a durable customer onboarding and lifecycle workflow,
  provider-specific independent review, and stronger effect-boundary fencing.
  The current Linux sandbox does not yet enforce CPU/memory or persistent-workspace
  quotas, and is not a complete T-21 isolation qualification.

- [ ] PR-04 — Secret handling and supported installation (T-07–T-08; E-01, E-05).
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
  idempotent. The only upgrade baseline evidenced here is 001–006; other legacy
  versions and recovery scenarios remain unqualified.

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
  is separately exercised by the browser journey below.
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
  A bounded operator recovery command now writes PostgreSQL custom-format backups
  into private temporary directories, verifies them, then atomically publishes a
  restrictive dump plus manifest (application/schema/PostgreSQL versions, source
  database identity without credentials, size and SHA-256). Restore requires a
  separate protected `ORGWARD_RESTORE_DATABASE_URL_FILE`, rejects the configured
  service URL file and source database identity, validates the dump/schema and
  PostgreSQL compatibility, and restores only into an empty target in one
  transaction. A persistent protected status report records running/completed/failed
  state; disposable PostgreSQL tests cover isolated restore/restart retention,
  source/nonempty/tampered-target denial and failed restore. Credentials are supplied
  through a temporary protected pgpass file, not process arguments or logs. SHA-256
  detects corruption but does not authenticate the backup. This does not qualify a
  production recovery plan, backup retention, or operator cutover. PR-04/T-08 remain
  open.
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

- [ ] PR-05 — Editable, versioned enterprise design (T-09–T-10, T-12–T-18 except
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

- [ ] PR-06 — Durable human/agent work and private operating journey (T-19–T-24,
  then T-11; P-07–P-10, P-12; E-07–E-08). Run process/task graphs through leased,
  crash-recoverable work with pause/resume/cancel, mandatory human checkpoints,
  isolated tools and one real bounded model provider. Then enable sourced proposal
  generation and prove the complete private design-to-result journey across restart.

  P-07 planning-only graph increment: a workspace writer can select a saved process
  and persist a proposed graph pinned to its blueprint version. Nodes are derived
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
  execution authority. Role references do not select a person by themselves, and no execution
  run is created or dispatched. Focused model/PostgreSQL coverage verifies edit
  validation, cycle and role/reference denial, immutable prior revision, replay,
  expected-version conflict, access/project isolation, restricted identity privacy,
  enabled-binding revalidation, revoke/regrant staleness and restart retention. Explicit
  person assignment, run-state transitions, lease/recovery controls and the complete
  P-07 journey remain open; PR-06 and release gates remain open.

## Governed software delivery

- [ ] PR-07 — Intent-to-plan engineering workflow (T-25–T-28). Connect approved
  enterprise intent to context/impact, traced requirements, architecture alternatives
  and recovery design, then compile accepted work into the shared durable engine.

- [ ] PR-08 — SCM, agent changes and immutable assurance (T-29–T-32; E-06, E-09).
  Onboard a real repository with scoped credentials; create and review bounded agent
  changes; run reproducible build/test/security checks; publish SBOM, provenance,
  signatures and immutable candidate evidence.

- [ ] PR-09 — Authorized environments, release and rollback (T-33–T-35; E-10).
  Bind approvals to exact principals/actions/assets/risks/environments, execute one
  protected deployment adapter, reconcile ambiguous effects, and prove health,
  progressive delivery where applicable, rollback and restart-safe idempotency.

- [ ] PR-10 — Outcomes and customer operations (T-36–T-44; E-11–E-13). Connect
  technical/control/business observations to reviewed learning; add durable inbox,
  verifiable audit export, admin controls, backup/restore, upgrade recovery,
  telemetry/incidents and stable import/export/integration contracts.

- [ ] PR-11 — Core production qualification (T-45–T-48; P-01–P-12, E-01–E-16).
  Qualify accessible supported-browser workflows, security/supply chain, scale/soak,
  redundant recovery and an isolated customer installation. Close gates only from
  evidence produced by the releasable revision.

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
  with customer, security, scale and complete portfolio qualification.

## Managed SaaS, migration and final qualification

- [ ] PR-16 — Managed SaaS foundation (T-109–T-114). Add whole-business inventory,
  isolated tenant/cell provisioning, enterprise identity onboarding, entitlements,
  metering/quotas, safe subscription lifecycle, operator/support controls, residency,
  customer-owned keys and tenant relocation without granting business authority.

- [ ] PR-17 — Consistent changes and customer-defined work (T-121–T-127). Route
  form/map/chat/matrix/API/import/learning edits through one semantic command model;
  compute field-level impact, enforce atomic publication watermarks, reconcile truth
  continuously, and support typed customer concepts/actions, executable work forms,
  safe templates, role adoption and graduated autonomy.

- [ ] PR-18 — Existing-enterprise migration and activation (T-115–T-120). Discover
  sources and ownership, map identities and transformations, stage imports, operate
  with fenced source-of-record coexistence, rehearse and validate, then cut over with
  rollback/hypercare and owner-approved activation evidence.

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
