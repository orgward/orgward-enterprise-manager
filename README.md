# OrgWard Enterprise Studio

Development workspace with enterprise-design, synthetic SDLC-reference, and controlled-execution surfaces. It is **not production-ready**; production maturity is tracked separately in `PRODUCTION-READINESS.json` against `docs/production/ROADMAP.md`.

## Unified product specification

[Engineering workflow](docs/engineering/WAYS-OF-WORKING.md) now supplies four
repo-local skills, reusable prompts/templates, governed requirement/design changes,
task/subtask model routing and honest review/evidence handoffs. Read
[change control](docs/engineering/CHANGE-CONTROL.md) when implementation reveals
a better requirement or architecture. Improvements are allowed with traceable
impact/review, not silent acceptance weakening. Run `npm run check:engineering`;
the routing helper does not start agents or approve implementation.

Hard requirement: [configurable enterprise/SDLC workflows](docs/product/CONFIGURABLE-WORKFLOWS.md)
with equivalent diagram/forms, substeps, bounded loops, conditions, registered
actions, simulation, versions and safe run migration. [ADR-010](docs/production/ADR-010-CONFIGURABLE-WORKFLOW.md)
selects bpmn-js modeling and a planned Temporal runtime adapter; neither is installed
by this specification. Sixteen additional WF acceptance obligations are mandatory.
Latest [handoff 17](docs/production/DOMAIN-FIXTURE-HANDOFF-17.md): **480/480 original
scenarios defined across all 132 tasks**, with 2,608 expected observations, plus
the sixteen unrun workflow obligations. This completes original scenario-definition
coverage, not implementation readiness. Approved packets and actual enterprise
acceptance runs remain zero. Earlier checkpoint counts below are historical.

[Activation, consistency and everyday work](docs/product/ACTIVATION-CONSISTENCY-INTERACTIONS-17.md)
explains scope activation, all-angle edits, knowledge reconciliation, custom concepts,
worker forms, configurable SDLC and final enterprise qualification. Next: integrate
a bounded foundation packet with full schemas/seeds/observation adapters and genuine
independent review before coding. No runtime/UI feature is added by definitions.

[SaaS and migration interactions](docs/product/SAAS-MIGRATION-INTERACTIONS-16.md)
details scoped business coverage, tenant/identity/usage/support/residency, source
discovery/mapping/coexistence and migration validation/shadow/rehearsal. At checkpoint
16, 48 scenarios across 12 tasks still needed this layer. No new runtime or qualification;
full contract/seed/adapter integration and independent packet review remain required.

[Resilience, qualification and exit](docs/product/RESILIENCE-QUALIFICATION-INTERACTIONS-15.md)
details interpreted domain packs, simulation/case learning, continuity, independent
security/load/customer qualification, extensions and safe reorganisation/portability.
At checkpoint 15, 88 original scenarios still needed this layer; full packet integration
and independent review remain required. No product qualification is delivered by definitions.

[Delivery and customer interactions](docs/product/DELIVERY-CUSTOMER-INTERACTIONS-14.md)
details design-linked SDLC, multi-repository recovery, human-owned regeneration,
business effects, connectors, accessible laptop workflows and self-host operations.
Contracts are included throughout planning; full seeds/adapters, contract integration
and independent packet review still precede implementation. At checkpoint 14, 124 original
scenarios still needed this definition layer. No new runtime/UI feature was implemented.

[Governance and agent interactions](docs/product/GOVERNANCE-AGENT-INTERACTIONS-13.md)
details current reviewer eligibility, ownership/access changes, independent audit
verification and shared-budget specialist work through configurable SDLC. These are
required future features; at checkpoint 13, 164 original scenarios still needed this layer.

[Sentinel to Warden to SDLC](docs/product/SENTINEL-WARDEN-INTERACTIONS-12.md)
details evidence-backed findings, reviewed repairs, timeboxed exceptions and
protected policy decisions. All 28 Sentinel rules now have trigger/control
definitions under a pinned local profile; they have not run against an engine.
At checkpoint 12, 212 original scenarios still needed this layer. No new UI/backend is implemented.

