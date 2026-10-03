import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../../server.mjs';

async function request(base, route, options = {}, status = 200) {
  const response = await fetch(`${base}${route}`, { ...options, headers: { 'content-type': 'application/json', 'x-orgward-tenant': 'execution-test', ...(options.headers ?? {}) } });
  const value = await response.json();
  assert.equal(response.status, status, JSON.stringify(value));
  return value;
}

test('execution HTTP surface enforces approval and exposes generated artifacts', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-execution-api-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = createApp({
    dataDirectory: path.join(root, 'projects'), sdlcDirectory: path.join(root, 'sdlc'),
    executionDirectory: path.join(root, 'runs'), executionWorkspaceDirectory: path.join(root, 'workspaces'), enableLocalExecution: true,
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => app.server.close(resolve)));
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const meta = await request(base, '/api/execution/meta');
  assert.equal(meta.productionReady, false);
  assert.deepEqual(meta.profiles.map((entry) => entry.id), ['scaffold-node-service']);
  const forgedLinkedRun = await request(base, '/api/execution/runs', {
    method: 'POST',
    body: JSON.stringify({
      profileId: 'scaffold-node-service', requestedBy: 'developer',
      title: 'Forged linked run', objective: 'Attempt caller-selected task linkage',
      processTaskRef: { processPlanId: 'process-plan-forged', revision: 1, planInstanceId: '00000000-0000-4000-8000-000000000001', taskId: 'task-forged' },
    }),
  }, 400);
  assert.equal(forgedLinkedRun.code, 'INVALID_COMMAND');
  const forgedProposalContext = await request(base, '/api/execution/runs', {
    method: 'POST', body: JSON.stringify({
      profileId: 'scaffold-node-service', requestedBy: 'developer',
      title: 'Forged proposal', objective: 'Attempt caller-selected source envelope',
      proposalContext: { sourceEnvelope: { sources: [] } },
    }),
  }, 400);
  assert.equal(forgedProposalContext.code, 'INVALID_COMMAND');
  assert.deepEqual((await request(base, '/api/execution/runs')).runs, []);
  let run = await request(base, '/api/execution/runs', { method: 'POST', body: JSON.stringify({ profileId: 'scaffold-node-service', requestedBy: 'developer', title: 'Create catalog service', objective: 'Create a catalog API', requirements: ['health check'] }) }, 201);
  await request(base, `/api/execution/runs/${run.id}/execute`, { method: 'POST', body: JSON.stringify({ version: run.version, principal: 'worker' }) }, 400);
  run = await request(base, `/api/execution/runs/${run.id}/approve`, { method: 'POST', body: JSON.stringify({ version: run.version, principal: 'governor', roles: ['execution-approver'] }) });
  run = await request(base, `/api/execution/runs/${run.id}/execute`, { method: 'POST', body: JSON.stringify({ version: run.version, principal: 'worker' }) });
  assert.equal(run.status, 'SUCCEEDED');
  assert.ok(run.execution.changedArtifacts.length >= 6);
  assert.equal(run.execution.workspace, undefined);
  assert.equal(run.execution.workspaceRef, `workspace:${run.id}`);
  assert.equal((await request(base, '/api/execution/runs')).runs.length, 1);
  await request(base, `/api/execution/runs/${run.id}`, { headers: { 'x-orgward-tenant': 'other-tenant' } }, 404);
  const sourcePath = 'src/server.mjs';
  const artifactResponse = await fetch(`${base}/api/execution/runs/${run.id}/artifact?path=${encodeURIComponent(sourcePath)}`, {
    headers: { 'x-orgward-tenant': 'execution-test' },
  });
  assert.equal(artifactResponse.status, 200);
  const artifactBody = await artifactResponse.text();
  assert.match(artifactBody, /createServer/);
  assert.equal(artifactResponse.headers.get('cache-control'), 'private, no-store');
  assert.equal(artifactResponse.headers.get('x-content-sha256'), run.execution.changedArtifacts.find((entry) => entry.path === sourcePath).contentHash);
  assert.equal(artifactResponse.headers.get('x-content-sha256'), createHash('sha256').update(artifactBody).digest('hex'));
  const hiddenArtifact = await fetch(`${base}/api/execution/runs/${run.id}/artifact?path=${encodeURIComponent(sourcePath)}`, {
    headers: { 'x-orgward-tenant': 'other-tenant' },
  });
  assert.equal(hiddenArtifact.status, 404);
  const traversal = await fetch(`${base}/api/execution/runs/${run.id}/artifact?path=${encodeURIComponent('../.orgward-context.json')}`);
  assert.equal(traversal.status, 404);
  await writeFile(path.join(root, 'workspaces', run.id, sourcePath), 'tampered after execution');
  const tampered = await fetch(`${base}/api/execution/runs/${run.id}/artifact?path=${encodeURIComponent(sourcePath)}`);
  assert.equal(tampered.status, 404);

  const ui = await fetch(`${base}/execution.html`);
  assert.equal(ui.status, 200);
  const executionHtml = await ui.text();
  assert.match(executionHtml, /Real executables and files/);
  assert.match(executionHtml, /id="process-instance-refresh-status"[^>]*aria-live="off"/);
  assert.doesNotMatch(executionHtml, /id="process-instance-refresh-status"[^>]*role="status"/,
    'the visible message does not create a second live announcement inside the aria-live=off main region');
  assert.match(executionHtml, /id="process-instance-announcement"[^>]*aria-live="polite"[^>]*aria-atomic="true"/,
    'process refresh statuses have a dedicated polite atomic live region outside the aria-live=off main');
  assert.doesNotMatch(executionHtml, /id="process-instance-announcement"[^>]*role=/,
    'the generic process live region avoids the status role that Orca classifies as a status bar');
  assert.match(executionHtml, /id="execution-announcement"[^>]*role="status"[^>]*aria-live="polite"/,
    'selected-run announcements retain their own separate polite live region');
  assert.match(executionHtml, /id="enterprise-design-nav" href="\/"/);
  const skipLinkStart = executionHtml.indexOf('<a id="execution-skip-link" class="execution-skip-link" href="#execution-main">');
  const headerStart = executionHtml.indexOf('<header class="topbar">');
  const executionMain = executionHtml.indexOf('<section id="execution-main" class="execution-main" tabindex="-1" aria-label="Execution content"');
  assert.ok(skipLinkStart >= 0 && skipLinkStart < headerStart, 'the first Execution focus stop is a skip link before product navigation');
  assert.ok(executionMain > headerStart, 'the skip link target is a programmatically focusable Execution content region');
  const executionMainClose = executionHtml.indexOf('</section>', executionMain);
  const processAnnouncement = executionHtml.indexOf('<div id="process-instance-announcement"');
  const detachedAnnouncement = executionHtml.indexOf('<div id="execution-announcement"');
  assert.ok(executionMainClose >= 0 && processAnnouncement > executionMainClose && detachedAnnouncement > processAnnouncement,
    'both process and selected-run live regions are outside the aria-live=off Execution main');
  assert.match(executionHtml, /id="execution-skip-link"[^>]*href="#execution-main"/);
  const onboardingHtmlResponse = await fetch(`${base}/index.html`);
  assert.equal(onboardingHtmlResponse.status, 200);
  const onboardingHtml = await onboardingHtmlResponse.text();
  assert.match(onboardingHtml, /id="github-installation-connect"/);
  assert.match(onboardingHtml, /Tenant-bound GitHub installation<select name="installationId"/,
    'the served onboarding UI selects installations already bound to the active tenant');
  assert.match(onboardingHtml, /Accessible repository<select name="repositoryId"[^>]*disabled/,
    'the served onboarding UI selects from installation-authorized repository metadata');
  assert.match(onboardingHtml, /id="github-installation-connect"[^>]*disabled/,
    'the served onboarding UI starts disabled until the server reports GitHub App configuration');
  const studioClient = await fetch(`${base}/app.js`);
  assert.equal(studioClient.status, 200);
  const studioSource = await studioClient.text();
  assert.match(studioSource, /github-installation\/start/);
  assert.match(studioSource, /github-installations\/\$\{encodeURIComponent\(installationId\)\}\/repositories\?projectId=/,
    'the served client loads repository choices for the selected tenant-bound installation');
  assert.match(studioSource, /repository\.fullName\}/,
    'repository options show the safe full name returned by the server');
  assert.match(studioSource, /new URLSearchParams\(location\.search\)\.get\('github_installation'\) === 'connected'/,
    'the served project return path detects a completed tenant-bound GitHub OAuth flow');
  assert.match(studioSource, /target: '_blank', rel: 'noopener noreferrer'/,
    'the GitHub flow opens separately and preserves unsent Studio work');
  const savedTaskPanel = executionHtml.indexOf('<div id="process-plans" aria-live="off"></div>');
  const graphCreationForm = executionHtml.indexOf('<form id="process-plan-form"');
  const standaloneRunForm = executionHtml.indexOf('<form id="run-form"');
  assert.ok(savedTaskPanel >= 0 && savedTaskPanel < graphCreationForm && graphCreationForm < standaloneRunForm,
    'existing saved process task cards are rendered before graph creation and standalone run forms in the served template');
  const executionClient = await fetch(`${base}/execution.js`);
  assert.equal(executionClient.status, 200);
  const executionSource = await executionClient.text();
  assert.match(executionSource, /Repeat fixed verification/,
    'saved GitHub candidates expose an explicit repeat-verification action');
  assert.match(executionSource, /A matching failed verifier remains failed/,
    'the served candidate review keeps a matched failing verifier visibly failed');
  assert.match(executionSource, /github-candidate-verification-repeats/,
    'repeat history and actions use the authenticated candidate-specific API');
  assert.match(executionSource, /Required-check status: \$\{statusLabel\}/,
    'the candidate panel scopes the displayed status to configured required checks');
  assert.match(executionSource, /receipt\.status === 'NOT_CONFIGURED'/,
    'candidates without an operator-owned build plan remain visibly unconfigured');
  assert.match(executionSource, /Build status: \$\{receipt\.status\}/,
    'build results use a scoped status instead of implying full T-31 completion');
  assert.match(executionSource, /two clean build output byte sets differ[\s\S]*Review both manifests and logs/,
    'a mismatched build gives the customer a concrete review and repair action');
  assert.match(executionSource, /builds\/\$\{buildRun\.artifactSetId\}/,
    'the review panel links to hash-checked output from each isolated build');
  assert.match(executionSource, /LEGACY INCOMPLETE T-31 COVERAGE/,
    'one-check legacy configuration cannot be presented as full T-31 coverage');
  assert.match(executionSource, /if \(candidate\.verification && !candidate\.checkPlan\)/,
    'planned checks hide the compatibility verifier summary that could mislabel aggregate output hashes');
  assert.match(executionSource, /Original verifier observation[\s\S]*Original result: \$\{originalOutcome\}[\s\S]*output hash \$\{verification\.outputHash\}/,
    'the candidate panel labels the original verifier status, exit code and output hash');
  assert.match(executionSource, /github-candidate-repeat-history[\s\S]*github-candidate-repeat-action-status/,
    'repeat action feedback and saved observation history use separate regions');
  assert.match(executionSource, /repeatActionStatus\.replaceChildren\(el\('p', \{ className: 'muted', text: 'Repeating[\s\S]*appendAttempt\(attempt\);[\s\S]*await loadAttempts\(\)/,
    'starting or completing a repeat updates action feedback and refreshes append-only history');
  assert.match(executionSource, /Comparison with original: \$\{comparison\}[\s\S]*Verifier result: \$\{outcome\}[\s\S]*Aggregate check output hash: \$\{verification\.outputHash/,
    'each repeat labels the aggregate hash for all check outputs');
  assert.doesNotMatch(executionSource, /repeatHistory\.replaceChildren\(/,
    'repeat actions never clear already loaded history');
  const instanceOptionLabelClient = await fetch(`${base}/process-instance-option-label.mjs`);
  assert.equal(instanceOptionLabelClient.status, 200);
  const instanceOptionLabelSource = await instanceOptionLabelClient.text();
  assert.match(instanceOptionLabelSource, /export function processInstanceOptionLabel/);
  assert.match(instanceOptionLabelSource, /export function orderProcessInstancesByLatestActivity/);
  assert.match(executionSource, /processInstanceOptionLabel\(instanceId, runtimes\)/,
    'saved instance selector labels use the served lifecycle and activity summary helper');
  assert.match(executionSource, /const orderedInstances = orderProcessInstancesByLatestActivity\(\[\.\.\.instances\.entries\(\)\]\)/,
    'the served selector orders instances from the same authorized runtime rows used for its default');
  assert.match(executionSource, /const latestInstance = orderedInstances\[0\]\?\.\[0\] \?\? 'new'/,
    'the latest activity option is the default-selected instance');
  const taskRequestHelper = await fetch(`${base}/process-task-request.mjs`);
  assert.equal(taskRequestHelper.status, 200);
  const taskRequestHelperSource = await taskRequestHelper.text();
  const humanStartHelper = await fetch(`${base}/human-task-start-recovery.mjs`);
  assert.equal(humanStartHelper.status, 200);
  const humanStartHelperSource = await humanStartHelper.text();
  const humanOutputHelper = await fetch(`${base}/human-task-output-application.mjs`);
  assert.equal(humanOutputHelper.status, 200);
  const humanOutputHelperSource = await humanOutputHelper.text();
  assert.match(executionSource, /renderHumanTaskOutputApplication\(\{ project, plan, task, runtime, output \}\)/,
    'the served process task row renders owner output review from its selected durable runtime');
  assert.match(executionSource, /proposalDesignLink\(project, \{ status: 'applied',[\s\S]*?objectId: disposition\.outputObjectId \}\)/,
    'the saved owner output link is derived from the validated applied event object');
  assert.match(executionSource, /Saved output reference: plan \$\{disposition\.planId\} revision \$\{disposition\.revision\}, task \$\{disposition\.taskId\}, instance \$\{disposition\.planInstanceId\}, event \$\{disposition\.eventId\}\.[\s\S]*?does not open a historical snapshot/,
    'the task result keeps its durable references visible and says the link opens current design');
  assert.match(executionSource, /text: designLink\.label, attrs: \{ href: designLink\.href \}/,
    'the expanded applied output disclosure renders the current design link');
  assert.match(executionSource, /Human evidence notes remain contextual provenance\. They will not be copied into this output or treated as validation\./);
  assert.match(executionSource, /human-task-outputs\/apply/);
  assert.match(executionSource, /retry sends the same command and payload/i);
  assert.match(humanOutputHelperSource, /event\.data\?\.planInstanceId === runtime\.planInstanceId/);
  assert.match(humanOutputHelperSource, /event\.data\?\.evidenceContextOnly === true/);
  assert.match(humanOutputHelperSource, /typeof event\.eventId === 'string'/,
    'saved output projection uses the actual persisted project-event identifier');
  assert.match(humanOutputHelperSource, /event\?\.id === appliedEvent\.data\.humanTaskEventId/,
    'saved output projection requires the referenced successful completion event in the exact runtime');
  assert.match(humanOutputHelperSource, /entry\.sourceEventHash === sourceEventHash && entry\.contentHash === outputContentHash/,
    'saved output projection matches checkpoint and output hashes across event and provenance');
  assert.match(humanOutputHelperSource, /kind: 'applied'/);
  assert.doesNotMatch(executionSource, /detail\.value\s*=\s*.*runtime\.evidence/,
    'human evidence cannot automatically populate owner-entered output detail');
  assert.match(executionSource, /if \(!state\.meta\?\.profiles\?\.length\) \{[\s\S]*?No execution profile is configured\. Ask an OrgWard administrator to configure one before requesting approval\.[\s\S]*?\} else if \(!profileOptions\.length\) \{[\s\S]*?No configured execution profile supports this task\. Model profiles need at least one input and one information output; add those to the task or ask an OrgWard administrator to configure a non-model profile\./,
    'the task request explains missing server profile configuration separately from task/profile incompatibility');
  assert.match(executionSource, /profileSelect\.disabled = requestPresentation\.locked/);
  assert.match(executionSource, /repositorySelect\.disabled = requestPresentation\.locked/);
  assert.match(executionSource, /profileSelect\.value = savedProfileId/);
  assert.match(executionSource, /repositorySelect\.value = savedRepository\.selectionId \?\? savedRepository\.id/);
  assert.match(executionSource, /Saved repository snapshot \$\{pendingRequest\.payload\.repositoryId \?\? pendingRequest\.payload\.githubSnapshotId\} · unavailable or changed/);
  assert.match(executionSource, /findPendingProcessTaskRequest\(processTaskIntentStorage\(\)/,
    'an accepted request remains findable if the selection changes to its concrete instance');
  assert.match(executionSource, /processTaskRequestPresentation\(pendingRequest, \{\s*submitting: isSubmittingTaskRequest, recoveringNewInstance,/,
    'a recovered uncertain new-instance command is clearly labeled and remains tied to its original intent');
  assert.match(taskRequestHelperSource, /Retry saved new-instance request[\s\S]*?not tied to the instance currently displayed/,
    'the served recovery helper explicitly distinguishes the original new-instance intent from the displayed instance');
  assert.match(executionSource, /const pendingHumanTaskStarts = syncHumanTaskStarts\(project, plan\)/,
    'the authorized task snapshot restores and reconciles persisted human starts before rendering actions');
  assert.match(executionSource, /humanTaskStartReconciled\(pending, \{ tenantId: project\.tenantId, principal: state\.currentPrincipal,[\s\S]*?instances: state\.taskInstances \}\)/,
    'start receipts clear only against the current tenant, principal and authorized task runtime snapshot');
  assert.match(executionSource, /It is not linked to the process instance selected above; retry retrieves the original server-created instance/,
    'new-instance recovery is attached to the task row and does not attribute an uncertain command to the selected instance');
  assert.match(humanStartHelperSource, /assignedToCurrentPrincipal !== true[\s\S]*?status: 'accepted'/,
    'a saved start is accepted only when its response confirms in-progress work for the current assigned human');
  const humanStartHandler = executionSource.slice(executionSource.indexOf('async function startHumanTask'), executionSource.indexOf('async function completeHumanTask'));
  assert.match(humanStartHandler, /saveHumanTaskStart[\s\S]*?const runtime = await api\('\/api\/execution\/process-task-instances\/start'[\s\S]*?pending\.commandId, payload: pending\.payload[\s\S]*?acceptHumanTaskStart[\s\S]*?saveHumanTaskStart[\s\S]*?await refresh\(\)/,
    'start stores and replays the exact command, then retains its accepted receipt through refresh');
  assert.match(humanStartHandler, /if \(definitiveHumanTaskStartRejection\(error\)\)[\s\S]*?state\.pendingHumanTaskCommands\.delete\(key\)[\s\S]*?clearHumanTaskStart\(processTaskIntentStorage\(\), storageKeyFor\(pending\)\)/,
    'a definitive non-retryable 4xx rejection clears only its rejected start command and storage receipt');
  assert.match(humanStartHandler, /if \(state\.pendingHumanTaskCommands\.get\(key\)\?\.status === 'accepted'\)[\s\S]*?retry it to reconcile/,
    'an accepted receipt remains available through refresh failure until snapshot reconciliation');
  assert.match(executionSource, /role: 'status', 'aria-live': 'polite'/,
    'saved and uncertain request state is announced accessibly');
  const taskRequestHandler = executionSource.slice(executionSource.indexOf('async function requestTaskApproval'), executionSource.indexOf('function openPlanEditor'));
  assert.match(taskRequestHandler, /const accepted = acceptProcessTaskRequest\(pending, run\)[\s\S]*?savePendingProcessTaskRequest[\s\S]*?const refreshed = await refresh\(\)/,
    'the exact accepted receipt remains persisted until the follow-up snapshot is checked');
  const acceptedReceiptPath = taskRequestHandler.slice(taskRequestHandler.indexOf('const run = await api'), taskRequestHandler.indexOf('} catch (error)'));
  assert.doesNotMatch(acceptedReceiptPath, /clearPendingProcessTaskRequest/,
    'the accepted-request path does not discard its receipt before authoritative reconciliation');
  assert.match(executionSource, /reconcileAcceptedProcessTaskRequests\(state\.runs, state\.taskInstances, state\.planningProject\.id\)/,
    'the initial authorized refresh can clear only a linked task request confirmed in both snapshots');
  assert.match(executionSource, /reconciledSavedProcessTaskRequests\(processTaskIntentStorage\(\), \{[\s\S]*?tenantId: state\.planningProject\?\.tenantId, principal: state\.currentPrincipal/,
    'reload reconciles saved accepted requests for the exact active tenant and principal against the first authorized snapshots');
  assert.match(executionSource, /processTaskRequestReconciled\(pending, \{ runs, instances \}\)/,
    'cross-session refresh reconciliation uses the exact run and task snapshots');
  assert.match(executionSource, /el\('summary', \{ text: view\.disclosureSummary \}\)/,
    'the collapsed assignment disclosure uses the safe actor-selection and enabled-target summary');
  assert.match(executionSource, /setInterval\(\(\) => \{\s*void refreshProcessInstancesFromOtherSessions\(\);\s*void refreshSelectedRunFromOtherSessions\(\);\s*\}, 15000\)/);
  assert.match(executionSource, /document\.addEventListener\('visibilitychange'/);
  assert.match(executionSource, /void refreshSelectedRunFromOtherSessions\(\);/);
  assert.match(executionSource, /event\.target\?\.closest\?\.\('#execution-main'\)\) setTimeout\(retryDeferredSelectedRun, 0\)/);
  assert.match(executionSource, /api\(`\/api\/execution\/runs\/\$\{encodeURIComponent\(runId\)\}`\)/,
    'selected-run freshness uses the existing authenticated read endpoint without a mutation method');
  assert.match(executionSource, /isCurrentSelectedRunRefresh\(\{ requestId, currentRequestId: selectedRunRefreshRequestId,[\s\S]*?routeProjectId: route\.searchParams\.get\('project'\) \|\| null \}\)/);
  assert.match(executionSource, /selectedRunStatusAnnouncement\(state\.run, nextRun\)/);
  assert.match(executionSource, /api\(`\/api\/execution\/process-task-instances\?projectId=\$\{encodeURIComponent\(projectId\)\}`\)/);
  assert.match(executionSource, /Promise\.allSettled\(\[[\s\S]*?api\(`\/api\/v1\/projects\/\$\{encodeURIComponent\(projectId\)\}`\)[\s\S]*?\]\)/,
    'cross-session refresh reads the current authorized project snapshot alongside runtime state');
  assert.match(executionSource, /if \(processRead\.status === 'rejected'\) throw processRead\.reason/,
    'a failed project read does not discard a successful process activity read');
  assert.match(executionSource, /projectRead\.status === 'fulfilled' && projectRead\.value\?\.data\?\.id === projectId[\s\S]*?: state\.planningProject/,
    'project-read failure retains the currently selected project snapshot while runtime refresh proceeds');
  assert.match(executionSource, /if \(projectRefreshUnavailable\) noteProjectRefreshUnavailable\(\)/,
    'unavailable design status remains visible even when process snapshots did not change');
  assert.match(executionSource, /Project design update status could not be refreshed; process activity can still refresh/);
  assert.match(executionSource, /projectRead\.value\?\.data\?\.id === projectId/,
    'a project snapshot is accepted only when it matches the selected project');
  assert.match(executionSource, /applyCrossSessionProcessInstances\(result\.instances,[\s\S]*?projectSnapshot, routeKey, projectRefreshUnavailable\)/,
    'the selected project snapshot reaches guarded task-card rendering');
  assert.match(executionSource, /state\.planningProject = projectSnapshot/,
    'event-only project changes update task-row proposal application state');
  assert.match(executionSource, /result\.runs \?\? \[\]/, 'the authorized process refresh applies the linked run snapshot with its runtime and plans');
  assert.match(executionSource, /routeKey,[\s\S]*?currentRouteKey: `\$\{window\.location\.pathname\}\$\{window\.location\.search\}`/);
  const processRefreshApplyStart = executionSource.indexOf('function applyCrossSessionProcessInstances');
  const processRefreshApplyEnd = executionSource.indexOf('async function refreshProcessInstancesFromOtherSessions', processRefreshApplyStart);
  assert.ok(processRefreshApplyStart >= 0 && processRefreshApplyEnd > processRefreshApplyStart);
  const processRefreshApplySource = executionSource.slice(processRefreshApplyStart, processRefreshApplyEnd);
  assert.match(processRefreshApplySource, /currentRuns: state\.runs\.filter/);
  assert.match(processRefreshApplySource, /state\.runs = \[\.\.\.state\.runs\.filter/);
  assert.match(processRefreshApplySource, /runLink\?\.querySelector\('\.run-link-status'\)/);
  assert.doesNotMatch(processRefreshApplySource, /renderList\(\)/, 'refresh updates run-list status in place without replacing focused links');
  assert.match(executionSource, /if \(event\.target\?\.closest\?\.\('#process-plans'\)\) setTimeout\(retryDeferredProcessInstances, 0\)/);
  assert.match(executionSource, /item\.append\(el\('p', \{ className: 'provider-outcome-diagnostic', text: resultSummary\.diagnostic \}\)\)/,
    'unknown delivery warning is visible outside collapsed saved-result details');
  assert.match(executionSource, /el\('summary', \{ text: resultSummary\.summaryLabel \}\)/,
    'the collapsed linked-result disclosure exposes the safe status and bounded artifact count');
  assert.match(executionSource, /resultSummary\.failureGuidance && !resultSummary\.diagnostic[\s\S]*?resultSummary\.providerDiagnostic\?\.outcome !== 'outcome_unknown'/,
    'the safe failure next step appears in expanded details without overriding uncertain-provider guidance');
  assert.match(executionSource, /className: 'linked-task-failure-guidance', text: resultSummary\.failureGuidance\.nextStep/);
  assert.match(executionSource, /uncertainDelivery: uncertainBlockedDependency/);
  const processTaskRecoveryClient = await fetch(`${base}/process-task-recovery.mjs`);
  assert.equal(processTaskRecoveryClient.status, 200);
  const processTaskRecoverySource = await processTaskRecoveryClient.text();
  assert.match(processTaskRecoverySource, /Reconcile the provider outcome before deciding whether to start a new process instance/);
  assert.match(processTaskRecoverySource, /Start a new process instance from the first task to retry the workflow/);
  assert.match(processTaskRecoverySource, /uncertainDelivery\) return \{ kind: 'reconcile' \}/);
  assert.match(processTaskRecoverySource, /action\?\.kind !== 'select-new-instance'/);
  assert.match(executionSource, /canStartNewInstance: canStartNewInstances && entries\.at\(-1\)\?\.revision === plan\.revision[\s\S]*?project\.latestBlueprint\?\.version === plan\.source\.blueprintVersion/,
    'the fresh-instance action is hidden for historical plans and stale blueprint pins');
  assert.match(executionSource, /if \(!selectFreshProcessTaskInstance\(state\.selectedPlanInstances, instanceKey, recoveryAction\)\) return;\s*syncExecutionRoute\(project\.id, null\);\s*renderProcessPlans\(container, plans, project\);/,
    'the recovery action only switches the selected instance and rerenders, without starting work');
  assert.match(executionSource, /planCard\?\.querySelector\('select\[aria-label\^="Process instance for"\]'\)\?\.focus\(\)/,
    'focus returns to the selected plan instance control after the rerender');
  assert.match(executionSource, /for \(const \[instanceId, runtimes\] of orderedInstances\)/,
    'existing instance options render newest activity first and remain available after selecting a fresh instance');
  assert.match(executionSource, /data-run-link-id': run\.id/);
  assert.match(executionSource, /selectedRunLink\?\.querySelector\('\.run-link-status'\)/);
  const selectedRunApplyStart = executionSource.indexOf('function applySelectedRunSnapshot');
  const selectedRunApplyEnd = executionSource.indexOf('async function refreshSelectedRunFromOtherSessions', selectedRunApplyStart);
  assert.ok(selectedRunApplyStart >= 0 && selectedRunApplyEnd > selectedRunApplyStart);
  assert.doesNotMatch(executionSource.slice(selectedRunApplyStart, selectedRunApplyEnd), /renderList\(\)/,
    'background refresh updates the selected row in place and preserves run-list focus');
  assert.match(executionSource, /if \(announcement\) executionAnnouncement\.textContent = announcement/);
  const selectedRunRefreshClient = await fetch(`${base}/selected-run-refresh.mjs`);
  assert.equal(selectedRunRefreshClient.status, 200);
  const selectedRunRefreshSource = await selectedRunRefreshClient.text();
  assert.match(selectedRunRefreshSource, /export function isCurrentSelectedRunRefresh/);
  assert.match(selectedRunRefreshSource, /export function selectedRunRefreshDisposition/);
  assert.match(selectedRunRefreshSource, /export function selectedRunStatusAnnouncement/);
  assert.match(selectedRunRefreshSource, /export function selectedRunRefreshMessage/);
  assert.match(executionSource, /processInstanceRefreshDisposition\(\{ currentInstances: state\.taskInstances,[\s\S]*?currentRuns: state\.runs\.filter\(\(run\) => run\.projectId === projectId\), nextRuns: projectRuns,[\s\S]*?currentProject: state\.planningProject, nextProject: projectSnapshot,[\s\S]*?container: plans, documentRef: document \}\)/);
  assert.match(executionSource, /if \(disposition === 'unchanged'\) \{[\s\S]*?applySettledProcessInstanceCommands/);
  const refreshClient = await fetch(`${base}/process-instance-refresh.mjs`);
  assert.equal(refreshClient.status, 200);
  const processRefreshSource = await refreshClient.text();
  assert.match(processRefreshSource, /scheduleLiveRegionAnnouncement/);
  assert.match(processRefreshSource, /cancelLiveRegionAnnouncement/);
  assert.match(processRefreshSource, /export function updateProcessInstanceRefreshStatus/);
  assert.match(processRefreshSource, /previousRuns = \[\], nextRuns = \[\]/);
  assert.match(processRefreshSource, /function sameProjectSnapshot/);
  assert.match(processRefreshSource, /currentProject = null, nextProject = null/);
  assert.match(processRefreshSource, /snapshotProjectId === undefined \|\| snapshotProjectId === projectId/);
  assert.match(processRefreshSource, /Outcome unknown\. An external request may have been received\. Delivery is unverified\. Reconcile with the provider before retrying\./);
  assert.match(processRefreshSource, /if \(!previous\) continue/);
  assert.match(executionSource, /processInstanceStatusAnnouncement\(state\.taskInstances, instances, processPlansFor\(projectSnapshot\),\s*currentProjectRuns, projectRuns\)/);
  assert.match(executionSource, /function setProcessRefreshStatus\(message\) \{[\s\S]*?updateProcessInstanceRefreshStatus\(\{ visibleRegion: document\.querySelector\('#process-instance-refresh-status'\),\s*liveRegion: processInstanceAnnouncement \}, message, \{\s*isCurrent:/,
    'process refresh copy stays visible and is sent to its dedicated detached polite region');
  assert.match(executionSource, /skipBlockedAnnouncement: Boolean\(announcement\)/,
    'the cross-session status/outcome message replaces the duplicate blocked-task live announcement');
  const runTransitionFocusClient = await fetch(`${base}/run-transition-focus.mjs`);
  assert.equal(runTransitionFocusClient.status, 200);
  const runTransitionFocusSource = await runTransitionFocusClient.text();
  assert.match(runTransitionFocusSource, /event\?\.isTrusted === true && event\.detail === 0/);
  assert.match(executionSource, /isRunActionKeyboardActivation\(event, button, document\)/);
  assert.match(executionSource, /restoreRunTransitionFocus\(\{/);
  assert.match(executionSource, /data-run-status-focus-target/);
  assert.match(executionSource, /executionRunRouteTarget\(window\.location\.href, state\.runs\)/);
  assert.match(executionSource, /syncExecutionRunRoute\(state\.run\)/);
  assert.match(executionSource, /action: 'open-run'/);
  assert.match(executionSource, /Open linked run \$\{linkedRun\.id\.slice\(-8\)\}/);
  assert.match(executionSource, /linkedRunActivityLabel\(linkedRun\)/,
    'linked task rows render activity labels from the saved run lifecycle status');
  const linkedRunActivityClient = await fetch(`${base}/linked-run-activity.mjs`);
  assert.equal(linkedRunActivityClient.status, 200);
  assert.match(await linkedRunActivityClient.text(), /Approval request \$\{run\.id\} · Awaiting approval/);
  const sharedInteractions = await fetch(`${base}/shared-interactions.mjs`);
  assert.equal(sharedInteractions.status, 200);
  const sharedInteractionsSource = await sharedInteractions.text();
  assert.match(sharedInteractionsSource, /export function executionRunRouteTarget/);
  assert.match(sharedInteractionsSource, /process-plan-\[0-9a-f-\]\{36\}\|software-delivery-/);
  assert.match(executionSource, /focusEvent\.target !== document\.body && focusEvent\.target !== button/);
  const runFocusCss = await (await fetch(`${base}/execution.css`)).text();
  assert.match(runFocusCss, /\.run-status:focus-visible\s*\{\s*outline: 3px solid var\(--exec\)/);
  const taskAnnouncementClient = await fetch(`${base}/process-task-announcement.mjs`);
  assert.equal(taskAnnouncementClient.status, 200);
  const taskAnnouncementSource = await taskAnnouncementClient.text();
  assert.match(taskAnnouncementSource, /PROCESS_TASK_ANNOUNCEMENT_DELAY_MS = 500/);
  assert.match(taskAnnouncementSource, /export function scheduleLiveRegionAnnouncement/);
  assert.match(taskAnnouncementSource, /export function cancelLiveRegionAnnouncement/);
  const humanTaskFocusClient = await fetch(`${base}/human-task-status-focus.mjs`);
  assert.equal(humanTaskFocusClient.status, 200);
  assert.match(await humanTaskFocusClient.text(), /documentRef\.activeElement !== documentRef\.body/);
  assert.ok(executionSource.includes('scheduleProcessTaskAnnouncement'), 'blocked-task updates retain their delayed announcer');
  assert.match(executionSource, /function setProcessRefreshStatus\(message\) \{[\s\S]*?updateProcessInstanceRefreshStatus\(\{ visibleRegion: document\.querySelector\('#process-instance-refresh-status'\),\s*liveRegion: processInstanceAnnouncement \}, message, \{[\s\S]*?isCurrent:/,
    'process refresh messages use the independent delayed live region with a current project/route guard');
  assert.ok(executionSource.includes('restoreHumanTaskStatusFocusAfterAction'), 'successful human actions restore focus after refresh');
  assert.match(executionSource, /linkedProcessTaskResult\(runtime, linkedRun, project\)/);
  assert.match(executionSource, /el\('details', \{ className: 'linked-process-task-result', attrs:/);
  assert.match(executionSource, /text: resultSummary\.summaryLabel/);
  assert.match(executionSource, /captureExpandedSavedTaskResultKeys\([\s\S]*?container\.replaceChildren\(\)/,
    'plan rerenders snapshot expanded saved-result disclosures before replacing their cards');
  assert.match(executionSource, /captureFocusedSavedTaskResult\(savedTaskResultDetails, document\.activeElement\)/,
    'plan rerenders capture focus inside the saved-result disclosure before replacing cards');
  assert.match(executionSource, /restoreSavedTaskResultOpen\(disclosureKey, expandedSavedTaskResults\)/);
  assert.match(executionSource, /restoreFocusedSavedTaskResult\(focusedSavedTaskResult,[\s\S]*?container\.querySelectorAll\('details\[data-saved-task-result-key\]'\)\)/,
    'plan rerenders restore the same saved-result summary or action link after building replacement cards');
  assert.match(executionSource, /'data-saved-task-result-key': disclosureKey/);
  const savedTaskResultDisclosureClient = await fetch(`${base}/saved-task-result-disclosure.mjs`);
  assert.equal(savedTaskResultDisclosureClient.status, 200);
  const savedTaskResultDisclosureSource = await savedTaskResultDisclosureClient.text();
  assert.match(savedTaskResultDisclosureSource, /JSON\.stringify\(\[projectId, runId\]\)/);
  assert.match(savedTaskResultDisclosureSource, /detail\?\.open === true/);
  assert.match(savedTaskResultDisclosureSource, /activeElement\.tagName === 'SUMMARY'/);
  assert.match(savedTaskResultDisclosureSource, /activeElement\.tagName === 'A'/);
  assert.match(savedTaskResultDisclosureSource, /target\.focus\(\{ preventScroll: true \}\)/);
  assert.match(executionSource, /Saved output preview:/);
  assert.match(executionSource, /resultSummary\.proposalPreview\?\.kind === 'proposal'/);
  assert.match(executionSource, /if \(preview\.designLink\) disclosure\.append\(el\('a', \{[\s\S]*?text: preview\.designLink\.label, attrs: \{ href: preview\.designLink\.href \}/,
    'the expanded saved task proposal disclosure renders its validated current-design link');
  assert.match(executionSource, /text: `Proposed detail: \$\{preview\.proposedDetail\}`/);
  assert.match(executionSource, /modelUsagePresentation\(proposal\.modelUsage\)/);
  assert.match(executionSource, /modelUsagePresentation\(execution\.modelUsage\)/);
  assert.match(executionSource, /className: 'muted model-usage'/);
  const modelUsageCss = await (await fetch(`${base}/execution.css`)).text();
  assert.match(modelUsageCss, /\.evidence-grid > \.model-usage \{ grid-column: 1 \/ -1; margin: 0; \}/);
  assert.match(executionSource, /linked-task-artifacts/);
  assert.match(executionSource, /These checks verify proposal structure and pinned references\. They do not assess factual accuracy, source grounding, or provider quality\./);
  assert.match(executionSource, /evaluation\.status === 'passed' \? 'passed' : 'blocked'/);
  assert.ok(executionSource.includes('/artifact?path=${encodeURIComponent(artifact.relativePath)}'));
  assert.ok(executionSource.includes('Download ${artifact.displayName} · ${artifact.hashPrefix}…'));
  const linkedTaskResultClient = await fetch(`${base}/linked-process-task-result.mjs`);
  assert.equal(linkedTaskResultClient.status, 200);
  const linkedTaskResultSource = await linkedTaskResultClient.text();
  assert.match(linkedTaskResultSource, /export function modelUsagePresentation\(usage\)/);
  assert.match(linkedTaskResultSource, /Reported model usage:/);
  assert.match(linkedTaskResultSource, /Provider dispatch outcome is uncertain; token usage remains unreported and cost is unknown/);
  assert.match(linkedTaskResultSource, /Structured proposal unavailable\. Open the linked run for details\./);
  assert.match(linkedTaskResultSource, /Review-only proposed update\. Applying it is a separate versioned owner action\./);
  assert.match(linkedTaskResultSource, /project\?\.id === run\.projectId/);
  assert.match(linkedTaskResultSource, /event\.data\?\.runId === run\.id && event\.data\?\.proposalHash === proposal\.proposalHash/);
  assert.match(linkedTaskResultSource, /Number\.isSafeInteger\(event\.data\?\.appliedBlueprintVersion\)/);
  assert.match(linkedTaskResultSource, /objectId: applyEvent\.data\.objectId === proposal\.target\.id \? proposal\.target\.id : null/);
  assert.match(linkedTaskResultSource, /proposalDesignLink\(project, \{/);
  assert.match(linkedTaskResultSource, /This created a proposed design version; it did not execute work/);
  assert.match(linkedTaskResultSource, /runtime\.projectId !==/);
  assert.match(linkedTaskResultSource, /run\.id !== runtime\.executionRunId/);
  assert.match(linkedTaskResultSource, /deepSeekOutcomeDiagnosticCopy/);
  assert.match(linkedTaskResultSource, /failureGuidanceByCategory/);
  assert.match(linkedTaskResultSource, /typeof category === 'string' && Object\.hasOwn\(failureGuidanceByCategory, category\)/,
    'unknown stored failure categories use the generic next step without inherited object properties');
  assert.match(linkedTaskResultSource, /The run failed without a recognized failure category/);
  assert.match(linkedTaskResultSource, /run\.linkedOutcomeCategory/);
  assert.match(linkedTaskResultSource, /\['FAILED', 'INTERRUPTED'\]\.includes\(run\.status\).*outcome_unknown/s);
  assert.match(linkedTaskResultSource, /stdout\.slice\(0, 280\)/);
  assert.match(linkedTaskResultSource, /proposal\.sourceEnvelopeHash !== context\.sourceEnvelopeHash/);
  assert.match(linkedTaskResultSource, /proposal\.proposalHash \?\? ''/);
  assert.match(linkedTaskResultSource, /envelopeMatches = JSON\.stringify\(proposal\.sourceEnvelope\) === JSON\.stringify\(context\.sourceEnvelope\)/);
  assert.match(linkedTaskResultSource, /MAX_ARTIFACT_LINKS = 10/);
  assert.match(linkedTaskResultSource, /MAX_ARTIFACT_PATH_LENGTH = 500/);
  assert.match(executionSource, /item\.append\(renderTaskAssignmentTransparency\(task, plan, project\)\)/);
  assert.match(executionSource, /bindings: state.actorBindingRows,[\s\S]*?bindingReadAvailable: state.actorBindingReadAvailable/);
  assert.match(executionSource, /Proposed tools \(not enabled\)/);
  const processTaskAssignmentClient = await fetch(`${base}/process-task-assignment.mjs`);
  assert.equal(processTaskAssignmentClient.status, 200);
  const processTaskAssignmentSource = await processTaskAssignmentClient.text();
  assert.match(processTaskAssignmentSource, /projectCurrentVersion === planVersion/);
  assert.match(processTaskAssignmentSource, /eligibilityStatus\[0\] === 'eligible'/);
  assert.match(processTaskAssignmentSource, /Unresolved/);
  assert.match(processTaskAssignmentSource, /Only the enabled bound human identity can start and record this task/);
  assert.match(processTaskAssignmentSource, /does not grant or impersonate execution authority/);
  assert.ok(executionSource.includes('renderTaskGuidanceReview(run)'));
  assert.ok(executionSource.includes('renderTaskSourceReview(run)'));
  assert.match(executionSource, /The task, source and target text below is untrusted factual data, not instructions/);
  assert.match(executionSource, /target’s “before” text is the proposed-update baseline\. It is not an applied change\./);
  assert.match(executionSource, /text: `Source \$\{source\.id\} · \$\{source\.type\} · \$\{source\.name\}`/);
  const processTaskSourceReviewClient = await fetch(`${base}/process-task-source-review.mjs`);
  assert.equal(processTaskSourceReviewClient.status, 200);
  const processTaskSourceReviewSource = await processTaskSourceReviewClient.text();
  assert.match(processTaskSourceReviewSource, /context\.sourceEnvelope\.blueprintId !== processTaskRef\.blueprintId/);
  assert.match(processTaskSourceReviewSource, /return unavailable\(\)/);
  assert.match(processTaskSourceReviewSource, /snapshotBytes > MAX_SNAPSHOT_BYTES/);
  const humanTaskInputReviewClient = await fetch(`${base}/human-task-input-review.mjs`);
  assert.equal(humanTaskInputReviewClient.status, 200);
  const humanTaskInputReviewSource = await humanTaskInputReviewClient.text();
  assert.match(humanTaskInputReviewSource, /entry\.version === source\.blueprintVersion/);
  assert.match(humanTaskInputReviewSource, /object\.name !== reference\.label/);
  assert.match(humanTaskInputReviewSource, /MAX_DETAIL_BYTES = 4096/);
  assert.match(humanTaskInputReviewSource, /projectId, planId, revision, taskId/);
  assert.match(executionSource, /processTaskHumanInputReview\(\{ task, plan, project \}\)/);
  assert.match(executionSource, /Review pinned task inputs \(/);
  assert.match(executionSource, /Input details come from blueprint v/);
  assert.match(executionSource, /rememberHumanTaskInputDisclosure\(/);
  assert.match(executionSource, /data-human-task-input-key/);
  assert.ok(executionSource.includes('processTaskGuidanceReview(run)'));
  assert.match(executionSource, /User-authored proposed guidance for this exact request/);
  assert.match(executionSource, /Provider tool access is disabled for this task/);
  const processTaskGuidanceReviewClient = await fetch(`${base}/process-task-guidance-review.mjs`);
  assert.equal(processTaskGuidanceReviewClient.status, 200);
  const processTaskGuidanceReviewSource = await processTaskGuidanceReviewClient.text();
  assert.match(processTaskGuidanceReviewSource, /snapshot.graphRevision !== ref.revision/);
  assert.match(processTaskGuidanceReviewSource, /current editable role text is not added/);
  assert.match(executionSource, /deepSeekOutcomeDiagnosticCopy\(execution\.providerDiagnostic\)/);
  const providerDiagnosticClient = await fetch(`${base}/provider-outcome-diagnostic.mjs`);
  assert.equal(providerDiagnosticClient.status, 200);
  const providerDiagnosticSource = await providerDiagnosticClient.text();
  assert.match(providerDiagnosticSource, /value\.httpStatus >= 100 && value\.httpStatus <= 599/);
  assert.match(providerDiagnosticSource, /invalid_json.*body_too_large.*incomplete_response.*missing_output_text/s);
  assert.match(providerDiagnosticSource, /Delivery remains unverified; this run cannot be retried/);
  assert.match(providerDiagnosticSource, /const credentialGuidance = diagnostic\?\.httpStatus === 401[\s\S]*administrator should check and verify the saved provider credential/,
    '401 guidance asks an administrator to check the saved credential without asserting its cause');
  const diagnosticDetailsIndex = providerDiagnosticSource.indexOf('${safeDetails ?');
  const credentialGuidanceIndex = providerDiagnosticSource.indexOf('${credentialGuidance}', diagnosticDetailsIndex);
  const reconciliationCopyIndex = providerDiagnosticSource.indexOf('An external request may have been received.', credentialGuidanceIndex);
  assert.ok(diagnosticDetailsIndex >= 0 && credentialGuidanceIndex > diagnosticDetailsIndex
    && reconciliationCopyIndex > credentialGuidanceIndex,
  'safe diagnostic details and optional 401 credential guidance precede fixed reconciliation copy');
  assert.match(executionSource, /blueprint agent binding is recorded for traceability/);
  assert.match(executionSource, /does not execute as or impersonate the bound workload identity/);
  assert.match(executionSource, /Escalate to project owner/);
  assert.match(executionSource, /canResolveEscalation/);
  assert.match(executionSource, /process-task-instances\/\$\{action\}/);
  assert.match(executionSource, /Pause process instance/);
  assert.match(executionSource, /Resume process instance/);
  assert.match(executionSource, /Cancel process instance/);
  assert.match(executionSource, /instanceControl\.canCancel === true/);
  assert.match(executionSource, /process instance is cancelled/i);
  assert.match(executionSource, /The parent process instance was cancelled before this task started/i);
  const taskRequestRenderingStart = executionSource.indexOf('const assignment = currentTaskAssignment');
  const taskRequestRenderingEnd = executionSource.indexOf('if (!profileOptions.length)', taskRequestRenderingStart);
  const taskRequestRendering = executionSource.slice(taskRequestRenderingStart, taskRequestRenderingEnd);
  assert.ok(taskRequestRendering.indexOf("if (selectedInstance !== 'new' && blockedDependencyText)")
    < taskRequestRendering.indexOf('if (!assignment.available)'),
  'the terminal dependency recovery instruction stays visible even when task assignment is unavailable');
  assert.match(executionSource, /ExecutionCancelledByProcessInstanceController/);
  assert.match(executionSource, /completed outcomes and evidence remain/i);
  assert.match(executionSource, /no further task work can start/i);
  assert.match(executionSource, /in-flight tasks settle/);
  assert.match(executionSource, /fresh independent approval/);
  assert.match(executionSource, /Instance control history/);
  assert.match(executionSource, /OrgWard-local attempt reference/);
  assert.match(executionSource, /not a provider request ID; proves neither receipt nor completion/);
  assert.match(executionSource, /task\.attemptStatus === 'outcome_unknown'/);
  assert.match(executionSource, /instanceControl\.canControl === true/);
  assert.match(executionSource, /Only the instance initiator or a current project owner can control this process/);
  assert.match(executionSource, /instanceControl\.canRecover === true/);
  assert.match(executionSource, /Reason for owner recovery/);
  assert.match(executionSource, /The old model output is unverified/);
  assert.match(executionSource, /may have incurred cost/);
  assert.match(executionSource, /fresh independent approval/);
  assert.match(executionSource, /acknowledgeDuplicateCostWork/);
  assert.match(executionSource, /process-task-instances\/abandon-unverified/);
  assert.match(executionSource, /submitInstanceControl\(/);
  assert.match(executionSource, /refreshAfterProcessInstanceControl/);
  assert.match(executionSource, /applySettledProcessInstanceCommands\(\{ disposition, pendingCommands: state\.pendingInstanceCommands/);
  assert.match(executionSource, /processInstanceControlHistoryEntries\(instanceControl\.events\)/);
  const instanceHistoryClient = await fetch(`${base}/process-instance-history.mjs`);
  assert.equal(instanceHistoryClient.status, 200);
  const instanceHistorySource = await instanceHistoryClient.text();
  assert.match(instanceHistorySource, /authorized controller/);
  assert.match(instanceHistorySource, /ProcessTaskInstanceCancelled/);
  const instanceControlClient = await fetch(`${base}/process-instance-control.mjs`);
  assert.equal(instanceControlClient.status, 200);
  const instanceControlSource = await instanceControlClient.text();
  assert.match(instanceControlSource, /submitProcessInstanceControl/);
  assert.match(instanceControlSource, /current process state could not be refreshed/);
  assert.match(instanceControlSource, /applySettledProcessInstanceCommands/);
  assert.match(executionSource, /instanceControl\.canAbandonUnverified === true/);
  assert.match(executionSource, /ABANDONED_UNVERIFIED/);
  assert.match(executionSource, /humanTaskHistoryEntries\(runtime\?\.events\)/);
  assert.match(executionSource, /parseHumanTaskEvidence\(evidence\.value\)/);
  assert.match(executionSource, /Evidence notes, one per line/);
  const humanTaskEvidenceClient = await fetch(`${base}/human-task-evidence.mjs`);
  assert.equal(humanTaskEvidenceClient.status, 200);
  assert.match(await humanTaskEvidenceClient.text(), /MAX_NOTES = 20/);
  assert.match(executionSource, /Human task history \(/);
  assert.ok(executionSource.includes("if (runtime?.outcome?.result) {")
    && executionSource.includes("text: `Human checkpoint result: ${runtime.outcome.result}. Evidence: ${runtime.evidence.join(' · ') || 'none recorded'}`"),
    'the human task card renders the persisted result value and that runtime row’s evidence');
  assert.match(executionSource, /submitHumanTaskCommand\(/);
  assert.match(executionSource, /humanTaskEscalationResolutionOptions\(/);
  assert.match(executionSource, /instanceControlStatus: runtime\.instanceControl\?\.status/);
  assert.match(executionSource, /resolutionOptions\.resume\.disabled/);
  assert.match(executionSource, /resolutionOptions\.reassign\.disabled/);
  assert.match(executionSource, /resolutionOptions\.initialChoiceRequired/);
  assert.match(executionSource, /resolutionOptions\.succeeded\.disabled/);
  assert.match(executionSource, /resolutionOptions\.failed\.disabled/);
  assert.match(executionSource, /Choose an available owner resolution/);
  assert.match(executionSource, /value: '', disabled: 'disabled', selected: 'selected'/);
  assert.match(executionSource, /This process instance is paused\. Resume it before a project owner resolves the escalated checkpoint\./);
  const escalationResolutionClient = await fetch(`${base}/human-task-escalation-resolution.mjs`);
  assert.equal(escalationResolutionClient.status, 200);
  const escalationResolutionSource = await escalationResolutionClient.text();
  assert.match(escalationResolutionSource, /instanceControlStatus === 'PAUSE_REQUESTED'/);
  assert.match(escalationResolutionSource, /Resume unavailable · instance pause is pending/);
  assert.match(escalationResolutionSource, /Reassignment unavailable · instance pause is pending/);
  assert.match(escalationResolutionSource, /instanceControlStatus === 'PAUSED'/);
  assert.match(escalationResolutionSource, /Resume unavailable · instance is paused/);
  assert.match(escalationResolutionSource, /Reassignment unavailable · instance is paused/);
  assert.match(escalationResolutionSource, /This process instance is paused\. Resume the process instance before a project owner resolves this escalated checkpoint\./);
  assert.match(escalationResolutionSource, /Resolve this checkpoint as succeeded or failed/);
  assert.match(executionSource, /humanReassignmentCandidates/);
  assert.match(executionSource, /targetPrincipal: disposition\.value === 'reassign' \? targetPrincipal\.value : null/);
  assert.match(executionSource, /expectedVersion: disposition\.value === 'reassign' \? runtime\.version : null/);
  assert.match(executionSource, /the saved plan remains unchanged/);
  assert.equal((executionSource.match(/submitHumanTaskCommand\(/g) ?? []).length, 2,
    'completion and shared escalation/resolution handlers use the same safe retry control flow');
  assert.equal((executionSource.match(/if \(!saved\) button\.disabled = false;/g) ?? []).length, 2,
    'a saved completion or owner action stays disabled if the follow-up refresh fails');
  assert.equal((executionSource.match(/saved = true;\s*await refresh\(\);/g) ?? []).length, 2,
    'both wrappers mark a saved mutation before awaiting its follow-up refresh');
  assert.match(executionSource, /role: 'status', 'aria-live': 'polite'/);
  const humanTaskCommandUiClient = await fetch(`${base}/human-task-command-ui.mjs`);
  assert.equal(humanTaskCommandUiClient.status, 200);
  const humanTaskCommandUiSource = await humanTaskCommandUiClient.text();
  assert.match(humanTaskCommandUiSource, /Form values are locked; retry sends the same saved action and evidence/);
  assert.match(humanTaskCommandUiSource, /control\.disabled = mode !== 'normal'/);
  assert.match(humanTaskCommandUiSource, /button\.disabled = mode === 'submitting' \|\| mode === 'saved'/);
  assert.match(humanTaskCommandUiSource, /pendingCommands\.delete\(key\)/);
  assert.match(executionSource, /if \(disposition === 'reconcile'\)/);
  assert.match(executionSource, /reconcileHumanTaskConflict\(project, plan, task, selectedInstance\)/);
  assert.match(executionSource, /className: 'process-task-status'[\s\S]*?tabindex: '-1'[\s\S]*?data-human-task-status-focus-target/);
  assert.match(executionSource, /status\.focus\(\{ preventScroll: true \}\)/);
  assert.equal((executionSource.match(/const priorFocus = document\.activeElement/g) ?? []).length, 3,
    'human action handlers retain their initiating control before disabling it');
  assert.equal((executionSource.match(/document\.activeElement === document\.body && priorFocus\?\.isConnected/g) ?? []).length, 3,
    'validation and retry outcomes restore focus only when the original control remains connected and focus fell to body');
  assert.match(executionSource, /focusHumanTaskStatus\(\{/);
  const focusExecutionCss = await (await fetch(`${base}/execution.css`)).text();
  assert.match(focusExecutionCss, /\.process-task-status:focus-visible\s*\{[^}]*outline: 3px solid var\(--exec\)/);
  assert.match(executionSource, /human checkpoint changed before this action was saved/i);
  assert.match(executionSource, /The exact command remains saved; retry it to recover the same task start/);
  const humanTaskFailureClient = await fetch(`${base}/human-task-action-failure.mjs`);
  assert.equal(humanTaskFailureClient.status, 200);
  const humanTaskFailureSource = await humanTaskFailureClient.text();
  assert.match(humanTaskFailureSource, /error\?\.status === 409/);
  assert.match(humanTaskFailureSource, /INVALID_HUMAN_TASK_OUTCOME/);
  assert.match(humanTaskFailureSource, /INVALID_HUMAN_TASK_ESCALATION/);
  assert.match(executionSource, /submission\.kind === 'reconcile'[\s\S]*?reconcileHumanTaskConflict/);
  assert.match(executionSource, /submission\.kind === 'retry'/);
  assert.match(humanTaskFailureSource, /error\?\.retryable/);
  const humanTaskHistoryClient = await fetch(`${base}/human-task-history.mjs`);
  assert.equal(humanTaskHistoryClient.status, 200);
  const humanTaskHistorySource = await humanTaskHistoryClient.text();
  assert.match(humanTaskHistorySource, /project owner/);
  assert.match(humanTaskHistorySource, /Owner reassigned task/);
  const humanTaskAssigneeClient = await fetch(`${base}/human-task-effective-assignee.mjs`);
  assert.equal(humanTaskAssigneeClient.status, 200);
  const humanTaskAssigneeSource = await humanTaskAssigneeClient.text();
  assert.match(humanTaskAssigneeSource, /Current assigned human: You/);
  assert.match(humanTaskAssigneeSource, /pinned blueprint actor remains part of the saved plan/);
  assert.match(executionSource, /humanTaskEffectiveAssigneePresentation\(runtime\)/);
  assert.match(executionSource, /className: 'human-task-effective-assignee'/);
  assert.match(executionSource, /Only the current assigned human can start this task/);
  assert.match(executionSource, /current owner-reassigned human may start and complete this task/);
  assert.match(executionSource, /succeeded human checkpoint requires at least one brief evidence note/i);
  assert.match(executionSource, /evidence\.required = required/);
  assert.match(executionSource, /Withdraw request/);
  assert.match(executionSource, /Pause before dispatch/);
  assert.match(executionSource, /Resume for fresh approval/);
  assert.match(executionSource, /Save new instruction revision/);
  assert.match(executionSource, /submitLinkedRunAmendment/);
  assert.match(executionSource, /pending\.payload/);
  assert.match(executionSource, /role: 'status', 'aria-live': 'polite'/);
  assert.match(executionSource, /ExecutionInstructionsAmended/);
  assert.match(executionSource, /Instruction revision \$\{revision\.revision\} · \$\{revision\.reason\}/);
  assert.match(executionSource, /Pausing now clears this approval/);
  assert.match(executionSource, /This request has started\. Pause, resume and withdrawal apply only before dispatch/i);
  assert.match(executionSource, /receives the saved task instructions and its pinned input record content\. For a GitHub snapshot it receives only the validated files selected above; its credential stays in the server broker/);
  assert.match(executionSource, /Generated blueprint proposal/);
  assert.match(executionSource, /proposal-review-state\.mjs/);
  assert.match(executionSource, /proposalDesignLink/);
  assert.match(executionSource, /api\/v1\/projects\/\$\{encodeURIComponent\(run\.projectId\)\}\/members/);
  assert.match(executionSource, /deriveBlueprintProposalReviewState/);
  assert.match(executionSource, /proposalApplyFailureDisposition/);
  assert.match(executionSource, /proposalApplyFailureDisposition\(error\) === 'reconcile'/);
  assert.match(executionSource, /blueprint-proposals\/\$\{encodeURIComponent\(run\.id\)\}\/reviews/);
  assert.match(executionSource, /data-form': 'proposal-human-review'/);
  assert.match(executionSource, /Choose judgment/);
  assert.match(executionSource, /These are human judgments, not automated quality scores/);
  assert.match(executionSource, /reviewEventId: run\.proposalApplication\.review\.eventId/);
  assert.match(executionSource, /reviewHash: run\.proposalApplication\.review\.reviewHash/);
  assert.match(executionSource, /pendingProposalApplies\.delete\(run\.id\)/);
  const linkedRunAmendmentClient = await fetch(`${base}/linked-run-amendment.mjs`);
  assert.equal(linkedRunAmendmentClient.status, 200);
  const linkedRunAmendmentSource = await linkedRunAmendmentClient.text();
  assert.match(linkedRunAmendmentSource, /retry sends the same saved command and details/i);
  assert.match(linkedRunAmendmentSource, /refreshLinkedRunAmendment/);
  assert.match(executionSource, /proposalApplication\?\.canApply/);
  assert.match(executionSource, /executionProjectContext/);
  assert.match(executionSource, /executionProcessTarget\(window\.location\.href, state\.projects\)/);
  assert.match(executionSource, /processes\.some\(\(process\) => process\.id === preferredProcessId\)/);
  assert.match(executionSource, /loadPlanningProject\(planProjectSelect\.value, preferredProcessId, planTarget\)/);
  assert.match(executionSource, /projectSelect\.value = selectedProjectId/);
  assert.match(executionSource, /planProjectSelect\.value = selectedProjectId/);
  assert.match(executionSource, /if \(projectContext\.projectId\) showNew\(\)/);
  assert.match(executionSource, /encodeStudioRoute\(\{ projectId \}\)/);
  assert.match(executionSource, /linkedProcessPlanTarget\(run, state\.projects, state\.runtimePlans\)/);
  assert.match(executionSource, /Open linked plan instance/);
  assert.match(executionSource, /runtimeState\.status/);
  assert.match(executionSource, /Dependencies must succeed in this instance before the assigned human can start this task/);
  assert.match(executionSource, /Start a root task first; dependent tasks join its instance after their dependencies succeed/);
  assert.match(executionSource, /Insert a required human checkpoint/);
  assert.match(executionSource, /task that must wait for this checkpoint/i);
  assert.match(executionSource, /inherits the selected task’s existing dependencies/);
  assert.match(executionSource, /payload\.humanCheckpoint =/);
  assert.match(executionSource, /selectLinkedProcessPlanInstance\(run, state\.projects, state\.selectedPlanInstances, state\.runtimePlans\)/);
  assert.match(executionSource, /linkedPlanInstanceRouteTarget\(window\.location\.href, state\.projects\)/);
  assert.match(executionSource, /syncExecutionRoute\(target\.projectId, target\)/);
  assert.match(executionSource, /syncExecutionRoute\(project\.id, instanceSelect\.value === 'new' \? null/);
  assert.match(executionSource, /sourceProcessDesignLink\(plan, project\)/);
  assert.match(executionSource, /processPlanFreshness\(plan, project\)/);
  assert.match(executionSource, /Historical plan · pinned to blueprint v/);
  assert.match(executionSource, /const canStartNewInstances = !softwareDeliveryPlan && allowNewInstances && !freshness\.historical/);
  assert.match(executionSource, /text: canStartNewInstances \? 'Start a new instance'/);
  assert.match(executionSource, /Owner-promoted human checkpoint snapshot/);
  assert.match(executionSource, /state\.runtimePlans = runtime\.plans \?\? \[\]/);
  assert.match(executionSource, /planExists = processPlansFor\(project\)\.some/);
  assert.match(executionSource, /\.\.\.\(!canStartNewInstances \? \{ disabled: 'disabled' \} : \{\}\)/);
  assert.match(executionSource, /const canStartNew = canStartNewInstances && selectedInstance === 'new'/);
  assert.match(executionSource, /focusProcessPlanCard\(currentProcessPlanFocusTarget\(result\.data, processId, result\.event\?\.data\?\.planId\)\)/);
  assert.match(executionSource, /renderProcessPlans\(document\.querySelector\('#process-plans'\), processPlansFor\(result\.data\), result\.data\);\s*focusProcessPlanCard\(processPlanRevisionFocusTarget\(result\.event\)\);\s*notify\('Immutable graph revision saved\. Tasks remain planned; no work was dispatched\.'\)/);
  assert.match(executionSource, /card\.scrollIntoView\?\.\(\{ block: 'nearest' \}\)/);
  assert.match(executionSource, /card\.focus\(\{ preventScroll: true \}\)/);
  assert.match(executionSource, /tabindex: '-1'/);
  assert.match(executionSource, /candidate\.dataset\.processPlanId === target\.processPlanId/);
  assert.match(executionSource, /Planning graph saved\. No execution run was created and no work was dispatched\./);
  assert.match(executionSource, /className: 'process-plan-controls'/);
  assert.match(executionSource, /text: sourceLink\.label/);
  assert.match(executionSource, /encodeExecutionRoute\(projectId, target\)/);
  assert.match(executionSource, /focusLinkedPlanInstance\(restoredPlanTarget\)/);
  assert.match(executionSource, /data-process-plan-id/);
  assert.match(executionSource, /allowNewInstances: false, showHistory: false/);
  assert.match(executionSource, /Apply as new proposed blueprint version/);
  assert.match(executionSource, /BlueprintProposalApplied/);
  assert.match(executionSource, /api\/execution\/local-repositories\?projectId=/);
  assert.match(executionSource, /Repository source/);
  assert.match(executionSource, /repository\.kind === 'github' && !state\.githubExecutionAvailable/);
  assert.match(executionSource, /githubSnapshotId/);
  assert.match(executionSource, /new URLSearchParams\(window\.location\.search\)\.get\('githubSnapshot'\)/,
    'the Execution page accepts a snapshot handoff from its route');
  assert.match(executionSource, /repository\.snapshotId === state\.githubSnapshotHandoffId/,
    'a handoff is matched only against the current project repository listing');
  assert.match(executionSource, /Snapshot from onboarding is preselected\. Choose paths, task and profile; no request is submitted automatically\./,
    'the served selection panel keeps task submission explicit after handoff');
  assert.match(executionSource, /remote candidate execution is not enabled yet/);
  assert.match(executionSource, /\/api\/execution\/github-snapshots\/\$\{encodeURIComponent\(snapshotId\)\}\/files/);
  assert.match(executionSource, /MAX_GITHUB_SELECTED_FILES = 8/);
  assert.match(executionSource, /MAX_GITHUB_SELECTED_BYTES = 8_000/);
  assert.match(executionSource, /state\.githubFileSelections\.set\(selectionKey, selectedPaths\)/);
  assert.match(executionSource, /snapshotDigest = repository\.treeDigest/);
  assert.match(executionSource, /repositoryRefId = repository\.refId/);
  assert.match(executionSource, /repositoryCommitOid = repository\.commitOid/);
  assert.match(executionSource, /repository\.refLabel.*repository\.commitOid\.slice\(0, 12\)/);
  assert.match(executionSource, /function renderRepositoryCandidate\(candidate\)/);
  assert.match(executionSource, /Saved \$\{streams\} is bounded; earlier output may be omitted/);
  assert.match(executionSource, /no output truncation metadata, so whether earlier stdout or stderr was omitted is unknown/);
  assert.match(executionSource, /execution\.adapter\?\.port === 'ExecutionPort'/);
  assert.match(executionSource, /execution\.stdoutTruncated === true \|\| execution\.stderrTruncated === true/);
  assert.match(executionSource, /candidate\.source\.identity.*candidate\.source\.ref.*candidate\.source\.commitOid/);
  assert.doesNotMatch(executionSource, /repository-push/);
  assert.match(executionSource, /repository-source\?path=/);
  assert.match(executionSource, /function renderRepositoryCandidate\(candidate\)/);
  assert.match(executionSource, /change\.change !== 'mode_changed' && \(change\.beforeHash \|\| change\.afterHash\)/);
  assert.match(executionSource, /readBoundedUtf8Response\(response, change\.(beforeHash|afterHash)\)/);
  assert.match(executionSource, /repository-diff-\$\{line\.type\}.*text: line\.text/);
  assert.match(executionSource, /Use the file download links for review/);
  assert.doesNotMatch(executionSource, /innerHTML\s*=/);
  const textDiffModule = await fetch(`${base}/repository-text-diff.mjs`);
  assert.equal(textDiffModule.status, 200);
  const textDiffSource = await textDiffModule.text();
  assert.match(textDiffSource, /MAX_REPOSITORY_PREVIEW_BYTES = 128 \* 1024/);
  assert.match(textDiffSource, /MAX_REPOSITORY_DIFF_CELLS = 40_000/);
  assert.match(executionSource, /Local repository candidate · review only/);
  assert.match(executionSource, /has not written changes back to the configured repository or pushed them/);
  assert.match(executionSource, /Candidate path changes/);
  assert.match(executionSource, /verification\.treeDigest/);
  assert.match(executionSource, /Saved verification \$\{streams\} was truncated to the bounded capture/);
  assert.match(executionSource, /The output hash covers only the saved stdout and stderr/);
  assert.match(executionSource, /has no truncation metadata, so whether its output was truncated is unknown/);
  const executionCss = await fetch(`${base}/execution.css`);
  assert.equal(executionCss.status, 200);
  const executionStyles = await executionCss.text();
  assert.match(executionStyles, /\.github-snapshot-file-selection\s*\{/);
  assert.match(executionStyles, /\.github-snapshot-file-option\s*\{/);
  assert.match(executionStyles, /\.execution-skip-link:focus\s*\{[^}]*transform:\s*translateY\(0\)[^}]*outline:\s*3px solid var\(--exec\)/);
  assert.match(executionStyles, /\.execution-main:focus\s*\{[^}]*outline:\s*3px solid var\(--exec\)/);
  assert.match(executionStyles, /\.process-plan-controls\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap/);
  assert.match(executionStyles, /\.process-plan\s*>\s*label\s*\{[^}]*display:\s*grid/);
  assert.match(executionStyles, /\.process-plan\s*>\s*label\s+select\s*\{[^}]*width:\s*100%/);
  assert.match(executionStyles, /\.task-assignment-transparency\s*\{[^}]*max-width:\s*100%[^}]*overflow-wrap:\s*anywhere/);
  assert.match(executionStyles, /\.task-assignment-transparency\s*>\s*summary\s*\{[^}]*min-height:\s*44px/);
  assert.match(executionStyles, /\.process-plan:focus\s*\{[^}]*outline:\s*3px solid var\(--exec\)/);
  assert.match(executionStyles, /\.run-events\s*>\s*div\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(executionStyles, /\.run-events\s+span\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(executionSource, /\/api\/execution\/runs\/\$\{run\.id\}\/cancel/);
  assert.match(executionSource, /\/api\/execution\/runs\/\$\{run\.id\}\/\$\{action\}/);
  const proposalReviewClient = await fetch(`${base}/proposal-review-state.mjs`);
  assert.equal(proposalReviewClient.status, 200);
  const proposalReviewSource = await proposalReviewClient.text();
  assert.match(proposalReviewSource, /status: 'evaluation-blocked', canApply: false/);
  assert.match(proposalReviewSource, /SUPPORTED_EVALUATOR_VERSION = 1/);
  assert.match(proposalReviewSource, /relevance-to-task/);
  assert.match(proposalReviewSource, /source-support/);
  assert.match(proposalReviewSource, /actionability/);
  assert.match(proposalReviewSource, /scope-and-risk/);
  assert.match(proposalReviewSource, /review-required/);
  assert.match(proposalReviewSource, /Structural checks blocked this proposal/);
  assert.match(proposalReviewSource, /Open current design/);
  assert.match(proposalReviewSource, /Open updated design/);
  assert.match(proposalReviewSource, /objectId: typeof appliedEvent\.data\?\.objectId === 'string'/);
  assert.match(proposalReviewSource, /Array\.isArray\(project\.graph\?\.nodes\) && project\.graph\.nodes\.some\(\(node\) => node\?\.id === application\.objectId\)/);
  assert.match(proposalReviewSource, /view: 'map', selectedId: objectId/);
  const processPlanNavigation = await fetch(`${base}/process-plan-navigation.mjs`);
  assert.equal(processPlanNavigation.status, 200);
  const processPlanNavigationSource = await processPlanNavigation.text();
  assert.match(processPlanNavigationSource, /sourceProcessDesignLink/);
  assert.match(processPlanNavigationSource, /processPlanFreshness/);
  assert.match(processPlanNavigationSource, /currentProcessPlanFocusTarget/);
  assert.match(processPlanNavigationSource, /processPlanRevisionFocusTarget/);
  assert.match(processPlanNavigationSource, /Plan current \$\{source\.processName\} in Execution/);
  const enterpriseClient = await fetch(`${base}/app.js`);
  assert.equal(enterpriseClient.status, 200);
  const enterpriseSource = await enterpriseClient.text();
  assert.match(enterpriseSource, /Plan this process in Execution/);
  assert.match(enterpriseSource, /blueprintItem\(state\.project\.latestBlueprint, node\.id\)/);
  assert.match(enterpriseSource, /encodeExecutionRoute\(state\.project\.id, \{ projectId: state\.project\.id, processId: savedProcess\.id \}\)/);
  assert.match(enterpriseSource, /Use this snapshot in an Execution task/,
    'saved onboarding snapshots have an explicit next-step action');
  assert.match(enterpriseSource, /encodeExecutionRoute\(state\.project\.id, null, null, snapshot\.id\)/,
    'the onboarding action carries the exact saved snapshot ID into Execution');
  assert.match(enterpriseSource, /useSnapshot\.addEventListener\('click', \(event\) => \{\s*if \(!allowRouteChange\(\)\) event\.preventDefault\(\);\s*\}\)/,
    'snapshot handoff preserves unsent drafts');
  assert.match(enterpriseSource, /planLink\.addEventListener\('click', \(event\) => \{\s*if \(!allowRouteChange\(\)\) event\.preventDefault\(\);\s*\}\)/);
});
