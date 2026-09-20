# SDLC: user journeys, decisions and operating feedback

Increment 09. **Required target behavior, not current implemented capability.**
The current SDLC reference executes a synthetic scenario; it does not yet deliver
the real-repository, enterprise-authority, deployment and operating workflows
below. This document explains the intended experience and elaborates existing
SC-08–SC-12, Q-02 and T-25–T-48 without replacing their IDs or criteria.

## What SDLC is inside OrgWard

Studio expresses what the business intends, who owns it, its processes, controls,
information, systems and measures. SDLC is the governed way to create or change
the software that realizes those intentions. A system can be explored from a
business process down to components, interfaces, schemas, repositories, deployed
artifacts and observed behavior, then back to the purpose and constraints it
serves. The same canonical objects and change protocol apply in every view.

The loop is:

Business intent → context and impact → governance → requirements → architecture
→ bounded work → code/review → assurance → authorized release → observation
→ reviewed learning → a new change when warranted.

This is not a requirement that every business action become code. A design change
may need only an instruction, human process, configuration or external-system
integration. The impact review selects the implementation mode; no artificial
repository task is required when no software change is needed. Conversely, a
written process or generated code file is not an operating system.

## Primary journey: online furniture collection booking

Example intent: “Let customers book furniture collections online, without
overbooking drivers or exposing another customer's address.” The business owner
also specifies an intended improvement in booking completion. Numbers below are
test examples, not facts about a real customer business.

### 1. Start from the business, not a blank coding prompt

In Studio the owner selects the collection process and chooses **Propose change**.
The same command is reachable from chat, a system detail, a gap, an incident or
an observed outcome. The form contains intent, affected scope, owner, constraints,
desired measures and exclusions. An existing-service change references its real
system and repository; a new-system change records that no implementation exists.

Saving creates one draft ChangeCase with stable ID and selected enterprise
baseline. It does not publish a new business design, enable a worker or deploy.
The owner can correct the brief, attach permitted sources or leave facts unknown.
Reload preserves the case and initiating map selection.

### 2. Review what is affected and what is missing

**Context and impact** shows the booking UI/API, capacity service, driver roster,
customer-record authority, accountable roles, resource constraints and applicable
controls. Each affected item has a “why affected” path and source/version/age.
Indirect consumers matter: changing capacity can affect both dispatch and promises
already made to customers, even when neither is in the requested UI edit.

The owner resolves stale capacity information or assigns a clarification to the
dispatch owner. Hidden information is not disclosed to unauthorized readers.
An incomplete traversal or mandatory inaccessible source blocks advancement;
the assistant cannot assume “nothing else is affected.” Noncritical uncertainty
may remain only under an explicit applicable policy and an owned review action.

### 3. Decide which controls and human decisions apply

**Governance** records applicable policy/control versions, accountable owners,
decision rights, mandatory reviews and permissible exceptions. The user sees the
reason for each required decision and who may make it. Customer/jurisdiction
interpretations must come from configured accountable owners, not invented legal
conclusions from a model. Unresolved mandatory interpretation blocks affected work.

Changing business design is not changing deployment authority. A title such as
“owner” does not automatically grant repository writes, signing or production
access. Platform administration is not automatic business-risk approval.

### 4. Review concrete requirements and examples

The product owner edits atomic requirements linked to the original intent:

- A customer can reserve an available collection slot and receives one confirmed
  booking after capacity is committed.
- With one remaining slot and two simultaneous booking requests, exactly one
  succeeds; the other receives a clear unavailable result, not a false confirmation.
- Retrying the same confirmed booking request returns its original result and
  does not reserve another slot.
- One customer cannot read or edit another customer's address or booking.
- A temporary hold expires under an explicitly approved duration, rather than an
  implementation agent guessing a business rule.

Each has actor, precondition, observable result, source, owner, priority and
independent verification. “Make it fast” is an unresolved requirement until its
bound and measurement conditions are specified. Contradictory capacity rules
cannot be silently resolved by whichever model writes the code.

Accepting requirements creates a versioned baseline; it is not acceptance of the
architecture, the implementation, a release or the business outcome.

### 5. Compare architecture alternatives and recovery

The architect sees current and proposed interfaces, data ownership, dependencies,
capacity/concurrency rules, security boundary and migration impact. In this
example the booking API calls the capacity owner's interface; it must not write
directly into an unrelated roster database to avoid its controls.

The review includes rejected alternatives, exact service/data contracts, an
ordered compatible migration, deployment sequencing and health criteria. It
names a verified rollback candidate or a forward-recovery path where schema or
business effects are irreversible. Acceptance binds the actual design version.

### 6. Review a bounded work plan

**Work** shows tasks such as capacity/API changes, UI changes and independent
integration checks. Every task pins requirements, architecture, immutable source,
instructions, input/output schemas, allowed files/tools, assignee, budget and
dependencies. Review points and required outputs are visible before starting.