[Business and Sentinel interactions](docs/product/BUSINESS-SENTINEL-INTERACTIONS-11.md)
walk through commitments, staffing, physical work, configurable processes, outcome
measurement, safe source intake and claim review back into SDLC. These are required
future scenarios, not functioning screens. At checkpoint 11, 244 scenarios still needed this
definition layer; full seeds/adapters and independent reviews remain pending.

[SDLC process and user interactions](docs/product/SDLC-INTERACTIONS-09.md) explains
business intent through real code review, protected release and measured outcome,
including human decisions, changes during work and failure recovery.
[Domain test definitions](docs/production/DOMAIN-FIXTURE-HANDOFF-09.md) now cover
164 original scenarios across 53 tasks, adding all T-25–T-48 core SDLC, release,
audit, recovery and qualification scenarios to the prior foundation coverage.
316 scenarios still lack this layer; actual schemas/seed adapters and independent
packet reviews remain required. A source-bound index detects scenario drift.
These are unrun product tests; comparator self-tests are not acceptance evidence.

Start with the concise [product intent](docs/product/PRODUCT-INTENT.md).
The [engineering decisions and model assignments](docs/production/ENGINEERING-DECISIONS-06.md)
now specify the 73 missing secondary commands and recommend models for all
132 tasks. They remain pending independent review; domain acceptance fixtures
and actual implementation are still required. Earlier draft counts below are
historical and must not be read as approved implementation readiness.

Increment 05 adds the [132-task packet register](docs/production/WORK-PACKAGE-INDEX.md)
and [packet review](docs/production/WORK-PACKAGE-REVIEW.md). These are saved,
schema-checked boundary drafts, not approved implementation packets. All 480
scenarios remain unrun; 205 explicit elaboration/review decisions remain,
including 73 additional command contracts. The roadmap still requires real
implementation and independent qualification.

Revision 4 makes the target enterprise SaaS for new and existing businesses. Read the [architecture review](docs/product/ARCHITECTURE-REVIEW-04.md), [solution architecture](docs/production/SOLUTION-ARCHITECTURE.md), [change/knowledge protocol](docs/production/CHANGE-PROTOCOL.md), [migration and coverage contract](docs/product/MIGRATION-AND-COVERAGE.md) and [implementation handoff](docs/production/IMPLEMENTATION-HANDOFF.md). Current backlog: **132 tasks and 480 unrun acceptance cases**; T-132 qualifies the expanded target. The revision-3 inventory below is historical. Specification validation is not implementation; no task has a reviewed implementation packet yet.

Start with the [full portfolio roadmap](docs/production/PORTFOLIO-ROADMAP.md) and [revision-3 review](docs/product/UX-REVIEW-03.md). They preserve the original outcomes and expand design, multi-perspective maps, versioning, progressive system detail, bidirectional SDLC, Sentinel, Warden, Arbiter, Steward, Ledger and Overseer. The [current task index](docs/production/TASK-INDEX.md) and [canonical backlog](docs/production/IMPLEMENTATION-BACKLOG.json) contain 132 tasks and 480 task acceptance cases, all unrun (the historical revision-3 baseline had 108 tasks/384 cases). [Enterprise scenarios](docs/product/ENTERPRISE-SCENARIOS.md), [model contract](docs/product/ENTERPRISE-MODEL.md), [portfolio UX](docs/product/PORTFOLIO-UX.md) and [qualification](docs/production/PORTFOLIO-QUALIFICATION.md) define the supported target and failure/recovery behavior. The [revision-2 UI findings](docs/product/UX-REVIEW-02.md)—including static success/data, missing forms and keyboard defects—remain open. Documentation and structural checks do not make the application production-ready.

