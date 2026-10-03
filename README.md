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

On Linux, command profiles run through `/usr/bin/bwrap`: the worker gets separate user, mount, PID, IPC, and network namespaces, read-only runtime and approved source files, a read-only context file, and only its per-run workspace writable. The adapter fails closed when bubblewrap or a required mount is unavailable. This boundary does not yet enforce CPU, memory, or persistent-workspace quotas and is not a complete hostile-code qualification. Managed identity lifecycle, a durable queue, remote Git integration, a real coding-model provider, deployment, HA, and production operations also remain explicit roadmap gates.

For local-only repository candidates, the server operator may set
`ORGWARD_LOCAL_REPOSITORIES` to a JSON array of exact tenant/project bindings.
Each entry has `id`, `label`, `tenantId`, `projectId`, `directory`, and a
server-owned `verification` object containing `id`, `version`, absolute
`executable`, and fixed string `args`. The directory is never accepted from a
client. For example:

```json
[{"id":"reference-service","label":"Reference service","tenantId":"tenant-a","projectId":"project-00000000-0000-4000-8000-000000000000","directory":"/srv/orgward/reference-service","verification":{"id":"node-tests","version":"1","executable":"/usr/bin/node","args":["--test"]}}]
```

Project editors can select these bindings in the Execution plan view. The
server pins a bounded file/mode snapshot in the task run, executes approved
local profiles only in the no-network sandbox, and stores a review-only diff
plus the exact-tree verification receipt. It never writes the candidate back
to the configured source directory or pushes it. Remote clone/push, applying a
candidate, and CI attestations remain out of scope.

GitHub App onboarding is optional and disabled unless the server operator sets
`ORGWARD_GITHUB_APP_ID`, `ORGWARD_GITHUB_APP_SLUG`, and
`ORGWARD_GITHUB_APP_PRIVATE_KEY`, plus the App's `ORGWARD_GITHUB_APP_CLIENT_ID`
and `ORGWARD_GITHUB_APP_CLIENT_SECRET`. Set
`ORGWARD_GITHUB_APP_OAUTH_REDIRECT_URI` to the exact registered HTTPS callback;
when `ORGWARD_PUBLIC_URL` is set, its OAuth callback path is derived as
`/api/execution/github-installation/oauth-callback`. Configure the GitHub App
Setup URL separately to the absolute OrgWard URL ending in
`/api/execution/github-installation/callback`, and do not enable GitHub's
“Request user authorization (OAuth) during installation” option because OrgWard
runs its own second authorization step. Grant repository metadata and contents
read, and organization Members read permissions in GitHub App settings. OrgWard
first verifies the installation belongs to the configured App, stores it only
as provisional state, and then requires GitHub user OAuth: a personal install
must match the user's account ID/login; an organization install requires the
user to be an active organization admin for that exact organization ID.
Enterprise installations are not supported. A short-lived
principal/project/authz-bound state is consumed only after both proofs, and the
installation is permanently bound to one tenant; the UI never accepts an
installation ID as ownership proof. Installation connections and reconnections
append a tenant audit event. OAuth tokens and App credentials remain in server
memory/config only. Installation tokens are minted briefly with `metadata:read`
for repository discovery and are revoked afterward. Source capture mints a
separate token scoped to the selected repository with `metadata:read` and
`contents:read`, then revokes it. Both callback paths carry one-time state and, for OAuth, the
authorization code in query parameters; configure the reverse proxy to redact
query strings from access logs for
`/api/execution/github-installation/callback` and
`/api/execution/github-installation/oauth-callback`. The Node application does
not log callback URLs.

Set `ORGWARD_GITHUB_VERIFIER` in the server environment to an operator-owned
JSON check plan. The ordered `requiredChecks` array is snapshotted into each
approved candidate and every check must pass against the same candidate tree.
Executables and arguments are fixed server configuration; requests cannot supply
or change this plan. For example:

