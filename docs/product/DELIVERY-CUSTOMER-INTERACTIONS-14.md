# From enterprise design to delivered systems and customer operation

Required future user experience for T-90–T-99, not implemented screens. See
[handoff 14](../production/DOMAIN-FIXTURE-HANDOFF-14.md) for precise behavior,
failure schedules, contract refinements and independently collected evidence.

## One continuous SDLC story

A service company already has customer onboarding in Studio. Its architect selects
the onboarding process, switches to the system/data perspective and sees that the
contact service must read Party.email from the authorized identity service. The
same canonical IDs link business outcome, process, software and data authority.
The architect chooses **Create software change** from that selected gap.

1. **Review context.** The case shows accepted business baseline, Sentinel snapshot,
   policy/authority, requirements, risks and assumptions. Coverage lists included,
   unknown and excluded dependencies with reasons. A missing mandatory authority
   blocks planning and links to owned repair; the model cannot silently omit it
   because its prompt is full. Back returns to the original process and selection.
2. **Review requirements and evaluations.** The owner sees “read the authorized
   contact source,” with success, forbidden-replica and outage/recovery cases.
   Each test traces to business outcome, scope, risk and source. An independent
   reviewer accepts the test contract; a generated test that only prints “passed”
   or copies the requirement text does not meet it. Removing a failing test remains
   visible against the accepted obligation inventory and blocks assurance.
3. **Choose an architecture.** Two alternatives show business fit, authority/data
   constraints, failure modes, cost assumptions and reversal. A cheaper direct
   replica read is rejected if it violates mandatory source authority. The review
   records the actual rationale, not a hidden automatic weighted-score winner.
4. **Adapt the delivery process.** Open Diagram or Structured steps. Add privacy
   review, parallel checks and a maximum-three-iteration implementation/test loop
   with a shared budget and human escalation. Both editors change the same versioned
   workflow. Simulate pass/fail/unknown routes, review, publish and separately enable
   the new version. This does not require changing application source code. Existing
   runs retain their old profile unless separately reviewed safe migration succeeds.
5. **Review multi-repository work.** A service and client repository have pinned
   base commits, dependency locks, required checks and compatible release order.
   A schema change expands first, migrates consumers and contracts only when safe.
   Actual isolated workers make changes. Human-owned consent logic remains protected:
   a regeneration collision opens base/current/generated comparison and requires
   explicit resolution with fresh checks, not a wholesale overwrite.
6. **Handle partial work honestly.** If the service merge succeeds and the client
   build fails, the case shows both. Resume the client work after correction; do not
   repeat the service merge or claim everything rolled back atomically. Cancellation
   preserves accepted architecture and recoverable attempt artifacts.
7. **Review and promote.** An eligible independent release reviewer sees the exact
   artifact, target, configuration, context, checks and recovery plan. Promotion
   verifies what actually runs and observes mandatory controls for the complete
   declared window. A healthy build alone is insufficient. If policy changed after
   review, dispatch blocks immediately—even if an old map badge has not refreshed.
8. **Observe and learn.** Technical acceptance can be green while business outcome
   is unknown because onboarding measurements are missing. A later authority-bypass
   incident links back to release, system, property and process. A corrective proposal
   gets separate review, new baseline/context/evaluations and a measurable follow-up.
   Further observations can refute the fix; history is not rewritten to call it good.

At each step the user sees owner, pinned version, prerequisites, evidence freshness,
next permitted action and recovery status. “Queued,” “awaiting review,” “running,”
“unknown effect,” “failed” and “accepted” describe real persisted states. The process
is not constrained to exactly twelve visual stages; the original sequence is a
starter template with traceability, not hard-coded universal workflow logic.

## What happens when release goes wrong?

- **Provider accepted deployment but the response was lost:** show reconciliation
  required and the provider operation identity. Re-read the target before retry.
  Refreshing the browser must not deploy again.
