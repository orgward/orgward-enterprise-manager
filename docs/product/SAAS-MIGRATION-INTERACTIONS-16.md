# Bring a whole business into OrgWard, safely

Required future journeys for T-109–T-118, not implemented screens. See
[handoff 16](../production/DOMAIN-FIXTURE-HANDOFF-16.md) for contracts and evidence.

## Know what “complete” means

An enterprise owner opens **Business coverage**, selects a dated scope and reviews
each unit and dimension: normal operations, exceptions, executive decisions, informal
work, continuity and wind-down. Activities have owners, inputs/outputs, constraints,
resources, source systems, measures and an execution mode. Manual work is valid;
not every activity needs a software system or an automated agent.

The matrix separates inventoried, represented, constraint-linked, runnable, tested
and measured coverage. Six fully described activities with only two enabled processes
and no observed outcomes are not a fully operating business. Each number links to
the exact included IDs, unknowns and approved exclusions. Duplicate source records
or appearances in multiple perspectives do not inflate the denominator.

The owner can request a **Representation certificate** or **Operating certificate**
for that scope. The latter requires actual execution/control/outcome evidence.
Critical unknowns block it. If another user discovers a supplier-dispute process
during assessment, the pending certificate becomes stale and the inventory grows;
the old dated certificate remains historical. Excluding mandatory work just to
reach 100% is rejected with an owned evidence gap.

## Set up an enterprise tenant

The administrator requests an approved tenant, chooses a supported region and
modules, and follows provisioning progress through resource allocation, identity,
configuration/recovery checks and activation. A timeout returns to the same job;
it does not create a second tenant. Partial allocation shows exactly what exists,
what failed and whether the operator can resume or clean up proven owned resources.

The global operator view contains routing and safe service metadata, not the business
graph or evidence. The customer-owned installation uses the same domain contracts,
with its storage/provider dependencies explicit. Neither mode needs the developer's
credentials to operate. Tenant activation does not start business processes by itself.

The admin verifies the domain and explicitly maps trusted identity-provider groups
to tenant roles. Matching an email suffix or selecting a workspace in the browser
does not grant access. Two independently configured custodians rehearse owner recovery.
If the owner leaves or the identity provider fails, recovery follows that tested path;
there is no emergency platform-admin shortcut when recovery was never configured.

Revoking a member invalidates streams, retrieval, downloads, jobs and future effects,
including cached sessions. The UI shows already accepted external actions separately:
they need reconciliation, not a false “cancelled” label.

## Understand usage, support and location controls

The admin sees **consumed**, **outstanding reserved**, **uncertain held** and **available**
usage with explicit units. For a 1,000-token quota, consuming 300 while holding 200
for queued work and 100 for an unknown provider outcome leaves 400 available. The
uncertain 100 is part of the held 300, not another charge. Duplicate provider events
cannot increase usage twice. Tokens are not currency, and this plan enables no live billing.

Entitlement to SDLC makes the module available; it does not give a commercial admin
permission to release software. Restriction stops new discretionary work under the
agreed grace policy while preserving authorized evidence access and safe reconciliation.
Resuming service does not revive expired approvals or revoked users.

A **Support case** begins with redacted diagnostics. The customer grants a named
operator specific resources, allowed actions, purpose and expiry. The operator cannot
extend it or turn a diagnostic read into a business-risk approval. The customer sees
the redacted session history. Cell maintenance notices contain only that customer's
impact; unsafe drain is postponed rather than dropping unknown remote work.

Residency includes storage, backups, retrieval/model processing, connector egress,
workflow history and diagnostics—not just a chosen region label. Prohibited fallback
stays blocked during outages. Moving cells shows target validation, safe work transfer,
source fencing and a new owner epoch. A recovery pause may temporarily have no writer;
it must never have two. Key rotation preserves authorized old evidence without copying
private keys into exports or restoring access for revoked users.

## Migrate an existing enterprise in reviewable phases

1. **Discover sources.** Choose approved documents, catalogues and operational systems.
   Review source/team/time coverage, permissions, sampling, errors and unknowns.
   The owner can add an interview-backed informal activity absent from logs, clearly
   labeled asserted rather than observed. Restricted sources create safe gaps, not
   empty-success results or leaked summaries.
2. **Map meaning and identity.** Compare source IDs, canonical objects, typed fields,
   scope and history. Same-named customers do not automatically merge. A reviewer
   accepts the exact mapping and transform before staging. The form/table provides
   complete keyboard access; no mandatory graph gesture is needed.
3. **Stage and repair.** Import to an isolated draft. Four valid rows and one quarantined
   row remain five accounted source rows. Restart preserves both results and errors.
   Mapping repair creates a new reviewed version; it does not rewrite old imports.
   Credentials, schedules and grants do not become active. A legacy “completed” run
   stays source-attested, not proof that OrgWard executed it.
4. **Declare coexistence.** A field/scope matrix says which system currently owns writes
   and which sync directions are permitted. The CRM can remain authoritative for a
   field while OrgWard owns process instructions. Overlapping authority/policy edits
   open a reviewed conflict; the newest timestamp does not win automatically.
5. **Handle ongoing change.** Missed events or expired cursors trigger verified
   resnapshot/backfill and a visible historical gap. Relevant source changes make
   a Studio draft's old preview/approval stale without erasing the draft or accepting
   the source proposal as business truth. Compare source/current/draft explicitly.
6. **Validate exactly.** Reconcile IDs, counts, source and transformed target hashes,
   references, history and domain invariants. A legitimate field rename has different
   source/target bytes but a verified mapping. Sampling alone cannot pass validation.
7. **Shadow and rehearse.** Compare outputs/decisions on pinned inputs without a second
   live effect. Inspect active work: unsupported state must drain on the old engine;
   only a fully supported reviewed safe-boundary bridge can transfer it. A status
   label such as waiting cannot reconstruct timers, budgets, approvals and effects.
8. **Request cutover eligibility.** Missing recovery proof, failed rehearsal or a changed
   final source watermark blocks advancement and names repair work. Staged evidence
   remains intact. Actual cutover and hypercare still have separate tasks, approvals
   and independently observed outcomes; passing rehearsal does not perform cutover.

## How this relates to configurable SDLC

Imported process and system gaps retain canonical links into SDLC context, requirements,
evaluations and guardrails. A migration may create a software change for an interface
or schema, or keep a specialist system and run manual work. Both are valid operating
choices. The SDLC/process definition remains editable through the same diagram/forms,
with explicit versioning, bounded loops, approvals and safe active-run migration.

Changing source authority or a relevant policy invalidates affected delivery context
and approvals. No connector can silently redefine those constraints. Historical runs
remain pinned; a corrected successor requires fresh eligible evidence and current
authority. OrgWard can represent the business while some systems remain external—it
does not claim their work was executed or qualified merely because it was imported.

Every phase shows owner, version, evidence age, actual status and next permitted action.
Loading, empty, stale, denied, conflict, failed and recovery are distinct. Retain
permitted drafts and context, but never replay uncertain effects on refresh or disclose
revoked data through old browser state. These requirements still need actual UI/API/
storage/provider implementation and independent acceptance evidence.