Open `/platform.html` for the initial future-product catalogue. It sketches enterprise setup, business design, governed change, requirements and architecture, human/agent work, repository and assurance, release, outcomes, evidence, administration, and recovery. Capability labels and inspectors describe intent but have known inaccuracies recorded in the review; sample statuses must not be treated as actual operations. The revised UX contract is `docs/product/UX-SPEC.md` with its linked detailed contracts.

This specification is intentionally broader than the implemented backend. It is the experience and boundary contract for subsequent production increments, not evidence that the displayed external effects or enterprise services already exist.

## Enterprise design

The first workflow:

1. create a project and describe a business through four focused chat questions;
2. save the resulting scope, assumptions, unknowns, and a versioned organisational blueprint;
3. explore the linked design in blueprint, graph, and list views.

The generator is a deterministic, knowledge-backed design assistant. It reuses the OrgWard research primitives and integrity rules without sending data to an external model. Real LLM-backed task execution belongs to the original release gate P-09 and is not enabled in that workflow yet.

## Financial SDLC reference

Open `/sdlc.html` for the fully executable MVPX reference track based on `orgward/orgward-autonomous-stack@11fb942f4ea7aee0767ae6132294778dec08d74c`.

It implements the synthetic beneficial-owner scenario through:

```text
Intent → Context → Impact → Governance → Requirements → Architecture
→ Plan → Implementation → Assurance → Authority/Release
→ Observation → Outcome → Learning
```

The SDLC surface provides durable ChangeCases, stage/gate history, provenance and evidence hashes, enterprise impact analysis, requirement and architecture critics, bounded context packages, a provider-neutral command execution adapter, twelve-dimensional assurance, segregation-of-duties release approval, immutable release evidence, outcome evaluation, and follow-up proposals. Its completion percentage refers only to that synthetic reference contract.

Its mutation lab proves that missing AML evidence, stale standards, forged provenance, omitted dependencies, unresolved interpretation, defective requirements, invalid architecture, cyclic plans, failed checks, artifact tampering, and unauthorized release stop at their intended gates. All data and release effects are synthetic.

## Controlled execution foundation

Open `/execution.html` for the first real-execution increment. When the server operator enables `ORGWARD_ENABLE_LOCAL_EXECUTION=true`, a user can request a server-configured system-generation profile, a different identity must approve the immutable request, and the worker invokes a fixed absolute executable without a shell inside a per-run workspace. The included generator creates a runnable Node.js service, tests, container recipe, traced manifest, logs, artifact hashes, and an append-oriented event history.

On Linux, command profiles run through `/usr/bin/bwrap`: the worker gets separate user, mount, PID, IPC, and network namespaces, read-only runtime and approved source files, a read-only context file, and only its per-run workspace writable. The adapter fails closed when bubblewrap or a required mount is unavailable. This boundary does not yet enforce CPU, memory, or persistent-workspace quotas and is not a complete hostile-code qualification. Managed identity lifecycle, a durable queue, Git integration, a real coding-model provider, deployment, HA, and production operations also remain explicit roadmap gates.

## Run privately

Node 22 or newer is required. Install the PostgreSQL driver and test tools with `npm ci`.
Before startup, run `npm run preflight` with the same environment that will be
used by the service. It checks runtime/authentication settings, required OIDC
tenant mappings, paired OpenAI profile settings, local execution workspace
access when enabled, and PostgreSQL connectivity/version/migration checksums.
It does not apply migrations or modify application data. Remedies are printed
without connection URLs or credential values. `/livez` reports process
liveness; `/readyz` checks the PostgreSQL migration ledger and returns 503 when
the dependency is unavailable.

```bash
cd /srv/orgward/orgward-enterprise-studio
: "${ORGWARD_SECRET_ENCRYPTION_KEY:?Load the 32-byte key from your secret manager first}"
export ORGWARD_AUTH_MODE=development
export ORGWARD_SECRET_ENCRYPTION_KEY
export ORGWARD_DATABASE_URL=postgresql://orgward_app@127.0.0.1/orgward
npm run preflight && npm start
```

