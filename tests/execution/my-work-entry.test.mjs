import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { encodeMyWorkRoute, executionProcessTarget } from '../../public/shared-interactions.mjs';

const executionSource = await readFile(new URL('../../public/execution.js', import.meta.url), 'utf8');
const executionHtml = await readFile(new URL('../../public/execution.html', import.meta.url), 'utf8');
const studioSource = await readFile(new URL('../../public/app.js', import.meta.url), 'utf8');
const myWorkSource = executionSource.slice(executionSource.indexOf('function showMyWork('), executionSource.indexOf('\nasync function loadPlanningProject('));

test('My work has a separate Execution entry and reloadable project-scoped route', () => {
  const sidebar = executionHtml.slice(executionHtml.indexOf('<aside'), executionHtml.indexOf('</aside>'));
  assert.match(sidebar, /id="my-work"[^>]*>My work<\/button>/);
  assert.match(executionSource, /document\.querySelector\('#my-work'\)\.addEventListener\('click', \(\) => showMyWork\(state\.projectContextId\)\)/);
  assert.match(executionSource, /get\('view'\) === 'my-work'[\s\S]*?else if \(myWorkView\) showMyWork\(state\.projectContextId, processTarget\?\.processId/);
  assert.match(myWorkSource, /encodeMyWorkRoute\(projectId, processFilter\)/);
});

test('My work loads the authenticated project runtime without mounting the plan-creation flow', () => {
  assert.match(myWorkSource, /attrs: \{ 'aria-label': 'My work' \}/);
  assert.match(myWorkSource, /attrs: \{ 'aria-label': 'Project for my work' \}/);
  assert.match(myWorkSource, /if \(!state\.authenticated \|\| !state\.currentPrincipal\)/);
  assert.match(myWorkSource, /api\(`\/api\/v1\/projects\/\$\{encodeURIComponent\(projectIdToLoad\)\}`\)/);
  assert.match(myWorkSource, /api\(`\/api\/execution\/process-task-instances\?projectId=/);
  assert.match(myWorkSource, /assignedHumanWorkItems\(plans, runtime\.instances \?\? \[\], projectIdToLoad\)/);
  assert.doesNotMatch(myWorkSource, /process-plan-form|renderProcessPlans\(/);
});

test('My work opens the selected retained plan revision and exact task instance', () => {
  assert.match(myWorkSource, /processPlanId: item\.planId, revision: item\.revision,[\s\S]*?planInstanceId: item\.planInstanceId, taskId: item\.taskId/);
  assert.match(myWorkSource, /selectionKey: `\$\{item\.planId\}\\n\$\{item\.revision\}`/);
  assert.match(myWorkSource, /showNew\(\{ planTarget: target \}\)/);
  assert.match(executionSource, /if \(target\.taskId\) return focusHumanTaskStatus/);
});

test('a saved process detail opens My work filtered to that process and the filter survives reload', () => {
  const projectId = 'project-01234567-89ab-cdef-0123-456789abcdef';
  const processId = 'process-customer-intake';
  const route = encodeMyWorkRoute(projectId, processId);
  assert.equal(route, `/execution.html?project=${projectId}&process=${processId}&view=my-work`);
  assert.deepEqual(executionProcessTarget(`https://orgward.local${route}`, [{ id: projectId }]), {
    requested: true, target: { projectId, processId },
  });
  assert.match(studioSource, /My assigned work for \$\{savedProcess\.name\}/);
  assert.match(studioSource, /encodeMyWorkRoute\(state\.project\.id, savedProcess\.id\)/);
  assert.match(myWorkSource, /assignedHumanWorkItemsForProcess\([\s\S]*processFilter/);
  assert.match(myWorkSource, /emptyMessage: processFilter \? 'No active human tasks are assigned to you for this saved process\.'/);
  assert.match(executionSource, /else if \(myWorkView\) showMyWork\(state\.projectContextId, processTarget\?\.processId/);
});
