# Customer functionality queue

**Latest scope and model override (2026-10-04):** This queue contains the 17
stable functionality IDs PR-01–PR-10 and PR-12–PR-18. Luna 6 owns
implementation, tests, documentation and integration. GPT-6.1 Sol is read-only
reviewer and may provide design feedback. PR-11 and PR-19 remain pending in
`HARDENING-TASKS.md`; broad hardening and release qualification follow this
functionality queue. Required runtime integrity and customer operations remain
part of the relevant functionality paths.

This queue covers customer-facing functionality from the product brief, first
release outcomes and relevant historical requirements. T-ranges identify
coverage; they do not create paperwork gates. Historical roadmaps, task indexes,
vectors and packet instructions under `docs/production/` remain reference
material, not a competing cursor.

Work the first unchecked, dependency-ready item. Luna implements and runs
focused tests when the slice is ready; Sol reviews the resulting source and test
contracts without editing or running tests. Freeze the source and run `npm run check`
once at parent-task completion. Do not duplicate checks. Preserve skip and failure
details; specification validators and vectors are not product acceptance.
Unrequested live effects, deployments, purchases and external communications are
out of scope.

Work order (PR numbers are stable IDs, not numeric sequence):

1. PR-01–PR-05: completed foundation and founder-facing conversation, saved/editable
   design, maps, version history, instructions and usable UX.
2. PR-06: complete the saved-design-to-result journey with human/agent work,
   intervention, persisted evidence and restart recovery. A planning graph or
   static UI alone does not complete it.
3. PR-07–PR-10: deliver customer-usable governed software delivery and outcomes.
   PR-10 closes the observable outcome, learning and next-action journey.
4. PR-12–PR-15, then PR-17: deliver the complete enterprise portfolio and
   consistent customer-defined work.
5. PR-16 and PR-18: deliver managed SaaS and migration journeys.
6. After the functionality queue, handle PR-11 and PR-19 from
   `HARDENING-TASKS.md` as pending broad qualification.

Complete each customer-visible end-to-end path before standalone broad security,
resilience, scale or operations qualification. Build the runtime authorization,
tenant isolation, secret protection, explicit intervention, approval-bound
effects, durable audit and operational actions needed by that path. PR-11 and
PR-19 remain pending in the separate future backlog. No P/E release gate is
closed by this queue; active section order follows the functionality work order.

Active cursor: PR-14. The active checkboxes below are the source of truth;
`npm run task:next` checks that this cursor matches their first open PR in section
order. PR-01 through PR-10 and PR-12–PR-13 are functionally complete, and PR-14 is next. A stale PR
number in a saved goal, dated receipt or older document does not reset the queue.
Read this header and the active PR outcome at the line printed by
`npm run task:next`; search receipts only for a concrete dependency.
If an external dependency blocks the current PR, keep it open and inspect later
sections in priority order for independently ready work before treating the whole
goal as blocked. After a bounded increment, add its actual behavior and test/demo
receipt under its PR item and
record gaps or skipped checks explicitly. Advance the cursor and checkbox together
only when the whole PR outcome passes its required behavior checks and review.
After the final PR, set the cursor to `COMPLETE`. Keep P/E release-gate status
and evidence in their separate ledgers.
Focused tests remain per-slice. Run the single full check at parent PR/task
completion, after source freeze and diff review; do not run it concurrently with
another full check. Keep the current test-runner isolation and resource settings:
one shared PostgreSQL cluster per invocation, a separate database per fixture,
and concurrency 2. The current VPS has 2 CPUs and low `/tmp` tmpfs headroom, so
these settings are unchanged. Preserve skip and failure details in receipts; this
workflow change does not mark any task, test or release gate complete.

PR-06 DeepSeek HTTP 401 guidance (2026-09-28): the fresh synthetic
`deepseek-current` provider dispatch returned one `outcome_unknown` attempt with
allowlisted DeepSeek HTTP 401; it was not retried, and the provider response
body was unavailable, so the exact cause is not established. The saved-result
copy tells administrators to verify the saved provider credential while keeping
delivery unverified and requiring reconciliation before retry. Other statuses
retain their existing no-retry guidance.
Triggering diagnostic evidence:
`/tmp/orgward-pr06-managed-profile-proof-20260928-prepared/attempt-summary-1790633379644b62ea665a1b.json`.
Focused helper and linked-task projection tests passed 18/18 (0 failures/skips;
0.30s runner wall); TAP log `/tmp/orgward-tests-LvTULB/node-test.tap.log`.
`git diff --check` passed. No provider or credential call was made for this UX
slice. PR-06 remains first open; task checkboxes and release gates are unchanged.

PR-06 fresh managed-profile provider attempt (2026-09-28): a disposable
PostgreSQL/app fixture created a synthetic `process-review` plan, bound its
human checkpoint to Bob and `task-process-learn` to the existing design-assistant
actor, completed the checkpoint as Bob, saved a tenant-managed
`deepseek-flash` profile with a 192-token cap, requested the linked task as Alice,
and independently approved it as Bob. Exactly one execute request was made for
new run `execution-run-05616995-8e10-4e87-870f-218021bba558`; the local API
returned HTTP 200, but the run ended `FAILED` with one provider attempt marked
`outcome_unknown`. No proposal or artifact was returned, no restart readback was
attempted, and the run was not retried. The sanitized response check found no
credential match. The upstream cause is unknown; no provider status or response
body was available in the sanitized evidence. A preceding fixture-only setup
attempt stopped on an incorrect assumption about the process root with zero
provider calls, before reading the credential or dispatching; the corrected
attempt used the declared human checkpoint. App, database,
PostgreSQL cluster and temporary workspace were cleaned, and no fixture process
remained. Evidence: `/tmp/orgward-pr06-managed-profile-proof-20260928/attempt-summary-2.txt`.
The provider result remains unverified and PR-06 stays first open; cursor,
checkboxes and release gates are unchanged.

PR-06 read-only DeepSeek model catalog check (2026-09-28): one authorized GET to
`https://api.deepseek.com/models` returned HTTP 200 with `application/json`, and
the `deepseek-flash` model ID was present. The response body was discarded after
the boolean check, and no other response headers were read or retained. No
generation, retry or application change occurred. The one-shot reader script was
removed. This only confirms catalog visibility; it does not establish quota or
generation success.

PR-06 allowlisted provider transport diagnosis (2026-09-28): Node request errors
now map only known DNS (`ENOTFOUND`, `EAI_AGAIN`), connection
(`ECONNREFUSED`, `ECONNRESET`) and timeout codes to fixed classes. The approved
lease wrapper forwards only that enum; the attempt ledger remains the authority
for `outcome_unknown`. The closed class is persisted with the failure diagnostic
and shown as fixed copy that retains delivery-unverified guidance. Raw codes,
messages, request options and credentials are not persisted or rendered. Focused
pure tests passed 4/4 (0 failures/skips; 0.285s TAP duration, 0.24s command wall),
log `/tmp/orgward-pr06-provider-transport-focused.tap.log`; `git diff --check`
passed. No provider request or database fixture was used for this slice. PR-06
remains first open; cursor, checkboxes and release gates are unchanged.

PR-06 restart-safe provider outcome detail projection (2026-09-28): the
attempt-gated saved-result projection now retains only DeepSeek HTTP status
100–599 and the existing parser/transport enums alongside `outcome_unknown`.
The saved-result copy shows those bounded details while preserving the
reconciliation/no-retry guidance. Invalid statuses/classes, non-DeepSeek data,
ordinary attempts, raw bodies, request IDs, messages and error codes remain
omitted. Focused pure/helper tests passed 18/18 (0 failures/skips; 371 ms TAP
duration; log `/tmp/orgward-pr06-provider-outcome-projection-focused.log`). No
database, browser or provider was used. `git diff --check` passed. PR-06 remains
first open; cursor, checkboxes and release gates are unchanged.

PR-06 cross-session outcome detail announcement (2026-09-28): when a matching
linked run newly gains `outcome_unknown`, the status announcement now reuses the
fixed allowlisted DeepSeek diagnostic copy, prefixed by the task title. Marker-only,
invalid and non-DeepSeek diagnostics retain generic reconciliation guidance;
first snapshots, repeated polls, prioritization and announcement bounds are
unchanged. Restart-shaped helper tests passed 16/16 (0 failures/skips; 169 ms TAP
duration; log `/tmp/orgward-pr06-outcome-announcement-focused.log`). No database,
browser or provider was used. PR-06 remains first open; cursor, checkboxes and
release gates are unchanged.

PR-06 persisted DeepSeek outcome projection integration regression (2026-09-28):
the filtered PostgreSQL provider tests now assert that HTTP 503, transport
`connection_reset`, and each supported 2xx parser status/class survive into the
returned run and remain present in event/restart readback. Existing raw body,
header, credential canary and no-redispatch assertions remain. The exact filtered
command passed 3/3 tests (0 failures/skips; parser test covered four response
classes; 4.886s TAP, 5.1s command wall), log
`/tmp/orgward-pr06-provider-projection-integration.log`. `git diff --check`
passed. No live provider, browser or Orca was used.

PR-06 human escalation resolution pause-state UX (2026-09-28): the owner
resolution form now matches the server's pause fences. While `PAUSE_REQUESTED`,
resume/reassignment are disabled and the required select starts on a blank prompt;
succeeded/failed remain available to settle the pause boundary. While `PAUSED`,
all dispositions are disabled with resume-first guidance; the task card continues
to omit the form. Active instances retain eligible choices, and server enforcement
is unchanged. Focused helper and served-client tests passed 4/4. The final frozen
`npm run check` passed 393/394 (393 passed, 0 failed, 1 optional PostgreSQL
backup/restore skip because client tools are unavailable; 76.40s test phase),
TAP `/tmp/orgward-tests-KBVst5/node-test.tap.log`, wrapper
`/tmp/orgward-pr06-human-escalation-paused-check.log`. `git diff --check` passed.
No provider/browser activity or external effects. PR-06 remains first open; cursor,
checkboxes and release gates are unchanged.

PR-06 human escalation pause-boundary PostgreSQL regression (2026-09-28): the
existing mixed-human journey now covers a second assigned root instance across
`PAUSE_REQUESTED` and `PAUSED`. Owner resume and reassignment are denied while
the pause is draining; an owner failure resolution is accepted and settles the
pause; another resolution is denied after the instance is paused. Restart
readback verifies task status/evidence, the escalation-resolution event and both
pause-control events, and a post-restart resolution remains denied. The first
focused run exposed an incorrect expected HTTP status in the new test (pause
returns 200); after correcting it, the focused PostgreSQL journey passed 1/1
(16.32s runner), log `/tmp/orgward-pr06-human-pause-resolution-focused-final.log`.
The single frozen-tree `npm run check` passed 393/394 (393 passed, 0 failed, 1
skipped; 77.27s TAP), TAP `/tmp/orgward-tests-3ylV8I/node-test.tap.log`, wrapper
`/tmp/orgward-pr06-human-pause-resolution-check.log`. `git diff --check` passed.
No source/API changes, provider/browser activity, or external effects. PR-06
remains first open; cursor, checkboxes and release gates are unchanged.

PR-06 cross-session Orca announcement proof attempts (2026-09-28): one
provider-free fixture/browser attempt rendered the synthetic Bob task as
`IN_PROGRESS`, but its second-session escalation stopped before the request
because nested shell quoting made `node -e` receive no script. Orca emitted only
generic startup/teardown speech; there was no task-specific announcement. A
single corrected attempt reached the same synthetic `IN_PROGRESS` state, then
stopped before Xvfb/Chrome/Orca because the evidence directory was missing when
shell redirection opened `xvfb.log`. No transition or speech was observed. Both
fixtures and processes were cleaned; no product/test/provider/credential changes
occurred. A further module-based attempt used a pre-created evidence directory
but stopped before task creation/browser startup because the actor-binding API
correctly returned HTTP 200 while the temporary harness expected 201. No browser
page or Orca session started, and no task transition or speech was observed. The
disposable app/database were closed; no source/test/provider/credential changes
occurred. Sanitized records:
`/tmp/orgward-pr06-cross-session-announcement-proof/attempt-summary.txt`,
`/tmp/orgward-pr06-cross-session-announcement-proof-2/attempt-summary.txt`, and
`/tmp/orgward-pr06-cross-session-announcement-proof-3/attempt-summary.txt`.
Cross-session spoken status remains unverified; PR-06 remains first open, with
cursor and release gates unchanged.

PR-06 updated saved-result keyboard proof attempt (2026-09-28): the one
provider-free direct-CDP fixture attempt stopped before startup because shell
redirection could not open `/tmp/orgward-pr06-keyboard-current-proof/run.log`;
its parent directory did not exist. No page or keyboard interaction was
observed, and no source, tests, provider, credentials or external effects were
used. The existing keyboard-only human-checkpoint evidence predates the updated
saved-result disclosure, so keyboard re-entry into that disclosure remains
unverified. Sanitized record:
`/tmp/orgward-pr06-keyboard-current-proof/attempt-summary.txt`. PR-06 remains
first open; cursor and release gates are unchanged.

Follow-up attempt (2026-09-28): a new provider-free synthetic fixture enabled
only the local deterministic `scaffold-node-service` executor and used the
authorized process-task API path. Setup stopped before browser launch because
the project-member API returned HTTP 200 while the adapted harness expected
201. The app, synthetic issuer, disposable database and PostgreSQL cluster were
closed; the temporary fixture script was removed. No browser, provider,
credentials, Orca, product source or test behavior was involved. The saved-result
keyboard interaction remains unverified. Sanitized record:
`/tmp/orgward-pr06-saved-result-keyboard-proof-4/attempt-summary.txt`. PR-06
remains first open; cursor and release gates are unchanged.

Corrected follow-up attempt (2026-09-28): static route/status preflight corrected
the member API expectation to HTTP 200. The single provider-free local-executor
fixture then stopped before browser launch when starting `task-process-review`
returned HTTP 409 `PROCESS_TASK_DEPENDENCY_UNSATISFIED`; the harness incorrectly
treated a dependent task as a root. The app, synthetic issuer, disposable
database and PostgreSQL cluster were cleaned, and process inspection found no
services or browser remaining. No saved-result UI behavior was observed; there
was no retry or source/test change. Sanitized record:
`/tmp/orgward-pr06-saved-result-keyboard-proof-4/attempt-summary.txt`. PR-06
remains first open; cursor and release gates are unchanged.

Dependency-corrected follow-up attempt (2026-09-28): static inspection matched
the tested root-human → human-checkpoint → dependent-agent sequence, but the
single disposable fixture launch stopped before browser startup because the
temporary harness referenced undefined `randomBytes` while creating synthetic
sessions. Its catch path closed the app and issuer, dropped the disposable
database, stopped PostgreSQL, and removed the temporary execution workspace;
process inspection found no fixture, PostgreSQL test cluster, Chrome, or
agent-browser process. No browser or product behavior was observed, and no
retry or product source/test change occurred. Sanitized record:
`/tmp/orgward-pr06-saved-result-keyboard-proof-5/attempt-summary.txt`. The
saved-result keyboard interaction remains unverified; PR-06 remains first open,
with cursor and release gates unchanged.

Keyboard-proof follow-up (2026-09-28): the authorized saved-result disclosure
keyboard proof stopped before launch because no reusable app/PostgreSQL/two-subject
OIDC/browser fixture was ready. No temporary root, services, browser, provider call,
or source/test change was created for this attempt. Saved-result keyboard
interaction remains unverified; PR-06 cursor and release gates are unchanged.

PR-06 saved-result keyboard and restart proof (2026-09-28): a synthetic,
provider-free local journey completed the deterministic agent task with durable
run status `SUCCEEDED` and artifact `review.txt`; the human checkpoint and linked
instance/task references remained successful after restarting only the app
against the same disposable database. Chrome keyboard proof reached the disclosure
by Tab in 26 desktop and 39 narrow keypresses before restart, and 26 desktop and 38
narrow keypresses after restart. Space opened and closed it with focus retained in
all four viewport checks, and the artifact appeared while open. At 1280x900 and
390x844, before and after restart, there was no horizontal overflow. The proof
recorded zero provider calls and zero external requests. Evidence, screenshots
and accessibility trees:
`/tmp/orgward-pr06-saved-disclosure-keyboard-20260928-1/attempt-summary.txt`.
This closes only the local saved-result keyboard, narrow-layout and app-restart
evidence. Real managed-provider output/restart and Orca/screen-reader evidence
remain outstanding; PR-06 remains first open, with cursor and release gates
unchanged. No product source or test files changed.

PR-06 Orca announcement proof follow-up (2026-09-28): one synthetic local
attempt reached the rendered Alice Execution page and started Orca, but stopped
at the pre-transition keyboard guard: after focusing the visible Chrome window,
one X11 Tab left `document.activeElement` on `BODY` instead of the skip-to-
execution link. Orca's log contained startup/shutdown speech only; it did not
announce the link or any status transition. Bob's escalation was not sent, and
no provider call, credential use, or external request occurred. The fixture and
services were cleaned; no retry or source/test change was made. Evidence:
`/tmp/orgward-pr06-cross-session-announcement-proof-7/attempt-summary.txt` and
`run.log`. This is a harness/input attempt only and does not demonstrate a product
defect. Orca announcement evidence and real managed-provider output/restart remain
outstanding; PR-06 remains first open, with cursor and release gates unchanged.

PR-06 Orca input diagnostic follow-up (2026-09-28): a second synthetic attempt
added a page-side keydown trace and waited up to one second after a single X11
Tab. The focused Chrome window was confirmed, but the page observed no keydown
event and remained on `BODY`; Orca's baseline link speech was not confirmed. No
Bob escalation or provider/external request occurred. The fixture was cleaned,
with no retry or product source/test change. Diagnostic evidence:
`/tmp/orgward-pr06-cross-session-announcement-proof-8/baseline-tab-diagnostic.json`
and `run.log`. Together with the preceding attempt, this isolates the outstanding
screen-reader proof to the current X11 input/Orca harness; it does not demonstrate
a product defect. Orca announcement and real managed-provider output/restart
remain outstanding; PR-06 remains first open, with cursor and release gates
unchanged.

PR-06 Orca focus-path diagnostic follow-up (2026-09-28): one alternate
synthetic attempt delivered a single Tab through Chrome DevTools Protocol; the
page recorded `keydown` (`Tab`, not default-prevented) and moved focus from
`BODY` to `#execution-skip-link`. Orca did not speak the skip-link label within
five seconds. Its trace showed focus on Chrome's “Address and search bar” UI,
not the web document, so no Bob escalation, status transition, or readback was
attempted. This verifies the browser-side focus change only, not Orca or native
keyboard behavior. The fixture was cleaned; no provider/external request, retry,
or product source/test change occurred. Evidence:
`/tmp/orgward-pr06-cross-session-announcement-proof-9/baseline-tab-diagnostic.json`,
`orca-debug.log`, and `attempt-summary.txt`. The current blocker is the test
window's native focus staying in browser chrome; PR-06 remains first open, with
cursor and release gates unchanged.

PR-06 Orca native-focus follow-ups (2026-09-28): one attempt stopped before
input because its temporary harness selected an `h1` inside the empty dynamic
`#execution-main`. After correcting the selector to the static sidebar heading,
a native click left DOM focus on `BODY`, and one native Tab reached
`#new-run`; this follows from clicking a heading that occurs after the skip link
in document order. Orca spoke only the Chrome window title, not the page control.
A subsequent launch using the previously successful Chrome for Testing binary
did not expose its DevTools endpoint within eight seconds, so no page or task
action ran. All fixtures were cleaned. No Bob escalation, provider/external
request, retry, or product source/test change occurred. Evidence:
`/tmp/orgward-pr06-cross-session-announcement-proof-10/attempt-summary.txt`,
`/tmp/orgward-pr06-cross-session-announcement-proof-11/baseline-tab-diagnostic.json`,
and `/tmp/orgward-pr06-cross-session-announcement-proof-12/attempt-summary.txt`.
These attempts do not demonstrate a product defect or establish the required
cross-session Orca announcement. PR-06 remains first open; cursor and release
gates are unchanged.

PR-06 cross-session Orca status proof (2026-09-28): in one synthetic local
fixture, a native X11 click on the inert “Execution runs” heading left focus on
`BODY`, and one native Tab reached `#new-run`; Orca spoke “New controlled run.”
One Bob escalation then produced Alice's live-region text “Discover and qualify
demand changed from in progress to escalated”, and Alice's authorized runtime
readback was `ESCALATED`. The attempt failed only the assertion that Orca's
`SPEECH OUTPUT` contained the exact transition phrase. The AT-SPI debug log
exposed the exact text in a polite `role=status` node but contained no matching
spoken output. No provider, credential, retry or external effects occurred;
fixture processes were cleaned. Evidence:
`/tmp/orgward-pr06-cross-session-announcement-proof-13/run.log`,
`/tmp/orgward-pr06-cross-session-announcement-proof-13/orca-debug.log`,
`/tmp/orgward-pr06-cross-session-announcement-proof-13/alice-after.dom.txt`,
and `/tmp/orgward-pr06-cross-session-announcement-proof-13/attempt-summary.txt`.
PR-06 remains first open; cursor and release gates are unchanged.

PR-06 cross-session status announcement repair (2026-09-28): process refresh
status, transition, defer and retry messages retain immediate visible copy and
schedule a 500ms-delayed update to a dedicated, always-mounted polite live region
outside the Execution main's `aria-live="off"` subtree. The visible paragraph is
non-live; selected-run announcements retain their separate region. Pending
announcements are isolated per region, superseded or cleared messages cannot be
spoken later, identical status polls are deduplicated, and clearing then restoring
a message permits a fresh announcement. Focused helper, announcer and served-client
tests passed 25/25 (0 failures/skips; 0.99s command wall), log
`/tmp/orgward-pr06-orca-region-focused-final4.tap.log`. Stale process-context
callbacks are dropped; a later current-context update can schedule a fresh
announcement. Proof-15 used an assertion that required both task title and exact
transition phrase in Orca `SPEECH OUTPUT` lines only; its result is recorded
below. The earlier served-source assertion for bounded optional provider details
now checks the current fixed guidance with its optional allowlisted details.
`node --check` and `git diff --check` passed. No browser, Orca, provider or
credential activity occurred during this code change. PR-06 remains first open;
cursor and release gates are unchanged.

PR-06 post-fix Orca status proof (2026-09-28): one synthetic proof-14 run
confirmed native click/Tab, Orca baseline speech for “New controlled run”, Bob's
successful escalation, Alice's live-region transition and authorized
`ESCALATED` readback. It did not capture the exact transition in Orca `SPEECH
OUTPUT`; the runner exited 0 because its final phrase check searched the broader
debug segment rather than speech lines. This result does not pass spoken-transition
acceptance. The correction note records the assertion defect, and raw output was
left intact. Evidence:
`/tmp/orgward-pr06-cross-session-announcement-proof-14/proof-result-summary.txt`,
`orca-debug.log`, `alice-after.dom.txt`, `run.log`, and `proof-result-correction.txt`.
No provider, credential or external call occurred, and fixture processes were
cleaned. PR-06 remains first open; cursor and release gates are unchanged.

PR-06 proof-15 cross-session Orca speech result (2026-09-28): the synthetic
journey reached the rendered Alice page; native X11 click/Tab focused the “New
controlled run” button and Orca spoke its label. One Bob escalation succeeded;
Alice's live-region text changed to “Discover and qualify demand changed from
in progress to escalated”, and Alice's authorized runtime readback was
`ESCALATED`. The corrected assertion restricted to Orca `SPEECH OUTPUT` lines
failed: neither the task title nor the exact transition appeared in spoken
output. No retry, provider/credential/external effects occurred, and app, DB,
browser, Orca, audio and display fixture processes were cleaned. Evidence:
`/tmp/orgward-pr06-cross-session-announcement-proof-15/run.log`,
`/tmp/orgward-pr06-cross-session-announcement-proof-15/orca-debug.log`,
`/tmp/orgward-pr06-cross-session-announcement-proof-15/alice-after.dom.txt`,
and `/tmp/orgward-pr06-cross-session-announcement-proof-15/attempt-summary.txt`.
Cross-session screen-reader speech remains unverified; PR-06 remains first open,
and cursor/release gates are unchanged.

PR-06 generic live-region role adjustment (2026-09-28): proof-15 showed Orca
received the dedicated process announcement node as a `status bar` and did not
emit the transition as speech. Removed its explicit `role="status"`, retaining
the detached `aria-live="polite"` and `aria-atomic="true"` semantics so it is
exposed as a generic live region; selected-run status role is unchanged. Focused
helper, announcer and served-client tests passed 25/25 (0 failures/skips; 0.93s
command wall), log `/tmp/orgward-pr06-orca-role-focused-final.tap.log`. `git diff
--check` and proof-16 script syntax passed. Proof-16's subsequent result is
recorded below; proof-15 evidence remains preserved. No provider or credential
activity occurred. PR-06 remains first open; cursor and release gates are
unchanged.

PR-06 proof-16 cross-session Orca speech result (2026-09-28): one synthetic run
passed native click/Tab and baseline “New controlled run” speech, performed one
Bob escalation, displayed the transition in Alice's before/after page evidence,
and returned authorized runtime status `ESCALATED`. The five-second in-run
speech-only assertion exited 1 before seeing the transition line. The retained
Orca log later in that same run contains
`SPEECH OUTPUT: 'Discover and qualify demand changed from in progress to escalated.'`;
the capture window/timing assertion failed even though the spoken transition was
recorded. This is not a passing harness command. No retry, provider/credential/
external effects occurred; app, database, Chrome, Orca, audio and display
processes were cleaned. Evidence:
`/tmp/orgward-pr06-cross-session-announcement-proof-16/run.log`,
`/tmp/orgward-pr06-cross-session-announcement-proof-16/orca-debug.log`,
`/tmp/orgward-pr06-cross-session-announcement-proof-16/alice-before.dom.txt`,
`/tmp/orgward-pr06-cross-session-announcement-proof-16/alice-after.dom.txt`, and
`/tmp/orgward-pr06-cross-session-announcement-proof-16/attempt-summary.txt`.
PR-06 remains first open; cursor and release gates are unchanged.

PR-06 task profile empty-state copy (2026-09-28): saved task cards now distinguish
an empty server execution-profile list, directing users to an OrgWard administrator,
from existing profiles that cannot serve the task because model profiles require
an input and information output. The latter copy also offers adding task inputs/
outputs or selecting a non-model profile; it does not imply missing credentials.
Served-client regression passed 1/1 (0.77s), TAP
`/tmp/orgward-tests-JyuHu2/node-test.tap.log`. The single `npm run check` passed
329/330 (329 passed, 0 failed, 1 optional PostgreSQL backup/restore skip because
client tools are unavailable; 75.22s TAP), TAP
`/tmp/orgward-tests-OHIst3/node-test.tap.log`. `node --check public/execution.js`
and `git diff --check` passed. PR-06 remains first open; cursor and release gates
unchanged.

PR-06 task profile empty-state copy repair (2026-09-28): clarified that when
configured profiles exist but none can run the task, the user can ask an OrgWard
administrator to configure a non-model profile. Focused served-client test passed
1/1 (0.67s), TAP `/tmp/orgward-tests-X3VUrO/node-test.tap.log`. The single check
on the repaired source passed 329/330 (329 passed, 0 failed, one optional
PostgreSQL backup/restore skip because client tools are unavailable; 76.69s TAP,
77.87s total), TAP `/tmp/orgward-tests-9W6imt/node-test.tap.log`. `node --check
public/execution.js` and `git diff --check` passed. PR-06, cursor, and release gates
remain unchanged.

PR-06 linked saved-result disclosure summary (2026-09-28): the collapsed task-row
summary now shows the validated terminal status and bounded artifact count, using
singular/plural wording and `100+` when capped; output previews and artifact links
remain inside the disclosure. Focused helper and served-client tests passed 8/8
(0.68s), TAP `/tmp/orgward-tests-xNYpCK/node-test.tap.log`; an initial focused
attempt found two stale assertions, which were updated. The single frozen-source
`npm run check` passed 330/331 (330 passed, 0 failed, 1 optional PostgreSQL
backup/restore skip because client tools are unavailable; 75.40s TAP, 76.55s
total), TAP `/tmp/orgward-tests-2pR9jN/node-test.tap.log`. `node --check` for the
edited client/helper and `git diff --check` passed before and after. PR-06, cursor
and release gates remain unchanged.

PR-06 assignment disclosure summary (2026-09-28): the collapsed role-guidance
disclosure now distinguishes a planned actor specified in the pinned blueprint
from a currently enabled, eligible organizational target, without showing the
target name in the summary. Expanded guidance and permission details remain
unchanged. Focused assignment-helper and served-client tests passed 8/8 (0.69s),
TAP `/tmp/orgward-tests-KTCDIR/node-test.tap.log`. The single frozen-tree
`npm run check` passed 331/332 (331 passed, 0 failed, 1 optional PostgreSQL
backup/restore skip because client tools are unavailable; 75.86s TAP, 76.98s
total), TAP `/tmp/orgward-tests-BvUbfh/node-test.tap.log`. `node --check` for the
edited client/helper and `git diff --check` passed before and after. PR-06, cursor
and release gates remain unchanged.

PR-06 pinned provider-input review (2026-09-28): the authorized model-task run
view now exposes an expandable, text-only projection of the exact persisted source
envelope and output target. It labels all task/source/target text as untrusted
factual data and target-before as a proposed-update baseline, validates the full
bounded shape and blueprint pin, and shows an explicit legacy/unavailable state
without partial data. The existing fixture-backed PostgreSQL request journey
asserts pre-dispatch snapshot data, cross-tenant run-read denial, exact snapshot
and view persistence after restart. Focused helper, served-client and persistence
tests passed 48/48 (66.58s), TAP `/tmp/orgward-tests-X41Y8e/node-test.tap.log`.
The single frozen-tree `npm run check` passed 334/335 (334 passed, 0 failed,
1 optional PostgreSQL backup/restore skip because client tools are unavailable;
75.80s TAP, 76.98s total), TAP
`/tmp/orgward-tests-ntZlZj/node-test.tap.log`. Syntax checks and `git diff --check`
passed before and after. No live provider call or browser test. PR-06, cursor and
release gates remain unchanged.

PR-06 saved-result disclosure focus recovery (2026-09-28): expanded disclosures
already retained their open state across task-card rerenders, and changed
cross-session snapshots defer while focus remains in the plan. A same-snapshot
reconciliation can still rerender cards; it now captures focused result summaries
and links by exact project/run key and restores the matching element without
scrolling. Closed disclosures remain closed and can be reopened normally. Focused
helper, served-client and refresh tests passed 20/20 (0.85s), TAP
`/tmp/orgward-tests-AQePyd/node-test.tap.log`. The single frozen-source
`npm run check` passed 390/391 (390 passed, 0 failed, 1 optional PostgreSQL
backup/restore skip because client tools are unavailable; 79.15s TAP), TAP
`/tmp/orgward-tests-HnyXku/node-test.tap.log`. `node --check` on edited client and
tests plus `git diff --check` passed. No browser/provider activity. PR-06 cursor,
checkboxes and release gates remain unchanged.

The default `npm test` runner uses Node's process-isolated test-file workers with
concurrency 2. When selected tests need PostgreSQL, the runner creates one
runner-owned disposable loopback cluster per invocation and passes its internally
owned base URL to workers; caller-provided database URL variables are discarded.
Each `startPostgres()` call creates a uniquely named empty database on that
cluster, and fixture `close()` drops it after its pools close. Worker and runner
teardown stop the cluster and clean up leftovers on completion or failure.
Selections without PostgreSQL tests start no cluster. The disposable test server
uses `fsync=off`, `synchronous_commit=off`, `full_page_writes=off`, and bounded WAL
to avoid checkpoint/disk quota stalls; production database settings are unchanged.
The earlier per-test-file cluster lifecycle described in dated receipts is
historical and superseded by this runner-owned lifecycle.
Transactions, isolation, application restarts and migration rollback are exercised,
but test results do not prove PostgreSQL crash or power-loss durability.
No persistent PostgreSQL daemon is left running. Focused test invocations that do
not select PostgreSQL suites do not start it. The planned `npm run check`, after
the event-driven dispatch-watchdog test wait, passed 246/247 tests with 246
passed, 0 failed and 1 optional PostgreSQL backup/restore skip because client
tools were unavailable (`ORGWARD_PG_TOOLS_BIN` not set; 67.09s TAP, 69.65s
wall). The focused watchdog test passed 1/1 (6.44s case, 6.88s TAP, 6.96s
wall); its full
suite case duration fell from 6.50s to 5.63s. A redundant check was accidentally
started during a log lookup; it also passed 246/247 (66.36s TAP) and left no
PostgreSQL process running. `git diff --check` passed. The
preceding focused failure-policy and served-client tests passed 2/2 (0.69s TAP),
and the saved-process PostgreSQL conflict/recovery test passed 1/1 (10.66s TAP,
10.73s wall). Only non-retryable state-conflict 409s refresh project, actor
bindings, runtime and actions; validation codes `INVALID_HUMAN_TASK_OUTCOME` and
`INVALID_HUMAN_TASK_ESCALATION` preserve the form and show the validation error.
Retryable outcomes, including retryable 409s, retain the same pending command.
Logs: `/tmp/orgward-dispatch-uncertainty-check-20260927.log`,
`/tmp/orgward-tests-QkJO8h/node-test.tap.log`,
`/tmp/orgward-tests-k7hOAs/node-test.tap.log` (redundant run),
`/tmp/orgward-dispatch-uncertainty-focused-20260927.tap.log`,
`/tmp/orgward-dispatch-uncertainty-focused-20260927.time.log`,
`/tmp/orgward-pr06-human-conflict-repair-focused-20260927.log`, and the prior
PostgreSQL receipt `/tmp/orgward-pr06-human-conflict-pg-20260927.log`. The sole
skip was the optional backup/restore journey because client tools were unavailable.
One user-authorized fresh DeepSeek dispatch occurred. The local execute API
returned HTTP 200 while the run ended `FAILED` with its provider attempt marked
`outcome_unknown`; upstream status and output were unavailable. No retry was
made. PR-06 remains open with cursor/gates unchanged.
PR-06 cross-session process freshness slice (2026-09-27): Execution now checks
task-instance state every 15 seconds while visible and immediately on returning
to the tab. It applies only current-project responses, defers replacing saved-plan
cards while a card control is focused or has unsaved input, retries deferred data
after focus leaves, and exposes refresh failures and updates through one polite
status message. Focused state and served-client tests passed 3/3 (0.66s TAP),
log `/tmp/orgward-tests-hQ51nj/node-test.tap.log`. The single frozen-tree
`npm run check` passed 277/278 (277 passed, 0 failed, 1 optional PostgreSQL
backup/restore skip because client tools are unavailable; 70.92s runner,
70.85s TAP), log `/tmp/orgward-pr06-cross-session-freshness-check-20260927.log`,
TAP `/tmp/orgward-tests-yURhrk/node-test.tap.log`. `git diff --check` passed
before and after the check. No provider calls or credential access. PR-06 remains
first open, cursor and release gates unchanged.
PR-06 freshness review repair (2026-09-27): snapshot equality now takes
precedence over focus/dirty-input checks, so unchanged polls do not defer, render,
or alter the live status; only changed snapshots are deferred or applied. Added
behavior coverage for unchanged+focused, changed+dirty and changed+clean cases.
Focused tests passed 4/4 (0.73s), log `/tmp/orgward-tests-1ZHZkm/node-test.tap.log`.
The single frozen-tree `npm run check` passed 278/279 (278 passed, 0 failed,
1 optional PostgreSQL backup/restore skip because client tools are unavailable;
70.58s runner, 70.50s TAP), log
`/tmp/orgward-pr06-cross-session-review-repair-check-20260927.log`, TAP
`/tmp/orgward-tests-w9xIBm/node-test.tap.log`. `git diff --check` passed before
and after. PR-06 remains first open; cursor and release gates unchanged.
An optional headed two-session render proof was not completed: the available
reusable fixture uses provider-specific setup, while a stripped disposable
fixture draft stopped during plan-revision setup on `INVALID_PROCESS_PLAN_ROLE`.
It was torn down before any browser UI action; no provider or credential service
was called. Cross-session behavior for this repair is covered by focused tests,
not a new browser receipt.
PR-06 freshness defer-message repair (2026-09-27): changed refresh snapshots now
distinguish unsaved edits from focus-only protection. Dirty form values say to
save or discard the edit; a focused but clean task/status target says to move
focus outside the plan. Focused tests passed 6/6 (0.73s), log
`/tmp/orgward-tests-wxBedN/node-test.tap.log`. The single frozen-tree
`npm run check` passed 280/281 (280 passed, 0 failed, 1 optional PostgreSQL
backup/restore skip because client tools are unavailable; 71.38s runner,
71.50s TAP), log
`/tmp/orgward-pr06-cross-session-defer-message-check-20260927.log`, TAP
`/tmp/orgward-tests-ezNTej/node-test.tap.log`. `git diff --check` passed before
and after. The optional headed proof was not run: the valid test pattern provides
API-only bearer identities, while browser UI requires its separate normal OIDC
login harness; the available browser harness includes provider/credential setup.
No provider or credential call was made and no browser action was attempted.
PR-06 remains first open; cursor and release gates unchanged.
PR-06 provider-free cross-session browser proof (2026-09-27): a disposable
loopback app/PostgreSQL fixture used the normal synthetic OIDC `/auth/login` flow
in two headed agent-browser sessions, with no execution profiles configured.
The fixture followed the persistence test's founder business answers, Bob editor
membership, founder actor binding, `process-deliver` plan, and assigned
`task-process-learn` human task. Bob's page showed ESCALATED; Alice submitted one
owner `Resolve escalation` action with resume. Bob's first post-action DOM
inspection showed the same task IN_PROGRESS. The inspection interval was not
instrumented, so this is not a measured 15-second latency claim. AX snapshots and
screenshots: `/tmp/orgward-pr06-cross-session-proof-20260927/`. Fixture reported
zero provider calls and zero profiles. Both headed sessions and the disposable
app, issuer, PostgreSQL cluster/data and harness were stopped/removed. Focus-only
and dirty-form live browser deferral were not exercised in this proof; focused
behavior tests cover those dispositions/messages. No source/tests or release
gates changed; PR-06 remains open.
PR-06 cross-session transition announcement slice (2026-09-27): successful
poll application now announces task status transitions by matching project, plan,
revision, instance and task identity. Titles come from the matching saved plan
revision with a taskId fallback. First-seen and unchanged rows remain silent;
multiple changes are summarized with at most three named transitions plus a
remaining count. Existing focus/dirty deferrals, stale-response guards, and the
plan subtree's non-live-region behavior remain intact. Focused refresh tests
passed 9/9 (0.23s); log `/tmp/orgward-pr06-refresh-announcement-focused-20260927.log`,
TAP `/tmp/orgward-tests-3wojob/node-test.tap.log`. The single frozen-tree
`npm run check` passed 284/285 (284 passed, 0 failed, 1 optional PostgreSQL
backup/restore skip because client tools are unavailable; 71.54s), log
`/tmp/orgward-pr06-refresh-announcement-check-20260927.log`, TAP
`/tmp/orgward-tests-No62ub/node-test.tap.log`. `git diff --check` passed.
No provider calls or credential access. No Orca run was made for this slice;
spoken transition behavior remains unverified. PR-06 remains first open; cursor
and release gates unchanged.
PR-06 cross-session refresh Orca follow-up (2026-09-27): a private
D-Bus/Xvfb/PulseAudio smoke setup succeeded (`pactl info` confirmed the local
null-sink server), and its short-lived processes were cleaned by the setup trap.
The existing cross-session proof left screenshots/AX snapshots but no reusable
live app, issuer, or browser fixture; the remaining OIDC browser harness contains
provider-specific setup and was not used. No Alice/Bob refresh or Orca
`SPEECH OUTPUT` check was performed, so changed-status speech is unverified.
No provider/credential access, source edits, or tests. PR-06 remains first open;
cursor and release gates unchanged.
PR-06 refresh announcement component Orca check (2026-09-27): an initial
component exercise used a populated template clone and is not treated as a valid
speech result. A corrected final attempt attached the empty `#new-run-template`
fragment, confirmed `document.getElementById('process-instance-refresh-status')`
was empty and attached, then computed the transition through the real helper and
set “Prepare deliverables changed from escalated to in progress.” on that same
node. The DOM update was confirmed. Orca 50.2 emitted no task-specific
`SPEECH OUTPUT` or corresponding status text-change event. The one status event
in the trace was an unrelated JSON parse error from the unauthenticated static
server's API request; page-load speech followed. Sanitized record:
`/tmp/orgward-pr06-announcement-component-speech-evidence-20260927.txt`.
Browser, Orca, Xvfb, PulseAudio, audio capture and static server were stopped;
temporary profile and raw audio/logs removed. This is a component-only DOM
update result, not proof of spoken cross-session behavior or accessibility
qualification. No API fixture, provider, credential, source/test edits, or full
check. PR-06 remains first open; cursor and gates unchanged.
PR-06 authenticated two-session Orca attempt (2026-09-27): the one
provider-free fixture launch stopped before PostgreSQL/app/issuer startup while
loading the temporary script: Node ESM rejected the CommonJS `pg/lib/index.js`
named import (`Named export 'Pool' not found`). Per the bounded stop condition,
no correction/retry was made. No DB/app/browser/Orca processes or state changes,
login, task transition, or speech evidence resulted. Temporary harness removed;
no source/test/provider/credential changes. PR-06 remains first open; cursor and
gates unchanged.
Latest PR-06 rendered terminal-blocker recovery proof (2026-09-27): agent-browser 0.38.1 with Chromium `--no-sandbox` exercised a disposable loopback app/PostgreSQL fixture containing `task-process-learn` FAILED and unstarted `task-process-deliver` → `task-process-review` in the same instance. At 1280×900 and 390×844, the review task rendered BLOCKED and named the transitive failed prerequisite, explained starting a new instance from the first task, and stated that saved outcomes/evidence remain available. Neither blocked task row exposed an action; document horizontal overflow was 0px at both widths. Accessible snapshots named the review heading “Review and steer the enterprise — BLOCKED”; programmatic focus reached its `tabindex=-1` heading with the visible focus outline, and Tab then advanced to the next interactive form control. The recovery instruction is normal text in the same task reading order and is not a separate tab stop. No page/console errors. Rendered proof exposed that the recovery paragraph was hidden when assignment was unavailable; moved blocked-state guidance ahead of assignment status and added a focused served-client regression assertion. Focused tests passed 2/2 (0.69s); the one repaired-tree `npm run check` passed 247/248 (247 passed, 0 failed, 1 optional backup/restore skip; 68.79s runner / 68.71s TAP). `git diff --check` passed. Screenshots and sanitized snapshots/metrics: `/tmp/orgward-pr06-blocked-proof/desktop-1280x900.png`, `/tmp/orgward-pr06-blocked-proof/mobile-390x844.png`, and adjacent `*-snapshot.txt` / `*-metrics.json`; full check log `/tmp/orgward-pr06-blocked-check-20260927.log`, TAP `/tmp/orgward-tests-7CyJrX/node-test.tap.log`. Browser, app and PostgreSQL fixtures were closed and temporary database files removed. No provider or credential access. PR-06 remains first open; cursor and release gates unchanged.
PR-06 rendered journey proof (2026-09-27): headed agent-browser exercised normal `/auth/login` → loopback test issuer → `/auth/callback` sign-in for synthetic Bob and Alice identities. Bob started/escalated the assigned checkpoint, Alice resumed it as project owner, Bob completed it with evidence and requested the dependent saved-plan task, and Alice independently approved/executed the configured local-command profile. The run rendered SUCCEEDED with one `task-result.txt` artifact and append-only request/approval/start/success activity. After app-only restart against the same disposable PostgreSQL DB, the persisted owner session, linked plan/instance, run result, artifact and event history rendered again. A fresh outsider login received HTTP 404 `PROJECT_NOT_FOUND` for the tenant-a project. Provider calls: 0; no source or tests changed. Desktop and narrow rendered screenshots and accessible snapshots are under `/tmp/orgward-pr06-current-rendered-proof/`; details and limits are in its `proof.txt`. At 390px the document reported 528px scroll width (138px horizontal overflow); actions used browser click/fill, not keyboard-only interaction; Orca speech and production IdP behavior were not tested. All browser sessions, app processes, disposable PostgreSQL and temporary fixture scripts/data were cleaned. The single full `npm run check` was interrupted after the persistence test process stopped producing output for over four minutes (worker idle in epoll; disposable PostgreSQL postmaster had exited, leaving an orphan background writer). Its partial TAP summary reports 230 passed, 35 failed, 2 cancelled and 1 optional backup/restore skip across 268 tests in 357.4s; first failures were in blueprint actor identity proposals, legacy import, and multiple persistence-backed cases, with broad subsequent persistence failures. No assertion detail was flushed before interruption, so no common source cause is established. No retry was made. `git diff --check` passed. Logs: `/tmp/orgward-pr06-current-rendered-proof/npm-check.log` and `/tmp/orgward-tests-vEkhR2/node-test.tap.log`. PR-06 remains first open; cursor and release gates unchanged.
PR-06 repaired verification follow-up (2026-09-27): the prior first failing acceptance fixture was isolated to `tests/persistence.test.mjs` sending a caller-claimed `actor` to an authenticated architecture-accept action; the server’s verified-identity rejection remains intact and the shared test helper now relies on authenticated context. The narrow-screen activity history now wraps long event types and OIDC actor metadata; CSS/served-client regression assertions cover wrapping. An initial post-edit focused run failed with PostgreSQL SQLSTATE 53100 (disk quota exceeded). After confirming no active PostgreSQL process, removed only eight stale disposable test roots named in the repair log, leaving proof/TAP files untouched; `/tmp` free space rose from 684MB to 1.5GB. The combined focused command `npm test -- tests/persistence.test.mjs tests/execution/accessibility.test.mjs tests/execution/server.test.mjs` passed 47/47 in 61.65s. One final `npm run check` passed 265/266 (265 passed, 0 failed, 0 cancelled, 1 optional PostgreSQL backup/restore skip because client tools are unavailable; 73.74s TAP / 76.56s wall). `git diff --check` passed. Logs: `/tmp/orgward-pr06-repair-focused-final-20260927.log`, `/tmp/orgward-tests-QvAcfj/node-test.tap.log`, `/tmp/orgward-pr06-repair-check-final-20260927.log`, and `/tmp/orgward-pr06-repair-check-final-20260927.time.log`. The earlier interrupted check and quota-failed focused attempt are preserved as historical receipts. No fresh browser rerender was made after the CSS change; the earlier 390px measurement is pre-fix and CSS wrapping is verified through the served-client/focused tests. No provider calls or credentials. PR-06 remains first open; cursor and release gates unchanged.
PR-06 post-fix activity wrapping render proof (2026-09-27): agent-browser loaded the actual `public/execution.css` in a temporary local fixture. At 390×844, document scrollWidth was 390px; long OIDC actor metadata wrapped to three lines and remained inside the event panel. At 1280×900, scrollWidth was 1280px and metadata remained visible on one line. Screenshots, accessible snapshot and metrics are under `/tmp/orgward-pr06-repair-render-proof/`. The temporary server, browser session and fixture source were cleaned. No app DB or provider was used; no tests were rerun. PR-06 remains open; cursor and gates unchanged.
PR-06 mobile overflow follow-up (2026-09-28): inspected the current Execution source and the retained post-fix render proof. The documented 390px overflow is resolved: event rows wrap and long metadata uses `overflow-wrap:anywhere`; the retained render measured document width 390px at 390×844 and 1280px at 1280×900. Current served-client/accessibility assertions cover those wrapping rules. No code change was needed. Focused `npm test -- tests/execution/accessibility.test.mjs tests/execution/server.test.mjs` passed 3/3 (0.73s), TAP `/tmp/orgward-tests-UxrqLA/node-test.tap.log`. The single `npm run check` passed 309/310 (309 passed, 0 failed, 1 optional PostgreSQL backup/restore skip because client tools are unavailable; 78.63s), TAP `/tmp/orgward-tests-8pHdtu/node-test.tap.log`. `git diff --check` passed. The next customer UX evidence gap is actual spoken cross-session status announcements; prior Orca receipts are inconclusive, and no browser/Orca runtime reattempt was made per the current environment constraint. No provider/credential access or external effects. PR-06 remains first open; cursor and release gates unchanged.
DeepSeek credential lookup follow-up (2026-09-27): one additional small provider test was requested, but the expected local credential source is absent. OpenClaw resolved to `/home/ubuntu/.openclaw/openclaw.json` and `agents/main/agent/openclaw-agent.sqlite`; neither file nor the state directory exists. The process environment has no `DEEPSEEK_API_KEY`, OrgWard DeepSeek profile, database URL, or secret-encryption key, and no `.env`/`*.env` files were found under `/home/ubuntu`, `/srv`, or `/etc`. No credential value was read or emitted and no provider request was sent. The earlier `outcome_unknown` run remains untouched; a protected file path or OrgWard secret reference is needed for another live proof.

Latest PR-06 dependency recovery UX follow-up: downstream tasks now show
`BLOCKED` with terminal prerequisite names/statuses, including blockers carried
through unstarted tasks; another instance cannot unblock the selected one. The
focused state/served-client suite passed 2/2. The persistence pause/dispatch race
test now releases its worker after the per-run start marker and classifies a 409
as dispatch-wins. Its focused PostgreSQL case passed 1/1 (9.48s case, 9.87s TAP).
The final `npm run check` passed 247/248 (247 passed, 0 failed, 1 optional
backup/restore skip; 61.87s TAP). `git diff --check` passed. Two superseded
checks exposed and drove repair of the delayed worker release and fast-409
classification; the final event-barrier check is the current receipt. No provider
call or credential access occurred. Log: `/tmp/orgward-tests-qpkGOW/node-test.tap.log`.
PR-06 remains first open; T-22 evidence and release gates remain pending.
Previous DeepSeek diagnostics follow-up: the final `npm run check` passed 247/248 tests
(247 passed, 0 failed, 1 optional PostgreSQL backup/restore skip; 64.23s TAP,
64.33s wall). Focused diagnostic tests passed 20/20 and `git diff --check`
passed. The loopback cases persisted only HTTP status and allowlisted parser
classes, kept provider body/header/credential canaries out of run/event/UI
output, and confirmed restart recovery and no redispatch. No live provider call
occurred during this follow-up. Full-check log: `/tmp/orgward-tests-ipDutR/node-test.tap.log`.
OpenClaw credential follow-up
(2026-09-27; PR-06 remains open): its service configuration references
`DEEPSEEK_API_KEY` from an owner-only `.env`. A preflight transfer accidentally
emitted that value in a tool result before any OrgWard fixture, secret storage, or
provider dispatch occurred. Treat the source key as compromised; it was not
rotated, and the OpenClaw source file was not changed. At that point live proof
was paused pending rotation or replacement; the earlier outcome-unknown run was
not retried.
An attempted bounded rendered check was stopped before app, PostgreSQL or browser
fixtures started because no reusable browser harness was available. PR-06, the
active cursor and release gates remain unchanged. The immediately preceding
linked-run result summary check had failed on the RUNNING-before-cancel timing
assertion; its exact failure is retained below. The preceding DeepSeek Responses
endpoint correction `npm run check`
passed 240
of 241 tests with 240 passed, 0 failed and 1 optional PostgreSQL backup/restore
skip because client tools were unavailable (`ORGWARD_PG_TOOLS_BIN` not set;
66.31s TAP, 68.92s runner wall). Focused status-diagnostic, provider/restart and
served-client coverage passed 14/14 (9.97s TAP). `git diff --check` passed. Logs:
`/tmp/orgward-pr06-safe-provider-diagnostic-focused-rerun.log`,
`/tmp/orgward-pr06-safe-provider-diagnostic-check.log`,
`/tmp/orgward-pr06-safe-provider-diagnostic-check.time`, and
`/tmp/orgward-tests-c2n4zo/node-test.tap.log`. An initial focused run exposed an
overly specific served-source assertion; the predicate was corrected to match the
actual integer/range validation and the entire focused set passed. No provider
call was made. The sole full-check skip was the optional backup/restore journey
because client tools were unavailable. The preceding DeepSeek profile increment
`npm run check` passed 237
of 238 tests with 237 passed, 0 failed and 1 optional PostgreSQL backup/restore
skip because client tools were unavailable (`ORGWARD_PG_TOOLS_BIN` not set;
69.77s TAP, 72.34s runner wall). Focused affected coverage passed 79/79 (75.43s
wall), and the final proposal-identity follow-up passed 5/5 (0.23s wall).
`git diff --check` passed. Logs: `/tmp/orgward-deepseek/focused-final2.log`,
`/tmp/orgward-deepseek/focused-final2.time`,
`/tmp/orgward-deepseek/proposals-review.log`,
`/tmp/orgward-deepseek/proposals-review.time`,
`/tmp/orgward-deepseek/npm-check.log`, `/tmp/orgward-deepseek/npm-check.time`, and
`/tmp/orgward-tests-vsfAyw/node-test.tap.log`. The sole skip was the optional
backup/restore journey because client tools were unavailable. One live DeepSeek
request was attempted after those checks in a disposable, loopback-only OrgWard /
PostgreSQL fixture. The run failed and its sole dispatch attempt ended
`outcome_unknown`, so the provider may have received it; no retry was sent. The
fixture database and app data were removed, and no successful live result or
restart readback is claimed. Safe receipt:
`/tmp/orgward-deepseek/live-proof-1790484208611.json`. DeepSeek behavior otherwise
remains verified against loopback test fixtures. PR-06 remains first open and its
cursor and release gates are unchanged.
Earlier initial focused attempts and corrected test expectations are recorded in
`/tmp/orgward-deepseek/focused.log` and
`/tmp/orgward-deepseek/focused-repair-final.log`. The previous implementation
`npm run check`, after the PR-06 linked-run cancellation consistency follow-up,
passed
233 of 234 tests with 233 passed, 0 failed and 1 optional PostgreSQL backup/restore
skip because client tools were unavailable (`ORGWARD_PG_TOOLS_BIN` not set;
68.25s TAP, 70.85s runner wall). Focused instance-controlled cancellation,
requester-only withdrawal, served-client and migration-upgrade tests passed 7/7
(4.30s wall); the PostgreSQL cancellation/restart integration passed 1/1
(13.26s wall). `git diff --check` passed. Logs:
`/tmp/orgward-instance-linked-cancel/focused-unit-final.log`,
`/tmp/orgward-instance-linked-cancel/focused-persistence-repair.log`,
`/tmp/orgward-instance-linked-cancel/npm-check.log`, and
`/tmp/orgward-tests-oZJUa1/node-test.tap.log`. The optional recovery test was
skipped because PostgreSQL client tools were unavailable (`ORGWARD_PG_TOOLS_BIN`
not set). PR-06 remains first open and its cursor is unchanged. The preceding
applied-proposal object deep-link increment passed 229 of 230 tests with 229
passed, 0 failed and 1 optional PostgreSQL backup/restore skip because client tools
were unavailable (`ORGWARD_PG_TOOLS_BIN` not set; 67.74s TAP, 70.01s runner wall).
Focused proposal review and served-client tests passed 6/6
(0.80s wall); the first attempt failed on a source assertion that did not match the
array guard, then passed after the assertion was corrected. `git diff --check`
passed. Logs: `/tmp/orgward-pr06-proposal-deep-link-focused.log`,
`/tmp/orgward-pr06-proposal-deep-link-focused.time`,
`/tmp/orgward-pr06-proposal-deep-link-focused-repair.log`,
`/tmp/orgward-pr06-proposal-deep-link-focused-repair.time`,
`/tmp/orgward-pr06-proposal-deep-link-check.log`,
`/tmp/orgward-pr06-proposal-deep-link-check.time`, and
`/tmp/orgward-tests-lAjRyh/node-test.tap.log`. Follow-up rendered-browser
verification was attempted with agent-browser against a disposable loopback app,
but Chrome failed before DevToolsActivePort with `No usable sandbox`, including
when the documented `--args "--no-sandbox"` option was supplied. No rendered page
or screenshot was produced; no app or provider state was changed, and temporary
app data and browser sessions were cleaned up. The preceding narrow-viewport
rendered checks at 390×844 and 1280×900 confirmed the source link/edit action row
no longer overlaps the separately laid out process-instance selector. Keyboard
Tab reached “Edit planned graph” with a visible 3px focus outline; the browser
accessibility tree exposed distinct names for the button and combobox.
Subsequent bounded rendered-browser journey (2026-09-26) used agent-browser
0.38.1 with Chromium `--no-sandbox`, an isolated loopback app/PostgreSQL
fixture, fake OIDC identities, and one loopback OpenAI Responses fixture call.
The UI rendered saved revision 3, human checkpoint start/completion with
evidence, dependent agent approval/result, cited proposal review/apply to
blueprint v2, and the updated-design link selecting the changed object. After
restarting the app against the retained disposable DB, Execution still showed
the human evidence and terminal task states; reopening the run showed its
successful result, citation, applied proposal and v2 provenance. Browser page
errors and console checks returned no entries. Screenshots and exact limits are
recorded in `/tmp/orgward-pr06-rendered/summary.log`; captures include
`01-plan.png`, `02-human-started.png`, `03-checkpoint-agent-request.png`,
`04-independent-approval.png`, `05-proposal-review.png`, `06-applied-design.png`,
and `07-after-restart-result.png`. The harness restart handler printed a
JavaScript const-reassignment error after its replacement app had started; that
replacement served the post-restart browser view successfully. Cleanup stopped
the app/provider/PostgreSQL fixture and closed both browser sessions. No source,
tests, or persistent app data changed. This is fixture-only rendered evidence;
no live provider, narrow-viewport, screen-reader or production-browser proof was
performed. PR-06 and release-gate statuses and the active cursor remain
unchanged.
Orca follow-up (2026-09-26) used Orca 50.2 with Chromium 154 in a private
D-Bus/Xvfb/PulseAudio session. Chromium needed `GTK_MODULES=gail:atk-bridge`,
`ACCESSIBILITY_ENABLED=1`, `QT_ACCESSIBILITY=1`, and
`--force-renderer-accessibility=complete` to register on AT-SPI. Orca announced
the process-instance combobox name/value; an AT-SPI focus on “Edit planned graph”
was spoken as “Edit planned graph, button.” Real X11 Tab events also moved DOM
focus through the process controls. Speech Dispatcher output was captured through
a PulseAudio null sink, and nonzero samples confirmed generated speech
(the temporary audio recording was removed after validation; no human listening
claim is made). Orca trace: `/tmp/orgward-orca-debug-restart.log`. Earlier viewport
check logs: `/tmp/orgward-pr06-a11y-full-check.log` and
`/tmp/orgward-tests-MhJyJW/node-test.tap.log`. The preceding saved-design → human
checkpoint → dependent agent result/restart journey and loopback provider receipt
remain below; no live provider call was made. PR-06 remains first open.
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

- [x] PR-06 — Durable human/agent work and private operating journey (T-19–T-24,
  then T-11; P-07–P-10, P-12; E-07–E-08). Run process/task graphs through leased,
  crash-recoverable work with pause/resume/cancel, mandatory human checkpoints,
  isolated tools and one real bounded model provider. Then enable sourced proposal
  generation and prove the complete private design-to-result journey across restart.
  Priority slice: start from a saved, edited business design; assign human and agent
  work; exercise an intervention or escalation; then review the persisted outcome
  and evidence after restart. Complete this customer path before broad standalone
  resilience and operations qualification, while keeping authorization, tenant
  isolation, safe tool bounds and auditable state transitions in the path.

  PR-06 bounded owner proposal-review increment (2026-09-30): applying a saved
  generated proposal now requires a separate, append-only review by a verified
  human workspace owner. The versioned rubric asks about task relevance, factual
  accuracy and support from pinned cited sources, actionability, and scope/risk.
  Each judgment requires an explicit pass/needs-attention choice, a bounded reason,
  and at least one exact cited source ID/hash. Reviews bind to run, proposal hash,
  blueprint ID/version and source-envelope hash. Only the latest valid all-pass
  review enables apply; later negative, malformed or unsupported reviews prevent
  reuse of an older pass. The apply event records the review event/hash, and the
  review remains visible after apply/restart. Structural checks remain separately
  labeled; the UI states that human judgments are not automated scores and hashes
  do not establish truth. Focused helper/state/proposal/served-client tests passed
  20/20 (1.023s); after final latest-event fail-closed and rubric-copy changes,
  helper/state tests passed 8/8 (0.252s). The name-filtered PostgreSQL linked-task
  proposal journey passed 1/1 (16.848s), including workload/editor denial,
  apply-before-review, negative and superseded reviews, idempotent replay,
  application, and restart readback; its provider is a disposable loopback stub.
  `node --check server.mjs` and `git diff --check` passed. No live provider,
  credential, browser or full `npm run check` was run. This is human rubric review
  evidence, not automated provider-quality qualification or a tenant-wide dollar
  budget; PR-06, its cursor and release gates remain open.

  PR-06 human proposal-review rendered proof attempt (2026-09-30, revision
  `5637686`): one synthetic loopback fixture stopped at its first task action.
  Starting the assigned human root returned HTTP 409
  `PROCESS_TASK_STATE_CONFLICT` because the task was not in `PLANNED` state.
  Per the one-attempt stop rule, it was not retried. No browser opened, proposal
  was created, or provider request was made (0 dispatches). The controller
  cleaned the disposable app/PostgreSQL and synthetic profile/cookie state; no
  product source or tests changed. The fixture failure does not establish a
  product regression and leaves rendered owner review/apply, responsive and
  keyboard evidence unverified. Receipt:
  `/tmp/orgward-pr06-human-review-rendered-proof.json`. PR-06, cursor and release
  gates remain open and unchanged.

  PR-06 owner proposal-review browser fixture setup stop (2026-09-30): a
  disposable local-only fixture reached API identity and secret-profile setup,
  then the final focused run stopped before browser launch because the synthetic
  owner lacked the required `tenant-admin` grant for encrypted secret setup
  (`ACTION_FORBIDDEN`, 403). No provider dispatch occurred (0); no proposal,
  browser, review, apply, restart or narrow evidence was produced, and no product
  behavior was proved. The unproven fixture was removed; app and PostgreSQL
  cleanup completed, and no browser or fixture process remained. PR-06, cursor
  and release gates remain open and unchanged.

  Development provider authorization (2026-09-29): the user explicitly permits
  use of the exposed low-budget DeepSeek test key on this private VPS for bounded
  synthetic OrgWard verification and a fresh model task, and does not intend to
  rotate it. Its existing source is the owner-only OpenClaw `.env` file; parse its
  quoted value without printing, logging, committing or putting it in command
  arguments or the environment. Never replay a prior `outcome_unknown` request.
  This authorization does not permit unrelated live business effects or public
  deployment.

  PR-06 authorized DeepSeek and guided setup proof (2026-09-29): one direct
  synthetic Responses request with the parsed test key returned HTTP 200, and
  OrgWard's encrypted tenant-profile verification returned `verified`. A fresh
  disposable saved process task then made exactly one DeepSeek dispatch: the
  run SUCCEEDED with JSON output and a saved proposal. App restart readback
  retained the result; another tenant's run read returned 404. An attempted
  standalone run returned local HTTP 400 before dispatch because tenant-managed
  profiles belong to saved process tasks; no failed or unknown run was replayed.
  DeepSeek generation now disables reasoning within the bounded output cap. The
  fixed request-shape test passed 1/1 (0 failures/skips; TAP
  `/tmp/orgward-tests-AYVHAx/node-test.tap.log`).

  The delegated Administration submit handler now passes the actual form to all
  eight form handlers, including encrypted key and DeepSeek profile setup. A
  focused served-client test passed 1/1 (0 failures/skips; 0.39s harness; TAP
  `/tmp/orgward-tests-GYqB1W/node-test.tap.log`). A disposable browser check
  with a synthetic key showed secret PUT 200 before profile PUT 201, a listed
  profile, cleared password, no key in rendered body, and no page or console
  errors; it did not call the provider. The active-task drift test passed 1/1,
  `npm run task:next` selected PR-06, and the orchestrate skill validator passed.
  Sanitized live receipt: `/tmp/orgward-deepseek-live-proof-receipt.json`. No
  persistent customer instance, screen-reader pass, complete founder journey or
  full PR-06 check is claimed; PR-06, its cursor and release gates remain open.

  PR-06 model prompt and usage evidence slice (2026-09-29): model prompts are
  now capped at 16 KiB UTF-8 during approved-run preflight, before dispatch
  authorization and credential brokering. Completed Responses usage is persisted
  only as validated numeric input/output/total token counts; missing or malformed
  usage remains `unreported`, and uncertain dispatch remains `reserved` with no
  replay. The existing output cap, timeout, disabled tools and single-attempt
  behavior are unchanged. Run evidence hashes and proposal integrity hashes bind
  the usage summary, and the saved-result projection accepts only this bounded
  usage shape. Focused provider, proposal, result-projection and linked-process
  restart tests passed 7/7 (0 failures, 0 skips; 20.12s TAP); log
  `/tmp/orgward-pr06-model-usage-focused.log`. `npm run task:next` selected PR-06
  and `git diff --check` passed. Loopback fixtures only; no live provider or
  credential was used. Existing prompt-cap coverage uses the same 16 KiB constant;
  this slice did not add tenant-specific dollar quotas or claim model quality
  evaluation. PR-06 and release gates remain open.

  PR-06 proposal usage-state validator follow-up (2026-09-29): generated
  proposals now accept only `reported` or `unreported` usage from completed
  Responses; `reserved` and `dispatch_not_started` remain execution-failure
  metadata only. Server integrity and saved-result projection tests reject both
  invalid proposal states. Focused proposal/projection tests passed 25/25 (0
  failures, 0 skips; 0.31s TAP); log
  `/tmp/orgward-pr06-model-usage-validator-focused.log`. Syntax and
  `git diff --check` passed; PR-06 and release gates remain open.

  PR-06 joined PostgreSQL saved-design-to-result assertions (2026-09-30):
  extended the existing linked-task fixture without setup refactoring. The
  joined scenario starts from a saved proposal-edited blueprint, pins assigned
  human and agent work to that version, completes its evidence-bearing human
  checkpoint, and asserts exactly one loopback dispatch for the dependent agent
  task. The owner separately reviews and applies the resulting proposal. Focused
  PostgreSQL test passed 1/1 (0 failures, 0 skips; 16.47s runner wall); TAP log
  `/tmp/orgward-tests-Y87Xvk/node-test.tap.log`. Assertions cover source/design
  binding, persisted checkpoint and review/apply evidence, usage summary and
  tenant run denial after restart. Three preceding filtered invocations exposed
  test assertion/setup-order issues (process-plan reference field, restart
  readback declaration order, and 404 response shape); each was corrected before
  the passing run. `git diff --check` passed. No browser, live provider,
  credential or full `npm run check` was used; PR-06 and release gates remain
  open.

  PR-06 implementation acceptance complete (2026-09-30): reviewed the current
  joined PostgreSQL path together with the existing rendered founder-to-result
  journey and the authorized bounded-provider success receipt. The joined path
  pins assigned human/agent work to a saved edited blueprint, completes a human
  checkpoint with evidence, dispatches one bounded loopback model request, then
  separately reviews/applies the proposal and reads back result, usage, and
  audit evidence after restart; tenant isolation remains enforced. The frozen
  source tree passed its single `npm run check`: 427 passed, 0 failed, 1 skipped
  (optional PostgreSQL backup/restore journey because client tools are
  unavailable), TAP duration 82.41s and wrapper elapsed 87s. Logs:
  `/tmp/orgward-pr06-final-check-20260930.log` and
  `/tmp/orgward-tests-mM5UKL/node-test.tap.log`. PR-06 is checked complete and
  the cursor advances to PR-07. The skip is not passing backup/restore coverage;
  release gates remain separate and unchanged. Rendered owner-review/apply
  keyboard/screen-reader evidence and tenant dollar caps/pricing reconciliation
  are not claimed here and remain incomplete for broader release qualification.

  PR-06 fully rendered founder-to-result journey (2026-09-29, revision
  `6823d08`): a fresh disposable app/PostgreSQL fixture used synthetic OIDC
  users, a synthetic credential and a loopback Responses stub. The founder
  created a project through four discovery answers, edited and saved blueprint
  v2, enabled the human and workload bindings, and used the Execution UI to
  create and assign a plan with a mandatory human checkpoint. In the UI, the
  assigned owner completed the human root, escalated and resolved the checkpoint,
  completed it, and requested linked `task-process-deliver`. A distinct synthetic
  user approved it, and the approved local profile was executed once through the
  UI. After app-only restart, the browser showed all three task runtimes and the
  run SUCCEEDED, with a proposed result, one citation and evidence hash. The
  fixture returned no usage data, so the run truthfully shows
  `unreported/usage_missing`. One-time fixture preparation added only the
  synthetic workload identity/profile; project creation, bindings, planning,
  task-state actions, approval, execution and result review were rendered.
  Desktop/mobile screenshots and accessibility snapshot are listed in
  `/tmp/orgward-pr06-operational-ui-receipt.json`. At 390px the body and document
  widths were 390px; page errors and console errors were zero. No screen-reader
  speech or keyboard-only pass is claimed. The fixture made one loopback call,
  no live-provider request; app, database, browser, bridge and temporary state
  were cleaned. No product code or tests changed in this browser run. Model
  semantic evaluation and tenant-wide budget policy remain open; PR-06 and
  release gates remain open.

  PR-06 model usage presentation (2026-09-29): Execution run evidence and
  generated proposals now show validated provider input/output/total token counts
  when reported. Fixed copy explains missing, invalid, and not-started usage, and
  identifies reserved usage as an uncertain dispatch that must be reconciled;
  no estimates, price conversion, credentials, or source text are shown. The
  focused command `node --test --test-name-pattern='model usage presentation|execution HTTP surface enforces approval and exposes generated artifacts' tests/execution/linked-process-task-result.test.mjs tests/execution/server.test.mjs`
  passed 2/2 (0 failures, 0 skips; 0.76s; log
  `/tmp/orgward-pr06-model-usage-ux-focused.log`). An initial filtered
  invocation stopped during module parsing because a test-local binding reused
  an existing name; the binding was corrected before the passing invocation.
  Syntax and `git diff --check` passed. No provider request was made; PR-06,
  cursor, and release gates remain open.

  PR-06 owner proposal-apply browser attempt (2026-09-29; revision `6823d08`):
  one fresh disposable synthetic fixture stopped at its first action. The seeded
  checkpoint was assigned to Bob, while the attempted start used Alice; the
  server returned HTTP 403 `ACTION_FORBIDDEN`. A read-only query confirmed no
  process runtime was created. The loopback provider count remained 0, so no
  proposal, restart, owner review/apply, or responsive-browser evidence was
  reached. The action was not retried. The disposable app, PostgreSQL data,
  profile temp directory and synthetic session file were cleaned. Sanitized
  receipt: `/tmp/orgward-pr06-proposal-apply-browser-attempt.json`. This leaves
  the post-restart owner proposal-apply browser proof open; PR-06, cursor and
  release gates remain open.

  PR-06 managed DeepSeek checkpoint composition (2026-09-29): extended the
  existing saved-process PostgreSQL journey so a tenant-managed DeepSeek task
  is denied before its mandatory human checkpoint, then receives independent
  approval and runs only after the checkpoint completes with evidence. One
  deterministic loopback Responses call yielded a saved proposal; restart
  readback retained the run, task runtime, proposal and evidence hash without
  exposing the fixture credential. The focused journey passed 1/1 (0 failures
  or skips; 16.68s TAP, 17.91s harness; log
  `/tmp/orgward-tests-3dRPEc/node-test.tap.log`); `git diff --check` passed.
  This used no live provider request or rendered browser. The combined
  founder-to-result browser journey and remaining model evaluation/budget
  criteria are open; PR-06 and release gates remain unchanged.

  PR-06 rendered managed DeepSeek journey and UI repair (2026-09-29): a
  disposable browser fixture with synthetic Alice/Bob OIDC sessions and a
  loopback Responses endpoint started the assigned human task, escalated it,
  resumed it by owner decision, and completed it with evidence. The dependent
  tenant-managed DeepSeek task was requested, independently approved, and
  dispatched exactly once; after app restart, both task runtimes were SUCCEEDED
  and the proposal and citations rendered. The local provider count stayed 1;
  no live provider was contacted. The first fixture lacked its configured OIDC
  origin and correctly received 403 before creating an instance. That exposed
  two UI defects: false HTML boolean attributes kept action buttons disabled,
  and a definitive start rejection left a misleading saved retry. Both are
  fixed while uncertain and accepted receipts remain recoverable. Long evidence
  IDs now wrap; document width was 390px at a 390px viewport after restart,
  with no page or console errors. Focused DOM/rejection/accessibility tests
  passed 5/5 (0 failed/skipped, 0.335s); the affected served-client test passed
  1/1 (0 failed/skipped, 0.682s) after correcting a stale assertion about
  existing optional 401 guidance. Syntax and diff checks passed. Sanitized
  browser receipt and screenshots: `/tmp/orgward-pr06-deepseek-browser-proof/`.
  No full PR-06 check or release-gate qualification was run; PR-06 remains open.

  PR-06 connected founder-to-checkpoint follow-up (2026-09-29): a fresh
  authenticated browser session created a project through four discovery
  answers, edited its saved strategy to blueprint v2, enabled human and agent
  bindings, created and assigned a saved plan, inserted a mandatory checkpoint,
  completed the human root and escalated the checkpoint. Owner resolution then
  returned HTTP 500; read-only state remained ESCALATED with no resolution event.
  The uncertain command was not retried and no model task was dispatched. The
  disposable fixture was removed before a server error stack was retained, so
  this failure has no confirmed cause or repair. A fresh focused PostgreSQL/API
  regression now covers founder-created v2, owner-as-assignee, completed root,
  checkpoint escalation, same-origin OIDC session-cookie resolution and restart
  readback. It passed 1/1 (0 failures/skips, 2.402s; log
  `/tmp/orgward-pr06-owner-self-resolution-cleanup.log`). A separate fresh
  rendered owner form returned HTTP 201 and showed IN_PROGRESS with no browser
  errors; no screenshot or separate after-submit API snapshot was retained.
  These follow-ups did not reproduce the 500. No provider or live external call,
  full PR-06 check or release-gate qualification occurred; PR-06 remains open.

  PR-06 rendered design-to-checkpoint attempt (2026-09-29): the disposable
  synthetic fixture rendered blueprint v2 and its interactive map at desktop
  and 390px, then an Execution plan with a completed founder root and a required
  checkpoint in ESCALATED state. The owner-resolution form was visible, but this
  run ended before submitting it; no dependent model approval, provider dispatch,
  result or restart readback is claimed. An initial fixture graph incorrectly
  made the checkpoint the no-dependency root and received 403 before creating
  an instance; a fresh plan with the founder root and checkpoint before the
  dependent agent task reached the rendered state above. Local provider calls:
  0. Screenshots: `/tmp/orgward-pr06-integrated-design-desktop.png`,
  `/tmp/orgward-pr06-integrated-map-desktop.png`,
  `/tmp/orgward-pr06-integrated-map-mobile.png`,
  `/tmp/orgward-pr06-integrated-execution-start.png`,
  `/tmp/orgward-pr06-integrated-escalated-desktop.png`, and
  `/tmp/orgward-pr06-integrated-owner-escalated-desktop.png`. No source changes
  or tests occurred in this attempt; the browser session was closed and the
  disposable PostgreSQL cluster was stopped. PR-06 remains open.

  PR-06 fresh synthetic single-lifetime checkpoint and model follow-up
  (2026-09-29, revision `8c71d84`): a temporary fixture correction read the
  pinned source ID from the canonical task/source envelope; no product source
  changed. A fresh disposable instance completed the human root, escalated the
  mandatory checkpoint, resumed it by owner decision and completed it. The
  linked `task-process-deliver` request moved from AWAITING_APPROVAL to an
  independent APPROVED decision, then made exactly one local loopback provider
  dispatch and completed SUCCEEDED. After app restart, run/agent/checkpoint
  readback remained SUCCEEDED and the saved proposal was proposed with one
  citation; the synthetic credential was absent from serialized run output.
  Sanitized receipt: `/tmp/orgward-pr06-single-lifetime-success.json`. The
  disposable app and PostgreSQL data were stopped and removed; no task was
  replayed. This API/runtime fixture did not capture the rendered founder
  journey, test a live provider, or run the full PR-06 check. PR-06 and release
  gates remain open.

  PR-06 connected rendered founder-to-result follow-up (2026-09-29, revision
  `142f9e1`): one fresh disposable PostgreSQL/app instance used synthetic OIDC
  identities and one exact HTTPS redirect for the synthetic Responses endpoint
  to a `127.0.0.1` loopback stub. The founder created a workspace in the browser,
  answered four discovery prompts, edited and saved blueprint v2, and inspected
  the interactive map. In the same project/database, API fixture actions then
  enabled actor bindings, created plan revision 3 and its checkpoint, completed
  the human root, escalated and owner-resolved the checkpoint, independently
  approved `task-process-deliver`, and executed it with exactly one local
  provider call. After app-only restart, rendered browser views showed the
  succeeded linked plan, run, agent task and checkpoint, saved proposal, one
  pinned-source citation and run evidence. No real DeepSeek credential or
  external provider request occurred; page and console errors were zero, and
  390x844 result/plan views had 390px document width. Screenshots and AX
  snapshots: `/tmp/orgward-pr06-connected-rendered-proof.json` (which lists each
  path). Binding, plan, checkpoint, human transitions, approval and execution
  were API-driven, and a post-enable binding panel was not captured; this is
  connected UI/API/state evidence, not a fully rendered interaction for every
  action. One supplemental browser reopen failed before a page loaded because
  its command omitted `--no-sandbox`; it was not retried and did not affect the
  primary post-restart captures. The disposable app/database/browser were
  stopped and cleaned. No product source or tests changed; no full PR-06 check
  or release gate was completed. PR-06 remains open.

  PR-06 tenant-managed DeepSeek profile setup (2026-09-28): tenant administrators
  can create, revise and disable per-tenant DeepSeek profiles in PostgreSQL. The
  server fixes the provider and endpoint; the UI exposes only profile ID, label,
  model, an existing generic credential reference, bounded output tokens and
  enablement, and explains that saving does not test provider access. Writes check
  current human tenant-admin authority, installation-profile ID collisions,
  expected revision, idempotency and audit/outbox in one transaction, and require
  a same-tenant active generic credential when enabling. Disabled profiles can
  still be disabled after their credential expires. Linked runs pin the profile
  revision and credential generation; current-profile checks fence approval,
  resume and dispatch, and focused dispatch regressions verify rotated credentials
  and revised profiles fail before provider-attempt creation. The focused profile
  API/restart test passed 1/1 (1.94s), the saved-task/restart journey passed 1/1
  (16.15s), and the served Administration test passed 1/1 (2.83s), with zero
  skips. `git diff --check` passed. No live provider or browser was used; no full
  `npm run check` was run because PR-06 remains open. PR-06 cursor, checkbox and
  release-gate statuses remain unchanged.

  PR-06 explicit tenant-managed DeepSeek profile verification (2026-09-29;
  bounded): tenant admins can explicitly check saved model/credential access with
  a fixed request that contains no project or customer data. The API uses the
  server-owned tenant, profile, endpoint and encrypted credential; checks admin
  authority and profile/credential revisions before dispatch; limits concurrent
  calls and cooldown across edits/rotations; and persists only sanitized status,
  timestamps and revisions. The UI discloses quota/cost and no-retry behavior.
  Only a bounded, valid Responses API result marked completed/incomplete verifies;
  failed, malformed, oversized, 401/403 and ambiguous responses remain safely
  classified without persisting provider bodies. Focused test
  `node ops/run-tests.mjs --test-name-pattern='tenant DeepSeek profile verification is explicit' tests/secrets.test.mjs`
  passed 1/1 (0 failures/skips; 4.07s test, 5.52s runner), log
  `/tmp/orgward-tests-F5vcCM/node-test.tap.log`. An earlier teardown failure was
  traced to `/tmp` quota exhaustion during PostgreSQL checkpoint; stale,
  task-generated disposable clusters with no live servers were removed and the
  final run cleaned its cluster. `git diff --check` passed. No live provider or
  machine credential was used. No full check was run because PR-06 remains open;
  cursor, checkboxes and release gates are unchanged.

  PR-06 customer-facing unknown provider outcome (bounded; 2026-09-28; PR-06
  remains open): terminal run JSON now carries only
  `providerDiagnostic: { outcome: 'outcome_unknown' }` when the durable dispatch
  attempt ledger says `outcome_unknown`. The saved-plan linked task summary
  renders “Outcome unknown.” and advises that delivery is unverified and to
  reconcile with the provider before retrying. Task/run status stays FAILED;
  ordinary local failures and HTTP/parser details do not set this marker. No
  migration was needed. Loopback API coverage verified a dropped transport with
  no HTTP status, API visibility after restart, canary exclusion and retry
  refusal with exactly one dispatch; linked-summary/helper and served-client
  regressions cover the customer copy and ordinary FAILED case. Focused tests
  passed 21/21 (11.58s TAP), log
  `/tmp/orgward-tests-LEwsYN/node-test.tap.log`. The one frozen-tree
  `npm run check` passed 310/311 (310 passed, 0 failed, 1 optional backup/restore
  skip; 74.97s TAP), log `/tmp/orgward-tests-GgjKG4/node-test.tap.log`.
  `git diff --check` passed. No live provider call or external effect. PR-06,
  active cursor and release gates remain open and unchanged.

  PR-06 unknown-outcome visibility correction (2026-09-28): extended the
  durable-ledger marker to `INTERRUPTED` terminal runs when and only when the
  associated dispatch attempt is `outcome_unknown`. Linked saved-plan summaries
  show the same safe copy for FAILED and INTERRUPTED; ordinary interruptions
  and SUCCEEDED runs stay unmarked. The existing post-handoff revocation test now
  asserts INTERRUPTED status, API marker, restart persistence, one fixture
  request and retry denial. Helper coverage asserts interrupted marker/canary
  handling and ordinary interruption omission. Focused tests passed 20/20
  (11.68s TAP), log `/tmp/orgward-tests-xrnP5v/node-test.tap.log`. The single
  repaired-tree `npm run check` passed 310/311 (310 passed, 0 failed, 1 optional
  backup/restore skip; 77.19s TAP), log
  `/tmp/orgward-tests-1iWkaz/node-test.tap.log`. `git diff --check` passed. No
  live provider call or external effect; PR-06 cursor and release gates remain
  open and unchanged.

  PR-06 coherent cross-session linked-run freshness and uncertainty recovery
  (bounded; 2026-09-28): authenticated process-instance refresh now returns its
  project-authorized linked-run snapshot with task instances and plans. The UI
  rejects responses after request/project/route changes, defers all snapshot
  parts together while plan controls are dirty or focused, and retries on
  focusout. Applied refreshes merge current-project runs and update run-list
  status labels in place before rendering the saved-plan cards, preserving run
  list focus. The `outcome_unknown` reconciliation warning is visible outside
  collapsed result details. Blocked downstream tasks now ask for provider
  reconciliation before any new-instance decision when an upstream linked run
  has uncertain delivery; ordinary local failures retain the new-instance
  recovery instruction. Focused tests passed 26/26 (11.54s TAP), log
  `/tmp/orgward-tests-13DpBh/node-test.tap.log`. The single frozen-tree
  `npm run check` passed 313/314 (313 passed, 0 failed, 1 optional backup/restore
  skip; 74.87s TAP), log `/tmp/orgward-tests-GS5VJK/node-test.tap.log`.
  `git diff --check` passed. No live provider/credential access or external
  effects; PR-06 cursor and release gates remain open and unchanged.

  PR-06 screen-reader announcement for uncertain provider outcome (bounded;
  2026-09-28): the cross-session status announcer now compares previous and next
  authorized run snapshots alongside task runtime snapshots. A linked run that
  newly gains the durable `outcome_unknown` marker announces the task title and
  safe reconciliation copy, including marker-only updates; simultaneous status
  changes produce one announcement. Initial/first-seen snapshots and repeated
  polls stay silent, ordinary failures retain generic status copy, and bounded
  multi-task aggregation prioritizes unknown delivery without exposing request
  IDs or raw provider data. The redundant blocked-task announcement is skipped
  when the same refresh already announces a status/outcome transition. Focused
  helper and served-client tests passed 20/20 (0.85s TAP), log
  `/tmp/orgward-tests-j42j8m/node-test.tap.log`. The single frozen-tree
  `npm run check` passed 317/318 (317 passed, 0 failed, 1 optional backup/restore
  skip; 80.44s TAP), log `/tmp/orgward-tests-8Fs67E/node-test.tap.log`.
  `git diff --check` passed. No browser/provider/credential retries or external
  effects; PR-06 cursor and release gates remain open and unchanged.

  PR-06 Execution small-text contrast increment (bounded; 2026-09-27; PR-06
  remains open): added Execution-local `--exec-faint: #87948e` for boundary/muted,
  run-list metadata, evidence labels and run-event metadata. Its WCAG contrast is
  5.80:1 on `#11151b` and 5.38:1 on `#161d26`. A focused CSS-token regression
  passed 2/2 tests (0.14s TAP); `git diff --check` passed. The one `npm run check`
  passed 249/250 tests, 249 passed, 0 failed, 1 skipped (66.73s TAP; 69.24s
  wall). Accent, status and focus color declarations remain separately asserted.
  Logs: `/tmp/orgward-pr06-execution-contrast-focused-20260927.log`,
  `/tmp/orgward-pr06-execution-contrast-check-20260927.log`,
  `/tmp/orgward-pr06-execution-contrast-check-20260927.time`, and
  `/tmp/orgward-tests-rdGmvd/node-test.tap.log`. No provider or external effects.
  PR-06, active cursor and release gates remain open and unchanged.

  PR-06 terminal process-instance cancellation increment (bounded; PR-06 remains
  open): added migration 028 for the one-way PAUSED→CANCELLED transition. Only the
  current human initiator or project owner with workspace-write access can cancel;
  the transaction fences membership, control version, sorted runtime/run/attempt/
  lease rows and rejects active work, live leases, or reserved/handed-off/unknown
  provider requests. The append-only audit event records actor, time and reason.
  Completed task outcomes/evidence remain intact, while later starts, resumes,
  human writes, worker finalization and recovery are fenced. Execution shows the
  cancel control only for eligible paused instances and explains the preserved
  outcomes and terminal behavior. Focused cancellation/authz/replay/late-write/
  restart, migration-upgrade and served-client tests passed 9/9 (15.87s wall); the
  final UI-only served-client rerun passed 1/1 (0.59s). The single `npm run check`
  passed 232/233 with 0 failures and 1 optional PostgreSQL backup/restore skip
  because client tools were unavailable (`ORGWARD_PG_TOOLS_BIN` not set; 67.41s
  TAP, 70.01s runner wall). An initial migration run exposed the v027 pause-reason
  constraint name and an upgrade count still set to 27; both were corrected before
  the passing run. Logs: `/tmp/orgward-process-instance-cancel-focused-reviewed-repair-20260926.log`,
  `/tmp/orgward-process-instance-cancel-served-client-repair-20260926.log`,
  `/tmp/orgward-process-instance-cancel-check-20260926.log`, and
  `/tmp/orgward-tests-NuZHZF/node-test.tap.log`. `git diff --check` passed. No
  browser or live provider calls were made; PR-06 remains open and the
  cursor/gates are unchanged.

  PR-06 DeepSeek Responses endpoint correction (bounded; PR-06 remains open):
  changed the fixed production URL from the incorrect `/v1/responses` path to
  `https://api.deepseek.com/responses`, which matches the provider's documented
  `POST /responses` route and `https://api.deepseek.com` base URL. Validation now
  requires the DeepSeek-specific `/responses` path while OpenAI retains its
  independent `/v1/responses` path. Loopback tests assert the exact dispatched
  path, and a profile test asserts the fixed production host/path plus rejection
  of the former DeepSeek path. Focused tests passed 5/5 (15.25s TAP). The one
  `npm run check` passed 240/241, 0 failures and 1 optional backup/restore skip
  because client tools were unavailable (`ORGWARD_PG_TOOLS_BIN` unset; 65.88s
  TAP, 68.23s runner wall). `git diff --check` passed. Logs:
  `/tmp/orgward-pr06-deepseek-endpoint-focused.log`,
  `/tmp/orgward-pr06-deepseek-endpoint-focused.time`,
  `/tmp/orgward-pr06-deepseek-endpoint-check.log`,
  `/tmp/orgward-pr06-deepseek-endpoint-check.time`, and
  `/tmp/orgward-tests-EA6yTr/node-test.tap.log`. No live call was made; PR-06
  remains open and cursor/gates are unchanged.

  PR-06 linked-run result summary increment (bounded; PR-06 remains open): added
  a collapsed “Saved result and evidence” disclosure to process-task rows when
  their terminal linked run matches the runtime's project, run ID, process plan,
  revision, instance, and task. It shows terminal status, a 280-character preview
  only for successful saved output, capped artifact count, validated evidence-hash
  prefix, and the existing safe DeepSeek diagnostic. Failed output and arbitrary
  error text stay hidden; the full run detail link remains available. The pure
  presenter rejects missing, malformed, nonterminal, cross-project, or mismatched
  linkage. Focused helper, served-client, and PostgreSQL saved-process restart
  coverage passed 6/6 (12.58s TAP); the restart scenario ran the presenter on the
  restored task runtime and linked run. `git diff --check` passed. The one full
  `npm run check` did not pass: 243/245 passed, 1 failed, 1 optional backup/restore
  skip because PostgreSQL client tools were unavailable (62.39s TAP, 64.72s runner
  wall). The failure was the existing worker cancellation timing assertion at
  `tests/persistence.test.mjs:6673` (observed INTERRUPTED instead of RUNNING),
  before the new restart-summary assertion. This failure was repaired in the
  subsequent deterministic worker-barrier follow-up below.
  Logs: `/tmp/orgward-pr06-linked-task-result-focused-repair.log`,
  `/tmp/orgward-pr06-linked-task-result-focused-repair.time`,
  `/tmp/orgward-pr06-linked-task-result-check.log`,
  `/tmp/orgward-pr06-linked-task-result-check.time`, and
  `/tmp/orgward-tests-589rSG/node-test.tap.log`. No provider call was made; PR-06
  stays open and cursor/release gates remain unchanged.

  PR-06 worker cancellation test barrier repair: replaced the timing-based 1.2s
  worker sleep/poll with a marker/release barrier in the private per-run workspace.
  The worker writes its start marker under `/workspace`; the test waits for it,
  verifies RUNNING and cancellation denial, then writes the release marker in a
  `finally` block and awaits completion before fixture cleanup. This follows the
  existing adapter contract that binds the per-run host workspace at `/workspace`
  and sets it as the worker directory. The previously failed saved-process test
  passed 1/1 (10.95s TAP, 11.04s wall). The repaired-tree `npm run check` passed
  244/245, 0 failures and 1 optional backup/restore skip because client tools were
  unavailable (`ORGWARD_PG_TOOLS_BIN` unset; 67.24s TAP, 69.47s runner wall).
  `git diff --check` passed. Logs: `/tmp/orgward-pr06-running-cancel-barrier-focused.log`,
  `/tmp/orgward-pr06-running-cancel-barrier-focused.time`,
  `/tmp/orgward-pr06-running-cancel-barrier-check.log`,
  `/tmp/orgward-pr06-running-cancel-barrier-check.time`, and
  `/tmp/orgward-tests-1B0pDq/node-test.tap.log`. No live provider call was made;
  PR-06 and its cursor/gates remain open/unchanged.

  PR-06 linked task artifact retrieval UX increment (bounded; PR-06 remains open):
  process-task result disclosures now expose up to 10 authenticated artifact links
  per task, using only bounded safe display names and hash prefixes from artifacts
  with validated relative paths and SHA-256 hashes. Unsafe paths, labels and hashes
  are omitted; links continue through the existing authorized run artifact route.
  The PostgreSQL integration scenario writes one tiny local command-worker artifact,
  then after app restart verifies the linked task summary, download bytes and hash,
  foreign-tenant 404 and traversal 404. Focused presenter/served-client coverage
  passed 6/6 (0.69s TAP); the restart/download scenario passed 1/1 (10.52s TAP).
  The single `npm run check` passed 245/246 with 0 failures and 1 optional
  PostgreSQL backup/restore skip because client tools were unavailable
  (`ORGWARD_PG_TOOLS_BIN` unset; 67.77s TAP). `git diff --check` passed. Logs:
  `/tmp/orgward-pr06-artifact-focused-20260927.log`,
  `/tmp/orgward-pr06-artifact-restart-20260927.log`,
  `/tmp/orgward-pr06-artifact-check-20260927.log`, and
  `/tmp/orgward-tests-Xs84R5/node-test.tap.log`. No provider or OpenClaw credential
  access occurred. PR-06 remains open; cursor and release gates are unchanged.

  PR-06 linked task artifact disclosure rendered verification (bounded; 2026-09-27):
  with a persisted synthetic OIDC browser session, the authenticated Execution
  page rendered one collapsed “Saved result and evidence” disclosure and one safe
  artifact link at both 390×844 and 1280×900. Space toggled it open and Tab focused
  “Download rendered-proof.txt · 5d8a9c24189bc1bf2a…”. The local 37-byte download
  matched fixture bytes and SHA-256
  `5d8a9c24189bc1bf2a28818e116d52ca8b2a761959d32b515667bd50e986b34a`. Orca
  50.2/AT-SPI recognized the disclosure toggle and link accessible names, observed
  expanded state, and announced the download link. Console and page-error checks
  at 1280×900 returned no entries. An initial API-token-only fixture had no
  authenticated `/auth/session`, so the client correctly omitted task runtimes;
  after seeding a temporary persisted browser session, the actual disclosure
  rendered. This was fixture authentication, not a product defect. Evidence:
  `/tmp/orgward-pr06-artifact-rendered-20260927.log`,
  `/tmp/orgward-pr06-artifact-authenticated-390-open.png`,
  `/tmp/orgward-pr06-artifact-authenticated-1280-open.png`,
  `/tmp/orgward-pr06-artifact-orca-snapshot.txt`,
  `/tmp/orgward-pr06-artifact-orca-debug.log`, and
  `/tmp/orgward-pr06-artifact-authenticated-download.txt`. Disposable app,
  PostgreSQL database/cluster, workspace, session and browser sessions were
  removed. No product source/tests changed and no provider or external call was
  made. PR-06, cursor and release gates remain open/unchanged.

  PR-06 DeepSeek outcome-unknown diagnostic increment (bounded; PR-06 remains
  open): on an existing pinned DeepSeek run, a received HTTP 4xx/5xx response may
  persist only `{ provider: "deepseek", httpStatus }` in the failed run and its
  failure event. The UI renders fixed copy stating delivery remains unverified
  and the run cannot be retried. Response body, headers, request ID, phrase, URL
  and raw error are excluded. Missing/non-HTTP status yields no diagnostic;
  durable `outcome_unknown` and no-redispatch behavior are unchanged. Loopback
  behavior tests cover a 503 with body/header/credential canaries, no-response
  omission, restart persistence and retry denial; served-client and helper tests
  cover safe presentation. Focused tests passed 14/14 (9.97s TAP). The one
  `npm run check` passed 240/241, 0 failed, 1 optional backup/restore skip because
  `ORGWARD_PG_TOOLS_BIN` was unset (66.31s TAP, 68.92s runner wall). `git diff
  --check` passed. Logs: `/tmp/orgward-pr06-safe-provider-diagnostic-focused-rerun.log`,
  `/tmp/orgward-pr06-safe-provider-diagnostic-check.log`,
  `/tmp/orgward-pr06-safe-provider-diagnostic-check.time`, and
  `/tmp/orgward-tests-c2n4zo/node-test.tap.log`. The first focused attempt failed
  only because a served-source assertion expected a different equivalent range
  predicate; after matching the actual helper predicate, all 14 focused tests
  passed. No live provider call was made. PR-06 stays open; cursor and release
  gates are unchanged.

  PR-06 DeepSeek parser-diagnostic follow-up (bounded; PR-06 remains open):
  outcome-unknown DeepSeek runs now retain a closed parser-failure class alongside
  a validated upstream HTTP status, including when a 2xx response is malformed.
  The saved diagnostic contains no response body, headers, request ID, provider
  phrase, URL or arbitrary error. Execution renders fixed copy that can show both
  `HTTP 200` and its parser category, while unknown categories and raw canaries
  are omitted. Loopback coverage exercises invalid JSON, oversized body,
  incomplete response, missing output text, HTTP 503 and a dropped connection;
  tests also verify restart persistence, tenant isolation, no redispatch and
  canary exclusion. The focused diagnostics suite passed 20/20. The final
  `npm run check` passed 247/248 (247 passed, 0 failed, 1 optional PostgreSQL
  backup/restore skip because client tools were unavailable; 64.23s TAP, 64.33s
  wall). `git diff --check` passed. Full-check log:
  `/tmp/orgward-tests-ipDutR/node-test.tap.log`. No provider call was made in
  this increment; the earlier user-authorized outcome-unknown attempt was not
  retried. PR-06 remains open; active cursor and release gates are unchanged.

  PR-06 linked-run cancellation consistency follow-up (bounded; PR-06 remains
  open): instance cancellation now transitions every linked undispatched
  AWAITING_APPROVAL, APPROVED, or PAUSED run in the same transaction, after
  validating its runtime link and safe attempts/leases. It appends a dedicated
  instance-controller run event with the instance command causation, synchronizes
  the runtime to CANCELLED while retaining existing outcome/evidence, and binds
  the exact affected IDs into the control event and idempotent command result.
  Migration 029 rejects closing while a linked run is still pending/approved/
  paused/running and checks the exact event-bound run set; migration 030 extends
  the runtime cancellation guard for this event while retaining the standalone
  requester-only withdrawal rule. The existing PostgreSQL journey proves owner
  cancellation of a different requester’s paused run, read access after restart,
  exact replay IDs and the standalone owner-withdrawal denial; focused contract
  coverage exercises AWAITING_APPROVAL, APPROVED and PAUSED cases. Focused tests
  passed 8/8 (7 unit/server/upgrade, 4.30s wall; persistence/restart, 1/1,
  13.26s wall). The single `npm run check` passed 233/234: 233 passed, 0 failed,
  1 optional PostgreSQL backup/restore skip because client tools were unavailable
  (`ORGWARD_PG_TOOLS_BIN` not set; 68.25s TAP, 70.85s runner wall). The first
  focused attempts exposed and repaired an upgrade migration-count expectation,
  an API denial-code expectation, and the existing runtime cancellation trigger’s
  event-type allowlist. Logs: `/tmp/orgward-instance-linked-cancel/focused-unit-final.log`,
  `/tmp/orgward-instance-linked-cancel/focused-persistence-repair.log`,
  `/tmp/orgward-instance-linked-cancel/npm-check.log`, and
  `/tmp/orgward-tests-oZJUa1/node-test.tap.log`. `git diff --check` passed. No
  live provider calls or external effects were made; PR-06 remains open and its
  cursor/gates are unchanged.

  PR-06 historical-plan replan path increment (bounded; PR-06 remains open):
  Execution retains old process plans and their runtime/history for inspection,
  labels plans pinned to an earlier blueprint as historical, suppresses their edit
  action and new-instance option, and links to planning the same process from the
  current saved blueprint when that process still exists. Existing instances and
  history remain inspectable; current-version plans retain their controls. The
  new-work gate drives both the disabled selector option and agent start predicate.
  Focused route and served-client tests passed 6/6 (0.72s wall). The repair's
  single `npm run check` passed 230/231 with 0 failures and 1 optional PostgreSQL
  backup/restore skip because PostgreSQL client tools were unavailable
  (`ORGWARD_PG_TOOLS_BIN` not set; 65.93s TAP, 68.54s runner wall). Logs:
  `/tmp/orgward-pr06-historical-plan-repair-focused.log`,
  `/tmp/orgward-pr06-historical-plan-repair-focused.time`,
  `/tmp/orgward-pr06-historical-plan-repair-check.log`,
  `/tmp/orgward-pr06-historical-plan-repair-check.time`, and
  `/tmp/orgward-tests-2nUBvy/node-test.tap.log`. `git diff --check` passed. No
  browser, provider or external calls were made; PR-06 and release gates remain
  open, and the active cursor is unchanged.

  PR-06 post-save planning-graph focus increment (bounded; PR-06 remains open):
  After a successful planning-graph save, Execution targets the saved plan from the
  response event (or the current-process fallback on replay), then scrolls its
  rendered card into view and moves keyboard focus to the accessible card. A
  missing card is handled without interrupting the success flow, and the existing
  “no work was dispatched” message remains. Focused navigation and served-client
  tests passed 7/7 (0.82s wall). The single `npm run check` passed 231/232 with
  0 failures and 1 optional PostgreSQL backup/restore skip because client tools
  were unavailable (`ORGWARD_PG_TOOLS_BIN` not set; 67.59s TAP, 70.28s runner
  wall). The first focused run failed on a test expectation for malformed preferred
  target fallback and passed after correction. Logs:
  `/tmp/orgward-pr06-post-save-focus-focused-repair.log`,
  `/tmp/orgward-pr06-post-save-focus-focused-repair.time`,
  `/tmp/orgward-pr06-post-save-focus-check.log`,
  `/tmp/orgward-pr06-post-save-focus-check.time`, and
  `/tmp/orgward-tests-25V86a/node-test.tap.log`. `git diff --check` passed. No
  browser, provider or external calls were made; PR-06 and release gates remain
  open, and the active cursor is unchanged.

  PR-06 immutable graph-revision focus increment (bounded; PR-06 remains open):
  After a successful edit, Execution uses the validated `ProcessTaskGraphRevised`
  response event's plan ID and revision to scroll to and focus that exact rendered
  plan card. Invalid or missing events and cards are handled without disrupting the
  saved result. The truthful immutable-revision/no-dispatch notice is unchanged.
  Focused route/target and served-client tests passed 8/8 (0.80s wall). The single
  `npm run check` passed 232/233 with 0 failures and 1 optional PostgreSQL backup/
  restore skip because client tools were unavailable (`ORGWARD_PG_TOOLS_BIN` not
  set; 65.49s TAP, 68.27s runner wall). Logs:
  `/tmp/orgward-pr06-revision-focus-focused.log`,
  `/tmp/orgward-pr06-revision-focus-focused.time`,
  `/tmp/orgward-pr06-revision-focus-check.log`,
  `/tmp/orgward-pr06-revision-focus-check.time`, and
  `/tmp/orgward-tests-eqD8Ey/node-test.tap.log`. `git diff --check` passed. No
  browser, provider or external calls were made; PR-06 and release gates remain
  open, and the active cursor is unchanged.

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

  PR-06 narrow-viewport process-controls UX increment (bounded; PR-06 remains
  open): flex-wrapped the source/edit actions and moved the process-instance
  selector into its own labeled block after rendered inspection found overlap at
  390px. Fresh browser measurements at 390×844 and 1280×900 confirmed distinct,
  non-overlapping bounds. Keyboard Tab reaches “Edit planned graph” with a visible
  3px focus outline; the accessibility tree exposes distinct button and combobox
  names. Focused served-client coverage passed 1/1 (0.64s); the single `npm run
  check` passed 223/224 with 0 failures and one optional PostgreSQL backup/restore
  skip (`ORGWARD_PG_TOOLS_BIN` unset; 64.72s TAP, 64.80s wall). `git diff --check`
  passed. Browser captures: `/tmp/orgward-pr06-a11y-fixed-mobile.png` and
  `/tmp/orgward-pr06-a11y-fixed-laptop.png`; logs:
  `/tmp/orgward-pr06-a11y-full-check.log` and
  `/tmp/orgward-tests-MhJyJW/node-test.tap.log`. A subsequent focused Orca 50.2 /
  Chromium 154 check ran inside private Xvfb, D-Bus and PulseAudio: AT-SPI exposed
  the process-instance control as “Process instance for Discover and qualify
  demand” (combo box), and Orca spoke its label, value and popup state; keyboard
  focus landed on “Edit planned graph” and Orca spoke its accessible name and
  button role. Speech Dispatcher output was captured and nonzero audio samples
  confirmed speech generation. Evidence: `/tmp/orgward-orca-debug.log` and
  `/tmp/orgward-orca-debug-restart.log`; the focused one-test behavior check
  recorded in `/tmp/orgward-pr06-a11y-focused.log` passed 1/1 (0.64s), and the
  matching full `npm run check` passed 223/224 with one optional PostgreSQL
  backup/restore skip as recorded above. The initial direct CLI launch failed
  with `Cannot open display ":101"` because that display was not available to
  the invocation; the later private-Xvfb run succeeded, so this was an
  environment invocation issue, not an Orca or product failure. This is a focused
  screen-reader control check, not full screen-reader qualification. No live
  provider call was made. PR-06, release gates and cursor remain open/unchanged.

  PR-06 process-instance control conflict recovery increment (bounded; PR-06
  remains open): definitive non-retryable 4xx denials for pause, resume and
  unverified closure now discard the failed idempotency command and reload the
  current process-instance state, avoiding repeated submissions with stale
  versions. Network errors, timeouts, rate limits and retryable responses retain
  the command for safe replay. Focused behavior and served-client tests passed
  2/2 (0.58s runner). The single `npm run check` passed 224/225, with 0 failures
  and 1 optional PostgreSQL backup/restore skip because client tools were
  unavailable (`ORGWARD_PG_TOOLS_BIN` not set; 60.37s TAP, 63.25s runner wall).
  `git diff --check` passed. Logs: `/tmp/orgward-pr06-instance-control-check.log`,
  `/tmp/orgward-pr06-instance-control-check.time`, and
  `/tmp/orgward-tests-fkWenr/node-test.tap.log`. No live provider call was made.
  PR-06 remains first open; release gates and cursor remain unchanged.

  PR-06 human checkpoint event-history UX increment (bounded; PR-06 remains
  open): the Execution task row now exposes an expandable timeline of persisted
  start, escalation, owner-resolution and completion events with safe generic
  actor labels, timestamps, result/disposition, reason and recorded evidence.
  Presentation derives actor labels from the allowlisted event type and never
  renders event IDs, raw actor identifiers or whole payloads. Focused history and
  served-client tests passed 2/2 (0.69s); the persisted-process restart journey
  passed 1/1 (9.67s), confirming all four transitions and details survive restart
  without exposing the assigned principal. The single `npm run check` passed
  225/226, with 0 failures and 1 optional PostgreSQL backup/restore skip because
  client tools were unavailable (`ORGWARD_PG_TOOLS_BIN` not set; 64.20s TAP,
  66.57s runner wall). `git diff --check` passed. Logs:
  `/tmp/orgward-pr06-human-history-check.log`,
  `/tmp/orgward-pr06-human-history-check.time`,
  `/tmp/orgward-tests-WBX4Tp/node-test.tap.log`. No rendered-browser check or live
  provider call was made. PR-06 remains first open; release gates and cursor remain
  unchanged.

  PR-06 instance-control history actor privacy UX increment (bounded; PR-06
  remains open): the Execution history now labels pause/resume transitions as an
  authorized controller, unverified abandonment as a project owner, and uses the
  system label only when the event actor is exactly `system`. Event type, timestamp,
  reason and the existing abandonment run/attempt/evidence/duplicate-work details
  remain reviewable. Unknown and malformed events are omitted; raw actor identifiers
  and arbitrary payload properties are not rendered. Focused presentation, existing
  process-control behavior and served-client tests passed 4/4 (0.80s). The single
  `npm run check` passed 226/227, with 0 failures and 1 optional PostgreSQL
  backup/restore skip because client tools were unavailable (`ORGWARD_PG_TOOLS_BIN`
  not set; 68.21s TAP, 70.91s runner wall). `git diff --check` passed. Logs:
  `/tmp/orgward-pr06-instance-history-check.log`,
  `/tmp/orgward-pr06-instance-history-check.time`, and
  `/tmp/orgward-tests-LoJOVe/node-test.tap.log`. No live provider call was made;
  rendered-browser verification remains unavailable as recorded above. PR-06
  remains first open; release gates and cursor remain unchanged.

  PR-06 history malformed-entry and size-bounds repair (bounded; PR-06 remains
  open): both human-task and process-instance-control history presenters now skip
  null, primitive, unknown, malformed-time and oversized-time entries. Each caps
  history to the latest 100 events, reasons and evidence strings to 1,000
  characters, and evidence/reference arrays to 20 entries (run/attempt references
  to 160 characters). Event fields remain allowlisted; raw principals and arbitrary
  payload properties stay hidden. The “project owner” abandonment label matches its
  owner-only write path (`minimum: 'owner'`, workspace-write and human identity);
  existing persistence coverage denies non-owners and permits the owner. Focused
  history, control regression and served-client tests passed 6/6 (0.86s); the
  PostgreSQL owner/denial journey passed 1/1 (9.90s). The single `npm run check`
  passed 228/229, with 0 failures and 1 optional PostgreSQL backup/restore skip
  because client tools were unavailable (`ORGWARD_PG_TOOLS_BIN` not set; 67.51s
  TAP, 69.93s runner wall). `git diff --check` passed. Logs:
  `/tmp/orgward-pr06-history-bounds-repair-check.log`,
  `/tmp/orgward-pr06-history-bounds-repair-check.time`, and
  `/tmp/orgward-tests-ciRaU6/node-test.tap.log`. No live provider call was made;
  browser sandbox blocker, PR-06 status, release gates and cursor are unchanged.

  PR-06 history allowlist inherited-key repair (bounded; PR-06 remains open):
  both history presenters now require an own event-type key before projecting a
  transition, preventing inherited names such as `toString`, `__proto__`,
  `constructor` and `hasOwnProperty` from being accepted. Focused human-task and
  process-instance history canaries passed 4/4 (0.46s wall). The single
  `npm run check` passed 228/229, with 228 passed, 0 failed and 1 optional
  PostgreSQL backup/restore skip because client tools were unavailable
  (`ORGWARD_PG_TOOLS_BIN` not set; 67.41s TAP, 69.88s runner wall). `git diff
  --check` passed. Logs: `/tmp/orgward-pr06-history-prototype-focused.log`,
  `/tmp/orgward-pr06-history-prototype-focused.time`,
  `/tmp/orgward-pr06-history-prototype-check.log`,
  `/tmp/orgward-pr06-history-prototype-check.time`, and
  `/tmp/orgward-tests-06POHf/node-test.tap.log`. No browser or provider calls were
  made; PR-06 remains first open and the release gates and cursor are unchanged.

  PR-06 checkpoint-dependent proposal apply journey closure (bounded; PR-06 remains
  open): preserved the existing generic proposal-apply and stale-source checks, then
  after that apply created one graph pinned to the new current blueprint, rebound
  its human and agent actors for that version, completed a required human checkpoint,
  and executed the dependent OpenAI proposal only against the test's loopback
  provider fixture. An editor's apply was denied; the owner applied the dependent
  run's exact saved proposal. Assertions cover its proposal hash, citation IDs and
  hashes, provenance and target detail, the new `proposed-design` blueprint version,
  unchanged pinned plan revisions and process runtimes, idempotent replay, and
  applied provenance plus the immutable run result after app restart. Focused
  persistence passed 1/1 (11.38s wall); an initial focused attempt failed only on
  the old expectation that the first applied version remained latest after the new
  apply, and the corrected restart assertions passed on rerun. The single
  `npm run check` passed 228/229, with 228 passed, 0 failed and 1 optional
  PostgreSQL backup/restore skip because client tools were unavailable
  (`ORGWARD_PG_TOOLS_BIN` not set; 65.83s TAP, 68.25s runner wall). `git diff
  --check` passed. Logs: `/tmp/orgward-pr06-dependent-proposal-journey-focused.log`,
  `/tmp/orgward-pr06-dependent-proposal-journey-focused.time`,
  `/tmp/orgward-pr06-dependent-proposal-journey-focused-repair.log`,
  `/tmp/orgward-pr06-dependent-proposal-journey-focused-repair.time`,
  `/tmp/orgward-pr06-dependent-proposal-journey-check.log`,
  `/tmp/orgward-pr06-dependent-proposal-journey-check.time`, and
  `/tmp/orgward-tests-IwqT6z/node-test.tap.log`. No live provider call was made;
  PR-06 remains first open and release gates and cursor are unchanged.

  PR-06 applied proposal object deep-link UX (bounded; PR-06 remains open):
  applied review state now carries the object ID from the persisted apply event.
  “Open updated design” opens the current map with that object selected when it is
  present in the graph; missing or malformed object IDs fall back to the project
  design route. Current/unapplied proposal links retain their existing behavior.
  Focused proposal-review helper and served-client tests passed 6/6 (0.80s wall);
  the initial attempt failed only because its source-match assertion omitted the
  array guard, and the corrected run passed. The single `npm run check` passed
  229/230, with 229 passed, 0 failed and 1 optional PostgreSQL backup/restore skip
  because client tools were unavailable (`ORGWARD_PG_TOOLS_BIN` not set; 67.74s
  TAP, 70.01s runner wall). `git diff --check` passed. Logs:
  `/tmp/orgward-pr06-proposal-deep-link-focused.log`,
  `/tmp/orgward-pr06-proposal-deep-link-focused.time`,
  `/tmp/orgward-pr06-proposal-deep-link-focused-repair.log`,
  `/tmp/orgward-pr06-proposal-deep-link-focused-repair.time`,
  `/tmp/orgward-pr06-proposal-deep-link-check.log`,
  `/tmp/orgward-pr06-proposal-deep-link-check.time`, and
  `/tmp/orgward-tests-lAjRyh/node-test.tap.log`. No browser or provider calls were
  made; PR-06 remains first open and release gates and cursor are unchanged.

  PR-06 DeepSeek Responses provider profile (bounded; PR-06 remains open): added
  an opt-in `provider-deepseek` profile at the fixed
  `https://api.deepseek.com/responses` endpoint. It binds a tenant's active
  generic versioned secret reference, pins the configured model and a validated
  `max_output_tokens` cap (64–512, default 256) through create, independent
  approval, pause/resume and dispatch. The saved-source proposal prompt remains
  read-only with no tools; OpenAI candidate validation and its existing profile
  contract remain unchanged. Additive migration 031 extends only the
  outcome-unknown disposition to eligible DeepSeek model proposals. Loopback tests
  cover credential-rotation denial before dispatch, bounded request body,
  persisted outcome-unknown disposition, replay and restart. An initial focused
  run had three test assertion/setup failures; after correcting the forged-provider
  expectation, legacy response-envelope assertion and isolated preflight config,
  the affected set passed 79/79 (75.43s wall); the final provider-identity follow-up
  passed 5/5 (0.23s). The one `npm run check` passed 237/238: 237 passed, 0 failed,
  and 1 optional PostgreSQL backup/restore skip because client tools were unavailable
  (`ORGWARD_PG_TOOLS_BIN` not set; 69.77s TAP, 72.34s runner wall). `git diff
  --check` passed. Logs: `/tmp/orgward-deepseek/focused.log`,
  `/tmp/orgward-deepseek/focused-repair-final.log`,
  `/tmp/orgward-deepseek/focused-final2.log`,
  `/tmp/orgward-deepseek/focused-final2.time`,
  `/tmp/orgward-deepseek/proposals-review.log`,
  `/tmp/orgward-deepseek/npm-check.log`, `/tmp/orgward-deepseek/npm-check.time`,
  and `/tmp/orgward-tests-vsfAyw/node-test.tap.log`. One live request used the
  machine's OpenClaw-configured DeepSeek credential and `deepseek-flash` model with
  a 128-token cap. Its single dispatch attempt ended `outcome_unknown` and the run
  failed; provider receipt/completion is unverified, so no retry was made. The
  credential was held only in memory and in the disposable encrypted fixture DB;
  that DB and app data were removed. The sanitized receipt is
  `/tmp/orgward-deepseek/live-proof-1790484208611.json`. No successful live model
  result or restart readback is claimed. PR-06, release gates and the active cursor
  remain unchanged.

  PR-06 human-checkpoint conflict refresh and validation discrimination (bounded;
  PR-06 remains open): non-retryable authoritative 409 conflicts from human
  start/completion/escalation/resolution refresh the saved project, actor-binding
  registry, task runtime and current actions without resubmitting. Validation
  errors `INVALID_HUMAN_TASK_OUTCOME` and `INVALID_HUMAN_TASK_ESCALATION`, which
  also use HTTP 409, preserve the user's form and show the validation message;
  retryable outcomes including retryable 409s retain the same command. Focused
  failure-policy and served-client tests passed 2/2 (0.83s TAP, 0.92s wall); the
  saved-process PostgreSQL stale-owner conflict/recovery case passed 1/1 (10.66s
  TAP, 10.73s wall). The repair `npm run check` passed 246/247: 246 passed, 0
  failed, and 1 optional PostgreSQL backup/restore skip because client tools were
  unavailable (`ORGWARD_PG_TOOLS_BIN` not set; 64.12s TAP, 66.67s wall).
  `git diff --check` passed. Logs:
  `/tmp/orgward-pr06-human-conflict-repair-focused-20260927.log`,
  `/tmp/orgward-pr06-human-conflict-pg-20260927.log`,
  `/tmp/orgward-pr06-human-conflict-repair-check-20260927.log`, and
  `/tmp/orgward-tests-Pl3jTV/node-test.tap.log`. No provider/credential access or
  external effects occurred; PR-06, cursor and gates remain open/unchanged.

  PR-06 human-checkpoint keyboard focus recovery follow-up (bounded; 2026-09-27;
  PR-06 remains open): human start, completion, escalation and resolution handlers
  now remember the initiating control before disabling it and restore focus only
  when the request leaves focus on BODY and that same control is still connected.
  On validation and retryable errors, the form remains intact and focus returns to
  its submit button; after a definitive conflict replaces the stale form, the
  detached control is not refocused and the updated task status heading receives
  keyboard focus with a visible focus outline. Focused failure-policy and served
  client tests passed 2/2 (0.69s TAP); `git diff --check` passed. The one
  `npm run check` passed 246/247, 246 passed, 0 failed, and 1 optional PostgreSQL
  backup/restore skip because `ORGWARD_PG_TOOLS_BIN` was not set (71.00s TAP,
  73.76s wall). Logs: `/tmp/orgward-pr06-conflict-focus-focused-final-20260927.log`,
  `/tmp/orgward-pr06-conflict-focus-check-20260927.log`,
  `/tmp/orgward-pr06-conflict-focus-check-20260927.time`, and
  `/tmp/orgward-tests-Flvs0E/node-test.tap.log`.

  Rendered 390×844 confirmation used two persisted synthetic OIDC sessions and
  the disposable local PostgreSQL/app fixture. Session A submitted whitespace-only
  resolution reason: the server returned `INVALID_HUMAN_TASK_ESCALATION`/409, the
  typed value and form remained, the validation notice appeared, and keyboard
  focus stayed on “Resolve escalation”; navigation count remained one. Session B
  then resolved the task; A's one stale submission received
  `PROCESS_TASK_STATE_CONFLICT`/409, refreshed to SUCCEEDED with the owner form
  removed, and moved visible keyboard focus to the updated “Verify the saved
  review result — SUCCEEDED” status heading. The observed POST sequence was exactly
  those two 409s, with no automatic resubmit, navigation, or page errors. Screenshot:
  `/tmp/orgward-pr06-conflict-focus-final-390x844.png`. Orca was not run because
  this browser session has no `DISPLAY`; no screen-reader announcement is claimed.
  The fixture used deterministic local state only; no provider, credential, or
  external request occurred. PR-06, active cursor and release gates remain open
  and unchanged.

  PR-06 stale-checkpoint status focus Orca/AT-SPI confirmation (bounded;
  2026-09-27): a provider-free disposable PostgreSQL/app fixture seeded one
  escalated human checkpoint and two synthetic owner browser sessions. At
  390×844, session B resolved it while session A retained the stale form; A's
  one submitted stale action refreshed to SUCCEEDED, removed the owner form and
  moved visible keyboard focus to “Verify the saved review result — SUCCEEDED.”
  The AT-SPI accessibility tree exposed that focused heading; Orca emitted the
  exact heading text and “heading 5” through its speech output. Browser snapshot
  showed the current status and conflict notice. Evidence: screenshot
  `/tmp/orgward-pr06-focus-orca-390x844.png` and focused AT-SPI/Orca trace excerpt
  `/tmp/orgward-pr06-focus-orca-speech-evidence-20260927.txt`. Validation-input
  focus/text was not repeated under Orca; the immediately preceding browser
  receipt covers that behavior without a screen-reader claim. The run used a
  private Xvfb/D-Bus display and PulseAudio null sink; generated audio capture,
  sessions, Orca, browser, app, database and bridge were stopped/removed. The
  audio recording was deleted after confirming nonzero captured samples; no human
  listening claim is made. No providers, credentials, external network calls,
  product source changes, tests or full checks were used. PR-06, active cursor
  and release gates remain open and unchanged.

  PR-06 watchdog test runtime follow-up (bounded; 2026-09-27; PR-06 remains open):
  replaced the late-dispatch test's fixed 5.5s delay with a wait for the child
  `close` event capped at 5s. The expected close retains the 550ms observation
  gap; the deadline and existing closed-before-ack/live-lease assertions remain,
  so a missing or late close still fails. The focused case passed 1/1 (6.44s case,
  6.88s TAP, 6.96s wall); its full-suite duration fell from 6.50s to 5.63s
  (866ms, 13.3%).
  The planned `npm run check` passed 246/247 with 0 failures and one optional
  PostgreSQL backup/restore skip (`ORGWARD_PG_TOOLS_BIN` unavailable; 67.09s TAP,
  69.65s wall). `git diff --check` passed. A pre-change full-suite benchmark at
  concurrency 3 took 74.00s versus the saved concurrency-2 run at 71.09s, so the
  default remains 2. No product runtime, credential or provider behavior changed;
  PR-06, active cursor and release gates remain open and unchanged.

  PR-06 fresh DeepSeek proof attempt (user-authorized; 2026-09-27; PR-06 remains
  open): with a fresh linked-task/command and run ID, the configured profile used
  `deepseek-flash`, the fixed `/responses` endpoint and a 128-token cap. The
  encrypted credential was independently approved before the one dispatch. The
  local execute API returned HTTP 200, but the run finished FAILED and its single
  provider attempt is `outcome_unknown`; no upstream status or response shape was
  retained. The app restart readback preserved that failure; no parsed output or
  result hash existed before or after restart. No retry was made. The disposable
  app/database were removed and the credential was not emitted in logs or the
  receipt. Sanitized receipt:
  `/tmp/orgward-deepseek/live-proof-1790499388790-1790499382.json`. No successful
  T-22 evidence is claimed; PR-06, cursor and release gates remain open.

  PR-06 terminal dependency recovery UX increment (bounded; 2026-09-27; PR-06
  remains open): dependent tasks now derive a visible BLOCKED state when a
  prerequisite failed, was interrupted, or was cancelled in the selected process
  instance. The UI names the terminal prerequisite and directs the user to start
  a new instance from the first task, while preserving the existing instance's
  saved outcomes and evidence. Blocker propagation follows unstarted intermediate
  tasks, and outcomes from another instance do not unblock the selected one.
  Focused process-task state and served-client tests passed 2/2; the chain test
  covers A→B→C with failed A and no runtime for B. Review of the full check also
  found a pause/dispatch race fixture that left its slow worker waiting for a
  release marker when dispatch won. The test now observes the marker in the
  per-run workspace and releases only after worker start; it treats only a saved
  PAUSED response as pause-wins, while 409 waits for the dispatch marker. The
  focused PostgreSQL persistence journey passed 1/1 (9.48s case, 9.87s TAP),
  including the existing pause-before-authorization and dispatch-side race paths.
  The final `npm run check` passed 247/248 (247 passed, 0 failed, 1 optional
  PostgreSQL backup/restore skip because client tools were unavailable; 61.87s
  TAP). An earlier full-check attempt exposed the unreleased worker and failed
  after 123.8s; an intermediate run exposed a fast 409 classification issue.
  Both attempts are superseded by the reviewed event-barrier repair and final
  passing check. Logs: `/tmp/orgward-tests-JKNtd3/node-test.tap.log`,
  `/tmp/orgward-tests-CtVZTZ/node-test.tap.log`, and
  `/tmp/orgward-tests-qpkGOW/node-test.tap.log`. `git diff --check` passed. No
  provider call or credential access occurred. PR-06, active cursor and release
  gates remain open and unchanged.

  PR-06 terminal dependency recovery Orca check (bounded; 2026-09-27): confirmed
  Orca 50.2 / AT-SPI2 2.60.4 starts under `xvfb-run`, and the bundled Chrome
  binary is available at `/home/ubuntu/.agent-browser/browsers/chrome-154.0.8037.57/chrome`.
  The retained terminal-state evidence at `/tmp/orgward-pr06-blocked-proof/`
  consists of PNG renders, metrics and headless agent-browser snapshots. The
  snapshots expose the FAILED and BLOCKED status headings and the “Start a new
  instance” option, but do not expose the recovery instruction; the disposable
  seeded app/database session that produced the render is no longer running.
  Therefore this pass did not claim a live DOM/AT-SPI or Orca announcement for
  this state. Reproducing that evidence requires recreating and reseeding the
  disposable app fixture in a headed Xvfb/AT-SPI session. No source changes,
  tests, provider calls or credential access occurred; PR-06, active cursor and
  release gates remain open and unchanged.

  PR-06 terminal dependency recovery live Orca follow-up (bounded; 2026-09-27):
  recreated the provider-free BLOCKED chain with a one-off `/tmp` harness using
  `startTestPostgresCluster` and the existing app API patterns; the earlier
  screenshot's live fixture was not retained. In headed Chromium 154 under
  private Xvfb/D-Bus with Orca 50.2/AT-SPI2 2.60.4, the live accessibility tree
  exposed the FAILED and BLOCKED headings and the full recovery paragraph.
  Orca's initial whole-page speech event included the same recovery sentence;
  this was not a separate focused-paragraph announcement. Sanitized excerpt:
  `/tmp/orgward-pr06-orca-blocked-live-evidence-20260927.txt`. The ephemeral
  PostgreSQL database, app, Chrome, Orca, Xvfb/D-Bus session and temporary
  profiles/logs were stopped and removed. No source edits, tests, provider calls,
  or credential access occurred; PR-06, cursor and release gates remain open.

  PR-06 same-page blocked transition announcement follow-up (2026-09-27):
  source review found `refresh()` reloads task instances and replaces the plan
  subtree, while broad polite live regions could repeat the whole plan. Process
  plans now opt out of broad live updates; a separate atomic polite status region
  announces only a task's transition into BLOCKED, with failed prerequisite and
  recovery instructions. A per-instance task-status map suppresses unchanged
  refresh chatter; focus is not moved. Focused regression tests passed 2/2
  (0.13s); `node --check public/execution.js` and `git diff --check` passed.
  An initial `npm run check` passed 251/252 (251 passed, 0 failed, 1 optional
  backup/restore skip; 68.78s TAP) but overlapped one final message-batching edit.
  The frozen-tree `npm run check` passed 251/252 (251 passed, 0 failed, 1 optional
  backup/restore skip; 64.80s TAP). Focused test log:
  `/tmp/orgward-pr06-blocked-announcement-focused-20260927.log`; check log:
  `/tmp/orgward-pr06-blocked-announcement-final-check-20260927.log`, TAP:
  `/tmp/orgward-tests-8P5Kzp/node-test.tap.log`. No same-page Orca transition
  harness was run; the live AT-SPI/Orca proof covers initial whole-page speech
  only. No provider calls or credential access; PR-06 remains open.

  PR-06 blocked announcement aggregation correction (2026-09-27): one failed
  prerequisite could block many downstream tasks, so the earlier implementation
  repeated the full recovery paragraph in a single live-region update. It now
  emits one atomic summary per refresh with the newly blocked task count, up to
  three unique prerequisite names/statuses (and a count of any remaining causes),
  and one recovery instruction. Each task retains its full visible recovery
  paragraph. Focused tests cover a single transition, multiple transitions with
  deduplicated causes, repeated-refresh suppression, and live-region wiring; the
  frozen-tree focused pass passed 3/3. The frozen-tree `npm run check` passed
  252/253 (252 passed, 0 failed, 1 optional backup/restore skip; 65.00s TAP).
  Focused log: `/tmp/orgward-pr06-blocked-announcement-aggregation-focused-20260927.log`;
  check log: `/tmp/orgward-pr06-blocked-announcement-aggregation-check-20260927.log`,
  TAP: `/tmp/orgward-tests-tzY9yS/node-test.tap.log`. The prior frozen-tree full
  check above covers the earlier per-task speech content and is superseded for
  this correction by this check. No live screen-reader harness or provider access.

  PR-06 live same-page Orca transition follow-up (2026-09-27): dynamic speech
  remains unverified. The disposable OIDC test app had no configured browser
  login flow or identity provider; its bearer-token test authenticator did not
  create an `ow_session`. The only way reached to show the signed-in controls
  required manually seeding a session row/cookie, so that bypass was stopped
  before any task UI action or transition-speech capture. No task was started or
  failed. The disposable app/database/PostgreSQL, headed Chromium, Orca, Xvfb/D-Bus,
  temporary session and harness files were stopped and removed. No source changes,
  provider calls, or credential access occurred; PR-06 remains open.

  PR-06 assigned checkpoint to saved local result UI/restart proof (2026-09-27):
  with synthetic post-auth test sessions, the Execution UI completed the assigned
  human checkpoint through worker escalation, owner `resume`, and human completion;
  then the assigned downstream local-command task was requested from its named task
  row, approved by the owner, and executed. Captured POST request/response matched
  run `execution-run-2b46a3da-2b5e-4e6f-b72d-6bdec99767bc` to process task
  `task-process-deliver`, plan `process-plan-a03f8c21-dd23-4ff2-a3ab-01739e51decd`
  revision 2 and instance `4046f0ca-0695-4857-a2f8-b17c3759ca55`; after app-only
  restart, UI/API readback retained the same linkage, runtime `SUCCEEDED`, checkpoint
  history of start/escalation/resolution/completion, and `review.txt` artifact
  (`Saved review result.`; GET 200). Focused tests passed 9/9: served Execution
  controls, human history/result rendering (8 tests), and the linked durable task
  persistence journey (1 PostgreSQL test; local provider fixture only). Evidence:
  `/tmp/orgward-pr06-human-agent-ui-restart-proof.json`,
  `/tmp/orgward-pr06-human-agent-ui-postrestart.txt`, and
  `/tmp/orgward-pr06-ui-final-before-restart.txt`. No source edits, provider calls,
  or live external effects. The UI used synthetic post-auth sessions; normal OIDC
  browser login and same-page Orca speech remain unverified. PR-06 and release gates
  remain open. The single frozen-source `npm run check` passed 252/253 tests
  (252 passed, 0 failed, 1 optional backup/restore skip; 67.52s TAP); log:
  `/tmp/orgward-pr06-human-agent-ui-check.log`, TAP:
  `/tmp/orgward-tests-2iwMjr/node-test.tap.log`.

  PR-06 blocked-transition announcement timing and human-task focus recovery
  (2026-09-27): the polite one-summary BLOCKED announcement is deferred 500ms
  after refresh and is canceled when superseded or when its project/plan/instance
  context is no longer current. Focused tests cover aggregation/deduplication,
  unchanged suppression, deferred scheduling and stale-context cancellation.
  After successful human start, completion, escalation or resolution, Execution
  restores focus to that task's status heading only if the initiating control was
  removed and focus fell to BODY; it preserves any other valid focus. Focused tests
  passed 9/9 across announcement scheduling, focus fallback/no-steal/missing-target,
  and served Execution controls. Initial whole-page Orca speech evidence remains
  the separate earlier result recorded above; same-page transition speech is still
  unverified. The one bounded follow-up loaded the app with an already-authenticated
  browser session, so no task action was taken and the run does not prove normal
  OIDC login or dynamic speech. The narrow `SPEECH OUTPUT` capture was empty. Browser,
  Orca, Xvfb, app fixture and disposable PostgreSQL were stopped and cleaned up;
  no provider calls or source edits from the live attempt. `git diff --check` passed.
  The frozen-tree `npm run check` passed 257/258 tests (257 passed, 0 failed,
  1 optional backup/restore skip; 68.21s TAP); TAP:
  `/tmp/orgward-tests-itOzLK/node-test.tap.log`. PR-06 and release gates remain
  open.

  PR-06 same-page blocked-transition UI integration proof (2026-09-27): a fresh
  named browser session followed the disposable fixture's loopback test issuer
  `/auth/login` → `/auth/callback` flow; no browser cookie was manually seeded and
  this is not a production OIDC qualification. In Execution, starting and failing
  the assigned human checkpoint changed three dependent tasks to BLOCKED on the
  same page. After the delayed update, `#execution-announcement` contained one
  concise summary and a MutationObserver captured exactly one live-region DOM
  update. Selecting another instance and reselecting the same failed instance
  refreshed the same page; the summary remained unchanged and no additional DOM
  update occurred. After restarting the app against the same disposable database
  and reloading Execution, all three BLOCKED headings and full recovery paragraphs
  remained visible while the announcement region stayed empty on initial render.
  No Orca speech is claimed. Focused regression tests passed 6/6 (announcement
  helper, served-client wiring and Execution HTTP surface). The local fixture
  reported `providerCalls: 0`; browser, app and PostgreSQL were stopped and the
  disposable fixture cleaned up. PR-06 and release gates remain open.

  PR-06 deterministic proposal structural evaluation (2026-09-27): generated
  information-detail proposals now carry a versioned structural-only evaluation
  bound to the run, pinned blueprint/source envelope/target, provider profile and
  proposal core. Verification and the model apply boundary recompute the same
  evaluator; changed evaluation/core bindings and unknown versions fail closed.
  An unchanged trimmed target remains visible with a blocked reason and cannot be
  applied; passing proposals remain review-only until the existing owner approval.
  The existing PostgreSQL journey used its loopback provider fixture to persist an
  unchanged-target proposal, confirmed owner apply returns 409 without changing
  project or runtime state, restarted the app, then confirmed the evaluation
  survives and remains denied without mutation. Focused runs passed: 35/35 across
  proposal, review-state, served Execution/API surface and model tests; the existing
  PostgreSQL journey 1/1; model suite after final binding assertions 21/21. The
  single frozen-source `npm run check` passed 261/262 tests (261 passed, 0 failed,
  1 optional PostgreSQL backup/restore skip because PostgreSQL client tools are
  unavailable; 65.27s). TAP log:
  `/tmp/orgward-tests-W3VZiZ/node-test.tap.log`. Focused TAP output was not saved to
  separate log files. No external provider calls or credentials were used. PR-06,
  active cursor and release gates remain open and unchanged.

  PR-06 blocked proposal review UI proof (2026-09-27): headed agent-browser opened
  `/execution.html` on a disposable file-backed `createApp` fixture with the
  default local development identity and a seeded unchanged-target evaluation.
  The synthetic task reference included the saved process ID/name. The page showed
  “Deliver the core offering”, target, before/proposed detail, rationale, source
  citation/hash and the exact blocked structural reason; the review-only message
  was visible and the Apply action count was zero. Reload preserved the same
  visible review and zero Apply actions. No browser cookie was seeded; this is not
  an OIDC or production-auth claim. The profile endpoint was loopback-only and no
  provider request was made. App/browser, fixture data and harness were cleaned up;
  no product source/tests changed and no full check was rerun. Proof:
  `/tmp/orgward-pr06-blocked-proposal-review-proof.json`; full-page screenshot:
  `/tmp/orgward-pr06-blocked-proposal-review-full.png`. PR-06, cursor and gates
  remain open and unchanged.

  PR-06 same-page BLOCKED Orca speech follow-up (2026-09-27): a headed browser
  completed the disposable loopback `/auth/login` → authorization → `/auth/callback`
  flow without a manually seeded session cookie, then failed the assigned human
  checkpoint in Execution. Three dependent tasks became BLOCKED and the summary
  appeared in the accessibility tree as `role=status`, `live:polite`, `atomic:true`;
  Orca logged the matching AT-SPI text insertion, but there was no matching
  `SPEECH OUTPUT`. The scripted browser click left Orca's locus on the home link,
  and the trace recorded a focus change ignored during say-all, so this capture is
  inconclusive about real-user Orca speech and does not establish a product defect.
  Sanitized evidence: `/tmp/orgward-pr06-orca-transition-evidence-20260927.txt`.
  The local fixture reported `providerCalls: 0`; browser, Orca, app, disposable
  PostgreSQL and temporary session/profile data were stopped and cleaned up. No
  source or test changes and no full check; only `git diff --check` was run. PR-06,
  active cursor and release gates remain open and unchanged.

  PR-06 keyboard-only saved-process journey attempt (2026-09-27): headed agent-browser
  used the loopback `/auth/login` → authorization → `/auth/callback` flow with local
  synthetic Alice/Bob identities and a disposable PostgreSQL-backed fixture. Keyboard
  Tab/Enter/Shift+Tab and keyboard typing started the assigned human checkpoint,
  escalated it, and had the owner resolve/resume it; visible 3px focus outlines and
  focus recovery to IN_PROGRESS/ESCALATED task headings are in the retained snapshots
  and screenshots under `/tmp/orgward-pr06-keyboard-proof/`. A tab-order discovery
  overshoot submitted a default local controlled-run request; it remained AWAITING
  APPROVAL and was not approved or executed. After Alice’s resume, Bob’s refreshed
  DOM still showed ESCALATED/history 2, while read-only GETs from both existing
  sessions to `/api/execution/process-task-instances?projectId=project-bf47d0f2-0792-4e24-81b6-30fd0543ffcd`
  agreed on the same instance/task at IN_PROGRESS, version 3, three events; actor
  authority flags differed as expected. This records a UI/readback mismatch for root
  review; no further mutation/reload was attempted. The remaining completion, local
  execution, result/artifact and restart path is unverified. App/DB/browser sessions,
  PostgreSQL data and temporary harness were cleaned; no provider or external calls,
  source/test edits, tests or full check occurred. PR-06 and gates remain open.

  PR-06 keyboard reload timing follow-up (2026-09-27): a fresh disposable fixture
  copy used normal loopback OIDC login and only the built-in local executor; provider
  code/profile/endpoint were removed. The single repeat attempt reached the saved-plan
  page, but native Tab traversal wrapped to “Create planning graph” instead of the
  human-task action, and Enter added an extra planned graph in the disposable DB. No
  checkpoint transition, owner resolution, read-after-reload comparison, approval or
  execution occurred, so the prior DOM/API mismatch remains unresolved. The temporary
  app, PostgreSQL cluster/data, browser and launcher were cleaned. Evidence:
  `/tmp/orgward-pr06-keyboard-proof/repeat-attempt-20260927/`. No source/test edits,
  provider calls, tests or full check. PR-06 and release gates remain open.

  PR-06 Execution keyboard entry and saved-task ordering (2026-09-27): Execution
  now starts with a keyboard-visible “Skip to Execution content” link targeting a
  labelled, `tabindex=-1` main region with visible focus styling. Existing saved
  process task cards now precede the graph-creation form in the new-run template;
  graph creation and standalone run forms remain available. Served HTML/CSS regression
  coverage verifies the skip target and source order. Focused command `npm test --
  tests/execution/server.test.mjs tests/execution/accessibility.test.mjs` passed 3/3
  (0.69s); log `/tmp/orgward-pr06-keyboard-ux-focused-20260927.log`. The single
  frozen-tree `npm run check` passed 265/266 (265 pass, 0 fail, 1 optional backup/
  restore skip because PostgreSQL client tools are unavailable; TAP 72.12s, wall
  74.67s); logs `/tmp/orgward-pr06-keyboard-ux-check-20260927.log` and
  `/tmp/orgward-tests-3vl5TB/node-test.tap.log`. `git diff --check` passed. The
  earlier native-keyboard journey remains incomplete; no browser retry, provider call,
  or external request was made for this slice. PR-06, active cursor and release gates
  remain open and unchanged.

  PR-06 keyboard skip-link and human checkpoint proof (2026-09-27): in one fresh
  headed local fixture, browser login completed the normal `/auth/login` → loopback
  test issuer → `/auth/callback` flow with a synthetic assigned-human identity. First
  Tab focused “Skip to Execution content” with a visible 3px outline; Enter focused
  labelled `#execution-main`. Native Tab then reached saved task controls before
  “Create planning graph”; Enter started the eligible checkpoint, keyboard typing
  entered evidence, and Enter completed it. Focus moved to matching IN_PROGRESS and
  SUCCEEDED status headings with visible 3px outlines. A settled read-only GET verified
  the same task `SUCCEEDED` (version 2), evidence present, and HumanTaskStarted plus
  HumanTaskCompleted events. Sanitized AX snapshots, focus trace and screenshots:
  `/tmp/orgward-pr06-keyboard-skip-proof-20260927/`. The disposable fixture configured
  only the built-in local executor and had no provider profile/code/credential or
  provider request; no executor was run. Agent request/approval/result/artifact and
  restart flow plus Orca speech remain unverified. Fixture/app/PostgreSQL/browser and
  temp data were cleaned. No product source/test edits or test/full-check reruns were made for this proof.
  PR-06 keyboard approval/execution focus handoff and persisted run proof (2026-09-27):
  keyboard Approve now hands focus to Execute only after a successful APPROVED refresh,
  without activating it; keyboard Execute focuses the terminal SUCCEEDED/FAILED run
  status after successful refresh. Trusted keyboard activation, current focus, detached
  initiator, target availability and no focus movement during the request are required;
  failures, pointer activation and nonterminal responses do not hand focus away. The
  terminal status has a visible 3px focus outline. Focused helper/served-client/accessibility
  tests passed 10/10 (0.75s), log `/tmp/orgward-tests-7pc9us/node-test.tap.log`.

  The first full check after source changes had 271 pass, 1 failure, 1 optional skip
  (76.99s): `tests/persistence.test.mjs:6850` did not observe the slow local command
  worker start marker within 10 seconds. Test diagnostics were updated to use the same
  workspace-marker watcher used by the earlier race cases and to report execution HTTP
  status, final run status/events and safe error detail after releasing the barrier. The
  affected persistence case passed alone (1/1, 12.20s;
  `/tmp/orgward-tests-h7Tqkx/node-test.tap.log`). The final `npm run check` passed
  272/273 with 1 optional PostgreSQL backup/restore skip (client tools unavailable),
  0 failures, 66.36s; logs `/tmp/orgward-pr06-run-focus-final-check-20260927.log` and
  `/tmp/orgward-tests-qrqEU2/node-test.tap.log`. `git diff --check` passed.

  One fresh local keyboard journey used normal loopback OIDC for separate Bob requester
  and Alice approver sessions, starting from a saved plan whose human checkpoint was
  already SUCCEEDED. Bob keyboard-requested the task; Alice keyboard-approved it. Focus
  moved to Execute without running it; Enter then ran only the built-in deterministic
  `scaffold-node-service` executor, producing SUCCEEDED, six artifacts and the
  Request/Approve/Start/Success event history. Execution moved focus to the terminal
  status with a visible outline. App-only restart on the same PostgreSQL fixture was
  followed by keyboard Ctrl+R; the completed page AX tree showed SUCCEEDED and artifact
  links. Post-restart read-only API verified the same run/task/plan-instance link,
  succeeded human and agent history, all six artifact hashes, and a Dockerfile artifact
  GET 200 with matching recorded/header SHA-256. On an extra keyboard navigation after
  reload, focus was on “Open linked plan instance” and Enter returned to the plan; no
  further UI action was attempted. Thus post-restart persistence and initial reloaded
  run display were observed, but clean keyboard re-entry from the reloaded plan is not
  claimed. Evidence: `/tmp/orgward-pr06-agent-keyboard-proof-final-20260927/`. Fixture,
  app, PostgreSQL data/processes and browser sessions were cleaned; providerCalls=0,
  no provider profile/credential/network or external effect. Provider-backed model work
  and Orca transition speech remain open. PR-06, cursor and release gates remain open
  and unchanged.

  PR-06 selected-run keyboard re-entry increment (2026-09-27): Execution now records
  the selected run as a validated `?project=…&run=…` route and reload restores only
  an accessible run matching that ID. The existing plan-row “Open linked run” action
  explicitly returns to the run detail and, for keyboard activation, hands focus to
  its status target only after the successful load; it does not approve or execute.
  Route, focus-guard and served-client tests passed 17/17 (0.81s), log
  `/tmp/orgward-tests-gjI7We/node-test.tap.log`. The single `npm run check` passed
  274/275 with 1 optional PostgreSQL backup/restore skip (client tools unavailable),
  0 failures, 72.49s TAP / 75.03s total; logs
  `/tmp/orgward-pr06-run-reentry-full-check-20260927.log` and
  `/tmp/orgward-tests-MMWKuQ/node-test.tap.log`. A fresh local fixture reached a
  persisted SUCCEEDED run using the built-in executor, but headed agent-browser Chrome
  exited before UI launch with “No usable sandbox.” Per the one-attempt limit, browser
  re-entry and app-restart readback were not verified; no screenshot or UI interaction
  occurred. The exact disposable app/issuer/PostgreSQL/profile and browser session were
  cleaned; no fixture processes remain and providerCalls=0. Prior persisted-result and
  artifact readback receipts remain valid, while keyboard re-entry after reload and
  provider-backed model/Orca speech evidence remain open. `git diff --check` passed.
  PR-06, active cursor and release gates remain open and unchanged.

  PR-06 selected-run browser follow-up (2026-09-27): a fresh headed browser launch
  with the documented Chromium `--no-sandbox` option completed normal synthetic
  loopback OIDC login. A saved SUCCEEDED local-executor run rendered from a URL
  containing its exact project and run IDs. After app-only restart against the same
  disposable PostgreSQL database, the fixture chose a new ephemeral loopback port;
  opening the same selected-run URL there restored the exact SUCCEEDED run with six
  artifact links and the existing normal login session. Native Ctrl+R then restored
  that same run again. Native Tab/Enter opened the linked plan; Tab/Shift+Tab reached
  its explicit “Open linked run” button, and Enter re-entered the exact run URL with
  focus on the SUCCEEDED status (solid visible outline). Read-only state remained
  SUCCEEDED with only the original request, approval, start and success event types;
  no approval or execution action was triggered by re-entry. Provider calls: 0.
  Screenshots, AX snapshots, URL/focus records and sanitized proof:
  `/tmp/orgward-pr06-run-reentry-proof-20260927/`. The prior no-sandbox launch failure
  remains as historical receipt; this separate bounded launch succeeded. Fixture,
  issuer, app, browser session and PostgreSQL data were cleaned, with no related
  process remaining. No source/tests/full check changed for this proof. `git diff
  --check` passed. PR-06, active cursor and release gates remain open and unchanged.

  PR-06 approval handoff Orca follow-up (2026-09-27): the first disposable
  fixture launch stopped before browser startup because its temporary setup code
  expected a nested human-task start response; `server.mjs` returns
  `planInstanceId` and `status` at the top level. After correcting only that
  fixture assumption, a second fresh local run completed synthetic loopback OIDC
  login and loaded one AWAITING_APPROVAL run backed by the built-in deterministic
  `scaffold-node-service` executor. Native Tab reached “Approve execution” and
  native Enter approved it. The refreshed run was APPROVED; keyboard focus moved
  to “Execute approved profile” with a solid visible outline, and Orca logged
  `SPEECH OUTPUT: 'Execute approved profile'`. After a later Enter the browser
  unexpectedly returned to the workspace home page, so no further UI action was
  taken. Read-only run GET returned HTTP 200, status APPROVED, version 1, only
  `ExecutionRequested` and `ExecutionApproved`, and no execution/artifacts; the
  run did not start. Execute activation, terminal status focus and terminal Orca
  speech therefore remain unverified. Sanitized evidence:
  `/tmp/orgward-pr06-orca-approval-evidence-20260927/sanitized-result.txt`.
  App/fixture, browser, Orca, private Xvfb/D-Bus/PulseAudio and PostgreSQL were
  stopped; the final process scan found no task-owned processes. Provider calls:
  0. No product source/tests or full check changed for this attempt;
  `git diff --check` passed. PR-06, cursor and release gates remain open.

  PR-06 guarded Orca terminal-status follow-up (2026-09-27): a fresh synthetic
  loopback OIDC/local-executor fixture repeated approval. Orca spoke
  “Execute approved profile” after focus moved there with a visible outline. The
  required immediate pre-Enter guard returned false for exact Execute-button
  focus. A read-only probe found BODY focused on the selected-run URL
  (`http://127.0.0.1:38779/execution.html?project=project-7308ee4a-eb1b-4a71-9323-f12566948fd6&run=execution-run-bf4ba608-32bb-446b-870c-75c636d49ca5`), with status
  APPROVED. Per stop condition no Enter was sent. Read-only API confirmed only
  `ExecutionRequested` and `ExecutionApproved`, no execution; terminal focus,
  speech and artifact hashes remain unverified. This does not establish a
  product defect. Sanitized trace: `/tmp/orgward-pr06-orca-terminal-evidence-20260927/sanitized-result.txt`.
  Fixture/app, browser, Orca, Xvfb/D-Bus/audio and PostgreSQL were cleaned; final
  process scan was clear. Provider calls: 0; no product source/tests/full check
  changed. `git diff --check` passed. PR-06, cursor and gates remain open.

  PR-06 final guarded Orca follow-up (2026-09-27): a single CDP-backed page
  sequence observed exact BUTTON focus on “Execute approved profile” immediately
  before sending one Enter keydown/keyup. The captured trace records that keydown
  with Execute active, but no click event followed. The selected run URL remained
  loaded and focus stayed on Execute. Read-only API returned APPROVED, version 1,
  only `ExecutionRequested` and `ExecutionApproved`, and no execution/artifacts.
  The captured Orca trace had an AT-SPI text insertion for Execute but no matching
  SPEECH OUTPUT line. Enter activation and terminal status speech remain
  inconclusive; no product defect is established. Sanitized evidence:
  `/tmp/orgward-pr06-orca-guarded-evidence-20260927/sanitized-result.txt`.
  All fixture/browser/Orca/Xvfb/audio/PostgreSQL processes were cleaned; provider
  calls: 0. No source/tests/full check changed. `git diff --check` passed; PR-06,
  cursor and gates remain open.

  PR-06 native X11 Orca terminal-result proof (2026-09-27): with capture already
  running, normal synthetic loopback OIDC loaded a disposable saved-plan run.
  Native Tab and Return approved it. Before execution, the focused X11 input
  window was Chromium and `document.activeElement` exactly matched the Execute
  button; one native X11 Return then produced its activation click. The run stayed
  on its selected URL, finished SUCCEEDED, and moved DOM focus to the matching
  status target with a solid outline. Orca’s trace recorded focus on SUCCEEDED and
  `SPEECH OUTPUT: 'SUCCEEDED.'`; this attempt did not record speech for the Execute
  label (that phrase was spoken in the earlier approval-follow-up receipt above).
  Read-only API returned HTTP 200, SUCCEEDED, version 3, exactly one each of
  ExecutionRequested/Approved/Started/Succeeded and six artifacts with content
  hashes. Full URL, key-target trace and artifact hashes:
  `/tmp/orgward-pr06-orca-x11-evidence-20260927/sanitized-result.txt`. Fixture,
  browser, Orca, Xvfb/D-Bus/audio and PostgreSQL were cleaned; final process scan
  was clear. Provider calls: 0; no source/tests/full check changed.
  `git diff --check` passed. PR-06, cursor and gates remain open.

  PR-06 unknown-attempt reference UX increment (2026-09-27): the recorded pause
  boundary now displays the full local `attemptId` only when its provider status
  is `outcome_unknown`. The text identifies it as an OrgWard-local attempt
  reference, explicitly says it is not a provider request ID and proves neither
  receipt nor completion, and shows `unavailable` for a malformed local ID. No
  status, output, endpoint, retry or control transition changed. The focused
  saved-process PostgreSQL restart journey and served-client test passed 2/2
  (12.04s total; PostgreSQL case 11.17s), confirming the reference survives
  restart while the provider attempt remains unknown and linked run remains
  interrupted. The frozen-tree `npm run check` passed 286/287 (286 passed, 0
  failed, 1 optional PostgreSQL backup/restore skip because client tools are
  unavailable; 71.63s TAP, 74.04s total). `git diff --check` passed before and
  after the check. Logs: `/tmp/orgward-pr06-attempt-reference-check.log`,
  `/tmp/orgward-pr06-attempt-reference-check.time.log`, and
  `/tmp/orgward-tests-vjfJsE/node-test.tap.log`. No provider calls or credential
  access. PR-06 remains first open; cursor and release gates remain unchanged.

  PR-06 provider and sandbox availability check (2026-09-27): the user authorized
  a test with the exposed key. The relevant DeepSeek/OpenClaw environment variables
  are unset, the previously identified OpenClaw config and agent database paths
  are absent, and the running loopback gateway reports unhealthy status; its
  redacted model status lists only an OpenAI route, with no DeepSeek route. No
  secret values or transcripts were read, no provider call was sent, and the prior
  `outcome_unknown` attempt was not retried. A sandbox-preserving Chromium launch
  is also unavailable: Ubuntu AppArmor blocks unprivileged user namespaces and no
  Chrome sandbox helper is installed. No `--no-sandbox` workaround or host-policy
  change was made. The real-provider result and dynamic cross-session Orca proof
  remain open; PR-06, the active cursor and release gates are unchanged.

  PR-06 resource and freshness recheck (2026-09-28): the OpenClaw system service
  runs as its dedicated `openclaw` account, but its process environment exposes no
  provider/API-key variable names, its standard config and `.env` paths are absent,
  and no credential files are mounted for the service. No credential value was
  read, no provider request was sent, and the earlier `outcome_unknown` attempt was
  not retried. Orca and AT-SPI are installed, but no browser executable or
  browser automation runtime is available; the existing Chromium launch remains
  blocked by the host sandbox policy. No browser was launched and no sandbox or
  host policy was changed. Review of the historical cross-session stale-render
  report confirmed current behavior intentionally defers a changed snapshot while
  focus remains in the plan and applies it on focusout; the focused state/served-
  client tests and prior provider-free two-session proof cover this path. No source
  or test files changed and no tests were run. The real-provider result and dynamic
  cross-session Orca proof remain open; PR-06, cursor and release gates are
  unchanged.

  PR-06 provider/keyboard runtime recheck (2026-09-28): the active
  `openclaw.service` runs as its dedicated `openclaw` account, but its runtime
  environment has no provider-key variable names, and it has no environment-file
  or systemd credential-file directive. The service account's standard
  `/home/openclaw/.openclaw/openclaw.json`, agent SQLite and `.env` paths are
  absent. DeepSeek/OpenClaw key variables and OrgWard database/secret-vault
  variables are unset. No credential value was read or printed and no live
  request was made; the previous `outcome_unknown` attempt was not retried. The
  local `agent-browser` 0.38.1 runtime and Chrome for Testing 154.0.8037.57 are
  installed, as are Orca and Xvfb, but this Chrome runtime has no `chrome-sandbox`
  helper. AppArmor restricts unprivileged user namespaces
  (`/proc/sys/kernel/apparmor_restrict_unprivileged_userns` is `1`), and the
  sandbox-preserving `unshare --user --map-root-user true` probe failed with
  `Operation not permitted`. No browser was launched, no user profile or session
  was touched, and no host policy or sandbox setting was changed. The native
  keyboard/Orca customer journey remains unverified. No source/test changes or
  tests/full check were made. PR-06 remains first open; cursor and release gates
  remain unchanged.

  PR-06 selected-run cross-session freshness increment (2026-09-28): an open
  selected Execution run now performs authenticated GET refreshes on the existing
  15-second cadence and when the page becomes visible. Request generation and exact
  current run/project route identity reject late or misrouted responses; older and
  divergent same-version snapshots are ignored. Identical snapshots do not rerender
  or announce. Updates defer while run controls are focused or dirty, with distinct
  messages in the persistent polite status region, then apply on focusout. Applied
  snapshots announce status transitions only, keep the main content out of a live
  region, and update the selected run-list status in place to preserve keyboard
  focus. Focused helper and served-client tests passed 5/5 (0.71s); the single final
  frozen-tree `npm run check` passed 309/310 (309 passed, 0 failed, 1 optional
  PostgreSQL backup/restore skip because client tools are unavailable; 76.09s TAP,
  79.91s total). `git diff --check` passed. Logs:
  `/tmp/orgward-pr06-selected-run-refresh-focused-final.log`,
  `/tmp/orgward-pr06-selected-run-refresh-check.time.log`; TAP
  `/tmp/orgward-tests-tj8ob9/node-test.tap.log`. No browser or provider was used.
  PR-06 remains first open; task checkboxes, cursor and release gates remain
  unchanged.

  PR-06 task-assignment transparency increment (2026-09-28): saved-plan task cards
  now expose the exact pinned blueprint version's role scope, responsibility,
  instructions, proposed tools and escalation rules, clearly labeled as proposed
  guidance rather than enabled authority or tools. The card separately shows the
  planned human/agent assignee, and shows an organizational responsibility target
  only for a current version-matched enabled eligible identity binding of the
  matching target type; stale, proposed, unavailable or unresolved bindings say
  `Unresolved`. Human and agent execution permission boundaries are stated
  separately. Missing role statements are shown as `Not specified`. Focused helper
  and served-client tests passed 6/6 (0.66s). `git diff --check` passed before and
  after the single frozen-tree `npm run check`, which passed 322/323 (322 passed,
  0 failed, 1 optional PostgreSQL backup/restore skip because client tools are
  unavailable; 76.51s TAP, 77.7s total). Logs:
  `/tmp/orgward-tests-xpEk5F/node-test.tap.log`,
  `/tmp/orgward-tests-Mqhu1y/node-test.tap.log`. No provider, browser or external
  effect was used. PR-06 remains first open; task checkboxes, cursor and release
  gates remain unchanged.

  Role-reference follow-on (2026-09-28): verified that a planned task with a
  `role-reference` and no selected actor still presents role guidance from the
  exact pinned blueprint while the planned assignee and organizational target
  remain unresolved. Added an enabled-target canary assertion to ensure an
  unrelated binding cannot disclose its target. The focused assignment helper
  tests passed 6/6 (0.25s). The frozen-tree `npm run check` passed 323/324 (323
  passed, 0 failed, 1 optional PostgreSQL backup/restore skip because client tools
  are unavailable; 76.80s TAP). `git diff --check` passed before and after the
  check. Logs: `/tmp/orgward-tests-5hNAdS/node-test.tap.log`,
  `/tmp/orgward-tests-HXEvoF/node-test.tap.log`. PR-06 cursor, task checkboxes and
  release gates remain unchanged.

  PR-06 immutable model task-guidance increment (2026-09-28): model-backed
  process-task requests now capture proposed role instructions and scope from the
  exact blueprint version and graph revision already locked for the saved task
  request. The snapshot is validated against the task assignment and linked
  actor-role, stored with the existing run work item and checked by digest against
  the immutable run reference whenever the provider prompt is built. Existing
  historical plan instances remain pinned to their saved blueprint; no migration
  was needed. The prompt labels guidance as user-authored and subordinate to
  server-approved scope, tools, approvals and platform rules, while task and
  source text remain separately labeled untrusted factual data. Proposed tool and
  escalation statements are not sent as enabled permissions; Responses requests
  retain `tools: []` and bounded citation validation. Tests cover forged/mismatched
  references, stale blueprint and graph revisions, digest tampering, role edits
  after request with saved-work-item reload, source injection separation, and the
  PostgreSQL process-task request read after application restart. Focused proposal
  tests passed 9/9 (0.21s); the linked PostgreSQL request/recovery journey passed
  1/1 (16.16s). An initial focused persistence pass exposed a legacy pinned role
  without `proposedInstructions`; the snapshot now preserves that absent value as
  an empty string and the rerun passed. The single frozen-tree `npm run check`
  passed 325/326 (325 passed, 0 failed, 1 optional PostgreSQL backup/restore skip
  because client tools are unavailable; 78.21s TAP, 79.32s total). `git diff
  --check` passed before and after. Logs: `/tmp/orgward-tests-XUjXOA/node-test.tap.log`,
  `/tmp/orgward-tests-UtIAIJ/node-test.tap.log`,
  `/tmp/orgward-tests-jbUPoq/node-test.tap.log`. No provider credentials or live
  requests were used; PR-06 cursor, checkboxes and release gates remain unchanged.

  Legacy approval compatibility follow-on (2026-09-28): persisted model-backed
  runs without a guidance snapshot now reconstruct the exact pre-increment prompt
  from their saved proposal context and approved task instructions, with no read
  of mutable blueprint role text and no newly injected guidance. Prompt building
  requires the saved run approval; paused legacy amendments retain the same
  pre-guidance prompt contract. A no-transport unit regression mutates current
  role text after serializing an approved legacy run and confirms unchanged prompt
  wording and work item. Focused proposal tests passed 10/10 (0.23s); the linked
  PostgreSQL request/recovery journey passed 1/1 (14.48s). The repaired frozen-tree
  `npm run check` passed 326/327 (326 passed, 0 failed, 1 optional PostgreSQL
  backup/restore skip because client tools are unavailable; 77.64s TAP, 78.73s
  total). `git diff --check` passed before and after. Logs:
  `/tmp/orgward-tests-AAa6lG/node-test.tap.log`,
  `/tmp/orgward-tests-iQSi8O/node-test.tap.log`,
  `/tmp/orgward-tests-OcCTK1/node-test.tap.log`. No provider requests or credentials
  were used; PR-06 cursor, checkboxes and release gates remain unchanged.

  PR-06 run-specific guidance review increment (2026-09-28): confirmed the
  authorized run view exposes `workItem.taskGuidance` but the approval/result
  screen omitted it. The screen now renders only the immutable request snapshot,
  labels it as user-authored proposed guidance subordinate to approved scope,
  approvals, tools and platform rules, and shows its pinned role/actor/blueprint/
  graph references. Existing runs without a snapshot receive separate legacy
  prompt provenance copy; mismatched snapshots are shown unavailable. No current
  editable blueprint role text is consulted. Focused review-helper and served
  client tests passed 4/4 (0.64s); the single frozen-tree `npm run check` passed
  329/330 (329 passed, 0 failed, 1 optional PostgreSQL backup/restore skip because
  client tools are unavailable; 76.94s TAP, 78.15s total). `git diff --check`
  passed before and after. Logs: `/tmp/orgward-tests-kfUWdz/node-test.tap.log`,
  `/tmp/orgward-tests-jMZMZ6/node-test.tap.log`. One earlier helper/served-client
  run failed due to an unescaped test regex and passed after correction.

  Provider smoke status (updated 2026-09-28): one fresh synthetic OpenClaw CLI
  call through the service-managed DeepSeek credential route succeeded with
  `deepseek-flash` in 7.989s (one dispatch); the credential value was not printed.
  This confirms OpenClaw provider access only. The managed credential is not
  available as an OrgWard tenant-scoped SecretStore binding, so the linked
  process-task app flow was not attempted. No product source changed, and the
  historical `outcome_unknown` run was untouched. PR-06 cursor, checkboxes and
  release gates remain unchanged.

  PR-06 human checkpoint evidence notes (2026-09-28): completion, escalation and
  owner-resolution forms now accept up to 20 trimmed evidence notes, one per line,
  matching the existing runtime/API bounds of 1,000 characters per note. Invalid
  counts or oversized notes are rejected inline; successful completion and owner
  success still require evidence. Saved command payloads keep the evidence array
  intact. Follow-up uncertainty handling (2026-09-28): all fields and the submit
  button lock before the first request; a polite in-form status announces saving.
  An uncertain result keeps the exact command ID/payload and displayed values frozen
  behind a “Retry saved …” action. A definitive conflict clears the command and
  unlocks fields for reconciliation; after success, controls stay locked until the
  enclosing refresh replaces the form. Focused retry/helper/served-client tests
  passed 3/3 (0.44s), TAP
  `/tmp/orgward-tests-but8tQ/node-test.tap.log`. Tests cover complete, escalate and
  resolve control flow, same-command payload replay, edits blocked during send,
  post-save lock and definitive-conflict unlock. The first full check after this
  repair failed 343/345 because a served-client assertion expected three direct
  helper call sites instead of the two calls used by completion and the shared
  escalation/resolution path; the assertion was corrected. Its log is
  `/tmp/orgward-pr06-human-evidence-retry-check.log`, TAP
  `/tmp/orgward-tests-A64yls/node-test.tap.log`. The final frozen-tree check passed
  344/345 (344 passed, 0 failed, 1 optional PostgreSQL backup/restore skip because
  client tools are unavailable; 77.57s TAP, 80.19s total), TAP
  `/tmp/orgward-tests-kvb6CN/node-test.tap.log`; output
  `/tmp/orgward-pr06-human-evidence-retry-final-check.log`. Syntax checks and
  `git diff --check` passed. No provider call, browser launch or external effect.
  PR-06, cursor, task checkboxes and release gates remain unchanged.

  The earlier focused helper and served-client tests passed 3/3 (0.33s), TAP
  `/tmp/orgward-tests-NlkD3T/node-test.tap.log`. The existing PostgreSQL human/agent
  journey passed 1/1 (14.52s), including authorization denial, idempotency conflict,
  distinct-task isolation and restart recovery; it verifies multiple notes on
  escalation, owner resolution, completion and restored audit events. Log
  `/tmp/orgward-pr06-human-evidence-persistence.log`, TAP
  `/tmp/orgward-tests-fdM4fD/node-test.tap.log`.

  PR-06 process-instance control retry/freshness (2026-09-28): pause, resume,
  cancel and ABANDONED_UNVERIFIED forms now freeze submitted details while sending
  and retain the same command ID and payload for uncertain retries. A remounted
  form restores the saved values and retry/settled status; only the retry button
  is enabled while uncertain. Success and definitive conflicts keep stale controls
  locked until an authoritative instance refresh replaces them; failed refreshes
  preserve the lock and accurate status. Cross-session applied snapshots clear
  settled commands before render; deferred snapshots retain them, and unchanged
  snapshots rerender only when clearing a stale settled lock. The abandonment
  evidence and duplicate-cost/work acknowledgement remain required. Final focused
  control/helper and served-client tests passed 11/11 (0.69s), log
  `/tmp/orgward-pr06-instance-control-focused.log`. One earlier focused attempt
  caught an outdated served-client regex after the refresh branch changed; the
  assertion was corrected and the final focused run passed. The final frozen-tree
  `npm run check` passed 353/354
  (353 passed, 0 failed, 1 optional PostgreSQL backup/restore test skipped because
  PostgreSQL client tools are unavailable; 78.70s total, 77.52s TAP). Output:
  `/tmp/orgward-pr06-instance-control-final-check.log`; TAP:
  `/tmp/orgward-tests-bf46lL/node-test.tap.log`. No provider/browser/external
  action. PR-06, cursor, task checkboxes and release gates remain unchanged.

PR-06 paused linked-run amendment retry (2026-09-28): paused instruction edits
now freeze objective, normalized requirements, reason, project ID, version and
command ID before send. Fields lock while sending and after uncertain, saved or
conflict results; only the exact saved command can retry. A fresh run read clears
settled state before rerender, failed reads preserve the lock and truthful status,
and selected-run refreshes reconcile settled state only when applied. Remounted
forms restore the submitted values. The existing API authorization, idempotency,
pause and fresh-approval rules remain in force. Focused helper/served-client tests
passed 6/6 (0.71s), log
`/tmp/orgward-pr06-linked-run-amendment-ui.log`. The affected durable PostgreSQL
request journey passed 1/1 (15.66s), log
`/tmp/orgward-pr06-linked-run-amendment-persistence.log`; this includes requester
authority and same-command/conflicting-payload idempotency assertions. An earlier
combined focused run failed 48/50 on a version-conflict disposition edge and a
status-text assertion; both were corrected before the passing runs. No provider,
browser or external actions. The single frozen-source `npm run check` passed
358/359 (358 passed, 0 failed, 1 optional PostgreSQL backup/restore journey
skipped because PostgreSQL client tools are unavailable; 76.66s TAP, 77.82s
reported runner duration), log `/tmp/orgward-pr06-linked-run-amendment-check.log`,
TAP `/tmp/orgward-tests-cckVud/node-test.tap.log`. `git diff --check` passed
after the receipt update. PR-06, cursor, task checkboxes and release gates remain
unchanged.

PR-06 linked saved-result failure guidance (2026-09-28): linked failed and
interrupted runs now persist only a fixed allowlisted category derived from
profile kind, known failure codes or known interruption reasons. The saved-task
disclosure maps recognized categories to bounded next-step guidance and uses
generic copy for old or unknown categories; raw messages, output and unknown
codes are not used for this guidance. Existing provider outcome-unknown
diagnostics retain precedence. Focused helper/service/served-client tests passed
21/21 (1.26s), log
`/tmp/orgward-pr06-linked-failure-guidance-focused-final.log`. The durable saved
process-task PostgreSQL journey passed 1/1 (15.11s), including failed-command
category persistence and provider recovery classification, log
`/tmp/orgward-pr06-linked-failure-guidance-persistence.log`. The single
frozen-source `npm run check` passed 361/362 (361 passed, 0 failed, 1 optional
PostgreSQL backup/restore journey skipped because PostgreSQL client tools are
unavailable; 77.87s TAP, 79.01s reported runner duration), log
`/tmp/orgward-pr06-linked-failure-guidance-check.log`, TAP
`/tmp/orgward-tests-er9oCE/node-test.tap.log`. Syntax and `git diff --check`
passed. No provider, browser or external actions. PR-06, cursor, task checkboxes
and release gates remain unchanged.

PR-06 saved-plan proposal application status (2026-09-28): the linked task-row
proposal preview now reports an applied version only when the current project
snapshot and append-only `BlueprintProposalApplied` event match the run ID and
exact generated-proposal hash and carry a positive integer version. Otherwise it
remains review-only or says application status is unavailable. The applied copy
states that this created a proposed design version and did not execute work.
Focused helper and served-client tests passed 12/12 (0.72s), log
`/tmp/orgward-pr06-proposal-application-row-focused.log`. The saved-process
PostgreSQL restart journey passed 1/1 (15.52s), including applied and unapplied
task-row projection after restart, log
`/tmp/orgward-pr06-proposal-application-row-persistence.log`. The single
frozen-source `npm run check` passed 362/363 (362 passed, 0 failed, 1 optional
PostgreSQL backup/restore journey skipped because PostgreSQL client tools are
unavailable; 77.22s TAP, 78.36s reported runner duration), log
`/tmp/orgward-pr06-proposal-application-row-check.log`, TAP
`/tmp/orgward-tests-ATcCmL/node-test.tap.log`. Syntax and `git diff --check`
passed. No provider, browser or external actions. PR-06, cursor, task checkboxes
and release gates remain unchanged.

PR-06 cross-session proposal-status freshness (2026-09-28): the 15-second
process refresh now fetches the authorized selected-project snapshot alongside
runtime plans, task instances and runs. Matching project ID/version changes
trigger task-card refresh even when runtime state is unchanged; focus/dirty edits
retain the existing deferral, and request, route and project guards reject stale
responses. If project state is unavailable, process activity can still refresh
and an accessible retry warning remains visible. Focused refresh, announcement
and served-client tests passed 21/21 (0.86s), log
`/tmp/orgward-pr06-process-project-refresh-focused.log`. The final frozen-tree
`npm run check` passed 363/364 (363 passed, 0 failed, 1 optional PostgreSQL
backup/restore journey skipped because PostgreSQL client tools are unavailable;
78.31s TAP, 79.56s runner), log
`/tmp/orgward-pr06-process-project-refresh-final-check.log`, TAP
`/tmp/orgward-tests-l0aWwH/node-test.tap.log`. Syntax and `git diff --check`
passed. No provider, browser or external actions. PR-06, cursor, task checkboxes
and release gates remain unchanged.

PR-06 saved task applied-proposal design link (2026-09-28): expanded linked task
results now offer a direct design link only when the current project event matches
the exact run and proposal hash. The event object must also match the generated
proposal target and exist in the current graph before the link selects it; absent,
mismatched or superseded objects open the current design and are labeled as such.
Focused result, route, and served-client tests passed 19/19 (0.91s), log
`/tmp/orgward-pr06-applied-proposal-design-link-focused.log`. The final frozen-tree
`npm run check` passed 364/365 (364 passed, 0 failed, 1 optional PostgreSQL
backup/restore journey skipped because client tools were unavailable; 78.56s TAP,
79.70s runner), log
`/tmp/orgward-pr06-applied-proposal-design-link-check.log`, TAP
`/tmp/orgward-tests-SI134x/node-test.tap.log`. Syntax and `git diff --check`
passed. No provider, browser or external actions. PR-06, cursor, task checkboxes
and release gates remain unchanged.

PR-06 saved-result unknown-category fallback (2026-09-28): failed/interrupted
result guidance now recognizes only own keys from its fixed category allowlist.
Prototype property names in legacy or malformed persisted categories fall back to
the bounded generic guidance instead of producing inherited values. Focused
presenter and served-client tests passed 13/13 (0.79s), log
`/tmp/orgward-pr06-result-guidance-own-key-focused.log`. The final frozen-tree
`npm run check` passed 364/365 (364 passed, 0 failed, 1 optional PostgreSQL
backup/restore journey skipped because client tools were unavailable; 76.55s TAP,
77.75s runner), log
`/tmp/orgward-pr06-result-guidance-own-key-check.log`, TAP
`/tmp/orgward-tests-mSX5BL/node-test.tap.log`. Syntax and `git diff --check`
passed. No provider, browser or external actions. PR-06, cursor, task checkboxes
and release gates remain unchanged.

PR-06 saved-result disclosure refresh continuity (2026-09-28): expanded task
result disclosures now remain open across process-plan rerenders, keyed by exact
project and run so state cannot transfer to another project. Focused helper and
served-client tests passed 3/3 (0.67s), log
`/tmp/orgward-pr06-result-disclosure-persistence-focused.log`; the first focused
attempt caught a stale served-client assertion for the updated details markup,
which was corrected before the passing rerun. The final frozen-tree `npm run check`
passed 366/367 (366 passed, 0 failed, 1 optional PostgreSQL backup/restore journey
skipped because client tools were unavailable; 77.24s TAP, 78.50s runner), log
`/tmp/orgward-pr06-result-disclosure-persistence-check.log`, TAP
`/tmp/orgward-tests-e2gus2/node-test.tap.log`. Syntax and `git diff --check`
passed. No provider, browser or external actions. PR-06, cursor, task checkboxes
and release gates remain unchanged.

PR-06 linked-run lifecycle labels (2026-09-28): saved task rows now label linked
runs according to their lifecycle, distinguishing approval requests awaiting
approval from approved, paused, running, and terminal runs; malformed or unknown
statuses receive a bounded unavailable label. Focused helper and served-client
tests passed 3/3 (0.80s), log
`/tmp/orgward-pr06-linked-run-lifecycle-label-focused.log`. The frozen-tree
`npm run check` passed 368/369 (368 passed, 0 failed, 1 optional PostgreSQL
backup/restore journey skipped because `ORGWARD_PG_TOOLS_BIN` client tools were
unavailable; 76.35s TAP, 77.52s runner), log
`/tmp/orgward-pr06-linked-run-lifecycle-label-check.log`, TAP
`/tmp/orgward-tests-DimA9f/node-test.tap.log`. `node --check` and `git diff --check`
passed. The documented agent-browser attempt failed before opening a page because
Chrome reported `No usable sandbox`; no sandbox bypass or host-policy change was
used. Orca reported that no X11 display was available, so rendered, narrow-layout,
keyboard, and speech evidence remains unavailable; runtime details are in
`/tmp/orgward-pr06-agent-browser-runtime.log`. No provider or external effects.
PR-06 remains active; cursor, task checkboxes and release gates are unchanged.

PR-06 owner reassignment for escalated human checkpoints (2026-09-28): owners
with current workspace-write can explicitly reassign an ESCALATED checkpoint to
another active same-tenant human project owner/editor with workspace-write. The
original assigned principal and pinned actor/role/plan snapshot stay immutable;
effective principal and membership/authz generations are stored separately. A
version-fenced command validates the process control, snapshot, target identity
and membership under transaction locks, then appends the resolution event, audit
and idempotency result atomically. Completion, runtime visibility and success
provenance use the effective assignee; the owner UI limits candidates to eligible
members and keeps target principal details out of runtime history. The database
constraint accepts only the all-null legacy tuple or all three non-null positive
human override fields; its transition trigger requires the new target to differ
from the current effective assignee, allowing return to the original assigned
human after an intervening reassignment. PostgreSQL coverage checks every partial
tuple, valid legacy/complete tuples, direct trigger denial, version/reader/
revoked/outsider/same-principal/nonhuman/nonowner denials, exact replay and
changed-payload conflict, Carol→Bob reassignment, resume by a reassigned human
without an enabled pinned actor binding, completion, and restart generation
behavior after later revocation/regrant. A tenant-B identity target is denied
with `PROCESS_TASK_REASSIGNEE_UNAVAILABLE`; the direct DB snapshot confirms
status, version, effective assignment and event history are unchanged. Override
resume locks and validates the saved effective assignee's active human identity,
workspace-write role, active editor/owner membership, and exact persisted
generations; original assignment resume still validates its pinned binding.
Focused persistence and upgrade coverage passed 49/49 (67.34s TAP);
`git diff --check` passed. The final frozen-tree `npm run check` passed 369/370
(369 passed, 0 failed, 1 optional PostgreSQL backup/restore journey skipped
because PostgreSQL client tools were unavailable; 77.24s TAP, 79.90s runner).
Logs: `/tmp/orgward-pr06-cross-tenant-reassignment-focused.log`,
`/tmp/orgward-pr06-cross-tenant-reassignment-final-check.log`,
`/tmp/orgward-pr06-cross-tenant-reassignment-final-check.time.log`, and TAP
`/tmp/orgward-tests-2utCJZ/node-test.tap.log`. Earlier full attempts found and
repaired the migration count and effective-assignment assertion fixtures; the
final run has no failures. No provider, browser, external, or live business
effects were used. PR-06 remains active; cursor, task checkboxes and release
gates are unchanged.

PR-06 generic provider credential setup guidance (2026-09-28): the served tenant
admin now explains that generic encrypted references can back the operator-
configured DeepSeek model profile or supported fixed-version providers. It tells
admins to have the installation operator configure DeepSeek with the same
reference and selected model, and states that the generic form does not validate
credential or model access. It also makes the server encryption-key requirement
explicit while keeping credential values password-only and absent from served
content. No credential, provider profile, API, or secret behavior changed.
Focused `tests/secrets.test.mjs` passed 5/5 (5.02s TAP); the served-admin
regression checks the setup copy, key/access limits, and absence of secret
canaries. `git diff --check` passed. The final frozen-tree `npm run check` passed
369/370 (369 passed, 0 failed, 1 skipped: optional PostgreSQL backup/restore
journey because PostgreSQL client tools were unavailable; 78.51s TAP, 82.45s
runner). Logs: `/tmp/orgward-pr06-generic-provider-credential-focused.log`,
`/tmp/orgward-pr06-generic-provider-credential-focused.time.log`,
`/tmp/orgward-pr06-generic-provider-credential-final-check.log`,
`/tmp/orgward-pr06-generic-provider-credential-final-check.time.log`, and TAP
`/tmp/orgward-tests-x7pF8l/node-test.tap.log`. No provider or external effects
were used. PR-06 remains active; cursor, task checkboxes and release gates are
unchanged.

PR-06 linked task approval receipt recovery (2026-09-28): the profile and local
repository fields now lock while an approval request is in flight and remain
locked with the submitted selections after a transport-uncertain result. If the
API saved a run but the process-instance refresh fails or returns an incomplete
snapshot, the exact command ID/payload stays persisted and the task remains
locked for replay. Recovery clears only when an authorized run and process-task
snapshot match tenant, project, plan revision, task, instance and run ID; initial
refresh also scans accepted receipts for the active tenant/principal so reloads
can reconcile without requiring a new click. Recovery lookup is scoped by tenant
and principal. Focused helper and served-client tests passed 6/6 (0.74s TAP,
0.82s runner); the first focused attempt exposed an overbroad source assertion,
which was narrowed to the accepted-response path before the passing run.
`git diff --check` passed. Final frozen-tree `npm run check` passed 372/373
(372 passed, 0 failed, 1 optional PostgreSQL backup/restore journey skipped
because PostgreSQL client tools were unavailable; 79.68s TAP, 82.32s runner).
Logs: `/tmp/orgward-pr06-process-task-request-recovery-focused-final.log`,
`/tmp/orgward-pr06-process-task-request-recovery-focused-final.time.log`,
`/tmp/orgward-pr06-process-task-request-recovery-final-check.log`,
`/tmp/orgward-pr06-process-task-request-recovery-final-check.time.log`, and TAP
`/tmp/orgward-tests-mhIFR9/node-test.tap.log`. No provider, browser, credential or
external effects. PR-06 remains active; cursor, task checkboxes and release gates
remain unchanged.

PR-06 uncertain new-instance approval recovery follow-up (2026-09-28): when a
request submitted for a new instance has an uncertain transport result, a later
concrete-instance task view now recovers the exact tenant/principal/project/plan/
revision/task-scoped original command and payload. The form labels this as the
original new-instance intent and states that it is not tied to the displayed
instance; retry cannot create an instance-specific replacement command. Helper
and served-client tests passed 7/7 (0.70s TAP). Existing PostgreSQL persistence
coverage confirms same-command API replay returns the original run and generated
instance. `git diff --check` passed. Final frozen-tree `npm run check` passed
373/374 (373 passed, 0 failed, 1 optional PostgreSQL backup/restore journey
skipped because PostgreSQL client tools were unavailable; 79.02s TAP, 81.58s
runner). Logs: `/tmp/orgward-pr06-uncertain-new-instance-focused-final.log`,
`/tmp/orgward-pr06-uncertain-new-instance-final-check.log`,
`/tmp/orgward-pr06-uncertain-new-instance-final-check.time.log`, and TAP
`/tmp/orgward-tests-Gd5JKz/node-test.tap.log`. No provider, browser, credential or
external effects. PR-06 remains active; cursor, task checkboxes and release gates
remain unchanged.

PR-06 durable human-task start recovery (2026-09-28): assigned human starts now
persist the exact command and task payload under tenant, principal, project, plan
revision, task and requested-instance scope. In-flight controls disable; uncertain
and accepted-but-unreconciled starts remain available only as exact-command
recovery. A new-instance intent is clearly identified inside its task row and is
never attributed to whichever instance is currently selected. Accepted starts
clear only after an authorized runtime snapshot confirms the exact project, plan,
revision, instance and task is IN_PROGRESS for the current assigned principal.
Focused helper and served-client tests passed 4/4 (0.75s); the first focused
attempt caught one stale served-client copy assertion, corrected before the
passing run. Existing PostgreSQL journey assertions cover same-command replay
returning the original generated instance and wrong-assignee denial. `git diff --check`
passed. Final frozen-tree `npm run check` passed 376/377 (376 passed,
0 failed, 1 optional PostgreSQL backup/restore test skipped because PostgreSQL
client tools are unavailable; 78.83s TAP, 81.39s runner). Logs:
`/tmp/orgward-pr06-human-task-start-recovery-focused-final.log`,
`/tmp/orgward-pr06-human-task-start-recovery-check.log`,
`/tmp/orgward-pr06-human-task-start-recovery-check.time.log`, and TAP
`/tmp/orgward-tests-nle558/node-test.tap.log`. No provider, credential, browser or
external effects. PR-06 remains active; cursor, task checkboxes and release gates
remain unchanged.

PR-06 effective human-assignee visibility (2026-09-28): task rows now show the
effective assignment separately from the immutable planned blueprint actor. The
current assigned human sees “You”; an active project owner with current
workspace-write and owner membership sees the server-derived effective assignee
display name; other project readers and the former assignee receive only a
neutral “Assigned member” label. Override copy explains that the pinned plan is
unchanged while the effective assignment determines who may act. No principal
identifier is returned for this presentation. The existing durable PostgreSQL
reassignment journey now asserts owner, current assignee, reader and former
assignee visibility alongside their existing authority checks. Focused helper
and served-client tests passed 3/3 (0.77s); the first helper attempt caught a
test fixture that modeled an unauthorized client-side name instead of the
server-redacted response and was corrected. The PostgreSQL reassignment journey
passed 1/1 (16.79s). `git diff --check` passed. The final frozen-tree `npm run
check` passed 378/379 (378 passed, 0 failed, 1 optional PostgreSQL backup/restore
test skipped because PostgreSQL client tools were unavailable; 79.98s TAP,
82.65s runner). Logs: `/tmp/orgward-pr06-effective-assignee-check.log`,
`/tmp/orgward-pr06-effective-assignee-check.time.log`, and TAP
`/tmp/orgward-tests-cq4xxc/node-test.tap.log`; focused TAP logs:
`/tmp/orgward-tests-VAOwiM/node-test.tap.log` and
`/tmp/orgward-tests-gYnpu2/node-test.tap.log`. No provider, credential, browser
or external effects. PR-06 remains active; cursor, task checkboxes and release
gates are unchanged.

PR-06 pinned human-task input review (2026-09-28): human task cards now provide
an expandable preview of their referenced information inputs. Each input resolves
by exact object ID, label and type against the blueprint ID/version pinned to the
saved plan; newer blueprint edits are not substituted. Missing pins, malformed,
duplicate or mismatched references and oversized text fail closed with one
unavailable message instead of a partial or current-design preview. Agent and
unassigned task cards do not show this human-only review. Expanded state survives
process-card rerenders and is scoped by project, plan revision and task. Focused
helper and served-client tests passed 5/5 (0.83s); the first served assertion
expected a differently named version field and was corrected. The saved-process
PostgreSQL restart journey passed 1/1 (16.56s), confirming the exact pinned input
remains reviewable after restart and design version advancement. `git diff
--check` passed. The single frozen-tree `npm run check` passed 382/383 (382
passed, 0 failed, 1 optional PostgreSQL backup/restore test skipped because
PostgreSQL client tools were unavailable; 81.31s TAP, 84.00s runner). Logs:
`/tmp/orgward-pr06-human-input-review-check.log`,
`/tmp/orgward-pr06-human-input-review-check.time.log`, and TAP
`/tmp/orgward-tests-rfsp0V/node-test.tap.log`; focused TAP logs:
`/tmp/orgward-tests-7l0Dzr/node-test.tap.log` and
`/tmp/orgward-tests-pPiXii/node-test.tap.log`. No provider, credential, browser
or external effects. PR-06 remains active; cursor, task checkboxes and release
gates are unchanged.

PR-06 task-row rendered proof attempt (2026-09-28): the disposable PostgreSQL
and local app fixture successfully created a pinned human task plan, started its
assigned task as Bob, and created separate authenticated synthetic sessions for
the owner, assignee and reader. `agent-browser open` then failed before loading
the page: Chromium exited with `No usable sandbox` under the host AppArmor
user-namespace policy. The CLI suggested `--no-sandbox`; it was not used. The
browser session was closed and the script stopped the app and dropped the
disposable database. No page rendered, so there are no screenshots, viewport
overflow measurements, accessibility-tree or keyboard results; Orca speech was
also unavailable to assess. The failure log is
`/tmp/orgward-pr06-effective-assignee-human-input-proof-run.log`; fixture
identifiers are in `/tmp/orgward-pr06-effective-assignee-human-input-proof/fixture.json`.
No source repair, tests or full check were run because the rendered proof did
not expose a product defect. PR-06 remains active; cursor, task checkboxes and
release gates are unchanged.

PR-06 owner-authored human output increment (2026-09-28): a current human
workspace owner can explicitly enter content for one `information` output
declared by the exact saved plan revision, after the exact assigned human
checkpoint has succeeded and its completion event passes the existing audit
verification. The owner command checks project and blueprint versions, pinned
before value, runtime, task, and output refs in one transaction; it creates one
proposed blueprint version and durable idempotency result, and links the project
event and output provenance to the completion event ID/hash. Evidence stays
contextual and is never copied or treated as validation. A stale pin/version,
nonowner, incomplete checkpoint, duplicate write, or changed before value fails
closed; task/runtime history is unchanged. The expanded saved task row renders
an accessible explicit-entry form and derives applied state from the persisted
event and blueprint after reload. The uncertain-submit retry freezes its command
ID, expected project version and payload together. Focused helper and
served-client tests passed 4/4 (0.74s); the focused PostgreSQL
owner/output/replay/restart journey passed 1/1 (2.58s). `git diff --check`
passed. The final frozen-tree `npm run check` passed 386/387 (386 passed, 0
failed, 1 optional PostgreSQL backup/restore test skipped because PostgreSQL
client tools are unavailable; 78.53s TAP, 82.15s runner). Logs:
`/tmp/orgward-pr06-human-output-focused-ui.log`,
`/tmp/orgward-pr06-human-output-focused-persistence.log`,
`/tmp/orgward-pr06-human-output-final-check.log`,
`/tmp/orgward-pr06-human-output-final-check.time.log`, and TAP
`/tmp/orgward-tests-4zeqDF/node-test.tap.log`. No provider, credential, browser,
or external effects. PR-06 remains active; cursor, task checkboxes and release
gates are unchanged.

PR-06 human output current-design navigation (2026-09-28): an applied owner-entered
output now links from its saved task result to the declared information object only
when the exact persisted `HumanTaskOutputApplied` event matches the saved project,
plan revision, instance, task and output, and that object exists in the current graph.
If the object is absent, the link opens the current design without selecting an
unverified object. The row keeps the applied blueprint version, current detail,
plan/revision/task/instance and event reference visible, and states that navigation
opens current design rather than a historical snapshot. Focused presenter and
served-client tests passed 4/4 (0.72s; two earlier focused assertion attempts
caught route-fixture expectations and were corrected before the passing run), log
`/tmp/orgward-pr06-human-output-link-focused.log`. `git diff --check` passed. The
single frozen-source `npm run check` passed 386/387 (386 passed, 0 failed, 1
optional PostgreSQL backup/restore test skipped because PostgreSQL client tools
were unavailable; 78.77s TAP, 82s runner), log
`/tmp/orgward-pr06-human-output-link-check.log`, TAP
`/tmp/orgward-tests-zv3uQd/node-test.tap.log`. No provider, credential, browser or
external effects. PR-06 remains active; cursor, task checkboxes and release gates
are unchanged.

PR-06 human-output applied-state provenance verification follow-up (2026-09-28):
restored owner-output status now resolves the actual persisted project `eventId`,
checks the referenced successful HumanTaskCompleted/HumanTaskEscalationResolved
event against the exact runtime task/plan/revision/instance, and requires the
referenced immutable applied blueprint to contain the declared information output.
That output's provenance must match project, plan/revision, instance, task, output,
completion event ID/hash and applied content hash in the apply event; malformed or
mismatched snapshots remain unavailable instead of appearing applied. PostgreSQL
restart coverage now runs the saved task presenter over the reloaded project, plan,
task and runtime. Focused helper/served-client tests passed 4/4 (0.78s), log
`/tmp/orgward-pr06-human-output-integrity-focused.log`; the persisted owner-output
apply/replay/restart journey passed 1/1 (2.68s), log
`/tmp/orgward-pr06-human-output-integrity-persistence.log`. Two initial restart-test
attempts caught that project events use `eventId` rather than `id`, then that runtime
projection intentionally omits event contentHash; the final check uses the persisted
event ID and exact successful runtime refs while matching source hashes between
apply event and output provenance. `git diff --check` passed. The frozen-source
`npm run check` passed 386/387 (386 passed, 0 failed, 1 optional PostgreSQL
backup/restore journey skipped because PostgreSQL client tools were unavailable;
79.25s TAP, 83s runner), log
`/tmp/orgward-pr06-human-output-integrity-check.log`, TAP
`/tmp/orgward-tests-3oZEmI/node-test.tap.log`. No provider, credentials, browser or
external effects. PR-06 remains active; cursor, task checkboxes and release gates
are unchanged.

PR-06 failed-dependency fresh-instance selection (2026-09-28): dependent human
and agent task rows blocked by a terminal failed/interrupted/cancelled task now
provide an explicit “Choose a new process instance” action when the plan and its
blueprint pin are current. Unknown provider delivery remains reconcile-only, and
historical/stale plans do not show the action. Choosing it changes only the
selected plan-instance UI state and route; it does not start work or mutate the
old instance. Existing instance options, results and evidence remain available,
and focus returns to the process-instance selector after rerender. Focused recovery
helper and served-client tests passed 5/5 (0.69s), log
`/tmp/orgward-pr06-failed-dependency-new-instance-focused.log`; an earlier served
assertion attempt failed on an overly specific focus-selector regex, corrected
before the passing run. `git diff --check` passed. The single frozen-source
`npm run check` passed 388/389 (388 passed, 0 failed, 1 optional PostgreSQL
backup/restore test skipped because PostgreSQL client tools were unavailable;
81.03s TAP, 83s runner), log
`/tmp/orgward-pr06-failed-dependency-new-instance-check.log`, TAP
`/tmp/orgward-tests-S8cxA8/node-test.tap.log`. No provider, credential, browser or
external effects. PR-06 remains active; cursor, task checkboxes and release gates
are unchanged.

PR-06 task-row rendered proof retry (2026-09-28): a fresh disposable PostgreSQL
and app fixture created synthetic owner, assignee and reader sessions, a saved
plan and pinned human task, and started the task as its assigned human. Chromium
154 launched using the installed setuid sandbox helper with host AppArmor policy
unchanged and no `--no-sandbox`; Orca's AT-SPI registry also initialized in the
private Xvfb/D-Bus session. The first authenticated local page open exceeded the
proof harness's 30-second `spawnSync` timeout (`ETIMEDOUT`) after Chrome launch.
No rendered page, screenshot, accessibility snapshot, overflow measurement,
keyboard result or spoken output was captured. The harness closed the browser
session and app, dropped the disposable database, and stopped Orca, PulseAudio and
Xvfb. Logs: `/tmp/orgward-pr06-proof-run.log`,
`/tmp/orgward-pr06-proof-orca.stdout.log`, and
`/tmp/orgward-pr06-proof-orca-debug.log`; fixture metadata:
`/tmp/orgward-pr06-effective-assignee-human-input-proof-sandboxed-retry-2/`.
No source code, tests or full check were run because no product view rendered.
PR-06 remains active; cursor, task checkboxes and release gates are unchanged.

PR-06 task-row rendered proof bounded retry (2026-09-28): in a second fresh
disposable fixture, headed Chrome successfully opened `about:blank` with the
installed sandbox helper; after setting the synthetic owner session cookie, the
authenticated loopback navigation returned `CDP command timed out: Page.navigate`.
The one allowed responsiveness probe also timed out at `Runtime.evaluate`, so no
HTTP response/status, page-script or API completion could be inspected and no
snapshot or screenshot was captured. Orca's AT-SPI registry initialized, but no
page reached it for speech evidence. The app, browser and Orca/Xvfb/D-Bus/PulseAudio
processes were closed. A final process check found the disposable PostgreSQL
server orphaned by direct-script fixture shutdown; it was stopped with its own
`pg_ctl`, and a second check found no fixture processes. Evidence:
`/tmp/orgward-pr06-proof-retry3-run.log`,
`/tmp/orgward-pr06-effective-assignee-human-input-proof-sandboxed-retry-3/alice-navigation-timeout.txt`,
and fixture metadata in the same directory. No source code, tests or full check
were run; no provider or external effects. PR-06 remains active; cursor, task
checkboxes and release gates are unchanged.

PR-06 task-row headless rendered proof attempt (2026-09-28): the independent
local request for `execution.html` returned HTTP 200 (`text/html; charset=utf-8`,
4,289 bytes). A fresh disposable PostgreSQL/app fixture created the synthetic
owner, assignee and reader identities, saved plan and assigned task. Headless
Chrome 154 opened `about:blank` with the installed executable and no sandbox
bypass; authenticated local navigation then failed with `CDP command timed out:
Page.navigate`, and the single `get url` responsiveness probe failed with
`CDP command timed out: Runtime.evaluate`. No browser HTTP response, page-script
or API completion evidence, snapshot, screenshot, overflow or keyboard result was
available. The owned PostgreSQL cluster was explicitly stopped; process checks
found no fixture/app/browser processes. Logs and HTTP result:
`/tmp/orgward-pr06-proof-headless-1-run.log` and
`/tmp/orgward-pr06-effective-assignee-human-input-proof-headless-1/`.
No source code, tests or full check were run because no product view rendered; no
provider or external effects. PR-06 remains active; cursor, task checkboxes and
release gates are unchanged.

PR-06 authenticated bootstrap API diagnostic (2026-09-28): on a fresh disposable
PostgreSQL/app fixture, the initial metadata, project list, session and run-list
requests all completed with HTTP 200 in 4–11 ms. The subsequent project detail,
actor-binding proposals, process-task runtime and local-repository requests also
completed with HTTP 200 in 9–29 ms; the project detail payload was 81,424 bytes.
The app's request-finish trace confirms all eight requests completed. This rules
out a slow or unresolved bootstrap API response in this fixture, but does not
establish browser module completion or a rendered page. Fixture database, app and
PostgreSQL cluster were closed by the harness; no product code, tests or full
check changed. Evidence: `/tmp/orgward-pr06-api-bootstrap-diagnosis/api-trace.json`
and `/tmp/orgward-pr06-api-bootstrap-diagnosis/fixture.json`. PR-06 remains
active; cursor, task checkboxes and release gates are unchanged.

PR-06 direct-CDP rendered task-row proof (2026-09-28): sandboxed headless Chrome
154 navigated to the authenticated Execution page using a synthetic session cookie;
DOMContentLoaded and load fired, and the page reached `readyState=complete`. The
saved-process UI rendered one task row with the enabled active instance, pinned
input disclosure and “Current assigned human: Bob Reviewer”; document/body width
was 1,265px at a 1,280×900 viewport. The eight startup/project/process API reads
and CSS/JS/module imports returned HTTP 200. No runtime exception, console event
or network failure occurred; the static `/favicon.ico` request alone returned 404.
The screenshot and sanitized event/DOM metrics are in
`/tmp/orgward-pr06-direct-cdp-proof/page.png`, `cdp-report.json`, and
`dom-snapshot-summary.json`. App, disposable PostgreSQL and browser processes were
closed; the browser profile was removed. This establishes the page renderer is
responsive and points to the `agent-browser` wrapper/session-control path behind
the earlier timeouts. The screenshot is the initial 1280×900 viewport; it does
not establish narrow layout, keyboard interaction, Orca speech or provider result
disclosure. No product source, tests or full check changed. PR-06 remains active;
cursor, task checkboxes and release gates are unchanged.

PR-06 process-instance selector activity labels (2026-09-28): saved instance
options now retain the short stable ID while showing lifecycle status, terminal
task count and latest human-readable activity time from the authorized runtime
snapshot. Timestamped control events are included; unknown statuses receive
unavailable copy and malformed control-event collections are ignored. Missing
times and future timestamps outside clock-skew tolerance receive unavailable
copy. Added helper and served-client regressions. After a
review fix to ignore non-array control history, focused tests passed 4/4
(0.83s TAP), log `/tmp/orgward-pr06-instance-option-label-review-fix-focused.log`;
`node --check` for both client modules and `git diff --check` passed. No API,
provider, browser, or external action. No full check was run, as instructed;
PR-06 remains active and cursor, task checkboxes and release gates are unchanged.

PR-06 process-instance picker ordering follow-up (2026-09-28): existing instance
options now render newest activity first, using the same ordered runtime rows to
choose the default-selected latest instance. Task and control-event timestamps
share one parser; missing/malformed times sort after valid activity, ties use a
stable ID order, and any parseable timestamp beyond the 60-second clock-skew
allowance makes that instance's activity unavailable rather than falling back to
an older time. Ordering does not mutate source rows. Focused helper and served-
client tests passed 6/6 (0.83s TAP), log
`/tmp/orgward-pr06-instance-option-order-focused.log`; `node --check` for the
client modules and `git diff --check` passed. No full check or provider/browser
activity. PR-06 cursor, task checkboxes and release gates are unchanged.

## Governed software delivery

- [x] PR-07 — Intent-to-plan engineering workflow (T-25–T-28). Connect approved
  enterprise intent to context/impact, traced requirements, architecture alternatives
  and recovery design, then compile accepted work into the shared durable engine.

  PR-07 saved-design source binding increment (2026-09-27): the customer form selects
  a saved blueprint object and describes a change. The server resolves the exact
  current project/blueprint/object versions, stores a canonical source snapshot and
  hashes, and records the source in Context and Impact; remaining synthesized
  coverage is labeled synthetic. Stale, corrupt or unavailable pins block further
  actions before mutation. Project-bound case creation requires a source reference;
  the no-project synthetic case path remains available. Focused source-pin,
  workspace/UI and affected PostgreSQL/OIDC scope checks passed 11/11, and
  `git diff --check` passed. A headed loopback browser proof selected a saved design,
  created a case through the S9 human checkpoint, and reviewed Context/Impact;
  screenshot and sanitized note are `/tmp/orgward-pr07-source-case-full.png` and
  `/tmp/orgward-pr07-saved-design-browser-proof-20260927.txt`. No live provider or
  external effect was used. The earlier `npm run check` was interrupted (exit 130)
  after old PostgreSQL fixtures using projectId-only creation failed and one case
  stalled; affected fixtures now use valid saved-source selections. The full check
  was not rerun, so this is not a full-suite pass. PR-06, active cursor, release
  gates and PR-07 status remain open and unchanged.

  PR-07 versioned requirement review increment (2026-09-27): source-bound cases
  now stop at G4 with an editable draft. Each requirement has a stable ID, intent
  and pinned-source links, actor, precondition, observable result, owner, priority,
  acceptance criteria, verification method and independent verification. Edits are
  idempotent and draft-revision guarded; invalid or stale edits cannot change the
  frozen baseline. Only the case owner can accept a validated revision, producing
  a hashed baseline tied to intent/source hashes and advancing G4. Architecture
  and planning verify and consume the accepted rows. Focused OIDC/PostgreSQL/SDLC
  coverage passed 44/44 with no skips (10.29s wall); `git diff --check` passed.
  A headed local browser path edited revision 2, accepted G4, passed G5 and reached
  S6; it used a synthetic local identity, not production OIDC. Evidence:
  `/tmp/orgward-pr07-requirements-browser-proof-20260927.txt` and the adjacent
  draft, accepted and architecture screenshots. No provider calls or external
  effects. The earlier whole-suite attempt remains interrupted; no full check was
  rerun. PR-07, cursor and release gates remain open and unchanged.

  PR-07 T-27 architecture review increment (2026-09-27): source-bound cases now
  pause at G5 with two stable-ID architecture alternatives, explicit interfaces,
  data ownership, dependencies, ordered migrations/health checks and recovery
  guidance. The case owner can revision-edit and accept the selected validated
  draft; its canonical hash binds the frozen architecture to the accepted G4
  content hash/version, pinned source hash and intent hash. G6 planning verifies
  that accepted binding and carries its exact architecture hash. Cross-system
  database writes, authorization bypasses and incompatible first-step schema
  replacement produce repairable findings and cannot be accepted. API tests
  cover denial, edit/replay, stale revision, acceptance persistence and tampered
  baseline blocking. Served-client assertions cover the S5 alternatives and
  owner-acceptance UI. `node --test tests/sdlc/server.test.mjs
  tests/sdlc/workspace.test.mjs` passed 19/19, 0 skipped (1.62s); log and timing:
  `/tmp/orgward-pr07-t27-focused.tap.log` and
  `/tmp/orgward-pr07-t27-focused.time.log`. `git diff --check` passed. The
  changed PostgreSQL journey helper now accepts G5 explicitly but was not run in
  this focused file-backed set; no `npm run check`, browser proof, provider call
  or external effect was performed. PR-07, active cursor and release gates remain
  open and unchanged.

  T-27 fitness-rule repair (2026-09-27): selected-option validation now also
  blocks unqualified direct database-write phrasing. Destructive schema removal
  or replacement must follow an earlier migration step whose action/health check
  establishes expansion, shadowing, compatibility, coexistence, parity or
  reconciliation; later compatibility language cannot mask a destructive first
  step. Regression cases cover both phrasings and the seeded safe migration still
  passes. The same focused command passed 19/19 with no skips (1.69s); logs:
  `/tmp/orgward-pr07-t27-repair-focused.tap.log` and
  `/tmp/orgward-pr07-t27-repair-focused.time.log`. No full check or other suite
  was run; PR-07, cursor and gates remain open.

  T-27 PostgreSQL accepted-architecture restart regression (2026-09-27): the
  compare-and-swap persistence journey now asserts that G5's canonical draft hash
  remains bound to the accepted G4 content hash/version, pinned source hash and
  intent hash after app-only restart. It also verifies every persisted G6 plan
  work item retains that exact architecture hash. The named PostgreSQL case passed
  1/1 (2.71s; `/tmp/orgward-pr07-t27-hash-persistence.log`, timing
  `/tmp/orgward-pr07-t27-hash-persistence.time.log`). One `npm run check` passed
  274/275 (274 passed, 0 failed/cancelled, 1 optional backup/restore skip because
  PostgreSQL client tools are unavailable; 72.32s TAP / 74.89s wall); logs:
  `/tmp/orgward-pr07-t27-hash-fullcheck.log`, timing
  `/tmp/orgward-pr07-t27-hash-fullcheck.time.log`, TAP
  `/tmp/orgward-tests-nccOiK/node-test.tap.log`. `git diff --check` passed.
  No provider calls or external effects. PR-06 remains the active cursor; PR-07
  and all release gates remain open and unchanged.

  T-27 rendered PostgreSQL review and restart proof (2026-09-27): one headed
  agent-browser journey used a synthetic loopback OIDC issuer and normal login /
  callback, with no seeded session cookie. From a saved-source case, the UI
  reached S4 and accepted G4, rendered both G5 alternatives, saved the owner's
  rationale edit, accepted G5, and generated the G6 plan. Read-only API evidence
  confirmed the G5 architecture hash bound to the exact G4, pinned-source and
  intent hashes; all eight G6 work items carried that architecture hash. After
  stopping/restarting only the app against the same disposable PostgreSQL DB, the
  authenticated UI restored the accepted architecture and plan; API hashes and
  item count matched. Screenshots, AX snapshots and sanitized values:
  `/tmp/orgward-pr07-t27-render-proof/` (`proof.txt`). Provider calls: 0. Browser,
  app and DB processes were stopped and temporary fixture scripts/data removed.
  No source/tests changed and no tests/full check ran. This is local synthetic
  OIDC evidence only, not production IdP/provider evidence. PR-06 remains the
  active cursor; PR-07 and release gates remain open and unchanged.

  T-28 inert software-delivery compilation slice (2026-09-27): an authenticated
  project owner can compile the accepted G6 work graph into deterministic,
  reviewable `software_delivery` DRAFT tasks in the shared PostgreSQL execution
  store. Each immutable row binds the G6 hash and compiler version to the G5/G4
  accepted baseline hashes/versions, intent, exact saved project/blueprint/object
  identity and source hash. Compilation locks the project and case aggregates,
  verifies their expected versions/state hash and rechecks G4/G5/G6/source integrity
  before insertion. The unique generation key safely replays identical drafts;
  corrupt stored bytes, changed G6 and stale source fail closed. Draft tasks retain
  stable G6 work IDs, mapped dependencies, requirement/decision/context refs, and
  no assignments, runtime rows, approvals or execution runs are created. The
  Delivery tab exposes an explicit owner action and labels the result inert; it
  never auto-runs. Migration `032-software-delivery-plans.sql` adds the typed
  sidecar without changing the source project or PR-06 `processPlans`.

  Focused command selecting the T-28 PostgreSQL compile/restart journey, saved-
  source stale behavior, served SDLC surface and migration upgrade case passed
  3/3, 0 skipped (3.31s); TAP `/tmp/orgward-tests-ZPVsK2/node-test.tap.log`.
  Browser review found and fixed two rendered issues: source-bound cases were
  incorrectly read-only when their project-list summary omitted full blueprint
  detail, and long engine IDs overlapped in the task list. Focused SDLC tests
  passed 20/20 after the source-detail repair; the task-label regression passed
  1/1. The latest `npm run check` passed 275/276 (275 passed, 0 failed/cancelled,
  1 optional PostgreSQL backup/restore skip because client tools are unavailable;
  69.47s runner). Log `/tmp/orgward-pr07-t28-task-label-check.log`, TAP
  `/tmp/orgward-tests-B3AsE2/node-test.tap.log`. An earlier check before the
  stale-source message compatibility repair had one wording assertion failure;
  its log remains `/tmp/orgward-pr07-t28-check.log`.

  Rendered proof used an isolated loopback app/PostgreSQL fixture and synthetic
  OIDC through normal login/callback. The owner compiled the accepted G6 graph
  from the Delivery UI into a DRAFT containing eight readable WORK-1…WORK-8
  items, source hashes and an inert notice. Project version remained 5. At
  390×844 there was no page-level horizontal overflow or task-label overlap.
  Screenshots and sanitized details: `/tmp/orgward-pr07-t28-browser-proof-20260927/`
  (`proof.txt`, `desktop-draft.png`, `mobile-draft.png`). No approval was clicked;
  no execution/runtime rows, provider calls or external effects were created.
  `git diff --check` passed after the receipt update. PR-06 remains the active
  cursor; PR-07 and release gates remain open.

  T-28 compiler identity collision repair (2026-09-27): compiler v2 now derives
  generation, plan and task IDs from the project/G6 identity plus the case and
  pinned source hash, blueprint version, and source object identity. The
  existing tenant-wide `plan_id` uniqueness remains unchanged and was exercised
  by compiling two cases with identical G6 and source hashes; their IDs no
  longer collide. Same-case compilation remains deterministic and replays the
  stored draft. Verification selects the plan's compiler version and preserves
  v1 canonical reconstruction, so a persisted v1 row remains valid and readable
  after restart. Pure identity tests passed 2/2 (0.23s); the focused PostgreSQL
  compile/restart journey passed 1/1 (3.02s test, 3.54s wall). The frozen-tree
  `npm run check` passed 286/287 (286 passed, 0 failed/cancelled, 1 optional
  PostgreSQL backup/restore skip because client tools are unavailable; 72.82s
  TAP, 75.50s total). Logs: `/tmp/orgward-pr07-t28-identity-pure.log`,
  `/tmp/orgward-pr07-t28-identity-pg.log`, `/tmp/orgward-pr07-t28-identity-pg.time.log`,
  `/tmp/orgward-pr07-t28-identity-full-check.log`, and
  `/tmp/orgward-pr07-t28-identity-full-check.time.log`; TAP:
  `/tmp/orgward-tests-J8JD56/node-test.tap.log`. `git diff --check` passed.
  No provider calls or external effects. PR-06 remains the active cursor; PR-07
  and release gates remain open and unchanged.

  T-28 owner assignment-review increment (2026-09-27): owners can save a
  separately persisted, append-only assignment snapshot for every compiled v2
  DRAFT task using a current enabled human/agent actor-role binding. The API
  checks owner/project authority, case/project optimistic versions, current
  source and G4/G5/G6/draft hashes, exact task coverage, binding authority and
  binding generations. Identical idempotent replay returns the saved snapshot;
  changed replay input, stale revision, missing/duplicate/unknown task, stale
  binding, editor denial and cross-tenant access are rejected without adding a
  review row. Revision 2 preserves revision 1 and survives restart. The Delivery
  UI distinguishes proposal from owner review, shows assignment names and task
  order/dependencies, pre-fills current assignments for revision, and states
  every snapshot is not executable; there is no promotion, approval, runtime or
  dispatch path in this increment. Focused PostgreSQL/restart plus served-client
  tests passed 2/2 (4.41s wall); `git diff --check` passed. The first frozen check
  failed only on a stale served-client regex, which was repaired before the final
  check. Final frozen-tree `npm run check` passed 286/287 (286 passed, 0 failed,
  1 optional database recovery test skipped because PostgreSQL client tools are
  unavailable; 71.51s TAP, 74.18s total). Logs:
  `/tmp/orgward-pr07-assignment-review-check.log`,
  `/tmp/orgward-pr07-assignment-review-check.time.log`,
  `/tmp/orgward-pr07-assignment-review-final-check.log`, and
  `/tmp/orgward-pr07-assignment-review-final-check.time.log`; TAP:
  `/tmp/orgward-tests-kswU5L/node-test.tap.log`. No provider calls or external
  effects. PR-06 remains the active cursor; PR-07 and release gates remain open
  and unchanged.


  T-28 runtime promotion follow-on (2026-09-27): promotion was not implemented. The existing process-task model proposal context requires exact blueprint input object IDs and an editable blueprint output target, while the software-delivery draft and owner-review schema provide G4 requirement/context references and actor assignments but no safe software-output contract. A human-only immutable runtime adapter was not completed in that attempt. Model-agent execution and result/patch handling require a separate PR-08 SCM/sandbox task context and output proposal. PR-06 remains the active cursor; PR-07 and release gates remain open and unchanged.

  T-28 human-only runtime adapter increment (2026-09-27): implemented a separate
  immutable PostgreSQL runtime-plan snapshot and idempotency receipts bound to
  the compiled case/project/source/blueprint/G4/G5/G6/draft and exact owner-review
  revision/hash. Owner promotion revalidates current source, authority, DAG and
  uniquely current explicit human principal/membership bindings; explicit start
  separately creates only human PLANNED checkpoint rows. Snapshot-backed plans
  resolve through authenticated runtime list/deep-link and lifecycle paths,
  including start, complete, escalate, owner resolve, pause, resume and cancel.
  Reads and task lifecycle fail closed on source/review mismatch, assignment
  revocation or missing snapshot task rows. Agent-assigned drafts remain
  unpromotable with `SOFTWARE_AGENT_RUNTIME_UNSUPPORTED`; there is no model run,
  approval, patch or dispatch path in this increment. Focused PostgreSQL restart,
  denial, replay, corruption, dependency and human lifecycle coverage passed
  2/2 selected persistence cases (6.23s), and served navigation/API/UI/upgrade
  coverage passed 28/28 (4.03s). `git diff --check` passed. The first frozen
  `npm run check` found one stale owner-principal privacy assertion; exact
  principal visibility is now owner-only, with editor visibility still denied,
  and the affected tests passed. The repair check passed 287/288 (287 passed,
  0 failed, 1 optional skip; 72.20s TAP); TAP log:
  `/tmp/orgward-tests-IFK6oO/node-test.tap.log`. No provider calls or external
  effects. PR-06 remains the active cursor; PR-07 and release gates remain open
  and unchanged.

  T-28 instance-start replay/audit repair (2026-09-27): the served SDLC client
  now persists one pending instance-start idempotency key per tenant/session
  and project/case/plan/revision intent, retains it when the response is
  ambiguous, blocks duplicate in-flight submission, and clears it after a
  confirmed receipt so a later explicit start can use a fresh key. The
  PostgreSQL start transaction now locks and revalidates the current case
  project/tenant/accountable owner, records one `SoftwareDeliveryInstanceStarted`
  audit/outbox event with the idempotency receipt in the same transaction, and
  invokes `afterCommit` once for a new commit only. Replay creates no new event;
  the initial process control history remains empty. Focused served-client/API
  tests passed 15/15; the focused PostgreSQL CAS/restart journey passed 1/1.
  The single `npm run check` passed 289/290 (289 passed, 0 failed, 1 optional
  skip; 73.24s TAP; 76s total). Logs:
  `/tmp/orgward-t28-start-repair-check.log`,
  `/tmp/orgward-t28-start-repair-check.time.log`, and TAP
  `/tmp/orgward-tests-DFEcBU/node-test.tap.log`. No provider calls or external
  effects. PR-06 remains the active cursor; PR-07 and release gates remain open
  and unchanged.

  T-28 stale-owner replay/lock-order follow-on (2026-09-27): instance start
  locks project then case, matching promotion's order to avoid start/promotion
  deadlocks, and validates the current case binding/owner before looking up a
  replay receipt. The PostgreSQL test changes the accountable owner after a
  successful start, retries that same idempotency key as the former owner, and
  verifies denial without another receipt, audit event, control/task row, or
  after-commit call; it then restores the fixture state. Focused PostgreSQL and
  client helper tests passed 2/2. The final single `npm run check` passed
  289/290 (289 passed, 0 failed, 1 optional skip; 73.51s TAP; 76s total). Logs:
  `/tmp/orgward-t28-start-replay-order-final-check.log`,
  `/tmp/orgward-t28-start-replay-order-final-check.time.log`, and TAP
  `/tmp/orgward-tests-cIYnWB/node-test.tap.log`. No provider calls or external
  effects. PR-06 remains the active cursor; PR-07 and release gates remain open
  and unchanged.

  T-28 rendered owner-to-human-checkpoint journey remains unverified (2026-09-27):
  `agent-browser open about:blank` failed before opening a page because Chromium
  reported `No usable sandbox` under the host's AppArmor user-namespace policy.
  No `--no-sandbox` flag or host-policy change was used; the disposable app/DB
  fixture was not started. The earlier browser proof covers the inert compiled
  draft only, not assignment review, promotion, instance start, or human outcome.
  Captured startup error: `/tmp/orgward-pr07-agent-browser-start.log`. PR-06 stays
  the active cursor; PR-07 and release gates remain open.

  T-28 rendered journey follow-up (2026-09-28): static source/test preflight
  identified the saved-source → G4/G5/G6 → compile/review → promote/start →
  human completion sequence, but the bounded direct-CDP proof stopped before
  launch because its temporary interaction harness was incomplete. The script
  was removed; no app, PostgreSQL fixture, or browser started, and no rendered,
  keyboard, or restart behavior was observed. Evidence:
  `/tmp/orgward-pr07-t28-render-proof-20260928-1/attempt-summary.txt`.

  T-28 human checkpoint saved-result readback regression (2026-09-28): the
  PostgreSQL persistence journey now asserts after app restart that the completed
  human task retains outcome `succeeded` and exact evidence. Its single matching
  `HumanTaskCompleted` event is checked for the same result/evidence plus exact
  project-plan revision, instance, and task identity; persisted rows are likewise
  checked for exact linkage and saved outcome. A second completed task verifies
  task-specific evidence does not bleed across checkpoints. Served-client
  coverage asserts the existing Execution UI binds its displayed result/evidence
  from that saved runtime outcome. Focused persistence test passed 1/1 and
  served-client/history tests passed 3/3. The single frozen-tree `npm run check`
  passed 289/290 (289 passed, 0 failed, 1 optional skip; 72.15s test run, 74.52s
  total). Logs: `/tmp/orgward-pr07-checkpoint-result-readback-pg-focused.log`,
  `/tmp/orgward-pr07-checkpoint-result-readback-client-focused.log`,
  `/tmp/orgward-pr07-checkpoint-result-readback-check.log`,
  `/tmp/orgward-pr07-checkpoint-result-readback-check.time.log`; TAP
  `/tmp/orgward-tests-UY6YjK/node-test.tap.log`. No browser or provider was used.
  Rendered end-to-end journey remains unverified; PR-06 remains the active cursor,
  and PR-07/release gates remain open and unchanged.

  PR-07 T-28 human enrollment guidance (2026-09-28): the owner assignment form
  now explains that a colleague must sign in once, receive project membership,
  and have an enabled human actor binding for the blueprint before they can be
  assigned to human work. Guidance appears when no eligible human binding exists,
  including when other enabled agent bindings are available, and links to the
  existing Administration view for Identity access and Project access. No API or
  authorization behavior changed. Focused served-client tests passed 18/18
  (0 failures/skips; 2.01s TAP, 2.12s wall), log
  `/tmp/orgward-pr07-human-enrollment-guidance-focused.tap.log`;
  `git diff --check` passed. No full check, browser, provider, DB fixture, commit
  or push. PR-06 remains the active cursor; PR-07/release gates remain open and
  unchanged.

  T-28 rendered owner-review setup attempt (2026-09-28): in one preflighted
  synthetic OIDC/PostgreSQL fixture, the owner and assigned human both signed in;
  the worker identity was enrolled before the owner granted project membership.
  The owner then created the saved-source case, accepted G4/G5, generated G6 and
  compiled the eight-task draft. The rendered Delivery form showed all eight
  selectors with no enabled actor binding and displayed the human-enrollment
  guidance/link. A follow-up harness diagnostic failed after reload because its
  page-local `window.__t28Proof` value was cleared; no assignment review,
  promotion/start, checkpoint completion, restart or result readback was
  performed. No retry occurred. Sanitized screenshot, AX snapshot and preflight:
  `/tmp/orgward-t28-final-proof/owner-delivery-review.png`,
  `/tmp/orgward-t28-final-proof/owner-delivery-review.ax.txt`, and
  `/tmp/orgward-t28-final-proof/preflight.txt`. Browser, app, disposable DB and
  PostgreSQL were cleaned. No provider or product source/test changes. PR-06
  remains the active cursor; PR-07 and release gates remain open and unchanged.

  PR-07 T-28 project-map enrollment navigation (2026-09-28): when no eligible
  human actor binding exists, the assignment guidance now links to the current
  project’s Enterprise design map using the existing project/view route, while
  retaining the Administration link for identity and project membership. The
  map link selects no actor and makes no state change; copy asks the owner to
  choose the correct human actor and role and enable its binding. Focused tests
  passed 26/26 (0 failures/skips; 1.92s TAP, 1.98s wall), log
  `/tmp/orgward-pr07-human-map-guidance-focused.tap.log`; `node --check
  public/sdlc.js` and `git diff --check` passed. No browser, provider, database
  fixture, full check, commit or push. PR-06 remains the active cursor; PR-07
  and release gates remain open and unchanged.

  PR-07 T-28 revision-pinned enrollment guidance (2026-09-28): the no-human
  binding guidance now explains that enabling or revising a binding changes the
  project revision, so the owner must create a new governed change case from the
  updated design before compiling. It retains the map and Administration links
  and requires the owner to select the human actor and role; no state or
  authorization behavior changed. Focused served-client tests passed 13/13
  (0 failures/skips; 1.47s TAP, 1.54s wall), log
  `/tmp/orgward-pr07-t28-revision-pinned-guidance-focused.tap.log`;
  `node --check public/sdlc.js` and `git diff --check` passed. No browser,
  provider, database fixture, full check, commit or push. PR-06 remains the
  active cursor; PR-07 and release gates remain open and unchanged.

  PR-06 T-28 binding setup and response parsing (2026-09-28): a single
  synthetic proof setup enrolled the worker, granted project membership, enabled
  the human actor binding before case creation, and refreshed the project
  revision. It stopped before case creation because the temporary harness read
  `proposals` from the API envelope root; the response is
  `{data: {currentBlueprintVersion, proposals}}`. No case, compiled plan,
  rendered owner review, task completion, or restart readback was reached. No
  screenshots or AX snapshot were captured. The app, browser, disposable DB and
  PostgreSQL cluster were cleaned; no provider was called and no retry occurred.
  Sanitized evidence: `/tmp/orgward-t28-proof-final/attempt-summary.txt` and
  `/tmp/orgward-t28-proof-final/preflight.txt`.

  The same envelope mismatch existed in `public/sdlc.js`, which read bindings
  from the wrong response level and silently fell back to an empty list. It now
  selects enabled, eligible bindings for the case's source blueprint from
  `response.data.proposals`. The focused helper and served-client tests passed
  2/2 (0 failures/skips; 0.431s TAP), log
  `/tmp/orgward-pr06-t28-envelope-focused.tap.log`; syntax checks for changed
  source/test files and `git diff --check` passed. No browser journey, provider,
  full check, commit or push for this fix. Rendered T-28 remains unverified;
  PR-06 remains first open and task checkboxes, cursor and release gates are
  unchanged.

  PR-07 T-25–T-28 saved-source to durable-compile PostgreSQL journey
  (2026-09-30): extended the existing PostgreSQL compare-and-swap restart test
  with the current saved-source pin, Context/Impact source evidence, an edited
  and accepted source-traced G4 requirement, and an edited and accepted G5
  alternative with migration and recovery changes. After compiling G6 into the
  shared software-delivery engine, app-only restart assertions compare the exact
  source, accepted-requirement, architecture and G6 hashes, then verify every
  compiled task's requirement/decision/context references and mapped dependency
  IDs against the persisted G6 work graph. The focused runner passed the named
  PostgreSQL journey 1/1 with 0 failures and 0 skips (3.93s test,
  5.35s runner wall); TAP `/tmp/orgward-tests-tZmwTd/node-test.tap.log`.
  `node --check tests/persistence.test.mjs` and `git diff --check` passed. Two
  preliminary focused runs exposed fixture request mistakes (stale case version
  after the concurrency check; client-supplied actor fields rejected by the DB
  API); both were corrected before the passing run. No full check, browser,
  provider/credential call or external effect. The rendered browser proof remains
  unverified: the known host Chrome startup failure is `No usable sandbox`, and
  no browser launch or bypass was attempted for this increment. The test runner
  closed the disposable PostgreSQL fixture and process inspection found no
  remaining app, database, Chrome or agent-browser process. PR-07 remains first
  open; release gates remain open and unchanged.

  PR-07 implementation acceptance complete (2026-09-30): the current joined
  PostgreSQL journey verifies the saved-source Context/Impact, source-traced G4
  requirement, accepted G5 alternatives/migration/recovery, G6 compilation and
  exact compiled task/dependency references after app restart. Earlier rendered
  evidence shows the source-bound case, requirement/architecture review and
  inert compiled draft at desktop/narrow width. The frozen tree passed its single
  `npm run check`: 427 passed, 0 failed, 1 skipped (optional PostgreSQL
  backup/restore journey because `pg_dump`/client tools are unavailable; 84.62s
  TAP, 88.63s wrapper). Logs: `/tmp/orgward-pr07-final-check-20260930.log` and
  `/tmp/orgward-tests-erNySU/node-test.tap.log`. PR-07 is checked complete and
  the cursor advances to PR-08. The skipped recovery journey is not passing
  coverage; release gates remain separate and unchanged. The rendered
  post-compile owner promotion/human runtime/restart path remains unverified
  because host Chrome reports `No usable sandbox`; no browser bypass was used.

- [x] PR-08 — SCM, agent changes and immutable assurance (T-29–T-32; E-06, E-09).
  Let a user onboard a repository, request a bounded agent change, review its diff,
  and inspect named-check/build outputs bound to immutable candidate receipts,
  including repeat results. Keep credentials scoped. This functionality does not
  complete T-31 environment-independence/dependency-toolchain reproducibility
  qualification or T-32 supply-chain scanners, SBOM, provenance and signatures;
  those remain in `HARDENING-TASKS.md`.

  Bounded local-only implementation receipt (2026-09-28): added server-configured,
  exact tenant/project repository bindings; bounded immutable file/mode snapshots
  with content hashes; source mutation/stale digest and unsafe entry rejection;
  descriptor-rooted no-follow private per-run materialization; path-level add,
  modify, delete and executable-mode candidate diffs; and a review-only Execution
  UI candidate backed by persisted run data. Verification command/config identity,
  exact candidate tree digest, status/exit and hash-checked output are persisted;
  pinned source and candidate bytes are served only from the captured, hash-checked
  run data. Client retries retain only the request identity and snapshot binding in
  namespaced browser storage, never a host path or secret. Tests cover synthetic
  local repositories, denied arbitrary/cross-project/stale bindings, unsafe paths,
  hard links and limits, restart recovery, candidate changes, verification and
  served UI; no external repository, provider, browser, push or write-back was used.
  Focused local snapshot/intent/served-client tests passed 6/6 and the PostgreSQL
  durability journey passed 1/1. The single frozen-tree `npm run check` passed
  294/295 (294 passed, 0 failed, 1 optional skip; 71.55s test run, 74.10s total).
  Logs: `/tmp/orgward-pr08-local-repository-client-focused.log`,
  `/tmp/orgward-pr08-local-repository-pg-focused.log`,
  `/tmp/orgward-pr08-local-repository-check.log`,
  `/tmp/orgward-pr08-local-repository-check.time.log`; TAP
  `/tmp/orgward-tests-E2JVUZ/node-test.tap.log`. This is one local candidate
  execution/review slice, not full PR-08: remote repository onboarding, reproducible
  builds, security checks, SBOM, provenance, signatures and broader qualification
  remain open. PR-06 remains the active cursor; task checkboxes and release gates
  remain open and unchanged.

  Inline review follow-on (2026-09-28): the Execution candidate view now offers a
  bounded line-level preview for changed text files. It loads pinned and candidate
  bytes only through the authenticated hash-checked endpoints, caps each response
  at 128 KiB and the LCS comparison at 40,000 cells/250 lines per side, validates
  the saved SHA-256 values, and uses fatal UTF-8 decoding. Diff lines are rendered
  as text nodes. Binary, invalid UTF-8, hash mismatch, oversized and complex files
  show a fallback to the existing download links; mode-only changes remain
  metadata-only. Focused diff and served-client tests passed 4/4. Syntax checks and
  `git diff --check` passed before the full check. The single frozen-tree
  `npm run check` passed 297/298 (297 passed, 0 failed, 1 optional skip; 73.87s
  test run, 76.45s total). Logs: `/tmp/orgward-pr08-inline-diff-focused.log`,
  `/tmp/orgward-pr08-inline-diff-focused.time.log`,
  `/tmp/orgward-pr08-inline-diff-check.log`,
  `/tmp/orgward-pr08-inline-diff-check.time.log`; TAP
  `/tmp/orgward-tests-SVlTCQ/node-test.tap.log`. No browser or provider tooling was
  used. This remains a review-only UI increment; no write-back or push behavior was
  added, and PR-06 cursor, task checkboxes and release gates remain unchanged.

  PostgreSQL test harness follow-on (2026-09-28): `npm test` now starts one
  disposable PostgreSQL cluster per invocation when the selected files require it,
  passes only its internally created loopback base URL to test workers, and tears
  the cluster down after success, failure or handled termination signals. Each
  `startPostgres()` call still creates a unique database; closing a scenario pool
  drops that database, with worker teardown cleaning any remaining fixture DBs.
  Selected non-PostgreSQL tests do not start a cluster, and runner setup discards
  caller-provided test database URL variables. Focused environment/cleanup tests
  passed 4/4 (also with an invalid PostgreSQL binary path and hostile database URL);
  shared-cluster isolation and drop-on-close passed 1/1. The single final frozen-tree
  `npm run check` passed 302/303 (302 passed, 0 failed, 1 optional skip; 73.69s
  test run, 76.25s total). Compared with the prior full check at 76.45s total and
  73.87s test time, this run was 0.20s faster overall and 0.18s faster in tests;
  it adds five tests, so this is effectively unchanged wall time rather than a
  measured speedup. Logs: `/tmp/orgward-postgres-runner-unit-focused.log`,
  `/tmp/orgward-postgres-runner-isolation-focused.log`,
  `/tmp/orgward-postgres-runner-check.log`,
  `/tmp/orgward-postgres-runner-check.time.log`; TAP
  `/tmp/orgward-tests-Ra8jXe/node-test.tap.log`. No cursor, task checkbox or release
  gate was changed.

  Git source hardening follow-on (2026-09-28): Git reads now disable lazy fetch and
  all transport protocols; partial/promisor config, alternates, HTTP alternates,
  and linked worktree metadata are rejected. Configured bare sources require a
  canonical no-symlink path whose ancestors are service/root-owned and not
  group/other-writable (a sticky `/tmp` parent is allowed); refs, object stores,
  and relevant metadata are checked for regular nonlinked files/directories,
  single-link files, safe ownership/modes and bounded entry counts. Git errors no
  longer surface repository stderr. A local promisor fixture confirmed the missing
  blob remains absent; tests also cover alternates, symlink refs, writable metadata,
  and a hard-linked object. Git snapshot and served-client tests passed 3/3; the
  PostgreSQL persistence journey passed 1/1. One exploratory persistence attempt
  observed a transient finalization-version conflict in its existing provider
  proposal journey; the worker state was RUNNING at the expected version after
  provider completion on the successful diagnostic rerun, and the final
  uninstrumented focused run passed without weakening assertions or changing
  execution behavior. Test-only teardown now closes idle connections on both app
  and provider fixture servers so failures cannot hang while awaiting server close.
  The single completed frozen-tree `npm run check` passed 304/305 (304 passed,
  0 failed, 1 optional skip; 69.12s test run, 71.72s total). An earlier full-check
  attempt was interrupted while diagnosing the same teardown stall and is not
  counted. Logs: `/tmp/orgward-pr08-git-focused.log`,
  `/tmp/orgward-pr08-git-persistence-focused.log`,
  `/tmp/orgward-pr08-git-check.time.log`; TAP
  `/tmp/orgward-tests-tAjVCo/node-test.tap.log`. No remote fetch, provider call,
  push or write-back was used; PR-06 cursor, task checkboxes and release gates
  remain unchanged.

  Dispatch-recovery race follow-on (2026-09-28): fixed a startup race where the
  periodic recovery worker could interrupt a RUNNING run before dispatch
  authorization created its worker lease. The active execution now marks its
  pre-authorization phase, and PostgreSQL recovery honors the callback's explicit
  skip result; after dispatch authorization, expired-lease recovery remains
  enabled. The persistence regression holds the authorization gate across the
  1-second recovery interval, asserts the run stays RUNNING without an interruption
  event, then confirms the existing PAUSED outcome. Focused persistence coverage
  passed 1/1 in 14.59s. The preceding frozen full check exposed this race and failed
  at 304/306 (304 passed, 1 failed, 1 optional skip; 66.88s test time, 70.61s
  total); its failure was the expected PAUSED response receiving a 409 after
  recovery had changed the run version. The repaired frozen-tree `npm run check`
  passed 305/306 (305 passed, 0 failed, 1 optional skip; 74.38s test time, 76.82s
  total). `git diff --check` passed. Logs: `/tmp/orgward-dispatch-recovery-focused.log`,
  `/tmp/orgward-dispatch-recovery-check.time.log`; TAP
  `/tmp/orgward-tests-Aw8aoC/node-test.tap.log`. No cursor, task checkbox or release
  gate changed.

  Verification-output disclosure follow-on (2026-09-28): bounded command capture
  now records whether stdout and stderr were truncated while preserving the
  existing output limit and tail. Saved local-repository verification receipts
  persist per-stream flags; their output digest is explicitly identified as
  covering only the saved stdout and stderr. Candidate review distinguishes
  truncated, complete and legacy-with-unknown output status. The ordinary run
  evidence view also identifies truncated command streams and legacy adapter
  records with missing metadata, without labeling current provider output as
  unknown. Focused adapter tests passed 6/6 (0.76s runner), the PostgreSQL
  candidate/restart journey passed 1/1 (15.66s), and served-client assertions
  passed 1/1 (final run 0.72s); zero failures or skips. `git diff --check` passed.
  Logs: `/tmp/orgward-tests-5LFj0t/node-test.tap.log`,
  `/tmp/orgward-tests-fIbGbH/node-test.tap.log`, and
  `/tmp/orgward-tests-cSFX55/node-test.tap.log`. No full check was run because
  PR-08 remains open; this is truthful output disclosure, not reproducible-build
  evidence. PR-06 cursor, task checkboxes and release gates remain unchanged.

  GitHub App repository onboarding and pinned capture slice (2026-09-30): added
  an optional server-only GitHub App configuration and project-owner/tenant-admin
  UI/API that binds a tenant/project, installation ID, immutable repository ID,
  and one canonical full branch ref. Each capture rechecks that the installation
  grants that repository, mints an installation token requested for that single
  repository with metadata:read and contents:read, then resolves the ref to an
  exact commit/tree and retrieves blobs by SHA. Tokens remain inside the ingestion
  service and are absent from persistence, API responses, UI, subprocesses and
  logs. Fixed-host HTTPS requests reject redirects; tree truncation, unsupported
  entries, unsafe paths, and file-count/size bounds fail closed. PostgreSQL saves
  the binding plus immutable commit/tree/manifest/policy snapshot; repeat captures
  at the same commit reuse the snapshot record, while a moved ref gets a new one.
  The served UI displays metadata only. No remote candidate execution or
  write-back was added.

  Static syntax checks and `git diff --check` passed. The first focused test run
  found that the file-count overflow fixture reached a missing blob response
  before the limit; capture now prevalidates the tree/count/declared byte budget
  before fetching blobs. The single repair rerun passed 5/5 (0 failed, cancelled
  or skipped; 2.23s wrapper), including loopback-only transport scope/token/ref/
  redirect/truncation/file-count checks, optional configuration, and PostgreSQL
  restart, replay, tenant-admin/project-owner authorization and ref-movement
  records. Logs: `/tmp/orgward-tests-Zahls4/node-test.tap.log` (first run) and
  `/tmp/orgward-tests-X02ArJ/node-test.tap.log` (passing rerun). No real GitHub,
  credentials, browser, full check or external effect was used. PR-08 remains
  open; the task checkbox, active cursor and release gates are unchanged.

  GitHub capture review repairs (2026-09-30): provider JSON bodies are now read
  as a stream and cancelled on declared or observed overflow at 10,000,000 bytes;
  missing/false Content-Length cannot bypass the response cap. Per-binding history
  is capped at 32 immutable snapshots with a PostgreSQL check constraint and a
  conflict response at capacity. A retry for an existing snapshot remains
  idempotent at capacity; new revisions are rejected without eviction or rewriting
  retained bytes. UI, API and ingestion now accept GitHub installation/repository
  IDs only from 1 through 9007199254740991, a documented exactly representable
  numeric range used for provider token serialization. Server config accepts both
  PKCS#8 and GitHub's RSA PKCS#1 PEM private-key form.

  Static checks passed; focused config, loopback ingestion and PostgreSQL store
  tests passed 7/7 (0 failures, cancellations or skips; 2.74s runner), covering
  missing-Length streamed overflow/cancellation, maximum and rejected IDs, RSA
  PKCS#1 parsing/signing, restart persistence, idempotent replay, ref movement,
  snapshot-cap boundary, and immutable-byte retention. Log:
  `/tmp/orgward-tests-vDrqqy/node-test.tap.log`. No full check, real GitHub,
  browser, credential or external effect was used. PR-08 remains open; task
  checkbox, cursor and release gates are unchanged.

  GitHub project-wide snapshot retention follow-on (2026-09-30): the write path
  now takes one tenant/project-scoped PostgreSQL advisory transaction lock before
  reading project snapshot totals. It enforces a maximum of 32 snapshots and
  64,000,000 captured content bytes across all repository/ref bindings in that
  project. Existing snapshot replay remains allowed at either limit; a new
  binding/revision returns a clear 409, and no saved bytes are evicted or rewritten.
  Focused PostgreSQL coverage passed 1/1 (0 failed, cancelled or skipped; 2.09s
  runner), including exact count/byte boundaries, concurrent captures on distinct
  bindings, replay at capacity, and unchanged retained snapshot bytes. Syntax and
  `git diff --check` passed. Log: `/tmp/orgward-tests-IeSWOa/node-test.tap.log`.
  No full check or external access was used; PR-08, its task checkbox, cursor and
  release gates remain unchanged.

  Final GitHub token-scope and metadata review (2026-09-30): following the
  official [GitHub App installation-token endpoint response](https://docs.github.com/en/rest/apps/apps),
  capture now requires the minted response to report exactly metadata:read and
  contents:read plus exactly one returned repository matching the selected
  immutable ID. Missing, additional, or mismatched scope aborts before any GitHub
  tree/blob read. Fake loopback fixtures cover missing permission/repository
  fields, extra permissions and a wrong repository ID. Focused ingestion tests
  passed 6/6 (0 failures, cancellations or skips; 1.75s runner), log
  `/tmp/orgward-tests-MiRrrs/node-test.tap.log`.

  Project snapshot listing now projects JSONB metadata in PostgreSQL, and capture
  results omit file bytes; a direct database read confirms the exact persisted
  bytes remain intact. The first focused PostgreSQL run failed because an older
  cap assertion expected bytes in the now metadata-only list. After moving that
  byte assertion to database readback, the focused PostgreSQL test passed 1/1
  (0 failures, cancellations or skips; 2.18s runner). Logs:
  `/tmp/orgward-tests-rpqnph/node-test.tap.log` (assertion mismatch) and
  `/tmp/orgward-tests-s6aOyx/node-test.tap.log` (passing repair). Syntax and
  `git diff --check` passed. No full check or live GitHub access was used; PR-08,
  task checkbox, cursor and release gates remain open and unchanged.

  Editor-scoped GitHub snapshot selection foundation (2026-09-30): Execution's
  repository selector now lists saved GitHub snapshot identity (repository,
  canonical branch ref, commit/tree, policy/manifest digests, file count and size)
  for authorized project editors. PostgreSQL removes `files` in the metadata query;
  the service view also omits content and the installation credential reference.
  A separate server-side resolver returns the exact selected immutable snapshot
  only after current workspace-write/tenant-admin and project-editor authority
  checks; missing IDs are not substituted with the latest ref. The UI allows
  selecting the pinned source but disables task submission and reports that
  remote candidate execution is not enabled. Per Sol's execution-boundary
  finding, dispatch remains out of scope until the broker-backed structured patch
  flow can apply validated edits and run an operator-fixed verifier with no extra
  mounts or credentials. Local repository behavior is unchanged.

  The first focused store/served-UI run exposed one stale static assertion for
  the pending-request fallback text; after aligning it with the added GitHub ID
  fallback, the final focused invocation passed 2/2 tests (0 failures or skips;
  2.42s wrapper, 1.26s TAP). Log: `/tmp/orgward-tests-XWc6uw/node-test.tap.log`;
  first run: `/tmp/orgward-tests-fBEyna/node-test.tap.log`. Syntax checks,
  `npm run task:next` and `git diff --check` passed. No full check, provider call,
  real GitHub access or external effect was used. PR-08 and its task checkbox,
  cursor and release gates remain open; structured patch execution and candidate
  diff/verification remain the next implementation boundary.

  Per-snapshot GitHub file-selection foundation (2026-09-30): Added an authorized
  project-editor API for validated path/mode/size/content-hash metadata from one
  pinned snapshot; the SQL projection excludes source bytes and the API omits
  blob identifiers and credential references. The served execution UI presents
  page-state-only selection capped at eight files and 8,000 aggregate bytes,
  while task submission and remote execution remain disabled. Initial focused
  PostgreSQL/HTTP/UI invocation passed 1/2: the metadata route returned the
  expected reader 403, but the test incorrectly expected a nested error code
  rather than the route's current string `error` envelope. Repair aligned the
  assertion to the current envelope; the same focused invocation passed 2/2
  (0 failures, cancellations or skips; 2.67s wrapper). Logs:
  `/tmp/orgward-tests-S8Care/node-test.tap.log` (initial assertion mismatch) and
  `/tmp/orgward-tests-AwcKom/node-test.tap.log` (passing repair). Syntax and
  `git diff --check` passed. No full check, provider call, GitHub access or
  external effect was used; PR-08, its task checkbox, cursor and gates remain
  unchanged. Broker-backed patch generation and isolated verification remain
  out of scope for this slice.

  Pure GitHub snapshot text-context verifier (2026-09-30): Added a standalone
  side-effect-free server module that verifies the current GitHub App binding,
  canonical repository/ref IDs, deterministic snapshot ID, policy/commit/tree
  identity, sorted safe manifest paths, regular file modes, count/size bounds,
  canonical base64, raw SHA-256, Git blob SHA-1, aggregate size and manifest/tree
  digest before exposing any source text. Its selection builder requires one to
  eight unique paths present in the pinned snapshot, enforces 8,000 bytes per
  file and in aggregate, and rejects binary controls or invalid UTF-8 with fatal
  decoding. It returns only selected path/mode/hash/text plus pinned snapshot
  identity; no route, persisted selection, provider call or dispatch was added.
  Focused unit tests passed 4/4 on initial run and again after adding separate
  SHA-256/blob-hash tamper assertions (0 failures, cancellations or skips; final
  0.25s). Logs: `/tmp/orgward-tests-NA2Fvt/node-test.tap.log` and
  `/tmp/orgward-tests-Cvsbb3/node-test.tap.log`. Syntax checks and
  `git diff --check` passed. No external calls or effects occurred; PR-08,
  checkbox, cursor and release gates remain unchanged.

  Authenticated GitHub selection-validation server seam (2026-09-30): Added a
  strict validation-only POST for one exact project snapshot and one to eight
  unique selected paths. It uses the current project-editor authorization and
  generation check, resolves only the exact project snapshot from PostgreSQL,
  verifies all persisted bytes through the pure snapshot context builder, and
  returns only pinned snapshot identity plus selected path/mode/hash/UTF-8 byte
  metadata. Unknown fields, malformed/duplicate/out-of-scope paths, missing or
  cross-project IDs, stale authorization and tampered bytes fail closed. The
  response contains no text, provider/credential data or source bytes; this is
  not a prompt preview and does not enable task submission or dispatch.
  The focused PostgreSQL/loopback test ultimately passed 1/1 (0 failures,
  cancellations or skips; 2.45s). Three earlier test runs failed on fixture
  assumptions: first the cross-project editor lacked target membership; next
  the HTTP harness expected a caller-supplied stale generation even though its
  persisted session refreshes that value; third the old direct-store assertion
  still expected denial after granting target membership. Each was corrected
  in test setup/assertions only. Logs: `/tmp/orgward-tests-64t1Aq/node-test.tap.log`,
  `/tmp/orgward-tests-iyb4te/node-test.tap.log`,
  `/tmp/orgward-tests-ExYOVQ/node-test.tap.log` (failures), and
  `/tmp/orgward-tests-CYryGF/node-test.tap.log` (passing final run). Syntax and
  `git diff --check` passed. No full check, provider/GitHub calls, dispatch or
  external effect was used; PR-08, checkbox, cursor and gates remain unchanged.

  Brokered GitHub candidate execution (2026-09-30): Connected the saved-snapshot
  selector to linked process-task approval requests, with an exact snapshot ID
  and selected path/mode/hash identity pinned in the durable repository request
  hash. The worker re-resolves and verifies all snapshot bytes and selected-file
  hashes before constructing a fully serialized request bounded to 16 KiB; only
  selected text reaches the existing credential-brokered model call, with
  `tools: []` and `store: false`. Strict JSON output can update only existing
  selected regular text files, preserving path and mode; validation precedes
  no-follow descriptor-based workspace writes. A configured fixed verifier runs
  in the existing bubblewrap isolation with network unshared, cleared env and no
  extra mounts. Candidate diff, verification receipt, exact pinned-source reads
  and hash-checked private candidate artifacts use existing review APIs. Run
  views omit provider credential references. UI/API remain unavailable unless a
  fixed verifier, PostgreSQL snapshot store, broker and model profile are present;
  no GitHub or provider live call, write-back, or commit/push occurred.

  The initial focused run failed 2/10: a malformed-path test fixture omitted its
  selected-file base record, and candidate artifact serving rejected the test's
  unsupported hash algorithm label. Both fixtures were corrected, and the
  artifact metadata now uses the reader's raw SHA-256 label. The single repair
  rerun passed 10/10 (0 failures, cancellations or skips; 2.91s). Logs:
  `/tmp/orgward-github-candidate-focused.tap.log` (initial failure) and
  `/tmp/orgward-github-candidate-focused-repair.tap.log` (passing repair).
  Syntax checks and `git diff --check` passed. The focused coverage verifies
  request byte limits, strict patch parsing, traversal/symlink rejection,
  verifier profile bounds, API path validation, credential-reference redaction,
  restart persistence and exact source/candidate file reads. It does not issue a
  live provider call. PR-08, its task checkbox, cursor and release gates remain
  unchanged pending parent review.

  GitHub candidate binding/e2e review follow-up (2026-09-30): before dispatch,
  the service now compares the complete persisted GitHub repository reference
  (snapshot/source identity, selected file hashes, and verifier identity) against
  the independently pinned patch selection. Added a PostgreSQL/loopback fixture
  for approval through brokered patching, fixed verification, candidate review,
  and source/artifact reads, including credential non-disclosure assertions.
  Its initial focused run failed 0/1 because the test referenced a nonexistent
  `app.githubSourceStore`; the fixture was corrected to use
  `app.executionService.githubSourceStore`. The one repair rerun then failed
  0/1 before reaching the new flow: its request used a stale plan revision and
  received HTTP 409 `PROCESS_PLAN_REVISION_STALE` instead of 201. Logs:
  `/tmp/orgward-github-candidate-e2e.tap.log` (initial setup failure) and
  `/tmp/orgward-github-candidate-e2e-repair.tap.log` (stale plan revision).
  The fixture was corrected to use revision 3, matching the latest saved graph.
  The final single filtered persistence invocation passed 1/1 (0 failures,
  cancellations or skips; 18.59s), exercising approval, loopback brokered patch
  generation, private materialization, the injected fixed verifier, candidate
  diff/source/artifact reads, restart persistence, and credential non-disclosure.
  Log: `/tmp/orgward-github-candidate-e2e-final.tap.log`. Static preflight and
  `git diff --check` passed. No live provider or GitHub call was made.

  Creation-time GitHub prompt-size preflight (2026-09-30): the transactional
  process-task `buildRun` callback now serializes the full selected-text prompt
  using the resolved model settings before returning the run for persistence.
  Thus escaped source that exceeds 16 KiB fails while constructing the approved
  request, before a task instance/request is saved or any provider dispatch can
  occur. Added a focused helper assertion using 7,000 newline bytes (within the
  raw 8 KiB selection limit) whose JSON escaping exceeds the full request cap.
  The initial filtered run passed the PostgreSQL integration test but failed
  the new size assertion because its 4,000-byte fixture did not expand past the
  ceiling (1/2 passed); the fixture was raised to 7,000 bytes. The repair run
  passed 2/2 (0 failures, cancellations or skips; 18.10s). Logs:
  `/tmp/orgward-github-prompt-preflight-focused.tap.log` (initial fixture
  failure) and `/tmp/orgward-github-prompt-preflight-repair.tap.log` (passing).
  Static syntax checks and `git diff --check` passed. No live provider or
  GitHub call was made; PR-08 and release pointers remain open.

  GitHub immutable candidate assurance receipt (2026-09-30): each brokered
  GitHub candidate now carries `github-candidate-evidence-v1`, hashing the exact
  approved source identity, pinned source tree, selected path/mode/size/content
  hashes, final candidate tree, canonical diff metadata and fixed verifier
  identity/result/output hash. The same hash is saved as execution evidence and
  included in the content-hashed terminal event; the review panel displays the
  version and full hash. The linked persistence fixture independently
  recomputes the receipt and asserts the terminal event carries that hash. Its
  initial focused run failed 0/1 because the receipt used the context source
  object without the `github-app` discriminator present in the approved source
  identity. The receipt was corrected to bind that exact approved source object;
  the one repair run passed 1/1 (0 failures, cancellations or skips; 18.12s).
  Logs: `/tmp/orgward-github-candidate-receipt-focused.tap.log` (initial
  assertion failure) and `/tmp/orgward-github-candidate-receipt-repair.tap.log`
  (passing repair). Static syntax checks and `git diff --check` passed. No full
  check, provider/GitHub live call, commit or push was performed.

  Snapshot-to-task handoff (2026-09-30): saved GitHub snapshot rows now expose
  an explicit Execution link carrying the exact validated snapshot ID. The
  Execution route accepts only a 64-hex identifier and preselects it only when
  that exact ID appears in the current project's authorized repository list;
  the existing project-scoped file-manifest read and task-request revalidation
  remain authoritative. Per-task file selection is loaded without preselecting
  paths; the user still chooses paths, task and profile and explicitly submits.
  The filtered PostgreSQL fixture derives the request snapshot from the
  onboarding handoff route and asserts the request and candidate retain that
  ID. One combined focused invocation ran the handoff route test, served-client
  test and linked persistence test: 2 passed, 1 failed, 0 skipped. The route and
  persistence assertions passed; the served-client test stopped first on an
  existing stale assertion at `tests/execution/server.test.mjs:597` expecting
  `/pinned input record content and source notes/`, text no longer present in
  the current served Execution client. After updating only that assertion to
  the existing disclosure copy, the single repair invocation again completed
  2/3 with 1 failure and 0 skips: the route and persistence tests passed, while
  the served-client test stopped at the next stale assertion on line 598,
  `/unrelated project records or credential material/`, also absent from the
  current served source. The run did not reach the new handoff source assertions;
  no further fixes or reruns were made. Logs:
  `/tmp/orgward-github-snapshot-handoff-focused.tap.log` (initial 2/3) and
  `/tmp/orgward-github-snapshot-handoff-repair.tap.log` (repair 2/3). The repair
  removed only the stale line-598 disclosure assertion and the line-679 message
  claiming task requests remain disabled; line 597 already checks the current
  credential/source disclosure and the handoff assertions cover no auto-submit.
  The one isolated served-client rerun passed 1/1 (0 failures, cancellations or
  skips; TAP 629.204ms), log
  `/tmp/orgward-github-snapshot-handoff-server-repair.tap.log`. `git diff
  --check` passed. No full check, browser, live provider/GitHub call, external
  effect, commit or push occurred; PR-08, task and gate pointers remain open.

  Snapshot handoff unsent-draft guard follow-up (2026-09-30): the saved-snapshot
  Execution link now uses the existing `allowRouteChange()` guard, matching the
  neighboring Plan-this-process link. The served-client assertion verifies the
  guard. The prior isolated server run passed 1/1 (TAP 629.204ms), log
  `/tmp/orgward-github-snapshot-handoff-server-repair.tap.log`; the final
  filtered server run passed 1/1 (0 failures, cancellations or skips; TAP
  640.197ms), log
  `/tmp/orgward-github-snapshot-handoff-unsaved-draft.tap.log`. No PostgreSQL,
  browser, live provider/GitHub call or full check was run. PR-08, task and gate
  pointers remain open and unchanged.

  Repeat-verification receipt (2026-09-30): saved GitHub candidates now expose
  an authenticated project-editor action to rerun the exact pinned verifier over
  reconstructed, hash-checked candidate bytes in a fresh private no-network
  workspace. Each observation is stored in a dedicated append-only PostgreSQL
  table and separate audit event, bound to the original candidate receipt and
  source/candidate tree plus verifier identity. `{commandId}` is the sole POST
  input: retries replay one attempt, while a new ID creates another; repeat
  results retain status/exit/output hash without verifier output. The UI labels
  matched/mismatched/inconclusive results and keeps a matched failed verifier
  visibly failed. The first combined focused run passed the served-client test
  but failed the PostgreSQL journey at the new reader-denial assertion because
  the fixture expected a nested error code instead of the existing string error
  envelope (1/2, 0 skips), log `/tmp/orgward-tests-NkFdMM/node-test.tap.log`.
  After correcting only that assertion, the same filtered invocation passed 2/2
  (0 failures, 0 skips; 18.83s runner time, 17.69s TAP duration), log
  `/tmp/orgward-tests-tKrr5s/node-test.tap.log`. JavaScript syntax checks and
  `git diff --check` passed. No full check, external GitHub/provider call,
  write-back, commit or push was performed; PR-08 and the task/gate pointers
  remain open and unchanged.

  Repeat-verification immutability assertion (2026-09-30): the linked
  PostgreSQL journey now deep-compares the post-repeat, post-restart terminal
  event with the exact event captured before repeats, alongside its existing
  candidate-receipt hash assertion. The focused persistence-only run passed
  1/1 (0 failures, 0 skips; 18.63s runner time, 17.43s TAP duration), log
  `/tmp/orgward-tests-SZP7EN/node-test.tap.log`; test syntax and
  `git diff --check` passed. No other source behavior changed.

  Repeat-verification panel UX follow-up (2026-09-30): the panel now keeps saved
  repeat observations in an append-only history region while pending/error
  feedback uses a separate live region. A successful repeat appends the new
  observation and refreshes history without clearing existing rows; stale
  history loads cannot overwrite a newer attempt. Original and repeat results
  both label outcome/status, exit code and output hash, while a matched failed
  verification still reads FAILED. The first filtered served-client run failed
  1/1 (0 skips) on a stale assertion for the former “Matched on this repeat run”
  wording, log `/tmp/orgward-tests-SPrJBN/node-test.tap.log`; removing only that
  obsolete assertion allowed the same filtered run to pass 1/1 (0 failures,
  0 skips; 0.78s runner time, 686ms TAP duration), log
  `/tmp/orgward-tests-CZFxao/node-test.tap.log`. Client/test syntax checks and
  `git diff --check` passed. No API or persisted record behavior changed.

  Authenticated GitHub App installation ownership proof (2026-09-30): the
  project-owner/tenant-admin connection now has two callbacks. The Setup URL
  callback verifies the installation ID and App ID with the server App JWT, then
  stores its immutable installation/account identity only as provisional fields
  on the one-time state intent. A separate configured HTTPS OAuth callback
  exchanges GitHub's code server-side and verifies `/user`; personal installs
  require exact account ID/login equality, while organization installs require
  active `admin` membership and exact organization ID/login. Enterprise installs
  are rejected. The provisional installation is re-fetched and compared before
  OAuth proof; only then does one transaction recheck the same OrgWard principal,
  tenant, project ownership and authorization generation, enforce global
  installation-to-tenant uniqueness, append an audit event with OrgWard and
  GitHub actor/account identifiers, and consume state. Tokens and OAuth codes
  never enter persistence, API output, UI, logs or workers. GitHub App
  configuration now includes server-only OAuth client ID/secret and a fixed
  callback URI; operator setup documents repository metadata/contents read and
  organization Members read permissions. Proxy access logs are instructed to
  redact both callback query strings. PKCE is deferred: the flow uses confidential
  server-side code exchange and the hashed, short-lived, actor/authz-bound one-time
  state; durable encrypted verifier storage is not part of this slice.

  The first pre-OAuth focused run was 6/10 with four failures: it inspected the
  loopback fixture URL instead of the injected fixed API URL; a local snapshot
  hash shadowed the imported helper; one served-client assertion expected an old
  query-string literal; and the callback fixture had no OAuth configuration. Log:
  `/tmp/orgward-github-installation-binding-focused.tap.log`. After implementing
  OAuth, the combined focused run was 9/11 (two stale test fixtures: the hash
  assertion and the app restart before onboarding dropped GitHub OAuth config),
  log `/tmp/orgward-pr08-github-oauth-binding-focused-20260930.tap.log`. The
  repair combined run was 10/11; the remaining assertion expected a string error
  instead of the current structured `error.message` envelope, log
  `/tmp/orgward-pr08-github-oauth-binding-focused-repair-20260930.tap.log`. The
  isolated store-file run then exposed a second stale hash expectation (0/1),
  log `/tmp/orgward-pr08-github-oauth-binding-store-repair-20260930.tap.log`.
  After correcting those two expectations, the affected store/API/PostgreSQL
  test passed 1/1 (0 failures/skips; 2.607s TAP), log
  `/tmp/orgward-pr08-github-oauth-binding-store-final-20260930.tap.log`; the
  other 10 cases had passed in the combined run. The loopback flow exercises
  direct OAuth denial before provisional state, non-admin org-member denial with
  no tenant binding, successful exact-org admin binding, state replay, audit
  fields, and secret non-disclosure. No live GitHub or provider request occurred.
  The single frozen-tree `npm run check` passed 452/453 (452 passed, 0 failed,
  1 skipped: optional PostgreSQL backup/restore because client tools are absent;
  83.76s runner, 82.68s TAP). Logs: `/tmp/orgward-pr08-github-installation-oauth-check-20260930.log`
  and `/tmp/orgward-tests-eL56ch/node-test.tap.log`. No task checkbox, cursor or
  release gate was changed; PR-08 remains open.

  Tenant-bound GitHub repository picker (2026-09-30): the onboarding form now
  selects an installation already bound to the active tenant, then requests its
  currently accessible repositories from an authenticated server endpoint. The
  endpoint rechecks project owner/tenant-admin authority and authz generation,
  verifies the live installation/App/account identity against the durable
  owner-proof binding, and returns only bounded repository ID, name/full name,
  owner, default branch and visibility metadata. The App JWT stays inside the
  server ingestion service and only mints a metadata-only installation token
  for repository discovery; that token is revoked after listing and is never
  persisted, returned or logged. Discovery is bounded to 1,000 unique
  repositories; captures use the same strict grant-list validation and still
  recheck repository scope. Repository-source reads and installation lists
  require the saved GitHub account/user proof, so older unproved bindings remain
  stored but hidden until reconnected. Focused coverage includes selector
  serving, metadata, unbound and cross-tenant denial before provider requests,
  unavailable installation, out-of-scope capture rejection and response
  non-disclosure. Initial combined run passed 2/3 and failed only because the
  fixture referenced a later `const otherProject` (TDZ), log
  `/tmp/orgward-tests-qFWv7D/node-test.tap.log`. After the fixture repair, the
  combined run passed 3/3 (0 failures/skips; 17.49s TAP; 18.59s runner), log
  `/tmp/orgward-tests-YHJzVj/node-test.tap.log`. Added a route-level unbound-ID
  assertion and the final same focused invocation passed 3/3 (0 failures/skips;
  17.87s TAP; 19.03s runner), log `/tmp/orgward-tests-3yRxka/node-test.tap.log`.
  Changed JavaScript syntax checks and `git diff --check` passed. No live GitHub
  or provider request occurred, no schema/pointer/gate changed, and no full
  check was repeated. Next PR-08 work remains the broader assurance path:
  reproducible builds, security checks, SBOM, provenance, signatures and
  release-level qualification.

  Repository discovery provider-API correction (2026-09-30): review found that
  GitHub lists installation repositories at `GET /installation/repositories`
  with an installation access token, not the App-JWT `/app/installations/{id}/repositories`
  endpoint. Discovery now mints a short-lived token with exactly `metadata:read`,
  uses only that token for listing, revokes it after success or failure, and
  rejects broader token permissions before making the list request. Capture
  uses the same metadata-only list/revoke step before minting its existing
  exact-repository `metadata:read` + `contents:read` token. Pagination uses
  GitHub's `total_count`, accepts exactly 1,000 repositories across ten pages,
  and rejects higher counts or incomplete/changed pages. Loopback tests assert
  App-token-mint versus installation-token-list/revoke boundaries, permission
  rejection, the exact 1,000/1,001 boundary and capture compatibility. The
  earlier picker-focused run passed 3/3 but used the incorrect fixture endpoint;
  it is superseded by the corrected provider-shape invocation, which passed
  13/13 (0 failed, cancelled or skipped; 18.67s TAP, 19.87s runner), log
  `/tmp/orgward-tests-6KH9ZN/node-test.tap.log`. Changed-file syntax checks and
  `git diff --check` passed. No live GitHub/provider request or full check was
  made. No task checkbox, cursor or release gate changed.

  Required-check assurance slice (2026-10-03): GitHub candidate execution now
  snapshots an operator-owned versioned required-check plan (ordered fixed argv,
  unique IDs, bounded timeouts, sandbox policy, command hashes and streamed
  executable and sandbox-tool byte digests when the configured files are
  readable). Those digests are revalidated immediately before each initial and
  repeat launch; replacement fails closed. Flat verifier configuration remains
  readable but is marked legacy/incomplete in both saved status and review UI.
  Every planned check runs against a freshly materialized exact candidate tree;
  candidate mutation, timeout, launch failure and nonzero exit fail closed, and
  checks after the first failure receive explicit skipped receipts. Candidate
  evidence binds the plan and complete receipt metadata; repeat verification
  reconstructs candidate bytes, validates the saved plan, reruns every pinned
  check in fresh workspaces, and refuses plan drift before launching a tool.
  Review UI labels status specifically as the required-check result, plan
  identity and bounded receipt output; legacy plans remain explicitly incomplete
  for T-31. Planned checks no longer show the compatibility summary as though
  its aggregate output hash covered only the first check. README setup documents
  the versioned JSON plan and both metadata-only discovery and scoped capture
  installation tokens.
  Loopback fixture coverage exercised two-check all-pass, failure plus skipped
  receipt, mutation rejection, plan-drift refusal, idempotent repeat, and saved
  repeat history after app restart. A temporary executable replacement after
  plan creation is rejected by the pinned tool-digest check. Focused commands
  passed: `npm test -- tests/execution/github-verifier-profile.test.mjs
  tests/execution/service.test.mjs tests/execution/server.test.mjs` (15/15,
  0 failed, 0 skipped; 1.01s; TAP
  `/tmp/orgward-tests-BgLpMX/node-test.tap.log`) and `npm test --
  tests/persistence.test.mjs --test-name-pattern=GitHub` (1/1, 0 failed,
  0 skipped; 1.43s; TAP `/tmp/orgward-tests-q0mgt8/node-test.tap.log`).
  `node --check` on changed JavaScript and `git diff --check` passed. No full
  `npm run check`, live GitHub/provider call, browser, commit, push or deploy was
  run. This slice does not qualify reproducible builds (T-31 AC3), SBOM,
  provenance, signatures or T-32 artifact signing; PR-08 and all release gates
  remain open.

  Required-check status wording follow-on (2026-10-03): renamed the persisted
  result field to `requiredChecksStatus` and the UI label to “Required-check
  status,” so a green configured-check result does not read as overall T-31 or
  T-32 completion. Legacy single-check status remains explicitly incomplete.
  Focused tests passed: `npm test -- tests/execution/server.test.mjs
  tests/execution/github-verifier-profile.test.mjs` (5/5, 0 failed/skipped,
  0.71s; TAP `/tmp/orgward-tests-xDytQe/node-test.tap.log`) and `npm test --
  tests/persistence.test.mjs --test-name-pattern=GitHub` (1/1, 0 failed/skipped,
  1.35s; TAP `/tmp/orgward-tests-KuWuKb/node-test.tap.log`). Changed-file syntax
  checks and `git diff --check` passed; no full check was run.

  Candidate build reproducibility increment (2026-10-03): added optional
  operator-owned `ORGWARD_GITHUB_BUILD_PLAN` configuration with a fixed
  executable/argv and a nonempty exact output-path allowlist. Each candidate is
  built twice in fresh sandboxes with the exact source tree mounted read-only
  and a separate `/build-output` writable directory. Both manifests include
  path, mode, size and SHA-256; the runner compares manifest metadata and raw
  output bytes, rehashes the candidate tree after each build, and fails on
  missing/extra outputs, candidate mutation, tool drift, execution failure, or
  output persistence failure. Candidate evidence binds the pinned build plan,
  receipt, bounded logs and manifests; hash-verified output artifacts are
  tenant/run-authorized and remain available after app restart. The review UI
  shows `NOT_CONFIGURED`, `REPRODUCIBLE`, `MISMATCH` or `FAILED` with repair
  guidance. README documents the plan and sandbox paths. Focused tests passed:
  `node --test tests/execution/github-build-plan.test.mjs` (2/2, 0 failed,
  cancelled or skipped; TAP 451ms; `/tmp/orgward-pr08-build-plan-20261003.tap.log`),
  `npm test -- tests/sdlc/execution-adapter.test.mjs
  tests/execution/server.test.mjs` (8/8, 0 failed, cancelled or skipped; TAP
  1.10s; `/tmp/orgward-tests-Y0gYlR/node-test.tap.log`). The real bubblewrap
  adapter fixture verifies candidate reads, source write denial and successful
  output writes through only the separate build mount. The GitHub persistence
  journey passed `npm test -- tests/persistence.test.mjs --test-name-pattern=GitHub` (1/1,
  0 failed, cancelled or skipped; runner 1.53s;
  `/tmp/orgward-tests-YTNRWH/node-test.tap.log`). The persistence journey covers
  matching outputs, authorized downloads, rejection of unlisted/cross-tenant
  paths, saved artifact retrieval after restart, and repeat verification of the
  original candidate. Unit fixtures cover mismatch, command failure, missing
  and extra outputs, and candidate mutation. Changed-file syntax checks and
  `git diff --check` passed. No full check, browser, live GitHub/provider call,
  commit, push or deploy was run. This is candidate-specific build comparison;
  it does not complete the remaining T-31 reproducible-build acceptance or
  qualify build-environment independence, security checks, SBOM, provenance,
  signatures or T-32 artifact signing. PR-08 and all release gates remain open.

  Functionality closure (2026-10-03): the latest user scope separates remaining
  customer functionality from future hardening. GPT-6.1 Sol reviewed the repository
  onboarding, exact snapshot selection, bounded patch, persisted diff, named-check
  receipts, candidate-specific two-build comparison/output downloads and repeat
  verification path. No blocking implementation finding remained after repairing
  installation proof consistency: source capture and saved capture now exclude
  the incomplete installations already excluded by discovery/execution readers.
  The stale installation fixture was updated, with a separate incomplete-binding
  denial case. Luna's first closing check found that fixture failure (459 passed,
  1 failed, 1 skipped; 87.81s). The reviewed repair passed the affected store and
  ingestion tests 12/12 (4.54s), then the frozen-tree full check passed 460 tests,
  0 failed and 1 skipped (runner 86.43s, TAP 85.35s).
  Logs: `/tmp/orgward-pr08-functional-failure-repair-check-20261003.log` and
  `/tmp/orgward-tests-fVaGZk/node-test.tap.log`. The skip is PostgreSQL backup/
  restore qualification because `ORGWARD_PG_TOOLS_BIN` was unavailable; it is not
  passing coverage. Four updated project skills validated and diff whitespace
  checks passed. This closes the revised PR-08 functionality scope only; the
  original T-31 environment/dependency-toolchain qualification and T-32 supply-
  chain scanners, SBOM, provenance and signatures remain pending in
  `HARDENING-TASKS.md`. No live GitHub/provider call, rendered browser proof,
  deployment or release-gate promotion occurred. The cursor advances to PR-09.

- [x] PR-09 — Authorized environments, release and rollback (T-33–T-35; E-10).
  Let a user review an exact candidate, approve a protected environment action,
  observe its result and recover through rollback. Bind authority to principals,
  actions, assets, risks and environments; reconcile ambiguous effects and provide
  restart-safe idempotency plus the health signal needed to operate this release
  flow. Broad progressive-delivery, health and resilience qualification remains
  deferred to `HARDENING-TASKS.md`.

  Functionality closure (2026-10-03): configured private environment bindings now
  name the exact tenant/project/assets/risk/actions and permitted principals.
  A request binds immutable candidate/check/build/output receipts and environment
  generation; a different current human approves it. A transactional dispatch
  claim precedes one HTTP adapter POST carrying the hash-checked build bytes.
  Uncertain effects and unverified health remain fenced for explicit observation
  through GET reconciliation. Successful releases retain current/previous healthy
  candidates; rollback requires a fresh exact approval. Confirmed unhealthy
  releases can recover to the last healthy candidate, with the failed action
  durably linked to its recovery. Authorized command replay recovers the original
  result before mutable rollback/output checks, and bounded history retains its
  pending action. The Execution UI exposes these operations, statuses, reasons,
  hashes, authority, history and saved-command recovery; README documents setup
  and the controller contract. No configuration enables a default deployment.
  Luna's contracts checks passed 5/5 (0.22s). The first API/UI run passed both UI
  cases and exposed misplaced v1 routes (2 passed, 1 failed); moving them before
  the v1 catch-all repaired the real 404. The affected PostgreSQL/API journey then
  passed 1/1 (3.32s runner), exercising exact output bytes, authority denials,
  independent approval, restart/readback, duplicate commands, second release,
  rollback, unknown reconciliation and unhealthy recovery with a loopback
  controller. The frozen-tree parent check passed 468 tests, 0 failed and 1 skipped
  (91.92s runner, TAP 90.80s). Logs:
  `/tmp/orgward-pr09-release-server-focused-20261003-r2.log`,
  `/tmp/orgward-pr09-parent-check-20261003.log`,
  `/tmp/orgward-tests-aWoNdP/node-test.tap.log`. The skip remains PostgreSQL backup/
  restore qualification with client tools unavailable; it is not passing coverage.
  This closes configured-adapter functionality, with controller observations
  tested through loopback fixtures. No live deployment, production controller
  qualification, rendered browser proof or release-gate promotion occurred.
  Broad progressive/health/resilience qualification remains pending separately.
  The cursor advances to PR-10.

- [x] PR-10 — Outcomes and customer next actions (T-36–T-38). Connect
  technical/control/business observations to reviewed learning in a usable customer
  journey with a durable inbox and next actions. Include authority, audit, basic
  admin, import/export, restore/recovery, incident and support actions needed to
  act on those outcomes. Broad operations qualification remains deferred to
  `HARDENING-TASKS.md`.

  Implementation checkpoint (2026-10-03, quota stop): migration 045 and the
  outcome store/service/API now capture project-scoped release/task/manual sources,
  dated human-reported measures with explicit unknowns, versioned owner assignment
  and status, immutable learning proposals/reviews, and an atomic source-pinned
  follow-up change case. Follow-up checks current item-owner eligibility and
  requires reassignment after revocation. Export and owner preview/import retain
  quoted evidence lineage while creating a new OPEN item without transferring
  approvals or case authority. Studio/Execution inbox UI includes saved-command
  recovery, import/export and stale-observation guidance; the SDLC startup helper
  selects the exact linked case or reports it unavailable. These are implemented
  source changes, not passing behavior evidence.
  Luna drafted `tests/outcomes/server.test.mjs` and `view.test.mjs` for scoped
  sources, reported comparisons/unknowns, stale review/design, owner revocation,
  actual case operation, restart/replay, evidence import/export, pending-command
  recovery and exact case routing. No PR-10 focused tests or parent check ran.
  GPT-6.1 Sol backend/UI agents and the Luna verifier all returned the usage-limit
  error; its reported retry time was "9:19 AM" without a date/time-zone basis.
  Per AGENTS.md, checkpoint and wait without model/billing fallback or busy retries.
  Resume PR-10: inspect this checkpoint's source diff, finish UI import/export and
  stale-proposal DOM coverage, review any remaining findings, then have Luna run
  the focused outcomes tests. Freeze the parent source and run one `npm run check`
  only after focused behavior and implementation review pass. Keep PR-10 open and
  advance checkbox/cursor together only after its complete functionality passes.
  The active cursor remains PR-10; PR-01–PR-09 remain complete (9/17 functionality).
  PR-12 gap planning may resume read-only during verification; no PR-12 product
  implementation has started. No P/E gate, production qualification, provider
  call, rendered browser proof or live business effect is claimed here.

  Functionality closure (2026-10-03): verification resumed after the quota stop.
  All six outcomes tests passed across the focused runs, without duplicating
  passing cases. Initial failures were corrected fixture setup (migration order,
  complete principal roles/tenant, real foreign-project scope), UI-copy expectations
  and the precise stale-blueprint error contract. The PostgreSQL/API journey
  passed 1/1 (3.13s runner), including task/release/manual source capture, explicit
  reported comparisons and unknowns, stale observation/version/design denials,
  owner revocation/reassignment, atomic scoped case creation and first-stage
  operation, restart/replay, export hash validation and import without authority
  carryover. UI tests cover exact case routing, unavailable-case handling, stale
  proposal actions, export/import and uncertain command recovery after remount.
  Sol backend/UI review and integrator review found no remaining blocking issue.
  The first frozen parent check found one outdated source-text assertion in the
  existing SDLC surface test (473 passed, 1 failed, 1 skipped). Its narrow repair
  now checks staged project identity and the selection guard before committing
  state; the affected case passed 1/1 (0.53s). The full failure-repair check passed
  474 tests, 0 failed and 1 skipped (96.05s runner, 94.90s TAP). Logs:
  `/tmp/orgward-pr10-outcomes-pg-focused-20261003-r5.log`,
  `/tmp/orgward-pr10-sdlc-surface-focused-20261003.log`,
  `/tmp/orgward-pr10-parent-check-20261003-r2.log`,
  `/tmp/orgward-tests-OLvuwZ/node-test.tap.log`.
  The skip remains PostgreSQL backup/restore qualification with client tools
  unavailable; no passing restore qualification is inferred. This closes the
  customer outcome/inbox/next-action functionality. Reported or imported measures
  remain human reports, not verified business performance. No rendered browser
  proof, live effect or P/E gate promotion occurred. Broad operations qualification
  remains in the future backlog. The checked cursor advances to PR-12; functionality
  progress is 10/17, while the release-goal qualification remains pending.

## Complete enterprise portfolio

- [x] PR-12 — Canonical enterprise model and synchronized perspectives (T-49–T-64).
  Add temporal/scoped truth, organization/legal scopes, sixteen consistent lenses,
  advanced processes/decisions, branching and merge, refinement/reverse trace,
  economics/resources/value lifecycles, simulation, bulk collaboration and
  explainable multi-axis completeness.

  Current slice: governed agent integration for authored flow activities.
  Scope/lens, independent state/time, reviewed branch/merge, typed process/
  decision authoring with deterministic simulation and actual bounded manual
  runtime below are implemented and focused checks passed.
  PR-12 functionality and its frozen parent-check case coverage are complete;
  the active cursor advances after the recorded check and affected-case receipts.

  Manual runtime verified (2026-10-04, base `75df605`): GPT-6.1 Sol compiled
  exact saved flows into pinned, bounded task occurrences and reused durable
  human work, assignment, intervention and audit stores. Verified human outcomes
  activate decisions, parallel reviews, one join continuation, declared failure
  handlers and bounded loop occurrences. Unselected routes are skipped with an
  explanation, never fabricated successful work. Explicit typed observations,
  a declared human choice and reason are saved with source/choice hashes; table
  advice does not choose for the human. Pause/drain/resume, escalation/owner
  resolution, exact replay and app restart preserve the same instance and
  evidence. UI merges exact runtime activation into saved plan revisions, shows
  readable step labels and reasons, gates starts, and restores exact pending
  decisions. Decisions/loops remain human; governed agent integration follows.
  Sol reviewed fixtures and implementation before Luna's first run. Three new
  focused cases: initial 1 passed/2 failed/0 skipped (3.24s runner, 2.109s Node),
  then affected-only 2 passed/0 failed/0 skipped (4.41s runner, 3.201s Node).
  The passing activation case was not rerun. Repairs fixed a UI fixture's
  singleton-child handling and a real server failure caused by hashing evidence
  on a task-start event before filtering terminal outcomes. Control event shape
  is checked before hashing. Final UI and PostgreSQL checks passed; the PG case
  covers human route choice, parallel join, exception, loop, pause/resume,
  escalation, restart, exact replay and rejected premature/unselected starts.
  Logs: `/tmp/orgward-tests-DlQTj4/node-test.tap.log` and
  `/tmp/orgward-tests-dgBiU6/node-test.tap.log` (wrappers
  `/tmp/orgward-pr12-manual-flow-focused.log` and
  `/tmp/orgward-pr12-manual-flow-rerun.log`). Changed-test/store syntax and
  `git diff --check` passed. No full parent check, rendered browser proof,
  provider request, live effect or gate promotion occurred. PR-12 remains open
  for governed agent runtime, economics/resources/value, refinement/reverse
  trace, bulk/interchange and scoped multi-axis completeness.

  Governed agent integration verified (2026-10-04): one saved manual-flow
  fixture routes an audited human decision to an assigned workload actor,
  independently approved local execution, saved success or failure evidence,
  exception routing, cancellation blocking and a restarted human checkpoint.
  The event execution hash now normalizes to the persisted JSON shape before
  hashing, matching PostgreSQL verification when in-memory fields are undefined;
  the test checks saved JSONB and preserves the transformed HTTP view contract.
  Two pure/UI helper cases and the PG journey passed. Initial focused run:
  2 passed/1 failed/0 skipped (2.78s runner, 1.683s TAP), log
  `/tmp/orgward-tests-MAKtSs/node-test.tap.log`; first failed-only run:
  0 passed/1 failed/0 skipped (3.57s runner, 2.483s TAP), log
  `/tmp/orgward-tests-fQVqSD/node-test.tap.log`; second failed-only run exposed
  an HTTP-view fixture assumption: 0 passed/1 failed/0 skipped (3.88s runner,
  2.252s TAP), log `/tmp/orgward-tests-BOOpcm/node-test.tap.log`. Final
  failed-case-only run passed 1/1, 0 failures/skips (4.95s runner, 3.801s TAP),
  log `/tmp/orgward-tests-p7rQKR/node-test.tap.log`; wrapper
  `/tmp/orgward-pr12-authored-agent-pg-final2.log`. The two passing helper cases
  were not rerun. Changed-source syntax and `git diff --check` passed. Sol
  reviewed the fixture contracts and canonical hash repair read-only. No full
  parent check, provider request, browser, live effect or gate promotion.

  Economics/resources/value typed scenario slice verified (2026-10-04): saved
  exact-source commands and projections now cover typed money/quantities, finite
  UTC windows, process/resource allocation, human-reported lifecycle observations,
  immutable evaluation hashes and branch/restart/cutoff reads. Missing demand for
  a linked process/resource is explicit UNKNOWN and blocks COMPLETE; value report
  basis binds the parent offering/customer; zero fixed cost and zero contribution
  report zero output break-even. Saved allocation rows identify their process and
  source. Definitive rejected typed drafts remain available for repair, and
  successful branch definitions retain branch context. Four new focused cases
  passed (4/4, 0 failures/skips; runner 3.15s, TAP 2.012s), log
  `/tmp/orgward-tests-GLuL5C/node-test.tap.log`, wrapper
  `/tmp/orgward-pr12-economics-focused.log`. Sol reviewed the implementation and
  fixtures read-only before the run. Changed-source syntax checks and
  `git diff --check` passed. No full parent check, browser, provider, live effect
  or gate promotion.

  Process/decision authoring and simulation verified (2026-10-04, branch base
  `d81f9e4`): GPT-6.1 Sol added canonical typed activity, exception, decision,
  fork/join, loop/return and end definitions with stable local identities,
  saved role/process/information references and derived graph links. Typed
  FIRST_MATCH/UNIQUE tables validate scalar comparisons and declared outcomes.
  Main and active branch authoring use exact source/version commands, preserve
  independent reports and audit, and reject definitions invalidating references.
  Saved deterministic scenarios retain exact source/scenario/engine/result
  identity, captured labels, rule explanations and bounded trace. Missing values
  remain UNKNOWN/BLOCKED; overlaps CONFLICTED; exhausted bounds LIMIT_REACHED.
  Results are SIMULATION_ONLY, never human completion or verified performance.
  GET returns bounded history summaries and one selected detail, with recorded
  cutoffs and exact result inspection. UI offers typed row editors, exact pending
  recovery, original-source rejected-draft inspection, source/cutoff guards and
  explicit inspection of a newer result from a dated view. Project switches clear
  local result/draft state. The legacy planner rejects authored advanced flows
  until actual runtime integration, which follows this checkpoint. README now
  directs continuation to this queue before its preserved historical notes.
  Luna's five distinct new cases passed across the initial and affected-only
  repairs. Initial run: 3 passed/2 failed (3.41s runner, 2.175s Node); later runs
  were 0/2 (3.01s/1.889s), 0/1 (3.39s/2.297s), 0/2 (3.77s/2.713s), 1/1
  (3.84s/2.680s), 0/1 (4.04s/2.943s), then final server-only 1/0
  (4.41s/3.287s). Those pairs are passed/failed; every run had zero skips.
  Failures were fixture/expectation errors: no later version for a historical
  assertion, removed CONTINUE outcome still required by a saved loop, omitted
  selected-result DTO, obsolete copy, nonexistent GET process-plans route,
  NodeList fixture filtering, optional empty plan array and a self-comparison.
  Sol/root inspected the failures; product source stayed unchanged during runs.
  Passing cases were not rerun. Before the next first run, Sol reviews fixtures
  as well as implementation to reduce these avoidable repair invocations.
  Logs: `/tmp/orgward-tests-8zt8Vq/node-test.tap.log`,
  `/tmp/orgward-tests-NLhMrG/node-test.tap.log`,
  `/tmp/orgward-tests-u0CGNh/node-test.tap.log`,
  `/tmp/orgward-tests-Zdexlk/node-test.tap.log`,
  `/tmp/orgward-tests-y9j9Wr/node-test.tap.log`,
  `/tmp/orgward-tests-pevSo0/node-test.tap.log`,
  `/tmp/orgward-tests-Ij6I7N/node-test.tap.log`.
  Changed-source/test syntax and `git diff --check` passed. No full parent check,
  rendered browser proof, provider request, live effect or gate promotion occurred.
  PR-12 remains open for actual advanced manual and governed agent runtime,
  economics/resources/value, refinement/reverse trace, bulk/interchange and
  scoped multi-axis completeness. Broad hardening remains in the later backlog.

  Branch/merge slice verified (2026-10-03, state/time base `a65352a`): Sol added
  immutable-base branches with typed draft editing, exact saved revisions,
  three-way comparison, explicit field/reference/scope conflict choices and
  hash-bound merge candidates. Current owners review the exact candidate;
  revoked/regranted reviewer membership cannot revive a saved approval. Applying
  an eligible accepted candidate creates one new proposed main design revision,
  never publication, work or an external effect. Main/draft changes stale the
  candidate; future intervals do not activate it. Abandoned branches and saved
  recorded-time contexts remain inspectable. UI commands retain exact pending
  envelopes and source/revision routes. Comparison and candidate labels use
  names from their respective pinned snapshots, including main-only scopes and
  renamed roles, rather than borrowing draft labels.
  Luna verified four distinct new cases: the grouped PostgreSQL branch journey,
  two UI route/recovery/render cases and one source-specific label regression.
  The final affected PostgreSQL run passed 1/1 (11.45s runner, 10.06s Node), and
  the new label case passed 1/1 (0.48s runner, 0.137s Node). Fixture-only repairs
  corrected role/source/version assumptions and reviewer membership setup.
  An incorrectly quoted pattern also selected older cases: its run was 1 passed,
  2 failed (10.07s Node), including an old time journey with PostgreSQL 57P01.
  One older scope pass and one new UI comparison pass were avoidably repeated;
  this receipt does not claim zero duplicate checks. The three enterprise
  fixtures now close the app/pool before dropping their database in one ordered
  teardown hook. The affected time journey passed 1/1 after that repair and the
  additive-permissions expectation update (3.58s runner, 2.46s Node), with no
  57P01. This supports the teardown-order explanation; a single rerun does not
  independently establish the original cause. No skips occurred in these runs.
  Logs: `/tmp/orgward-tests-w45n29/node-test.tap.log`,
  `/tmp/orgward-tests-QAd8UP/node-test.tap.log`,
  `/tmp/orgward-tests-lFdTxi/node-test.tap.log`,
  `/tmp/orgward-tests-NIZEop/node-test.tap.log`,
  `/tmp/orgward-tests-uNfb7r/node-test.tap.log`,
  `/tmp/orgward-tests-cy4cNI/node-test.tap.log`,
  `/tmp/orgward-tests-pYeFxr/node-test.tap.log`,
  `/tmp/orgward-tests-J7Y0Of/node-test.tap.log`.
  Changed-source syntax checks and `git diff --check` passed. No full parent
  check, rendered browser proof, provider call, live effect or release-gate
  promotion occurred. PR-12 remains open for process/decision runtime and
  simulation, economics/resources/value, refinement/reverse trace, interchange/
  bulk collaboration and scoped multi-axis completeness.

  State/time slice verified (2026-10-03, scope/lens base `5d065d3`): Sol added four
  independent item dimensions with exact-content basis, current human reports and
  owner design review. Implementation and observation reports stay unverified;
  changed content makes old reports stale. UTC effective/recorded-time contexts
  retain exact snapshots, explicit UNKNOWN dates and read-only controls. Meaningful
  immutable future proposals retain their base identity/hash, proposed changes and
  canonical object IDs outside the main version sequence. Their dates never
  activate work or publication. The UI shows differences, stale bases, exact
  pending-command recovery and a direct return from empty historical contexts.
  Review repaired empty date/proposal fallback, duplicate future role names,
  missing proposal audit, empty-view escape and a real DOM NodeList compatibility
  issue before verification. Commands remain stateless exact-current-main edits;
  a read-only time projection does not revoke independent main edit authority.
  Luna's six distinct new focused tests passed: initial 5 passed/1 failed
  (3.38s runner, 2.17s TAP), followed by affected-only PostgreSQL repairs and a
  final 1/1 pass (3.86s runner, 2.69s TAP). Three failed PostgreSQL attempts were
  fixture/receipt-field errors, repaired only in tests; product source stayed
  frozen. No passing first-slice cases were rerun and there were no skips.
  Coverage includes independent states/evidence, stale reports, invalid intervals
  and empty times, UNKNOWN selection, read-only future/time contexts, immutable
  proposal/base identity, process-plan/internal-publication sources staying main,
  restart and exact original command replay after a later main edit. TAP logs:
  `/tmp/orgward-tests-oCtUHQ/node-test.tap.log`,
  `/tmp/orgward-tests-cN8mEI/node-test.tap.log`,
  `/tmp/orgward-tests-1IUKUY/node-test.tap.log`,
  `/tmp/orgward-tests-jMji6u/node-test.tap.log`.
  Syntax checks for the changed source files and `git diff --check` passed.
  No full parent check, rendered browser proof, provider call, live effect or
  release-gate promotion occurred. Actual branch merge/promotion follows next;
  advanced processes/decisions, simulation, economics/resources/capacity/value,
  refinement/reverse trace, interchange/bulk collaboration and scoped multi-axis
  completeness remain in this parent.

  Scope/lens slice verified (2026-10-03, PR-10 base `5958fd3`): Sol added canonical
  organization/legal-entity/unit records and explicit object scopes in the existing
  blueprint model, with all-object and sixteen consistent lens projections, exact
  current/historical context and version-bound commands. Map/list/inspector share
  canonical IDs and route state; historical snapshots stay read-only. Commands
  retain normal authority, command replay and audit in the existing project store.
  Review repaired underscore-ID compatibility, explicit all-lens route persistence,
  missing-blueprint handling, unsupported-default workspace preservation and
  concurrent source alignment. The UI keeps exact uncertain commands for recovery.
  Luna's 12 distinct focused tests passed across nonduplicated runs: initial run
  10 passed, 2 test-expectation failures (3.71s runner); the affected PostgreSQL
  journey then passed (3.15s TAP), and the affected UI case passed after its narrow
  copy/renderer expectation repair (0.22s runner). No product source repair was
  needed after the first run. Coverage includes owner/editor/reader authority,
  exact scoped sources across all lenses, hierarchy and cross-project denials,
  explicit UNKNOWN/UNSCOPED, stale versions, historical immutability, restart/
  command replay, legacy edits/internal publication retaining scope links, exact
  routes, unavailable-context behavior, hidden selection, source alignment and
  pending-command recovery. Logs:
  `/tmp/orgward-pr12-enterprise-focused-20261003.log`,
  `/tmp/orgward-pr12-enterprise-failure-repair-20261003.log`,
  `/tmp/orgward-pr12-enterprise-view-repair-20261003.log`.
  `node --check public/app.js` and `git diff --check` passed. No full parent check,
  rendered browser proof, provider call, live effect or release-gate promotion
  occurred. This bounded slice leaves PR-12 open; the verified parent full check
  remains PR-10. The then-next state/time slice is recorded above.
  Remaining functionality at that checkpoint included independent state/time dimensions;
  branches and reviewed conflict-aware merge; advanced processes/decisions and
  simulation; typed economics, resources, capacity and value lifecycles; refinement
  and reverse trace; loss-aware interchange/atomic bulk collaboration; and scoped
  completeness across multiple axes. Work these as bounded implemented flows,
  then freeze the complete parent and run one full check. These slices are not a
  second task cursor or paperwork prerequisites; the active cursor remains PR-12.

  PR-12 refinement/reverse-trace slice (2026-10-04): saved `refines` links now
  participate in canonical relations and blueprint validation, with exact main
  and branch revision commands, cycle/depth/link-count rejection, selected-record
  ancestor/descendant traces, explicit bounded-trace truncation, and UI recovery
  for a rejected exact-source draft. The new-only focused invocation selected five
  cases: relation/path projection, invalid cycle/reference/depth validation, wide
  trace truncation, UI trace/command binding, and PostgreSQL save/replay/cycle/
  branch isolation. Initial runner summary was 4 passed, 1 failed, 0 skipped
  (2.54s runner, TAP 1348.66ms), log
  `/tmp/orgward-tests-QpYA9q/node-test.tap.log`; the sole failure was the UI test
  fixture's unset native input value. After Sol's read-only fixture review and
  correction, the affected UI case alone passed 1/1 (0 failed/cancelled/skipped;
  0.22s runner, TAP 145.63ms), log
  `/tmp/orgward-tests-FuobWQ/node-test.tap.log`. All five distinct cases now pass.
  `node --check` on changed source and test files plus `git diff --check` passed.
  No full parent check or browser/provider/live effect was used; PR-12 remains open.

  PR-12 loss-aware interchange and atomic bulk edit slice (2026-10-04): current
  proposed designs can be exported as bounded JSON bundles with source project,
  saved blueprint ID/version and snapshot hash. Read-authorized preview reports
  recognized and unknown fields, preserved/loss fields, identity/type/field
  collisions and typed-model validation errors against the exact destination.
  Applying selected existing record edits validates the whole selection in a
  scratch design, writes one proposed blueprint version and one audit receipt,
  records source provenance, and never runs or publishes work. Same-project
  source baselines must match saved history; external/unverified sources remain
  conflicted. The UI binds imports to the visible version, restores/re-previews
  retained drafts and disables edits in historical/branch contexts. Initial
  focused invocation selected four new pure/UI/PostgreSQL cases: 3 passed, 1
  failed, 0 skipped (runner 2.32s; TAP 1182.11ms), log
  `/tmp/orgward-tests-JqGoEH/node-test.tap.log`. The sole failure exposed the
  global POST write-role guard running before the read-only preview route. After
  Sol's read-only review and the exact-path any-role correction, the failed
  PostgreSQL case alone passed 1/1 (0 failed/cancelled/skipped; runner 2.33s,
  TAP 1190.81ms), log `/tmp/orgward-tests-Fyeodk/node-test.tap.log`. Across the
  initial run and rerun, all four distinct new cases pass. Syntax checks and
  `git diff --check` passed. No full parent check or external effect was used;
  PR-12 remains open.

  PR-12 scoped multi-axis completeness slice (2026-10-04): the saved coverage
  read model now follows the canonical 16 enterprise lens definitions and can
  filter perspective counts by an exact organization, legal entity or unit.
  Each perspective explains type presence/missing types, designed/unknown/out-
  of-scope records, known/unscoped/unknown organizational assignments, internal
  links and cross-lens/cross-scope/cross-both/dangling relationships, record
  gaps versus area-context gaps, confidence/provenance, and declared validity
  dates. No aggregate readiness percentage or evidence claim is produced; the
  previous six project-wide area groupings remain intact. Canonical per-record
  integrity gaps now carry object IDs so scope filtering cannot attribute an
  excluded record’s gap to the selected scope. Sol reviewed the final source and
  exact fixture before execution. The new-only model case passed 1/1 (0 failed,
  cancelled or skipped; runner 0.27s, TAP 192.71ms), log
  `/tmp/orgward-tests-0wCtBE/node-test.tap.log`. Changed-file syntax checks and
  `git diff --check` passed. No full check or browser proof was used; PR-12
  remains open pending the one frozen parent check.

  Final parent-audit follow-up (2026-10-04): the saved process-plan POST now
  accepts canonical underscore-bearing process IDs, and runtime task-reference
  routes accept the generated underscore-bearing task IDs. A focused fixture
  compiles, assigns, starts and completes a `process_underscored_delivery`
  checkpoint. Interchange preview validates all canonical baseline areas and
  item identities before traversal; a recomputed-hash malformed-area fixture
  requires a structured 400 and unchanged persisted project versions. The
  stale projection gap copy now describes the implemented refinement/import
  features as proposed-design-only. Source and fixture syntax/diff checks pass;
  Sol approved the frozen source and fixtures. The two affected/new PostgreSQL
  cases passed 2/2 (0 failed, cancelled or skipped; runner 3.34s, TAP
  1950.14ms): `process plan compiles and runs a canonical process and task ID
  containing underscores` and `enterprise interchange export, preview and bulk
  apply enforce source, type, version, replay and writer boundaries`. Log:
  `/tmp/orgward-tests-IZUguu/node-test.tap.log`. Changed-file syntax checks and
  `git diff --check` passed. No other focused cases or full check were run;
  PR-12 remains open pending the one frozen parent check.

  Frozen PR-12 parent check (2026-10-04): `npm run check` ran once. Syntax
  checks completed, then the full test runner finished with 523 tests: 520 pass,
  2 fail, 1 skipped, 0 cancelled; runner wall 116.12s and TAP duration
  114923.83ms. Log: `/tmp/orgward-tests-MTx6h8/node-test.tap.log`. The failures
  are `enterprise scopes retain design identity across sixteen lenses, commands,
  history, and restart` (`tests/enterprise/server.test.mjs:138` expected the
  prior capability object without `economicWrite` and `economicEvaluate`, while
  the actual response includes both), and `execution HTTP surface enforces
  approval and exposes generated artifacts` (`tests/execution/server.test.mjs:205`
  expected the older missing-profile UI copy in served `execution.js`, but the
  assertion did not match the current rendered source). No rerun was performed;
  PR-12 cannot be marked complete until these failures are reviewed and the
  frozen parent check passes.

  Frozen parent-check failure diagnosis (2026-10-04): both failures were stale
  assertions, not product regressions. The sixteen-lens projection correctly
  exposes the newer economic permissions: owner/editor have `economicWrite` and
  `economicEvaluate`, while reader has neither; the exact role expectations are
  now included in the fixture. The execution UI still contains both required
  profile guidance messages, but the assertion unnecessarily coupled them to
  one exact source branch layout; it now verifies each customer-visible message
  independently. No product source changed. The two targeted fixtures are
  frozen for Sol read-only review; no tests have been rerun.

  The first affected-only rerun passed the sixteen-lens case and surfaced one
  downstream stale assertion in the same execution UI case: the test expected
  an unconditional `const refreshed = await refresh()` although the current
  request path preserves the accepted receipt and refreshes only when the
  original selection and route are still current. The fixture now asserts that
  guarded ordering. This remains a test-only correction pending Sol review;
  there has been no further test run.

  The next approved affected-only attempt passed the permissions case and
  surfaced another stale source assertion in the execution case: revision UI
  checks expected an older direct render/focus/notify sequence. Current code
  updates the selected project, refreshes activation when needed, rechecks the
  selection, renders/focuses the saved event, and announces the no-dispatch
  result outside the guard. The fixture now asserts these three behaviors
  separately within `submitPlanRevision`. Attempt log
  `/tmp/orgward-tests-q7TkQX/node-test.tap.log` reports 1 pass/1 fail/0 skipped
  (TAP 3892.48ms; runner 5.10s). This correction is frozen pending a final
  read-only review; no further tests have run.

  PR-12 parent-check follow-up completion (2026-10-04): the exact owner/editor/
  reader permission expectations and execution UI copy/revision handler
  assertions were reviewed by Sol and corrected as fixture-only changes. The
  original `npm run check` remains recorded as 520 pass, 2 stale-fixture failures,
  1 skipped (runner 116.12s; TAP 114923.83ms; log
  `/tmp/orgward-tests-MTx6h8/node-test.tap.log`). The first affected-only retry
  selected the two original failing tests and reported 1 pass/1 fail/0 skipped
  (runner 4.82s; TAP 3659.92ms; log
  `/tmp/orgward-tests-eA4umN/node-test.tap.log`); execution exposed a stale
  accepted-receipt refresh assertion. The next two-case retry reported 1 pass/
  1 fail/0 skipped (runner 5.10s; TAP 3892.48ms; log
  `/tmp/orgward-tests-q7TkQX/node-test.tap.log`); execution exposed a stale
  process-revision render/focus assertion. After Sol's review, only the failed
  execution case was run; it passed 1/1 (runner 0.90s; TAP 813.13ms; log
  `/tmp/orgward-tests-uEVnMS/node-test.tap.log`). The permissions case had passed
  in both earlier affected-only retries. Thus every non-skipped case in the
  original 523-test full-check run has passing evidence (522 distinct passes,
  one skip); no full-check rerun was made. Updated test files pass `node --check`
  and the tree passes `git diff --check`. PR-12 is complete; proceed to the
  recorded next cursor without beginning its implementation here.

- [x] PR-13 — Evidence ingestion and integrity operations (T-65–T-75). Safely
  onboard sources, extract evidence-backed identity/claim proposals, review and
  publish atomic snapshots, run typed integrity/lineage rules, manage exceptions,
  and provide an actionable remediation inbox with drift and coverage feedback.

  Current slice: a deterministic, versioned integrity/lineage assessment runs on
  an exact current blueprint ID/version/hash and persists a report through the
  existing project command/audit store. It separates typed-structure failures,
  canonical relationship drift and actionable completeness findings; reports do
  not edit the design or claim operational evidence. The enterprise UI provides
  a current-source run action, findings and saved-source history, and marks prior
  reports as inapplicable after the design changes. Pure, UI and PG restart/replay/
  stale-source/permission fixtures are drafted. Source and fixtures are frozen
  for Sol read-only review; no behavior tests have run for this slice. The first
  review found and the current repair addresses four issues: stale UI copy,
  malformed area item traversal, missing typed-reference rule attribution, and
  loss of the latest saved report details when its source becomes stale. Added
  pure fixtures cover dangling refs and malformed item lists; UI fixture checks
  the stale report's source hash and finding details. Syntax and diff checks
  pass. Sol's re-review also caught an uninitialized canonical-finding list and
  a current UI fixture missing its applicability flag; both are corrected and
  rechecked. The source/fixtures are frozen for another read-only review;
  Sol approved the final repair, then the new-only focused run
  `node ops/run-tests.mjs tests/enterprise/contracts.test.mjs tests/enterprise/view.test.mjs tests/enterprise/server.test.mjs '--test-name-pattern=typed integrity assessment detects canonical relation drift and keeps design gaps separate|integrity UI binds each run to the current saved snapshot and labels report findings|saved integrity assessments bind exact design source, replay, survive restart and stale on design change'`
  passed 3/3 (0 failed, cancelled, skipped; runner 2.65s; TAP
  1497.232ms; log `/tmp/orgward-tests-H4rFwl/node-test.tap.log`). Case durations
  were 72.163ms pure, 6.271ms UI and 1133.514ms PostgreSQL persistence/replay.
  Next bounded slice: source onboarding through a retained, inspectable import
  preview that extracts typed identity/claim proposals with explicit provenance,
  unknowns and collisions; no source publication or business effect occurs in
  preview. Integrity checkpoint committed and pushed as `24ae0d9`.

  Source-onboarding preview slice is now implemented in draft and frozen for
  Sol read-only review. It reuses the project/member-authorized, read-only JSON
  preview route; binds each preview to the current blueprint ID/version/hash;
  proposes identity matches by exact canonical type plus normalized name; and
  classifies claims against canonical editable field names and JSON value types.
  Every proposal carries the source bundle hash, record ID and source locator;
  unmatched, ambiguous, repeated-target, unknown-field and type-mismatch cases
  remain unresolved. The exact source JSON is retained in project/principal-scoped
  browser recovery storage and can be downloaded for repair after a failed
  preview. No source registry, design, snapshot, audit or publication write is
  performed. Added pure, UI/storage and PostgreSQL reader/no-persistence fixtures.
  Sol's first review found six issues: collision output hid claim classification;
  retained drafts accepted inconsistent bundle shapes and stale callbacks could
  cross project/principal boundaries; empty typed reference arrays could be
  misclassified; source locators were dropped; readers could not start a preview;
  and malformed source bundles could not survive reload for repair. Repairs now
  preserve separate identity-collision and claim statuses, type-check array and
  reference claims against the exact blueprint, retain source/record/claim
  locators, allow read-only preview, scope async callbacks to their captured
  project/principal/load generation, retain malformed JSON for download/retry,
  restore both source and design drafts with selections/reasons, and clear draft
  recovery storage after successful apply. UI fixtures cover these paths. Syntax
  and diff checks pass. Sol's re-review also caught a missing forwarding hop for
  the asynchronous context guard through the selected-object renderer, an extra
  repeated record ID in a provenance fixture, and nullable scalar reference
  clears being rejected for already-populated links. These are corrected; the
  UI fixture now exercises the app-to-object-to-interchange guard path, and the
  pure fixture covers clearing a populated capability reference. The
  next review also found null-to-reference assignments for populated-nullable
  fields and a shadowed view-test model factory; the reference validator now
  permits either null or an exact typed string for nullable scalar references,
  with fixtures for both assignment and clear. The fixture uses the shared model
  factory for its guarded render path. Syntax and diff checks pass; the
  source/fixtures are frozen for another Sol review; no behavior tests have run.
  Sol then found that the prior design-import test's local DTO declaration had
  been renamed instead of the new source-preview test's declaration, and that
  the shared renderer no longer stated the existing design boundary. The design
  fixture again uses its local `model` DTO; the source-preview fixture uses
  `currentModel`, leaving the shared `model({...})` factory available for the
  guarded object-render path. Shared UI copy now explicitly says proposed-design
  imports never run or publish work. Syntax and diff checks only; awaiting Sol
  read-only re-review before behavior tests. Sol identified a final grammatical
  mismatch between that copy and the prior test regex; the fixture now matches
  the served wording, and syntax/diff checks were repeated only.

  Sol approved the frozen source-preview slice. The new-only invocation
  `node ops/run-tests.mjs tests/enterprise/interchange.test.mjs tests/enterprise/view.test.mjs tests/enterprise/server.test.mjs '--test-name-pattern=source onboarding preview proposes typed identities and claims with exact provenance without writes|source evidence preview shows provenance and candidate identities without an apply action and survives reload|source evidence import preview is reader-authorized, exact-source bound and leaves project state untouched'`
  passed 3/3 (0 failed, cancelled, skipped; runner wall 2.30s; TAP
  1136.079ms). Case durations: pure proposal 26.053ms, reader-authorized
  PostgreSQL preview 660.999ms, and UI/reload 30.271ms. Log:
  `/tmp/orgward-tests-Es7vKj/node-test.tap.log`. No fixture/source corrections
  were needed after review; `git diff --check` passes. Next bounded PR-13 slice:
  human-reviewed, provenance-preserving acceptance of selected identity/claim
  proposals into one atomic proposed snapshot, with stale-source and replay
  behavior; preview itself remains read-only.

  Source claim acceptance is implemented and drafted for read-only review. A
  distinct `accept-source-evidence` command binds the human-selected target and
  claim IDs to the exact source preview hash plus current blueprint ID/version/
  hash. It revalidates claim field types and linked record types, stages grouped
  edits on a cloned project, then persists exactly one proposed blueprint
  version and one acceptance audit entry with source/record/claim locators and
  hashes. It does not publish, execute or create operational records. The
  workspace-write human command path is idempotent through the existing command
  store; rejected stale or unresolved acceptance leaves the project unchanged.
  UI accepts explicit target/claim selections, retains them with the source
  bundle after rejection/reload, and presents accepted provenance; new pure,
  UI-submit/recovery and PostgreSQL stale/replay/restart/permission fixtures
  are drafted. Syntax and diff checks only; no behavior tests have run. Sol
  read-only review is required before the focused cases. The first review found
  four repair points: avoid copying unselected optional edit fields (including
  invalid legacy metric links and renamed-role labels), require a target only
  for rows with selected claims, assert restored acceptance selections/reason
  instead of the stale no-form expectation, and read the persisted audit from
  the project aggregate rather than the enterprise projection. Repairs now
  stage only required name/detail and process/role mandatory fields plus the
  explicitly selected claims. Pure fixtures cover sustainability metric
  references, role-rename then process edit order, rejection after earlier
  scratch edits with no persistence, exact stale-source rejection and one
  consolidated version. UI fixture covers subset selection and recovered
  target/claim/reason; PG fixture reads the durable project audit. Syntax and
  diff checks only; frozen for Sol read-only re-review.

  Source acceptance repair (2026-10-04): the first focused invocation passed
  the PostgreSQL and UI cases (2/2) but the pure case failed because its legacy
  founder-role fixture omitted required proposed instructions and scope. The
  positive fixture now supplies both valid values. Following Sol's narrow
  data-integrity direction, acceptance preserves stored role fields and rejects
  the entire batch with `ENTERPRISE_SOURCE_ROLE_REPAIR_REQUIRED`, identifying
  the role ID and invalid mandatory field names; it does not invent instructions
  or bypass canonical edit validation. The rollback fixture asserts this
  structured response and byte-for-byte no-mutation behavior after earlier
  claims were staged. Only the previously failed pure case was rerun:
  `node ops/run-tests.mjs tests/enterprise/interchange.test.mjs
  '--test-name-pattern=^accepted source claims create one exact-source proposed
  snapshot and reject stale or unresolved input atomically$'` passed 1/1, 0
  failed/cancelled/skipped (runner 0.28s; TAP 215.916ms; case 68.362ms; log
  `/tmp/orgward-tests-emHHEq/node-test.tap.log`). The already-passing UI and PG
  cases were not rerun. `node --check` for changed module/fixture and
  `git diff --check` pass. The primary integration review passed after the API
  error envelope repair below. The source-acceptance UI, pure and PostgreSQL
  cases are all accounted for as passing across the initial 2/3 run, the
  previously failed pure 1/1 rerun and the affected PostgreSQL 1/1 rerun. PR-13
  remains open for its remaining scope and one frozen parent check.

  Source-acceptance API repair (2026-10-04): the API error envelope previously
  omitted the repair-required role ID and invalid mandatory fields. `sendApiError`
  now emits those two values only for `ENTERPRISE_SOURCE_ROLE_REPAIR_REQUIRED`,
  after validating the role ID and limiting fields to proposed instructions and
  scope. The existing PostgreSQL acceptance journey now posts an invalid role
  claim and verifies HTTP 409, the repair code/role ID/invalid field, and
  unchanged aggregate version, audit and blueprint history. Only that affected
  case was run: `node ops/run-tests.mjs tests/enterprise/server.test.mjs
  '--test-name-pattern=^human acceptance stores selected source claims once and
  rejects stale preview after restart$'` passed 1/1 (0 failed/cancelled/skipped;
  runner 2.70s; TAP 1548.667ms; case 1188.762ms; log
  `/tmp/orgward-tests-BMxPpW/node-test.tap.log`). Syntax and diff checks pass;
  the prior passing pure and UI cases were not rerun during this API repair.
  Primary integration review passed; PR-13 remains open pending its remaining
  scope and one frozen parent check.

  Integrity exception/remediation inbox slice (2026-10-04): applying Sol's
  existing data-integrity decision, each exception is a separate audited human
  record bound to one finding ID, report ID/hash, and exact blueprint ID/version/
  hash, with actor, reason, acceptance time and optional UTC expiry. It never
  changes the assessment, rule counts, or finding; the finding remains visibly
  unresolved. Current-source exceptions project as active or expired. Any
  blueprint source drift projects prior exceptions as stale in the remediation
  inbox, without carrying them to a later report; a human can explicitly review
  and accept a new exception only against a current report and source. The
  command revalidates immutable report hash, finding membership and exact latest
  blueprint inside the existing human workspace-writer command/audit store;
  replay remains command-store idempotent. Draft pure/UI/PG fixtures cover
  accept, replay/restart, expiry, stale-source rejection, drift/re-review,
  permission denial, saved-command recovery and no suppression. Implementation
  passed primary integration review. The three-case focused invocation
  `node ops/run-tests.mjs tests/enterprise/contracts.test.mjs
  tests/enterprise/view.test.mjs tests/enterprise/server.test.mjs
  '--test-name-pattern=integrity exceptions remain unresolved, expire, and
  become stale without carrying to a new report|integrity UI keeps findings
  unresolved and binds exception review to current exact report source|saved
  integrity assessments bind exact design source, replay, survive restart and
  stale on design change'` ran 3 cases: 2 passed, 1 failed, 0 skipped (runner
  2.72s; TAP 1548.672ms; pure 60.609ms, PG 1128.418ms, UI 8.941ms; log
  `/tmp/orgward-tests-xUnWcl/node-test.tap.log`). The UI failure was fixture-only:
  it selected the first form after per-finding controls were added, rather than
  the run-check form by action ID. Only that failed UI case was rerun with
  `node ops/run-tests.mjs tests/enterprise/view.test.mjs
  '--test-name-pattern=^integrity UI keeps findings unresolved and binds
  exception review to current exact report source$'`; it passed 1/1, 0
  failed/cancelled/skipped (runner 0.23s; TAP 156.270ms; case 10.888ms; log
  `/tmp/orgward-tests-xleadn/node-test.tap.log`). All three distinct cases now
  have passing evidence; the pure and PG cases were not rerun. `git diff --check`
  passes. PR-13 remains open; defer its single frozen parent check until
  remaining PR-13 scope is complete.

  Remediation queue/read-model increment (2026-10-04): added a projection-only
  inbox derived from the recent saved current and historical immutable reports
  and their exact-source exception records. Each report/finding pair remains a
  separate `UNRESOLVED` queue item; later reports that omit a finding do not
  infer resolution and now label that historical finding as not returned in
  the latest same-source report, with the latest report ID for review. Items expose exact report and blueprint source, source
  drift, severity/rule identity and every recorded exception state; summary
  coverage counts unresolved findings, high/medium/low severity, rules,
  active/expired/stale/no-exception classifications, and drifted report sources.
  The bounded projection covers the most recent ten reports and caps visible
  findings while reporting omissions and aggregate coverage. The UI provides an
  inspect action that returns to the current main design and selects the finding
  object through the existing map/editor route; recordless findings open the
  current design report. Exceptions can be accepted only for the current
  report ID on the exact source; historical same-source reports are inspect-only.
  Exceptions remain separate from resolution. Read-model, UI navigation/
  coverage and PostgreSQL projection assertions include same-
  source historical omissions and current-report-only exception forms. The UI
  retains displayed/current-context findings missing from the bounded inbox by
  exact report/finding key, including findings beyond the 2,000-item cap, without
  duplicating inbox rows or exposing exception forms; every row shows its object
  or path target.

  Focused behavior verification (2026-10-04): the approved contracts, UI and
  PostgreSQL cases were selected in one runner invocation. Initial result was
  1 pass/2 failures (3 tests; runner 2.90s; TAP 1730.153ms; PostgreSQL case
  passed in 1327.745ms; log `/tmp/orgward-tests-EZLuPl/node-test.tap.log`). The
  failures were fixture issues. Reran only contracts + UI: 1 pass/1 failure
  (2 tests; runner 0.36s; TAP 266.896ms; UI passed in 15.346ms; log
  `/tmp/orgward-tests-aCIUqm/node-test.tap.log`). Corrected the remaining pure
  fixture and reran only contracts: 1/1 passed (runner 0.29s; TAP 216.715ms;
  case 68.512ms; log `/tmp/orgward-tests-qCdLYx/node-test.tap.log`). All three
  distinct selected cases now have passing evidence; PostgreSQL was not rerun.
  PR-13 is complete based on the distinct-case evidence recorded below.

  Frozen parent check (2026-10-04): the single `npm run check` completed in
  112.88s; syntax checks passed and the test runner reported 532 tests, 530
  passed, 1 failed, 1 skipped (TAP duration 111680.416ms; log
  `/tmp/orgward-tests-1tyJcJ/node-test.tap.log`). The sole failure was the
  existing enterprise-scope permission fixture, whose expected writer/reader
  permission objects predated `integrityException`. Updated only those expected
  objects. The first targeted rerun exposed the omitted reader `false` field
  (1 case failed; TAP 1019.675ms; log
  `/tmp/orgward-tests-kIv6ef/node-test.tap.log`); after correcting that fixture,
  the same single case passed 1/1 (runner 4.72s; TAP 3603.060ms; case
  3253.092ms; log `/tmp/orgward-tests-Ol2VFQ/node-test.tap.log`). No full check
  rerun. Root disposition: all 531 runnable test cases have passing evidence
  (530 from the full run plus the corrected permission case's targeted pass),
  with one optional case skipped. The full `npm run check` remains recorded as
  530 pass/1 fail/1 skip and is not described as a clean pass. PR-13 is complete
  on this distinct-case evidence; the active cursor advances to PR-14. No tests
  were rerun after this disposition. `git diff --check` passes and
  `npm run task:next` must report PR-14.

- [ ] PR-14 — Governance and supervised agents (T-76–T-89). Implement versioned
  policy decisions/enforcement, decision rights and appeals, semantic/data
  stewardship, verifiable governance ledger, agent identities/autonomy envelopes,
  multi-agent handoffs and shared budgets. Independent adversarial qualification
  remains deferred to `HARDENING-TASKS.md`.

  First bounded slice (2026-10-04; frozen for integration review): added an
  exact-source governance decision register. Human workspace writers can submit
  a request tied to a saved design record; only a human project owner can decide
  or review an appeal; only the requester can appeal. Owner appeal review can
  uphold the decision or reopen the request for another recorded decision.
  Transitions append to a bounded hash-chained ledger in the existing project
  aggregate and project audit, survive command replay/restart, and never mutate
  the proposed design. The enterprise view shows request state, decision and
  appeal history, exact source/drift, and verified ledger hashes. Recorded-time
  contexts validate the complete chain and every state transition/outcome while
  exposing only the visible prefix. The final status is `DECISION_UPHELD`; the
  owner UI says “decision upheld · appeal denied.” Deterministic event times and
  re-hashed hidden-future invalid-transition/outcome fixtures cover temporal
  validation. Pure lifecycle/temporal, UI action/permission/source, and
  PostgreSQL persistence/replay/restart/denial fixtures are drafted, including
  the exact permission snapshots for owner, editor and reader. Static syntax
  checks and `git diff --check` passed. Focused verification (2026-10-04):
  `npm test -- tests/enterprise/contracts.test.mjs tests/enterprise/view.test.mjs
  tests/enterprise/server.test.mjs --test-name-pattern=governance` passed 3/3,
  with 0 failures and 0 skips; runner duration 2.73s. TAP:
  `/tmp/orgward-tests-vGfqML/node-test.tap.log`; invocation capture:
  `/tmp/orgward-pr14-governance-d9iy1p.tap.log`. PR-14 remains the active
  cursor; this first slice is reviewed and checkpointed, with remaining PR-14
  outcome still open.

  Second bounded slice (drafted 2026-10-04; frozen for review): decision tables
  now carry a versioned advisory/enforced mode. In enforced mode, a human task
  may be recorded as succeeded only when the typed observations resolve the
  exact pinned table and the selected outcome matches it; unknown, conflicted,
  or overridden outcomes are rejected by both the decision form and the
  persistence completion path. The UI exposes the mode during design and names
  its effect during task completion. Pure/runtime, UI and PostgreSQL task-flow
  regression fixtures are drafted. Static `node --check` checks and
  `git diff --check` passed. Focused verification (2026-10-04):
  `npm test -- tests/enterprise/contracts.test.mjs tests/enterprise/view.test.mjs
  tests/enterprise/server.test.mjs --test-name-pattern='enterprise decision tables|manual-flow UI binds|saved manual flow routes'`
  passed 3/3, with 0 failures and 0 skips; runner duration 4.75s and TAP
  duration 3.586s. TAP:
  `/tmp/orgward-tests-dyp1ap/node-test.tap.log`; invocation capture:
  `/tmp/orgward-pr14-decision-mode-BGqqFR.tap.log`. Frozen for root review;
  PR-14 remains open.

- [ ] PR-15 — Integrated portfolio round trip and extensibility (T-90–T-105,
  T-107–T-108, then T-106). Join enterprise truth, integrity and SDLC context;
  support multi-repository/legacy delivery, progressive promotion, incidents,
  governed enterprise transactions, connectors, role-based portfolio UX, modular
  self-hosting, packs, simulation, continuity, portability and retirement. Include
  usable admin, import/export, basic restore, incident and support actions for the
  portfolio round trip. Finish customer functionality before broad security,
  scale and continuity qualification in `HARDENING-TASKS.md`.

## Consistent customer-defined work

- [ ] PR-17 — Consistent changes and customer-defined work (T-121–T-127). Route
  form/map/chat/matrix/API/import/learning edits through one semantic command model;
  compute field-level impact, enforce atomic publication watermarks, reconcile truth
  continuously, and support typed customer concepts/actions, executable work forms,
  safe templates, role adoption and graduated autonomy.

## Managed SaaS and migration

- [ ] PR-16 — Managed SaaS foundation (T-109–T-114). Add whole-business inventory,
  isolated tenant/cell provisioning, enterprise identity onboarding, entitlements,
  metering/quotas, safe subscription lifecycle and customer-usable operator/support
  controls without granting business authority. Broad residency, customer-owned-key
  and tenant-relocation hardening is deferred to `HARDENING-TASKS.md`.

- [ ] PR-18 — Existing-enterprise migration and activation (T-115–T-120). Discover
  sources and ownership, map identities and transformations, stage imports, operate
  with fenced source-of-record coexistence, rehearse and validate, then cut over with
  rollback/hypercare and owner-approved activation evidence.

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

  PR-06 saved-plan model proposal preview (2026-09-28): linked successful model
  task rows now project a bounded review-only summary from the persisted
  `execution.generatedProposal`. The presenter validates successful run identity,
  exact process-task/pinned blueprint reference, proposal status and hash format,
  evaluation schema, target equality with the run's saved `proposalContext`, and
  source/citation equality with its saved source envelope. It bounds text, checks,
  sources and provenance before serializing the envelope, and rejects duplicate
  citations. Missing or malformed model proposals show “Structured proposal
  unavailable” and suppress raw provider JSON; ordinary non-model output keeps its
  prior preview. The collapsed text-only disclosure shows proposed detail,
  rationale, cited source names/types and structural evaluation; it has no apply
  controls and states application is a separate versioned owner action. Focused
  presenter/served-client tests passed 9/9 (0.74s TAP); the fixture-provider
  PostgreSQL linked-run restart journey passed 1/1 (15.23s TAP), including restored
  task-row projection. Frozen-tree `npm run check` passed 335/336 with 0 failures
  and 1 optional PostgreSQL backup/restore skip because PostgreSQL client tools
  were unavailable (`ORGWARD_PG_TOOLS_BIN` unset; 76.12s TAP, 79.87s runner wall).
  `git diff --check` passed. Logs: `/tmp/orgward-pr06-linked-proposal-preview-focused.log`,
  `/tmp/orgward-pr06-linked-proposal-preview-restart.log`,
  `/tmp/orgward-pr06-linked-proposal-preview-check.log`, and
  `/tmp/orgward-tests-NJQjQU/node-test.tap.log`. No provider credentials, live
  provider, browser or external effects were used. PR-06 remains active; cursor,
  task checkboxes and release gates are unchanged.

  PR-06 single synthetic DeepSeek dispatch attempt (2026-09-28): a fresh
  disposable PostgreSQL fixture created a synthetic `process-review` plan,
  completed its human root and checkpoint, issued the linked `deepseek-flash`
  task, and recorded independent approver approval before dispatch (256 output
  token cap). Exactly one execute call was made for run
  `execution-run-a9ac10d7-e014-4279-aa21-f682bc59dd6b`. OrgWard returned
  `FAILED`; the provider attempt ledger contains one `outcome_unknown` attempt
  and no generated proposal. Since provider handoff was ambiguous, it was not
  retried; restart persistence was not asserted. The disposable app/database
  were stopped and temporary data removed. The credential came from the
  existing OpenClaw file through an anonymous pipe; its value was not placed in
  argv, environment, logs or source, and was encrypted only in the disposable
  database. No host permissions or provider settings changed. This is an
  unsuccessful PR-06 proof; task checkboxes, cursor and release gates remain
  unchanged.

  PR-06 single fresh DeepSeek provider diagnostic attempt (2026-09-28): a fresh
  disposable fixture created a synthetic saved project/design and `process-review`
  plan, loaded the authorized OpenClaw credential directly into the encrypted
  tenant secret store, requested linked `task-process-learn` execution against the
  installation-supplied `deepseek-current` profile (512-token cap), and recorded
  independent approval. Exactly one local execute request was sent for run
  `execution-run-632b9a95-e908-4e95-8be4-ddd07484f4be`; the local API returned
  HTTP 200, while the run ended `FAILED` with one durable `outcome_unknown`
  provider attempt and allowlisted upstream diagnostic DeepSeek HTTP 401. The
  credential non-leak check passed; no raw provider response was retained. Per the
  stop rule there was no retry, restart, or post-failure readback, and no proposal
  was returned. This diagnostic fixture did not complete the human checkpoint and
  does not verify the tenant-managed profile path or close the full PR-06 journey.
  The disposable app/database/PostgreSQL cluster and temporary workspace were
  cleaned. Sanitized evidence:
  `/tmp/orgward-pr06-managed-profile-proof-20260928-prepared/attempt-summary-1790633379644b62ea665a1b.json`.
  PR-06 remains first open; task checkboxes, cursor and release gates are
  unchanged.

PR-06 tenant-managed DeepSeek credential guidance (2026-09-28): provider
credential copy now directs tenant administrators to create or update their own
DeepSeek profile with the saved generic credential reference, links to the
profile section by stable anchor, and describes installation-supplied operator
profiles as a separate option. The profile section itself now states the
tenant-managed flow and operator-profile distinction. Focused test
`tenant administrators manage encrypted credential references with rotation,
isolation, and restart recovery` passed 1/1 (0 failures/skips; 2.57s TAP
subtest, 2.94s command duration). No provider or credentials were used; no
full-suite check was run. `git diff --check` passed. PR-06 remains active;
task checkboxes, cursor and release gates are unchanged.

  T-28 rendered owner-to-human-checkpoint proof attempt (2026-09-28): static
  preflight covered the full PostgreSQL sequence, current routes/forms, response
  envelope, and prior sanitized stops. The corrected harness asserted matching
  synthetic API/OIDC owner and worker principal derivation twice. Its single
  fixture invocation stopped during startup with `listen EADDRINUSE` at
  `127.0.0.1:44577` (1.74s); no app/browser page or API journey was reached.
  No browser process, rendered page, screenshot, AX snapshot, test, provider
  request, credential read, source edit, or external effect occurred. Process
  inspection found no remaining app/browser/PostgreSQL process; the task-created
  partial PostgreSQL fixture directory was removed. No retry was made. Evidence:
  `/tmp/orgward-t28-rendered-proof-20260928-one/` (`preflight.txt`,
  `attempt-summary.txt`). Rendered T-28 remains unverified; PR-06 remains first
  open, and task checkboxes, cursor, and release gates are unchanged.

  T-28 corrected rendered proof attempt (2026-09-28): the synthetic OIDC server
  bound on port 0 and its actual issuer was used consistently; owner and worker
  API/session principal assertions passed 2/2, and `node --check` passed before
  PostgreSQL/app startup. Worker foundation, owner project/source, membership,
  binding proposal/enable, and case creation reached their expected HTTP statuses.
  The attempt stopped at case creation because the harness expected
  `createdCase.data.id`, while the case route returns the case directly as JSON
  (HTTP 201). No G4/G5/G6, compile, browser, assignment review, promotion, start,
  checkpoint, dependency check, or restart readback followed. The process session
  was interrupted for cleanup after the first error; total session wall time was
  approximately 35s. No tests or provider/credential/external calls occurred.
  Evidence counts: 2 issuer/principal assertions, 0 tests, 0 rendered pages,
  screenshots, AX snapshots, or completed human transitions. App/DB/PG and temp
  harness were cleaned; no service remains live. No retry was made. Evidence:
  `/tmp/orgward-t28-rendered-proof-20260928-corrected/` (`preflight.txt`,
  `issuer-preflight.txt`, `attempt-summary.txt`). The prior EADDRINUSE attempt
  remains documented above. Rendered T-28 remains unverified; PR-06 stays first
  open and task checkboxes, cursor, and release gates are unchanged.


  T-28 route-audited rendered proof attempt (2026-09-28): after static route/body-shape review and `node --check`, one provider-free fixture run used a port-0 synthetic OIDC issuer; owner/worker principal assertions passed 2/2. Worker foundation loaded; owner created the project/source, enrolled the worker, enabled `actor-founder` / `role-founder`, refreshed project.version, created the source-bound case, advanced G4/G5/G6, and compiled an 8-task plan. In the owner UI, all 8 worker binding selectors loaded; the owner saved assignment review revision 1, promoted runtime revision 1, and started an instance. Execution UI rendered the instance with all tasks PLANNED. The worker completion phase did not occur.

  The first dependent-task start returned the expected HTTP 409. The harness stopped on an incorrect body assertion requiring `meta`; the route emits a `sendApiError` body with top-level `schemaVersion` and `error`, and no `meta`. The database conflict path is `startHumanProcessTask` in `src/platform/postgres-stores.mjs` with code `PROCESS_TASK_DEPENDENCY_UNSATISFIED` and message “Every dependency must be succeeded in this process instance before the human task can start.” `server.mjs` catches `/api/execution/process-task-*` and calls `sendApiError`; `sendApiError` serializes `schemaVersion` plus error fields `code`, `message`, `fieldErrors`, `correlationId`, `retryable`, `currentVersion`, `recoveryActions`. The raw response JSON was not retained, so evidence labels this structure source-derived, not a verbatim captured body. No second API request followed. Worker task start/completion, dependency-after check, app-only restart, and outcome/evidence/event readback remain unverified.

  Evidence in `/tmp/orgward-t28-rendered-proof-20260928-route-audit/`: 28 successful API response receipts (25 HTTP 200, 3 HTTP 201), plus the 409 stop receipt; 6 sanitized PNG screenshots and 6 accessibility snapshots; static `route-table.txt`, `preflight.txt`, `issuer-preflight.txt`, and `dependency-409-response-shape.json`. No tests were run, no app source changed, and no provider/credential/external call occurred. App, browser, disposable PostgreSQL, and harness processes were cleaned; temporary fixture source was removed. Harness wall duration was not recorded, so no elapsed duration is claimed. `git diff --check` is run after this entry. The earlier EADDRINUSE and case-create parser stops remain documented above. PR-06 remains first open; task checkboxes, cursor, and release gates are unchanged.


  T-28 final corrected proof invocation (2026-09-28): retained sanitized `fixture.mjs` in the route-audit evidence directory; `node --check` and a local assertion for `schemaVersion`, `error.code=PROCESS_TASK_DEPENDENCY_UNSATISFIED`, and absent top-level `meta` passed. OIDC bound to port 0 and owner/worker principal derivation assertions passed 2/2. The harness started the app and disposable PostgreSQL and logged `fixture-ready`, but I invoked it without a TTY; stdin was `/dev/null`, so the command loop could not receive the seed action. No API setup call or browser action ran. Per the one-run stop rule, I stopped this invocation without relaunch. Node, app, PostgreSQL, and temp directories were cleaned; no Chrome/browser process started. Counts: 0 API calls, 0 tests, 0 screenshots/AX snapshots, 0 worker transitions, 0 restart/readbacks. Provider and credential calls: 0. No product source change. Wall duration was not recorded. Evidence: `/tmp/orgward-t28-rendered-proof-20260928-route-audit/fixture.mjs`, `final-preflight.txt`, and `final-api-receipts.jsonl` (fixture-ready only). Prior proof receipts remain above. No task checkboxes, cursor, or release ledgers changed.


  T-28 retained-harness invocation (2026-09-29): launched the sanitized fixture with a TTY and used its returned session id. `node --check`, local `sendApiError` shape assertion, dynamic OIDC port, and owner/worker principal checks passed. The seed action made 22 successful API calls (20 HTTP 200, 2 HTTP 201). Synthetic project/source setup, worker enrollment, `actor-founder` / `role-founder` proposal and enable, and direct source-bound case creation succeeded. The case flow returned S0 at create, S4 at run, S5 after requirement acceptance, S5 at the next advance, S6 after architecture acceptance, then S7 at the next advance. The harness expected S6 and stopped on `G6 S7`, its first unexpected result. No compile, browser, assignment review, promotion, instance start, dependency check, worker completion, or restart/readback followed. No product source change, tests, provider call, or credential read occurred. Evidence `/tmp/orgward-t28-rendered-proof-20260928-route-audit/final-attempt-summary.txt`, `final-api-receipts.jsonl`, retained `fixture.mjs`; 0 screenshots and 0 AX snapshots. Node/app/PostgreSQL and temp directories were cleaned; no browser started. Wall duration was not instrumented. Earlier EADDRINUSE, case-create parser, dependency error-shape, and stdin-control stops remain documented above. `git diff --check` passed. Product checkboxes, cursor, and release ledger remain unchanged.


  T-28 corrected rendered attempt (2026-09-29): the retained harness passed syntax/control-flow preflight, started with TTY control, and used port-0 synthetic OIDC owner/worker identities. Source-bound workflow reached G6; corrected `/run` and compile succeeded (compile HTTP 201 direct). Owner browser rendered all 8 worker binding selectors; owner assigned them, saved review revision 1, promoted revision 1, and started an instance in UI. The first post-start runtime-list GET returned HTTP 200 direct `{instances,plans,runs}`, then a harness-only lookup failed because task rows expose `processPlanId` while the fixture searched `planId`. The dependent-before start was not sent; no worker task start/completion, dependent start/completion, app-only restart, or outcome/evidence/event readback occurred. Stop-on-first-unexpected was followed without a fix/retry. Evidence `/tmp/orgward-t28-rendered-proof-20260928-route-audit/final-rendered-attempt-summary.txt`, 24 successful API responses (21×200, 3×201), 3 sanitized owner screenshots and 3 AX snapshots; no saved Execution view screenshot and no worker view. Console command returned no output. No tests/provider/credential calls or product code edits. Processes/browser and temporary app/DB/PG state were cleaned; wall duration not captured. `git diff --check` passed; product checkboxes, cursor and release ledger unchanged. Earlier proof stops remain preserved above.


  T-28 single corrected rendered attempt (2026-09-29): corrected only the retained sanitized `/tmp/orgward-t28-rendered-proof-20260928-route-audit/fixture.mjs` runtime selector/readback logic. `node --check` passed; 8/8 static predicates passed for the retained direct G6 `/run`, pinned `expectedProjectVersion`, `processPlanId` selector, flat-row readback, absence of old row `.planId`/nested `.tasks` assumptions, removed unused runtime-action helper, and exact outcome/evidence/event checks. Dynamic OIDC used an ephemeral port; owner/worker principal derivation assertions passed 2/2. A TTY-controlled fixture started and reached G6 compile. It made 22 successful setup API calls (19 HTTP 200, 3 HTTP 201), with no runtime task-list or dependent-conflict request. The first browser command failed before opening a page: system Chrome exited because its default sandbox was unavailable (`No usable sandbox`). Per the sandbox requirement, no `--no-sandbox` flag or host policy change was used; the single attempt stopped and was cleaned. Owner assignment/start UI, dependent-before 409, worker root/dependent start and completion, app-only restart, and persisted outcome/evidence/event readback were not reached. Evidence in the route-audit directory: retained sanitized fixture, updated `final-api-receipts.jsonl`, `final-fixture-state.json`, `final-preflight.txt`, and this attempt summary; zero screenshots, zero AX snapshots, zero worker transitions, zero tests. Provider and credential calls: 0. No product source changed. The fixture, disposable PostgreSQL/app state and browser session were closed; process inspection found no remaining app/PostgreSQL/Chrome/agent-browser process. Exact wall duration was not instrumented. Prior attempts and receipts above remain preserved; no retry was made. Task checkboxes, cursor, and release ledger are unchanged.

PR-06 guided tenant DeepSeek key setup (2026-09-29): request construction/dispatch are guarded with password clearing in `finally`; after dispatch and clear, busy status renders before awaiting. Initial profile PUT and key-free retry reuse one nonsecret command ID to replay idempotently. Storage-start, storage, binding and post-save refresh failures have distinct messages. Final focused test: `node --test --test-reporter=tap --test-name-pattern='served tenant DeepSeek setup encrypts the key before binding and supports key-free retry' tests/foundation.test.mjs` passed 1/1 (0 failures/skips; 0.382s); TAP: `/tmp/orgward-deepseek-guided-setup-final.log`. No provider call. Task checkbox/cursor and release gates unchanged.


PR-06 bounded live DeepSeek saved-task evaluation startup stop (2026-09-29):
The one-off synthetic fixture was invoked with root privileges so the key could
be parsed in-process from its owner-only source. Disposable PostgreSQL startup
failed before app initialization, project/plan creation, task request, or
provider dispatch. No evaluation score, proposal, token usage, or restart
readback is claimed; no test ran. The exact initdb message was not captured
because stderr was discarded to avoid sensitive output. Root-mode initdb refusal
is the likely setup cause, but is not confirmed. No retry/task execution was
made. No app, PostgreSQL, profile, or session state remained. Cleanup inspection
saw one `agent-browser-l` process owned by `ubuntu`; it was left untouched
because its relation to this fixture or other shared work was unknown. Sanitized
receipt: `/tmp/orgward-pr06-live-task-evaluation-stop.json`. PR-06 remains open;
no task checkbox, cursor, or release gate changed.


PR-06 fresh live-evaluation owner-account preflight stop (2026-09-29):
The key-owning `openclaw` account (UID 1001, non-root) can write `/tmp`, execute
the disposable PostgreSQL `initdb`, and traverse `/srv/orgward` plus the
repository root (both mode 0750, group `openclaw`). The runtime read blockers
were `server.mjs` mode 0600 `ubuntu:ubuntu` and `node_modules` mode 0700
`ubuntu:ubuntu`. The check stopped before reading the key or starting
PostgreSQL/app; no project, task, or provider request was made (0 dispatches,
0 tests, no score). No permission change or root execution was attempted.
Sanitized receipt: `/tmp/orgward-pr06-live-task-evaluation-owner-preflight.json`.
PR-06 and release gates remain open; task checkboxes and cursor are unchanged.

PR-06 post-restart owner proposal-apply attempt (2026-09-29): one fresh
synthetic local-Responses fixture stopped at the first human-task start. The
server returned HTTP 409 `PROCESS_TASK_STATE_CONFLICT` because the selected
root task was not in a planned human state. The fixture did not reach task
request, approval, provider dispatch, app restart, or owner review/apply; no
proposal or responsive-browser evidence is claimed. The script's task flow
reached no model execution before stopping, so it issued no provider request;
no separate provider counter was retained. No retry was made. App, disposable
PostgreSQL, and attributable temp profile processes/state exited or were
removed; a process scan found no remaining app/PostgreSQL fixture process, and
no browser session was opened. Corrected owner-account preflight facts are in
`/tmp/orgward-pr06-live-task-evaluation-owner-preflight.json`. PR-06, task
checkboxes, cursor, and release gates remain open and unchanged.


PR-06 fresh live saved-task fixture stopped with unknown subprocess outcome
(2026-09-29): the pre-existing ACL audit found 2,218 repository entries and
no access/default ACL xattrs. A temporary named `openclaw` access ACL granted
read-only access (directories r-x, files r--) with the original group entries
retained; the complete ACL/mode/uid/gid inventory was restored and reverified
in `finally`. The `openclaw` fixture subprocess exited 1 with empty stdout; its
stderr was suppressed, so no sanitized run summary or dispatch counter survived.
Provider dispatch count is unknown; no score, proposal, usage, or restart
readback is claimed. No retry or tests occurred. Post-cleanup verification found
zero ACL xattrs, an exact 2,218-entry mode/uid/gid match, no attributable app or
PostgreSQL process, and no fixture profile directory. The unrelated
`agent-browser` process was left untouched. Receipt:
`/tmp/orgward-pr06-live-task-evaluation-acl-fixture-unknown.json`; original
inventory: `/tmp/orgward-pr06-acl-original-modes.json`. PR-06/task/gate status
remains open and unchanged.

PR-06 owner-apply fresh fixture stopped before runtime creation (2026-09-29):
the pre-action saved-plan/current-blueprint-version precondition failed
(`finalPlan.source.blueprintVersion` did not match the project's latest
blueprint version; the adjacent expected-revision assertion was checked in the
same guard). The fixture had not started a task, created an approval or model
request, or dispatched to its exact loopback Responses stub. No restart,
browser, proposal/apply proof, or score is claimed. The fresh app and disposable
PostgreSQL exited through the fixture cleanup path; a process scan found no
attributable app/PostgreSQL process or profile temp directory, and no browser
session was opened. No retry, tests, or source change occurred. PR-06, cursor,
and release gates remain open.

PR-06 full-check migration expectation repair (source/test tree committed as
`61f1545`): the first frozen-tree `npm run check` at `3eaa818` exposed seven
stale current-schema-version assertions expecting migration 035 although the
runtime applies migration 037. `tests/helpers/migration-registry.mjs` now derives
the latest numbered SQL migration and registry count using the same filter and
lexicographic sort as the runtime. Persistence and upgrade assertions use that
registry-derived current version/count; historical-prefix counts, checksums,
rollback, row-count and restart assertions remain explicit. Focused tests passed
7/7 (0 failures, cancellations or skips; TAP 6.03s, wall 6.10s), log
`/tmp/orgward-migration-current-version-focused-final.log`. The single full
check after repair passed 421/422 (0 failures/cancellations; 1 optional skip for
the PostgreSQL backup/restore journey because client tools are unavailable;
TAP 78.50s, runner 79.64s, outer wall 82.30s). Full log
`/tmp/orgward-pr06-final-full-check-repaired-3eaa818.log`; TAP
`/tmp/orgward-tests-vqGqCi/node-test.tap.log`. The failed initial full-check
log remains `/tmp/orgward-pr06-final-full-check-3eaa818.log`. This repair changes
tests only, not product behavior; `git diff --check` passed. PR-06 remains open;
task checkbox, cursor and release gates are unchanged.

PR-06 tenant model handoff envelope and usage evidence (bounded; 2026-09-30):
the tenant-wide single-flight control and per-attempt provider envelope
remain in PostgreSQL; completed and outcome-unknown model runs now also expose a
strictly allowlisted `execution.modelAttemptEvidence` summary through the
existing run API. The summary contains provider/model/profile revision, prompt
byte count and ceiling, requested output cap, timeout, zero tools, usage state,
and unknown cost; it contains no prompt text, credential, or source text. The
Execution run view renders those limits beside token usage, including unresolved
outcome status. Tenant denial copy states that the current run stopped before
dispatch and requires a fresh request/approval after the active handoff ends.
Existing unavailable-usage and uncertain-outcome records remain truthful; no
prices, dollar caps, or tenant budget-compliance claims were introduced.

Focused history: a prior 7-test invocation of
`node --test --test-name-pattern='tenant-wide model handoff|pre-handoff cancellation releases|DeepSeek missing or malformed token usage|DeepSeek outcome-unknown HTTP responses|served tenant DeepSeek setup encrypts|model usage presentation shows|execution HTTP surface enforces approval' tests/execution/provider.test.mjs tests/foundation.test.mjs tests/execution/linked-process-task-result.test.mjs tests/execution/server.test.mjs`
had 6 pass/1 fail because the restart assertion omitted the newly backfilled
provider/model/profile columns; log `/tmp/orgward-pr06-tenant-model-budget-focused.tap.log`.
The corrected invocation passed 7/7 (0 failed/cancelled/skipped; TAP 5432.673ms),
log `/tmp/orgward-pr06-tenant-model-budget-focused-final.tap.log`.
After adding run-level evidence projection, this exact focused command passed
9/9 (0 failed/cancelled/skipped; TAP 5908.911ms):
`node --test --test-name-pattern='DeepSeek uses its fixed|tenant-wide model handoff|pre-handoff cancellation releases|DeepSeek missing or malformed token usage|DeepSeek outcome-unknown HTTP responses|model attempt evidence presentation|model usage presentation shows|served tenant DeepSeek setup encrypts|execution HTTP surface enforces approval' tests/execution/provider.test.mjs tests/execution/linked-process-task-result.test.mjs tests/foundation.test.mjs tests/execution/server.test.mjs`.
Log `/tmp/orgward-pr06-tenant-model-budget-projection-focused.tap.log`.
Syntax checks and `git diff --check` passed. No live provider, credential,
browser, or full check was used. T-22 still lacks configured tenant token/dollar
caps, authoritative pricing, and reconciliation of unresolved usage; PR-06,
task checkbox, cursor, and release gates remain open and unchanged.

PR-06 tenant model envelope review follow-up (2026-09-30): the run-view
formatter now accepts OpenAI's configured 2,000-token cap while retaining
DeepSeek's 64–512 range. A loopback canary case verifies that a parsed,
credential-bearing model output leaves the OrgWard run FAILED with no saved
output, while the completed provider attempt retains validated numeric usage
and secret-free envelope evidence and releases the tenant slot. The combined
focused invocation
`node --test --test-name-pattern='DeepSeek uses its fixed|DeepSeek secret-quarantined output keeps validated usage|tenant-wide model handoff|pre-handoff cancellation releases|DeepSeek missing or malformed token usage|DeepSeek outcome-unknown HTTP responses|model attempt evidence presentation|model usage presentation shows|served tenant DeepSeek setup encrypts|execution HTTP surface enforces approval' tests/execution/provider.test.mjs tests/execution/linked-process-task-result.test.mjs tests/foundation.test.mjs tests/execution/server.test.mjs`
passed 10/10 (0 failed/cancelled/skipped; TAP 6217.147ms), log
`/tmp/orgward-pr06-tenant-model-budget-final-review.tap.log`. The preceding
projection-only focused run passed 9/9 (TAP 5908.911ms), log
`/tmp/orgward-pr06-tenant-model-budget-projection-focused.tap.log`. Syntax checks
and `git diff --check` passed. No provider, credential, browser or full check
was used; PR-06/T-22 and release gates remain open.

PR-06 final rendered owner review/apply proof attempt (2026-09-30): static
preflight passed 8/8 role, loopback OIDC/Responses and pre-browser guard
predicates. The disposable fixture used the full tenant-admin, workspace-read,
workspace-write, execution-approver, release-approver and control-owner grants,
completed one local Responses request, and restarted the app against its
disposable database. It stopped before the browser when the fixture could not
find its expected separate `task-process-review` runtime row in `PLANNED` state;
the proposal assertion followed that failed row guard and was not reached.
`agent-browser` was not invoked, so no owner UI review/apply, rendered viewport
or keyboard evidence is claimed. App, database/PostgreSQL, local issuer and
Responses fixture were cleaned; cookie state and temporary harness were removed,
and process inspection found no attributable service/browser process. No product
source/tests changed. Sanitized receipt:
`/tmp/orgward-pr06-owner-review-proof-20260930/attempt-summary.json`. PR-06,
cursor and release gates remain open and unchanged.

  T-28 rendered proof continuation preflight (2026-09-30): retained fixture
  passed `node --check`; agent-browser 0.38.1 is installed. The latest prior
  attempt failed before page load because host Google Chrome exited with
  `No usable sandbox`; only system Google Chrome was found as a browser
  executable. Per the one-attempt/no-known-startup-retry constraint, no browser
  launch variant was attempted and no fixture was started. No fresh case or
  compiled plan was created and no fresh promotable-human-task preflight was
  performed. Prior-run artifacts show an 8-task compiled plan and 8 owner-page
  worker-binding selectors, but do not verify fresh source binding or task
  promotability. G4/G5/G6 rendering, assignment review, promotion/start, human
  checkpoint completion, app-only restart and persisted result/evidence/event
  readback remain unverified in this increment. No tests, provider/credential
  calls or product source changes. Process inspection found no app, PostgreSQL,
  Chrome or agent-browser process. Evidence:
  `/tmp/orgward-t28-rendered-proof-20260930-stop-summary.txt`. PR-07 remains
  first open; task checkboxes, cursor and release ledger remain unchanged.