This local-development command uses unverified request-header identity and is
restricted to the default loopback listener. Configure OIDC as described below
for authenticated API use.

Open `http://127.0.0.1:4310/platform.html` for the unified product surface, `http://127.0.0.1:4310` for enterprise design, `http://127.0.0.1:4310/sdlc.html` for the SDLC reference, or `http://127.0.0.1:4310/execution.html` for controlled execution. The default listener is loopback-only. PostgreSQL is the authoritative store and must point at an empty database or one already migrated by this version:

```bash
ORGWARD_AUTH_MODE=development \
ORGWARD_SECRET_ENCRYPTION_KEY="$ORGWARD_SECRET_ENCRYPTION_KEY" \
ORGWARD_DATABASE_URL=postgresql://orgward_app@127.0.0.1/orgward PORT=4320 npm run preflight
ORGWARD_AUTH_MODE=development \
ORGWARD_SECRET_ENCRYPTION_KEY="$ORGWARD_SECRET_ENCRYPTION_KEY" \
ORGWARD_DATABASE_URL=postgresql://orgward_app@127.0.0.1/orgward PORT=4320 npm start
```

Startup applies checksum-protected migrations from `migrations/` before listening. The database principal needs the schema privileges required by those migrations and runtime reads/writes; use a dedicated least-privilege database and principal rather than a PostgreSQL superuser. The application uses a bounded connection pool and fails startup if the database or an applied migration checksum is unavailable.

Build a private application archive with `npm run release:bundle`. It is written
to `dist/orgward-enterprise-studio-<version>.tar.gz` with an adjacent SHA-256
file. The archive includes the production lockfile, runtime source, migrations,
workers, static assets, preflight command and example service/proxy configs; it
excludes tests, repository history, data, credentials and installed dependencies.
The included `INSTALL.md` documents Node 22+, PostgreSQL 16+, loopback behind an
HTTPS reverse proxy, OIDC first-owner mapping, secret-manager key delivery,
repeated startup and backup-aware upgrades. Bundle smoke coverage uses the
disposable PostgreSQL and existing host dependency cache; if offline npm install
is unavailable, the test qualifies archive contents and runtime against copied
test-host dependencies. It is not a clean-host, TLS or external OIDC qualification.

Existing private JSON records are import sources, not an authoritative fallback. Configure their locations with `ORGWARD_DATA_DIR`, `ORGWARD_SDLC_DATA_DIR`, and `ORGWARD_EXECUTION_DATA_DIR`, then use **Administration → Legacy JSON import** to preview and apply a tenant-scoped import. Valid project, case, and run IDs and source hashes are preserved; malformed or conflicting records are quarantined in PostgreSQL and source files are never changed or deleted. Retrying an uncertain import with the same command ID returns its durable original result.

For short-lived inspection of an older local workspace only, `ORGWARD_ALLOW_LEGACY_JSON=true npm start` enables legacy compatibility mode in read-only operation. All `/api/` writes and worker dispatch requests are rejected, and startup does not recover or rewrite interrupted execution records. The health and foundation APIs report `read_only_legacy`. Do not use that mode as authoritative product storage.

The local generator is disabled by default. Enable it explicitly only on a development host:

```bash
ORGWARD_ENABLE_LOCAL_EXECUTION=true npm start
```

To opt into an OpenAI execution profile, set `ORGWARD_OPENAI_CREDENTIAL_REFERENCE`
to a tenant-admin-managed secret reference and `ORGWARD_OPENAI_MODEL` to the exact
model ID. Set `ORGWARD_SECRET_ENCRYPTION_KEY` to canonical base64 for a 32-byte key.
The OpenAI profile is registered only when both profile settings are present and
startup requires PostgreSQL plus the encryption key. In **Administration → Provider
credentials**, stage the OpenAI key, validate access to that model, then activate it.
New runs bind the current validated version and require separate approval. The
adapter uses the fixed OpenAI Responses API with storage disabled and no tools.
Replacing a key marks its predecessor's upstream revocation status unconfirmed;
OrgWard does not call the provider's admin revocation API.