```json
{
  "id": "orgward-node-ci",
  "version": "1.0.0",
  "requiredChecks": [
    {
      "id": "unit-tests",
      "version": "1.0.0",
      "executable": "/usr/bin/node",
      "args": ["/workspace/scripts/unit-tests.mjs"],
      "timeoutMs": 60000
    },
    {
      "id": "contract-tests",
      "version": "1.0.0",
      "executable": "/usr/bin/node",
      "args": ["/workspace/scripts/contract-tests.mjs"],
      "timeoutMs": 60000
    }
  ]
}
```

Each check uses the configured sandbox policy (bubblewrap by default). The
check scripts must be part of the captured candidate tree (available under
`/workspace` inside the sandbox) or otherwise already available in the sandbox
namespace. Host paths outside its configured mounts are not visible to checks.
The older flat `{ "id", "version", "executable", "args" }` value remains accepted
for compatibility, but its candidate result is marked as legacy and incomplete;
it does not establish full T-31 required-check coverage. This configuration does not
provide reproducible-build evidence or T-32 SBOM, provenance, or artifact
signatures.

For candidate-specific build reproducibility, optionally set
`ORGWARD_GITHUB_BUILD_PLAN` to a separate operator-owned JSON plan. It uses one
fixed executable and argv plus an exact, nonempty `requiredOutputs` list:

```json
{
  "id": "orgward-production-build",
  "version": "1.0.0",
  "executable": "/usr/bin/node",
  "args": ["/workspace/scripts/build.mjs", "--output=/build-output"],
  "timeoutMs": 120000,
  "requiredOutputs": ["dist/app.js", "dist/app.css"]
}
```

The build script must be in the captured candidate tree under `/workspace` (or
otherwise available inside the sandbox namespace). OrgWard runs it twice in
fresh isolated workspaces, with candidate source mounted read-only and
`/build-output` as the separate writable output mount. The script must write
only the listed relative output paths there; missing or extra files fail the
result. Bounded logs, manifests, and hash-verified output bytes are retained
with the candidate. Without a plan, the UI reports `NOT_CONFIGURED`; matching
build outputs describe this candidate only and do not close T-31 or establish
T-32 signing, SBOM, or provenance.

## Protected release and rollback

Protected releases are disabled until an operator configures
`ORGWARD_RELEASE_ENVIRONMENTS`. Each binding names one tenant, project,
environment, affected assets, risk class, allowed actions and exact OIDC
principals. The configured HTTP deployment controller performs the effect;
OrgWard does not deploy by starting the application or approving a request.

```json
[
  {
    "id": "private-staging",
    "tenantId": "your-tenant",
    "projectId": "project-00000000-0000-4000-8000-000000000001",
    "label": "Private staging",
    "assetIds": ["service-api"],
    "riskClass": "moderate",
    "actions": ["release", "rollback"],
    "authority": {
      "requesters": ["oidc:REPLACE_WITH_REQUESTER_SHA256"],
      "approvers": ["oidc:REPLACE_WITH_DIFFERENT_HUMAN_SHA256"],
      "executors": ["oidc:REPLACE_WITH_EXECUTOR_SHA256"]
    },
    "adapter": {
      "kind": "http-release-v1",
      "endpoint": "https://private-deployment-controller.example",
      "authorizationToken": "SERVER_SIDE_CONTROLLER_TOKEN",
      "timeoutMs": 30000
    }
  }
]
```

Replace principal placeholders with `oidc:` followed by the identity's 64 hex
characters. Requesters and executors also need current `workspace-write` and
project editor membership; approval requires a different current human with
`release-approver`, workspace read access (`workspace-read`, `workspace-write`
or `tenant-admin`) and project editor membership. Store the configuration and
controller credential privately on the server. HTTPS requires a controller
token; HTTP is accepted only for a loopback fixture.