Humans can narrow scope, reassign eligible work, change instructions in a draft,
request clarification or reject the plan. These actions create reviewed versions;
they do not edit a running attempt's history. Missing requirement coverage,
cyclic scheduling dependencies, absent authority or missing inputs block dispatch.
SDLC tasks appear in the same run engine/inbox as other business operations.

### 7. Agents implement; users can inspect and intervene

Repository onboarding exposes the provider installation, allowed repositories,
branch policy and exact source commit. The agent works in an isolated environment
with bounded CPU/memory/time/token/cost/tool usage and scoped credentials. Repository
text, comments and test output are untrusted data, not new authority instructions.

The user sees progress, actual diff, changed files, test failures, budget used and
remaining, redacted logs and saved artifacts. The agent can repair in-scope faults
within its approved limits. It cannot remove required tests, widen file/tool scope
or increase its own budget to obtain a passing result.

**Pause** first shows requested and later effective. **Cancel** does not assert
that an already accepted remote operation was undone. **Change instructions**
creates a successor attempt with new review/authority if material. Budget exhaustion
or an unresolved defect routes a durable human task rather than an endless loop.

### 8. Review and merge the real code change

The agent's permitted repository-write operation creates an owned branch and PR
linked to requirements, exact head, checks and work evidence. The reviewer can
comment, request changes or approve; the producing agent cannot satisfy its own
required independent review or merge contrary to policy.

Changing the base, rebasing or resolving a conflict produces a new evaluated head.
Old checks and approval cannot be relabeled current. Lost PR-create responses
reconcile the existing provider object rather than creating another PR.

For the baseline workflow, build the candidate from the exact approved integration
commit. If merging produced different bytes from the reviewed branch head, required
checks run on that integrated revision. Never promote an earlier branch build merely
because its checks were green. Other certified branch strategies must preserve this
identity rule and their own explicit merge/review semantics.

### 9. Inspect assurance of the actual candidate

The candidate view names exact source, recipe, locked dependencies, artifact digest,
functional/contract/security results, SBOM, provenance and signature verification.
Independent verification happens outside the producing worker. Skipped checks,
missing evidence, substituted bytes or invalid trust block promotion—even when
the tool exits zero or prints “all tests passed.”

Build reproducibility is evaluated under the declared policy; this fixture uses
exact-byte equality. Safe failure logs and a repair path remain available. Evidence
integrity and trusted authorship still do not prove the business claim is true.

### 10. Review and authorize the protected release

The release reviewer sees the candidate, evidence, target environment, configuration,
policy, risk, required observation window and rollback/recovery plan. Approval binds
that complete request and expires. The implementer cannot self-approve when separation
is required; permitted reviewer combinations follow recorded conflict/quorum policy.

Approval and dispatch are distinct. The effect broker rechecks current policy,
identity, budget, context and target immediately before calling the provider. Changed
bytes, configuration, evidence, policy or revoked permission invalidate eligibility.
Staging success does not grant production authority. Each protected target has its
own bound approval. Deployment requires a configured authorized adapter and scope.

### 11. Observe deployment and recover truthfully

The deployment timeline distinguishes requested, provider-accepted, running,
observing, healthy, failed and unknown effect. Provider operation identity and the
actual running digest are recorded; health uses independent probes across the
declared window, not the deployment tool's reassuring final line.

If the response disappears after acceptance, the UI offers **Reconcile**, not blind
redeployment. If health fails and the previous artifact/schema remain compatible,
an authorized rollback restores and verifies them. An irreversible migration blocks
automatic rollback and presents the approved forward-fix or restore procedure.
Rollback itself can fail or become uncertain and needs reconciliation.

### 12. Check the business result, then decide what changes next

The business owner sees technical health, control results and business measures
separately. For example, service health can pass while booking completion is 30/100
against a 60/100 target. Missing observations or too few samples are unknown/partial,
not passing. Duplicate observations do not improve the denominator or result.

A follow-up can hypothesize that the address form causes abandonment; the system
must label that as a hypothesis, not established causality. The owner accepts,
rejects or defers with rationale. Acceptance creates a new linked change case; it
does not silently rewrite the original business design or deploy another version.

## Stable lifecycle and user controls

Mandatory addendum: [configurable workflows](CONFIGURABLE-WORKFLOWS.md) makes
the process itself editable via diagram and structured forms, including substeps,
branches, bounded loops, criteria/actions and explicitly reviewed version changes.
The following names are default-template provenance aliases, not an immutable
runtime sequence. Customers can split/reorder/nest/rename eligible steps; mandatory
policy obligations remain independent of labels and cannot be removed by editing.

Retain S0–S11 as aliases for the default template: Intent, Context, Impact, Governance,
Requirements, Architecture, Plan, Implementation, Assurance, Authority & release,
Observation, Learning. A stage being visited is not its gate passing. Build,
approval, deployment, health and business assessment are independently persisted
child records, even when grouped under one stage on the rail.