- **Canary fails:** stop further promotion, keep failure evidence and offer only
  an authorized compatible rollback or owned forward recovery.
- **New schema cannot run the old artifact:** disable automatic rollback and show
  the failed compatibility and data-recovery plan. Restoring an old database must
  not silently discard newer customer writes.
- **Reviewer/session authority expired:** preserve historical decision, request
  eligible current review and show the changed prerequisite. Neither an agent nor
  a second account controlled by its requester supplies independent approval.

These recovery actions are usable forms and backed commands, not descriptive drawers.
The implementation tests must verify actual target state, stored history and effect
counts independently of the UI's labels.

## The same governance for non-software work

A process owner configures a sandbox service order, an approved commitment and two
units of available capacity. A human approves the exact action; a qualified service
adapter performs one tracked external test effect. Replaying the command does not
create a second fulfilment. Real provider evidence—not the generated process—proves
the result, and the test action is never represented as a live commercial transaction.

If fulfilment is accepted but its response times out, the order shows unknown effect
and retains its reservation until reconciliation. If a later notification fails,
completed fulfilment remains visible. Cancellation/compensation requires its own
authority and receipt; it cannot erase ticket issuance or promise reversal of an
irreversible physical action. Missing payment/legal/device authority yields an owned
setup gap or explicit manual-work alternative, never an automatic live transaction.

## Connector and installation journeys

The customer administrator chooses a supported connector, sees its reads/effects,
minimum scopes, data destination/retention, version and recovery capabilities, then
tests scoped connectivity using customer credentials held server-side. Activating
the connection does not approve a business action. Invalid signatures or schema
changes produce quarantined owned work; an identical replay is deduplicated.

Rate limits and credential rotation preserve cursor progress. Exhausted retries
show paused work and a next action. Disabling a connector previews active users,
queued work, unknown effects and retention. It stops normal new work and cached
access while narrowly authorized reconciliation finishes already-accepted effects.
The screen distinguishes disabled access from erased historical data.

For self-hosting, an independent customer operator installs selected modules and
their required dependencies on a clean supported host. No developer credentials or
undocumented hosted database are required. The installation view distinguishes
installed/configured/healthy/enabled/qualified. Missing Warden blocks affected
protected work; a missing optional model provider does not erase an otherwise
authorized saved blueprint. It cannot trigger a permissive fallback scheduler.

Upgrade/disable recovery includes domain data, artifacts and durable workflow history
with compatible interpreter versions and fenced old workers. A disconnected profile
uses verified local mirrors and configured local providers; cloud-only features stay
unavailable. It proves only that declared subset, not every SaaS or external feature.

## Laptop navigation and accessibility

Role homes use jobs rather than product jargon: **Design my business**, **My work**,
**Review system impact**, **Review decisions**, **Operate installation**. Search and
command suggestions show only permitted objects/actions. A persona selector changes
navigation, not permissions. Cross-module links retain authorized scope, baseline
and selected object; changing workspace explicitly clears incompatible context.

Every supported diagram action has keyboard/form access. Review and intervention
remain usable with a screen reader and at 400% zoom, with visible focus, labels,
announced status, error links and unobscured controls. Drafts survive recoverable
network/conflict errors; revoked users cannot keep viewing protected drafts through
old client caches. No uncertain mutation is blindly replayed after reconnect.

Real independent participants test the role journeys, with completion, assistance,
timing and mistaken-readiness interpretations recorded. The target remains at least
90% supported-core-task completion, zero unauthorized/unintended effects and no
unresolved critical blocker. Browser automation cannot impersonate user-study evidence.

## What is included now versus next?

Shared contracts and task boundary drafts already exist. This pass makes their
scenario expectations and recovery decisions more concrete. Next, each selected
implementation packet integrates complete schemas, examples, seeds and observation
adapters, obtains genuine independent review and satisfies prerequisite evidence.
Then the UI/API/storage/worker path is implemented and tested as a bounded whole.
No document here means those features are running or that the production gates pass.