Legacy enterprise projects default to `data/projects/`; SDLC cases default to `data/sdlc/`; execution runs default to `data/execution-runs/`. They remain out of source control and are read only as import sources in PostgreSQL mode. This private product does not add public deployment. Browser OIDC login and API bearer authentication are available when configured; workload credential lifecycle, user provisioning/offboarding, revocation before token expiry, and project-level membership remain incomplete.

### OIDC API authentication

The server entry point defaults to OIDC mode and fails closed unless the API
and browser sign-in settings are present. Configure the browser client as a
public authorization-code client with PKCE and register the exact callback URI.
The issuer must exactly match each token's `iss` claim; the configured audience
must match `aud`; the JWKS URI supplies RS256 signing keys.
Verified tenant and role claim names default to `orgward_tenant` and `groups`.
Provider groups do not grant or remove OrgWard roles. Persisted role assignments
are authoritative and tenant administrators replace them in
**Administration → Identity access**. To make the first administrator, configure
one exact issuer, subject, and mapped tenant tuple before that identity signs in:
Set the canonical 32-byte encryption key through the secret manager before
starting, and use a public HTTPS origin that exactly matches the registered
callback.

```bash
: "${ORGWARD_SECRET_ENCRYPTION_KEY:?Load the key from your secret manager first}"
ORGWARD_PUBLIC_URL=https://studio.example.com \
ORGWARD_SECRET_ENCRYPTION_KEY="$ORGWARD_SECRET_ENCRYPTION_KEY" \
ORGWARD_OIDC_ISSUER=https://identity.example/ \
ORGWARD_OIDC_AUDIENCE=orgward-api \
ORGWARD_OIDC_JWKS_URI=https://identity.example/.well-known/jwks.json \
ORGWARD_OIDC_CLIENT_ID=orgward-browser \
ORGWARD_OIDC_REDIRECT_URI=https://studio.example.com/auth/callback \
ORGWARD_OIDC_AUTHORIZATION_ENDPOINT=https://identity.example/authorize \
ORGWARD_OIDC_TOKEN_ENDPOINT=https://identity.example/token \
ORGWARD_OIDC_ROLE_MAP='{}' \
ORGWARD_OIDC_TENANT_BINDINGS='{"identity-provider-org-42":"customer-acme"}' \
ORGWARD_OIDC_BOOTSTRAP_PRINCIPALS='[{"issuer":"https://identity.example/","subject":"ops-admin-user-123","tenantId":"customer-acme"}]' \
ORGWARD_DATABASE_URL=postgresql://orgward_app@127.0.0.1/orgward \
npm start
```