Every stage shows current/pinned version, owner, required inputs, evidence,
blocking findings, next permitted actions and history. Global controls include
save draft, compare, request review, repair/resubmit, pause, withdraw and inspect
evidence; only applicable authorized actions are enabled. A finding links to the
actual editable field or owned task, not a specification drawer. Reading an inbox
notification never approves the underlying decision.

Returning users see “Awaiting your architecture review” or “Deployment outcome
unknown—reconcile operation …”, not an unexplained completion percentage. Drafts
survive failed saves; a version conflict opens base/current/proposed comparison.
Graph and list, keyboard navigation, browser history and deep links preserve context.
No cross-workspace or denied data is retained in an inspector after revocation.

## Additional scenarios that must remain supported

| Scenario | User interaction and required behavior | Trace |
| --- | --- | --- |
| New system, no repository | Select the missing capability/system, compare build vs qualified integration, establish owner/contracts/approved repository target and hosting scope. Explicit repository provisioning authority is needed; until configured show a blocked setup task, not an arbitrary external repository creation. Then use the same governed implementation/release path. | T-25–T-34; T-97/T-100 extensions |
| Existing system | Discover approved immutable source and its real contracts; propose the smallest reviewed delta, preserve compatibility/history and test migration. No forced rewrite into a template. | T-25–T-35 |
| Existing external SaaS/ERP remains authoritative | Model owner and source of record, qualify adapter and scopes, make permitted configuration/integration changes. Represent unsupported operations as gaps/manual work. Do not import passwords, automatically activate schedules or invent transaction evidence. | T-44, T-97, T-113–T-120 |
| Policy-only or human-process change | Impact review decides no code is needed. Revise the relevant policy/instruction/process and revalidate affected work through the shared change protocol; invalidate affected approvals. Do not fabricate a code build. | T-13/T-18/T-40, T-121–T-124 |
| Requirement changes during coding | Preserve old attempt and diff; invalidate affected context, checks and approvals. Compare/replan, obtain required review and create a successor attempt. Unaffected dependencies remain current when sensitivity proves independence. | T-25–T-28, T-123 |
| Two teams alter one interface | Detect expected-head/contract conflict, compare base/current/proposed, negotiate authoritative contract, rebase and rerun impacted consumers. No last-write-wins merge of authority or schemas. | T-27/T-30, T-121–T-124 |
| Real test fails or agent exceeds limits | Retain failing artifacts and traces; perform bounded repair or route an owned human task. Review scope/budget explicitly; no quiet test deletion or billing/provider fallback. | T-22/T-30/T-31/T-38 |
| Provider accepted deployment but connection failed | Record unknown effect, retain operation identity, reconcile status before retry. Controls and UI cannot claim a canceled or missing effect from a lost response. | T-33–T-35 |
| Incident or emergency fix | Open an incident-linked change, choose the configured expedited review path and allowed mitigation. Urgency cannot waive identity, immutable denies, artifact integrity or required separation. If no policy exists, escalate; never invent emergency authority. | T-33/T-35/T-43; Arbiter/Warden tasks |
| Sentinel detects design/behavior drift | Inspect source-backed claims and affected rules; route repair to the owner, link a corrective change, evaluate intended vs observed design. Observed bypass does not become accepted permission. Recompile/reassess after correction under the same baseline. | T-68/T-71 and portfolio qualification; T-25–T-37 |
| Business outcome is worse after technically good release | Keep technical pass and business fail visible; assign review, experiment or corrective change. Do not infer causality or automatic rollback merely from correlation. | T-36/T-37 |
| Upgrade, disaster recovery or offboarding interrupts delivery | Fence old workers/grants, reconcile remote operations, restore consistent evidence and resume only currently eligible work. No replay of previously accepted deployment effects. | T-17/T-38/T-41–T-43 |

Rows referencing tasks outside T-25–T-48 preserve the full target but are not
claimed to have new concrete vectors in this increment. In particular, tenant-wide
SaaS rollout/cell migration, full Sentinel semantics and universal connector support
still require their own packets, adapters and qualification.

## How the other products participate

Studio owns business design and linked perspectives. SDLC coordinates the change
and uses the shared task engine. Sentinel evaluates modeled/observed claims and
drift. Steward maintains definitions, ownership and source-of-record/data contracts.
Arbiter handles eligible decisions, delegation, quorum, conflict and appeal. Warden
evaluates policy and protects each effect. Overseer bounds agent instructions,
autonomy and evaluation. Ledger retains verifiable decision/effect evidence.
These are cooperating modules, not eight separate copies of the enterprise graph.

## Release qualification is not a normal user's checklist

Ordinary users see case-specific readiness and owned next actions. Platform
Administration exposes product qualification, install/upgrade/restore, support,
security and measured limits. T-45 requires usable full workflows, T-46 independent
security review, T-47 measured load/24-hour/failover tests and T-48 integrated core
journeys. T-48 does not finish the expanded enterprise-SaaS endpoint: T-132 remains
the final qualifier. No document, fixture count or synthetic reference passes it.
