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
  assert.match(executionHtml, /id="enterprise-design-nav" href="\/"/);
  const executionClient = await fetch(`${base}/execution.js`);
  assert.equal(executionClient.status, 200);
  const executionSource = await executionClient.text();
  assert.match(executionSource, /blueprint agent binding is recorded for traceability/);
  assert.match(executionSource, /does not execute as or impersonate the bound workload identity/);
  assert.match(executionSource, /Escalate to project owner/);
  assert.match(executionSource, /canResolveEscalation/);
  assert.match(executionSource, /process-task-instances\/\$\{action\}/);
  assert.match(executionSource, /Pause process instance/);
  assert.match(executionSource, /Resume process instance/);
  assert.match(executionSource, /in-flight tasks settle/);
  assert.match(executionSource, /fresh independent approval/);
  assert.match(executionSource, /Instance control history/);
  assert.match(executionSource, /instanceControl\.canControl === true/);
  assert.match(executionSource, /Only the instance initiator or a current project owner can control this process/);
  assert.match(executionSource, /instanceControl\.canRecover === true/);
  assert.match(executionSource, /Reason for owner recovery/);
  assert.match(executionSource, /The old model output is unverified/);
  assert.match(executionSource, /may have incurred cost/);
  assert.match(executionSource, /fresh independent approval/);
  assert.match(executionSource, /acknowledgeDuplicateCostWork/);
  assert.match(executionSource, /process-task-instances\/abandon-unverified/);
  assert.match(executionSource, /instanceControl\.canAbandonUnverified === true/);
  assert.match(executionSource, /ABANDONED_UNVERIFIED/);
  assert.match(executionSource, /HumanTaskEscalationResolved/);
  assert.match(executionSource, /succeeded human checkpoint requires at least one brief evidence note/i);
  assert.match(executionSource, /evidence\.required = required/);
  assert.match(executionSource, /Withdraw request/);
  assert.match(executionSource, /Pause before dispatch/);
  assert.match(executionSource, /Resume for fresh approval/);
  assert.match(executionSource, /Save new instruction revision/);
  assert.match(executionSource, /ExecutionInstructionsAmended/);
  assert.match(executionSource, /Instruction revision \$\{revision\.revision\} · \$\{revision\.reason\}/);
  assert.match(executionSource, /Pausing now clears this approval/);
  assert.match(executionSource, /This request has started\. Pause, resume and withdrawal apply only before dispatch/i);
  assert.match(executionSource, /pinned input record content and source notes/);
  assert.match(executionSource, /unrelated project records or credential material/);
  assert.match(executionSource, /Generated blueprint proposal/);
  assert.match(executionSource, /proposal-review-state\.mjs/);
  assert.match(executionSource, /proposalDesignLink/);
  assert.match(executionSource, /api\/v1\/projects\/\$\{encodeURIComponent\(run\.projectId\)\}\/members/);
  assert.match(executionSource, /deriveBlueprintProposalReviewState/);
  assert.match(executionSource, /proposalApplyFailureDisposition/);
  assert.match(executionSource, /proposalApplyFailureDisposition\(error\) === 'reconcile'/);
  assert.match(executionSource, /pendingProposalApplies\.delete\(run\.id\)/);
  assert.match(executionSource, /proposalApplication\?\.canApply/);
  assert.match(executionSource, /executionProjectContext/);
  assert.match(executionSource, /executionProcessTarget\(window\.location\.href, state\.projects\)/);
  assert.match(executionSource, /processes\.some\(\(process\) => process\.id === preferredProcessId\)/);
  assert.match(executionSource, /loadPlanningProject\(planProjectSelect\.value, preferredProcessId, planTarget\)/);
  assert.match(executionSource, /projectSelect\.value = selectedProjectId/);
  assert.match(executionSource, /planProjectSelect\.value = selectedProjectId/);
  assert.match(executionSource, /if \(projectContext\.projectId\) showNew\(\)/);
  assert.match(executionSource, /encodeStudioRoute\(\{ projectId \}\)/);
  assert.match(executionSource, /linkedProcessPlanTarget\(run, state\.projects\)/);
  assert.match(executionSource, /Open linked plan instance/);
  assert.match(executionSource, /runtimeState\.status/);
  assert.match(executionSource, /Dependencies must succeed in this instance before the assigned human can start this task/);
  assert.match(executionSource, /Start a root task first; dependent tasks join its instance after their dependencies succeed/);
  assert.match(executionSource, /Insert a required human checkpoint/);
  assert.match(executionSource, /task that must wait for this checkpoint/i);
  assert.match(executionSource, /inherits the selected task’s existing dependencies/);
  assert.match(executionSource, /payload\.humanCheckpoint =/);
  assert.match(executionSource, /selectLinkedProcessPlanInstance\(run, state\.projects, state\.selectedPlanInstances\)/);
  assert.match(executionSource, /linkedPlanInstanceRouteTarget\(window\.location\.href, state\.projects\)/);
  assert.match(executionSource, /syncExecutionRoute\(target\.projectId, target\)/);
  assert.match(executionSource, /syncExecutionRoute\(project\.id, instanceSelect\.value === 'new' \? null/);
  assert.match(executionSource, /sourceProcessDesignLink\(plan, project\)/);
  assert.match(executionSource, /className: 'process-plan-controls'/);
  assert.match(executionSource, /text: sourceLink\.label/);
  assert.match(executionSource, /encodeExecutionRoute\(projectId, target\)/);
  assert.match(executionSource, /focusLinkedPlanInstance\(restoredPlanTarget\)/);
  assert.match(executionSource, /data-process-plan-id/);
  assert.match(executionSource, /allowNewInstances: false, showHistory: false/);
  assert.match(executionSource, /Apply as new proposed blueprint version/);
  assert.match(executionSource, /BlueprintProposalApplied/);
  const executionCss = await fetch(`${base}/execution.css`);
  assert.equal(executionCss.status, 200);
  const executionStyles = await executionCss.text();
  assert.match(executionStyles, /\.process-plan-controls\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap/);
  assert.match(executionStyles, /\.process-plan\s*>\s*label\s*\{[^}]*display:\s*grid/);
  assert.match(executionStyles, /\.process-plan\s*>\s*label\s+select\s*\{[^}]*width:\s*100%/);
  assert.match(executionSource, /\/api\/execution\/runs\/\$\{run\.id\}\/cancel/);
  assert.match(executionSource, /\/api\/execution\/runs\/\$\{run\.id\}\/\$\{action\}/);
  const proposalReviewClient = await fetch(`${base}/proposal-review-state.mjs`);
  assert.equal(proposalReviewClient.status, 200);
  const proposalReviewSource = await proposalReviewClient.text();
  assert.match(proposalReviewSource, /Open current design/);
  assert.match(proposalReviewSource, /Open updated design/);
  const processPlanNavigation = await fetch(`${base}/process-plan-navigation.mjs`);
  assert.equal(processPlanNavigation.status, 200);
  assert.match(await processPlanNavigation.text(), /sourceProcessDesignLink/);
  const enterpriseClient = await fetch(`${base}/app.js`);
  assert.equal(enterpriseClient.status, 200);
  const enterpriseSource = await enterpriseClient.text();
  assert.match(enterpriseSource, /Plan this process in Execution/);
  assert.match(enterpriseSource, /blueprintItem\(state\.project\.latestBlueprint, node\.id\)/);
  assert.match(enterpriseSource, /encodeExecutionRoute\(state\.project\.id, \{ projectId: state\.project\.id, processId: savedProcess\.id \}\)/);
  assert.match(enterpriseSource, /planLink\.addEventListener\('click', \(event\) => \{\s*if \(!allowRouteChange\(\)\) event\.preventDefault\(\);\s*\}\)/);
});
