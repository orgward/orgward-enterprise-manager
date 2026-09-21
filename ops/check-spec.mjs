import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validatePortfolio, selfTestPortfolio } from './check-portfolio.mjs';
import { validateArchitecture, selfTestArchitecture } from './check-enterprise-architecture.mjs';
import { checkDraftRegistry } from './check-work-package-drafts.mjs';
import { checkDesignResolutions } from './check-design-resolutions.mjs';
import { checkDomainVectors } from './check-domain-vectors.mjs';
import { checkConfigurableWorkflow } from './check-configurable-workflow.mjs';
import { checkClosedLoop } from './check-closed-loop.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const backlog = await read('docs/production/IMPLEMENTATION-BACKLOG.json');
const privateLedger = await read('DELIVERY-STATUS.json');
const productionLedger = await read('PRODUCTION-READINESS.json');
const portfolio = await read('docs/production/PORTFOLIO-COVERAGE.json');
const architecture = await read('docs/production/ENTERPRISE-ARCHITECTURE.json');
const packetContract = await read('contracts/enterprise/work-package.contract.json');
const protocolCases = await read('contracts/enterprise/consistency-cases.json');
const gates = new Set([...privateLedger.gates, ...productionLedger.gates].map(g => g.id));

function validate(plan) {
  assert.equal(plan.schema_version, '1.0');
  assert.ok(plan.source_contracts.length >= 5, 'Missing source contracts');
  assert.ok(plan.common_acceptance.length >= 5, 'Missing common acceptance rules');
  assert.ok(plan.tasks.length > 0, 'Empty backlog');
  const tasks = new Map();
  const stories = new Set();
  const scenarios = new Set();
  const coverage = { outcomes: new Set(), screens: new Set(), gates: new Set() };
  for (const task of plan.tasks) {
    assert.match(task.id, /^T-\d{2,}$/);
    assert.ok(!tasks.has(task.id), `Duplicate task ${task.id}`);
    assert.match(task.story_id, /^US-\d{2,}$/);
    assert.ok(!stories.has(task.story_id), `Duplicate story ${task.story_id}`);
    tasks.set(task.id, task); stories.add(task.story_id);
    assert.match(task.user_story, /^As .+, I want to .+ so .+\.$/, `${task.id}: missing actor, need or outcome`);
    assert.ok(['planned','in_progress','blocked','complete'].includes(task.status), `${task.id}: invalid task status`);
    for (const key of ['preconditions','deliverables','verification','acceptance','outcomes','screens','gates']) {
      assert.ok(Array.isArray(task[key]) && task[key].length, `${task.id}: empty ${key}`);
    }
    assert.ok(Array.isArray(task.depends_on) && new Set(task.depends_on).size === task.depends_on.length, `${task.id}: duplicate dependencies`);
    for (const [key, allowed] of [['outcomes',new Set(plan.outcomes)],['screens',new Set(plan.screens)],['gates',gates]]) {
      for (const value of task[key]) {
        assert.ok(allowed.has(value), `${task.id}: unknown ${key} ${value}`);
        // Final qualification cannot paper over missing feature-level coverage.
        if (task.id !== 'T-48' && task.task_type !== 'qualification') coverage[key].add(value);
      }
    }
    assert.ok(task.acceptance.length >= 3, `${task.id}: missing positive/negative/recovery scenarios`);
    for (const criterion of task.acceptance) {
      assert.ok(criterion.id.startsWith(`${task.id}-AC`) && !scenarios.has(criterion.id), `Invalid/duplicate acceptance ID ${criterion.id}`);
      scenarios.add(criterion.id);
      assert.match(criterion.scenario, /^Given .+, .+/, `${criterion.id}: missing concrete scenario`);
      assert.ok(['not_run','pass','fail','blocked'].includes(criterion.status), `${criterion.id}: invalid status`);
      assert.ok(Array.isArray(criterion.evidence), `${criterion.id}: no evidence array`);
      if (criterion.status === 'pass') assert.ok(criterion.evidence.length, `${criterion.id}: pass without evidence`);
    }
    assert.ok(Array.isArray(task.receipts), `${task.id}: no receipts array`);
    if (task.status === 'complete') {
      assert.ok(task.receipts.length, `${task.id}: completion without receipt`);
      assert.ok(task.acceptance.every(c => c.status === 'pass' && c.evidence.length), `${task.id}: completion with unverified criteria`);
    }
  }
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    assert.ok(tasks.has(id), `Unknown dependency ${id}`);
    assert.ok(!visiting.has(id), `Dependency cycle through ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    const task = tasks.get(id);
    for (const dependency of task.depends_on) {
      visit(dependency);
      if (task.status === 'complete') assert.equal(tasks.get(dependency).status, 'complete', `${id}: incomplete dependency ${dependency}`);
    }
    visiting.delete(id); visited.add(id);
  }
  for (const id of tasks.keys()) visit(id);
  for (const [key, required] of [['outcomes',plan.outcomes],['screens',plan.screens],['gates',[...gates]]]) {
    for (const value of required) assert.ok(coverage[key].has(value), `Uncovered ${key}: ${value}`);
  }
  return { tasks: tasks.size, stories: stories.size, scenarios: scenarios.size, outcomes: coverage.outcomes.size, screens: coverage.screens.size, gates: coverage.gates.size };
}

const result = validate(backlog);
Object.assign(result, validatePortfolio(backlog, portfolio));
Object.assign(result, validateArchitecture(backlog, architecture, packetContract, protocolCases));
assert.equal(architecture.draft_registry, 'contracts/enterprise/packet-drafts.index.json');
Object.assign(result, await checkDraftRegistry(root, backlog, packetContract, { selfTest: process.argv.includes('--self-test') }));
Object.assign(result, await checkDesignResolutions(backlog, { selfTest: process.argv.includes('--self-test') }));
Object.assign(result, checkDomainVectors(backlog, { selfTest: process.argv.includes('--self-test') }));
Object.assign(result, await checkConfigurableWorkflow(backlog, architecture, { selfTest: process.argv.includes('--self-test') }));
Object.assign(result, await checkClosedLoop(root, backlog, architecture));
if (backlog.tasks.find(t => t.id === portfolio.qualifier_task).status === 'complete') {
  assert.ok([...privateLedger.gates, ...productionLedger.gates].every(g => ['verified','complete'].includes(g.status)), 'Full portfolio qualification requires every original P/E gate');
}
for (const contract of backlog.source_contracts) await access(path.join(root, contract));
const screenDocs = await Promise.all(['docs/product/SCREEN-CONTRACTS.md','docs/product/PORTFOLIO-UX.md','docs/product/MIGRATION-AND-COVERAGE.md'].map(file => readFile(path.join(root,file), 'utf8')));
for (const screen of backlog.screens) assert.ok(screenDocs.some(doc => doc.includes(`## ${screen} —`)), `${screen}: no screen contract`);
const modelDoc = await readFile(path.join(root,'docs/product/ENTERPRISE-MODEL.md'), 'utf8');
for (const lens of portfolio.lenses) assert.ok(modelDoc.includes(`| ${lens} `), `${lens}: no model perspective`);
const portfolioDoc = await readFile(path.join(root,'docs/product/PORTFOLIO-CONTRACT.md'), 'utf8');
for (const boundary of portfolio.boundaries) assert.ok(portfolioDoc.includes(`| ${boundary.id} |`), `${boundary.id}: no integration contract`);
const qualificationDoc = await readFile(path.join(root,'docs/production/PORTFOLIO-QUALIFICATION.md'), 'utf8');
for (const journey of portfolio.journeys) assert.ok(qualificationDoc.includes(`| ${journey.id} `), `${journey.id}: no journey contract`);
const scenarioDoc = await readFile(path.join(root,'docs/product/ENTERPRISE-SCENARIOS.md'), 'utf8');
for (const row of portfolio.enterprise_scenarios) assert.ok(scenarioDoc.includes(`| ${row.id} —`), `${row.id}: no enterprise story contract`);
for (const collection of ['requirements','saas_requirements','source_rules','source_acceptance','scenario_families','boundaries','high_risk_intersections','journeys','enterprise_scenarios']) {
  for (const row of portfolio[collection]) {
    for (const receipt of row.evidence) {
      const resolved = path.resolve(root, receipt);
      assert.ok(resolved.startsWith(path.join(root,'ops/checks') + path.sep), `${row.id}: evidence outside receipts`);
      await access(resolved);
    }
    if (row.status === 'pass' && row.test_path) await access(path.join(root,row.test_path));
  }
}
const sources = await read('docs/product/PORTFOLIO-SOURCES.json');
for (const file of [architecture.decisions_document, architecture.change_protocol, architecture.migration_contract, architecture.handoff_contract]) await access(path.join(root,file));
for (const receipt of [...architecture.invariants,...architecture.journeys].flatMap(row=>row.evidence).concat(architecture.packages.flatMap(p=>p.dependencyReceipts))) {
  const resolved=path.resolve(root,receipt);
  assert.ok(resolved.startsWith(path.join(root,'ops/checks')+path.sep),'Architecture evidence outside receipts');
  await access(resolved);
}
assert.equal(sources.revision, 3);
assert.ok(sources.sources.length >= 20, 'Missing local source provenance');
assert.equal(new Set(sources.sources.map(s => s.id)).size, sources.sources.length, 'Duplicate source ID');
for (const source of sources.sources) {
  assert.match(source.sha256, /^[a-f0-9]{64}$/);
  if (process.argv.includes('--verify-sources')) {
    const bytes = await readFile(path.resolve(root, source.file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256, `Changed source ${source.file}; review compatibility before repinning`);
  }
}
result.pinned_sources = sources.sources.length;
result.source_hashes_verified = process.argv.includes('--verify-sources');
const index = await readFile(path.join(root, 'docs/production/TASK-INDEX.md'), 'utf8');
for (const task of backlog.tasks) {
  assert.ok(index.includes(`| ${task.id} / ${task.story_id} | ${task.title} | ${task.depends_on.join(', ') || 'None'} |`), `${task.id}: stale task index`);
  for (const receipt of [...task.receipts, ...task.acceptance.flatMap(c => c.evidence)]) {
    assert.equal(typeof receipt, 'string');
    const resolved = path.resolve(root, receipt);
    assert.ok(resolved.startsWith(path.join(root, 'ops/checks') + path.sep), `${task.id}: evidence outside receipt directory`);
    await access(resolved);
  }
}
for (const [ledger,total] of [[privateLedger,12],[productionLedger,16]]) {
  assert.equal(ledger.total_gates, total, 'Gate denominator changed');
  assert.equal(ledger.gates.length, total);
  const completed = ledger.gates.filter(g => ['verified','complete'].includes(g.status));
  assert.equal(ledger.verified_completed_gates, completed.length, 'Ledger completion disagrees with gate states');
  for (const gate of completed) assert.ok(gate.receipts.length, `${gate.id}: verified without receipt`);
}
if (process.argv.includes('--self-test')) {
  const mutations = [
    ['dependency cycle', p => p.tasks[0].depends_on.push('T-48')],
    ['missing dependency', p => p.tasks[0].depends_on.push('T-9999')],
    ['duplicate story', p => { p.tasks[1].story_id = p.tasks[0].story_id; }],
    ['missing outcome coverage', p => { for (const t of p.tasks) t.outcomes = t.outcomes.filter(x => x !== 'O-03'); }],
    ['missing gate coverage', p => { for (const t of p.tasks) t.gates = t.gates.filter(x => x !== 'P-01'); }],
    ['unknown screen', p => p.tasks[0].screens.push('SC-99')],
    ['false task completion', p => { p.tasks[0].status = 'complete'; }],
    ['false acceptance pass', p => { p.tasks[0].acceptance[0].status = 'pass'; }],
  ];
  for (const [name,mutate] of mutations) {
    const copy = structuredClone(backlog); mutate(copy);
    assert.throws(() => validate(copy), undefined, `Validator missed ${name}`);
  }
  result.rejected_invalid_plans = mutations.length;
  result.rejected_invalid_portfolios = selfTestPortfolio(backlog, portfolio);
  result.rejected_invalid_architecture_or_packets = selfTestArchitecture(backlog,architecture,packetContract,protocolCases);
}
console.log(JSON.stringify({ status: 'pass', meaning: 'Specification structure and traceability only; no product acceptance inferred', ...result }, null, 2));