`ORGWARD_OIDC_TENANT_BINDINGS` is required and has no implicit default. Its keys
are exact values of the verified provider tenant claim; its values are the
server-owned OrgWard tenant IDs used for isolation. Unknown provider tenant
values are rejected and cannot create a new tenant. Review this mapping as part
of identity onboarding. Use `ORGWARD_OIDC_TENANT_CLAIM` or
`ORGWARD_OIDC_ROLE_CLAIM` only when the provider uses different signed claim names.
`ORGWARD_OIDC_BOOTSTRAP_PRINCIPALS` defaults to `[]`. Each entry must use the
configured issuer, an exact provider subject, and a tenant ID from the values of
`ORGWARD_OIDC_TENANT_BINDINGS`. A matching human receives a one-time initial
grant of `tenant-admin`, `workspace-read`, and `workspace-write`; a durable
marker prevents later sign-ins from restoring roles removed by an administrator.
Keep the bootstrap list limited to initial administrators and remove entries
after enrollment. New identities otherwise receive no roles. Tenant admins can
replace another active identity's exact local role set, with an audit reason;
self-edits, stale authorization generations, workload tenant-admin grants, and
removal of the last active administrator are rejected. Role changes and
revocation cancel affected execution leases. Provider group changes have no
effect until a trusted synchronization adapter is added.
Explicit `ORGWARD_AUTH_MODE=development`
allows request-header identities only when the listener is bound to a loopback
address. That mode is for local development and provides no authentication
boundary. The browser uses state, nonce, PKCE S256, and a short-lived
authorization-code exchange. The server stores only a digest of the opaque
session secret in PostgreSQL and sends the secret in an HttpOnly, SameSite=Lax
cookie (Secure when the callback URI uses HTTPS). Login transactions are held
in process memory for five minutes, so a restart during sign-in requires the
user to start again. Tenant administrators can revoke a tenant-bound principal
from **Administration → Identity access**; current browser sessions and later
bearer requests then fail closed. Revocation is retained in PostgreSQL and is
not undone by a later login. Local logout revokes the OrgWard session; it does
not end the identity provider's own session. Provider-side group changes are
not reflected from fresh tokens; SCIM/webhook synchronization,
provider-session termination, in-flight command/effect fencing, project-level
membership and workload credential lifecycle remain incomplete. This foundation
does not complete T-05 or T-06. A tenant-admin role grants identity-management
authority and may be combined with project-write, execution-approval, or
release-approval roles by a tenant administrator. Keep approval roles separated
according to the enterprise's segregation-of-duties policy.

For a phone, keep the service loopback-only and use an SSH client that supports local port forwarding: forward the phone's local port `4310` to VPS destination `127.0.0.1:4310`, then open `http://127.0.0.1:4310` in the phone browser. Both product surfaces are responsive at a 390 px viewport; the organisational map opens in touch-friendly List mode on narrow screens and retains the Graph toggle.

## Verify

```bash
npm run check
```

The persistence tests start a real disposable PostgreSQL cluster. Install PostgreSQL 16 or newer, or set `ORGWARD_TEST_POSTGRES_BIN` to the directory containing `initdb` and `postgres`; absence of a real server is a failed check, not a skipped database test.

During an edit, run only the affected test file or named case, then run the full check before treating the task as done:

```bash
npm test -- tests/execution/provider.test.mjs
npm test -- tests/persistence.test.mjs --test-name-pattern='execution dispatch commit uncertainty'
```

PostgreSQL tests share one temporary server per test file and use separate databases for isolation. The dispatch watchdog test deliberately waits more than five seconds; keep the default two-file test concurrency to avoid timing-sensitive fixture failures.

`npm run check:spec` separately validates outcome/screen/gate coverage, stable story IDs, dependency acyclicity, evidence requirements and index consistency; it also checks eight deliberately invalid plan mutations. It validates the delivery contract, not product behavior or completeness of implementation.

The check runs JavaScript syntax validation plus the enterprise-design and SDLC domain, mutation, command-adapter, API, persistence, concurrency, isolation, security, and failure-path tests. Actual receipts live in `ops/checks/`. The original product gates remain in `DELIVERY-STATUS.json`; the separate merged SDLC contract is tracked in `SDLC-DELIVERY-STATUS.json`.

## What the saved blueprint contains

Every generated version covers the fixed product areas:

- purpose and strategy;
- customers, offerings, value, and economics;
- capabilities and processes;
- people and agents;
- responsibility and authority;
- resources;
- information and technology;
- governance, risk, and controls;
- metrics and feedback;
- lifecycle.

Objects retain status, confidence, and provenance. Integrity checks reject missing areas, invalid status, duplicate IDs, and dangling graph links. They surface incomplete ownership, role authority, process inputs/outputs, and missing provenance as actionable gaps. Generated content is explicitly a proposed design, not an enabled assignment or evidence of business readiness.

## Enterprise-design increment boundary

This increment stops after chat → saved blueprint → interactive map. Editing and version comparison, enabled human/agent assignments, runnable processes, intervention controls, real LLM-backed work, the full readiness dashboard, and the complete end-to-end release demo remain for later bounded increments under the unchanged 12 release gates.