In a GitHub candidate's Execution view, select the configured environment,
review the exact candidate evidence, output manifest, assets and risk, then
request the action. Release accepts only a successful candidate with a complete
passed required-check plan and two byte-identical build outputs. A different
configured human approves its immutable request hash, and an authorized executor
explicitly dispatches it. Approval does not dispatch. Rollback requests bind the
previous successful candidate; a confirmed unhealthy application can instead be
rolled back to the last healthy candidate. Both require fresh independent approval.

The controller implements `POST /actions` and `GET /actions/:actionId` below its
configured endpoint. POST receives `protected-release-dispatch-v1`, `actionId`,
`requestHash`, the immutable `request` and an `outputs` array containing each
output's path, mode, size, SHA-256 and base64 bytes. OrgWard rehashes and compares
both saved build sets before saving the dispatch claim. The controller must
deduplicate `actionId`; OrgWard sends one POST for that saved action.

A controller response uses `version: "protected-release-result-v1"` and echoes
`actionId`, `requestHash`, `environmentId`, `configurationHash`,
`candidateEvidenceHash` and `outputManifestHash`. `status: "APPLIED"` must include
`health: "healthy"` or `"unhealthy"`, a `healthCheckId` and an ISO `observedAt`
after dispatch. Only an exact matching healthy receipt changes the saved current
candidate. `status: "REJECTED", noEffect: true` records a confirmed failure.
Transport failures, missing or mismatched receipts and unverified health keep
the environment fenced. The user must explicitly reconcile through the GET
endpoint, which observes the saved action without applying it again. Requests,
approvals, dispatch claims, observations, recovery and environment history survive
restart. Loopback test receipts verify the product path; production controller
qualification and progressive delivery remain separate work.

## Customer outcomes and next actions

Each saved project's **Outcome and next-action inbox** connects a protected
release, task run or explicit human-reported context to an owned improvement,
incident or support item. The inbox requires PostgreSQL and a verified identity.
Project editors with `workspace-write` can create items, record observations and
propose learning. A current human project owner reviews proposals and assigns
responsibility; the item owner or project owner can change its status with a
recorded reason.

Observations contain explicit technical, control or business measures, numeric
actuals and targets, comparison, observation time and evidence summary. Missing
values, targets, evidence or time remain `UNKNOWN`. `MET` and `NOT_MET` describe
the reported comparison; they do not verify business facts. The source binding,
dated observations, proposal content, owner review and activity survive restart.

After accepting the exact current proposal, the project owner separately selects
an object from the current saved blueprint and creates a linked custom change
case. Its intent uses the reviewed recommendation and recorded targets, and its
lineage retains the original outcome, observation and review. **Open linked
change case** opens that exact case in the existing SDLC workspace, where the
user can edit intent and progress through its governed stages. Creating a case
does not apply a blueprint change, dispatch work or release software. The
existing SDLC reference stages continue to identify synthetic reference analysis.

Commands use the current outcome version and a stable command ID. After an
uncertain response, the inbox retains the exact command for recovery before a
new action; replay rechecks current authority and returns the saved result.
Conflicting content or stale versions require a refresh. The project inbox
retains up to 200 items, each with a bounded activity history. A current reader
can download a hash-bound record at
`GET /api/v1/projects/:projectId/outcomes/:outcomeId/export`.

A human project owner can preview an exported JSON record and import it into
the current project's inbox with a chosen eligible owner. Imports are limited
to one megabyte and validate the export and observation hashes. The new item
starts `OPEN`, records its original project/item/export lineage and retains
the reported observations as `HUMAN_REPORTED`. The hash establishes file
consistency, not the truth of imported claims or the identity of their original
reporter. Imported evidence needs a new proposal, owner review and current
saved-design selection before follow-up work. Previous approvals, status and
case links grant no authority in the new project. Import commands recover their
saved result after an uncertain response. Whole-database backup/restore remains
the operator path for exact workspace recovery, including outcome records.

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
