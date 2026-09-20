import assert from 'node:assert/strict';

const sequence = (prefix, count) => Array.from({ length: count }, (_, i) => `${prefix}-${String(i + 1).padStart(2, '0')}`);
const sameSet = (actual, expected, label) => {
  assert.equal(new Set(actual).size, actual.length, `${label}: duplicate value`);
  assert.deepEqual([...actual].sort(), [...expected].sort(), `${label}: missing or unexpected coverage`);
};

export function validatePortfolio(plan, portfolio) {
  assert.equal(portfolio.schema_version, '1.0');
  assert.equal(portfolio.revision, 4);
  assert.equal(plan.revision, 4);
  sameSet(portfolio.products, ['STUDIO','SDLC','SENTINEL','WARDEN','ARBITER','STEWARD','LEDGER','OVERSEER','PLATFORM'], 'products');
  sameSet(portfolio.lenses, sequence('L', 16), 'lenses');
  const tasks = new Map(plan.tasks.map(t => [t.id, t]));
  const acceptances = new Map(plan.tasks.flatMap(t => t.acceptance.map(a => [a.id, a])));
  const statuses = new Set(['not_run', 'pass', 'fail', 'blocked']);
  const collections = ['requirements','saas_requirements','source_rules','source_acceptance','scenario_families','boundaries','high_risk_intersections','journeys','enterprise_scenarios'];
  for (const name of collections) {
    assert.ok(Array.isArray(portfolio[name]) && portfolio[name].length, `Missing ${name}`);
    const ids = new Set();
    for (const item of portfolio[name]) {
      assert.ok(!ids.has(item.id), `Duplicate ${name} ${item.id}`); ids.add(item.id);
      assert.ok(Array.isArray(item.task_ids) && item.task_ids.length, `${item.id}: no owning task`);
      sameSet(item.task_ids, [...new Set(item.task_ids)], `${item.id} task links`);
      for (const id of item.task_ids) assert.ok(tasks.has(id), `${item.id}: unknown task ${id}`);
      assert.ok(statuses.has(item.status), `${item.id}: invalid status`);
      assert.ok(Array.isArray(item.evidence), `${item.id}: no evidence array`);
      if (item.status === 'pass') {
        assert.ok(item.evidence.length, `${item.id}: pass without evidence`);
        assert.ok(item.task_ids.every(id => tasks.get(id).status === 'complete'), `${item.id}: incomplete owning task`);
      }
    }
  }
  sameSet(portfolio.requirements.map(x => x.id), Array.from({ length: 60 }, (_, i) => `PF-${i + 49}`), 'revision-3 requirement baseline');
  sameSet(portfolio.saas_requirements.map(x => x.id), Array.from({ length: 24 }, (_, i) => `PF-${i + 109}`), 'revision-4 SaaS/migration requirement baseline');
  const coveredTasks = new Set(), featureProducts = new Set(), featureLenses = new Set();
  for (const req of [...portfolio.requirements, ...portfolio.saas_requirements]) {
    assert.ok(req.title?.trim(), `${req.id}: missing title`);
    const owned = req.task_ids.map(id => tasks.get(id));
    sameSet(req.acceptance_ids, owned.flatMap(t => t.acceptance.map(a => a.id)), `${req.id} acceptance`);
    sameSet(req.products, [...new Set(owned.flatMap(t => t.products))], `${req.id} products`);
    sameSet(req.lenses, [...new Set(owned.flatMap(t => t.lenses))], `${req.id} lenses`);
    for (const t of owned) {
      assert.equal(t.requirement_id, req.id, `${t.id}: wrong requirement`);
      assert.ok(!coveredTasks.has(t.id), `${t.id}: multiple primary requirements`); coveredTasks.add(t.id);
      assert.ok(['feature','qualification'].includes(t.task_type), `${t.id}: missing task type`);
      sameSet(t.acceptance.map(a => a.kind), ['positive','negative','recovery','cross_boundary'], `${t.id}: acceptance kinds`);
      for (const p of t.products) {
        assert.ok(portfolio.products.includes(p), `${t.id}: unknown product ${p}`);
        if (t.task_type === 'feature') featureProducts.add(p);
      }
      for (const lens of t.lenses) {
        assert.ok(portfolio.lenses.includes(lens), `${t.id}: unknown lens ${lens}`);
        if (t.task_type === 'feature') featureLenses.add(lens);
      }
    }
    if (req.status === 'pass') assert.ok(req.acceptance_ids.every(id => acceptances.get(id).status === 'pass'), `${req.id}: unverified acceptance`);
  }
  sameSet([...coveredTasks], plan.tasks.filter(t => t.requirement_id).map(t => t.id), 'orphan portfolio tasks');
  sameSet([...featureProducts], portfolio.products, 'feature-level product coverage');
  sameSet([...featureLenses], portfolio.lenses, 'feature-level lens coverage');
  for (const [name,prefix,count] of [['source_rules','R',28],['source_acceptance','AT',33],['scenario_families','F',20],['boundaries','PC',12],['high_risk_intersections','X',8],['journeys','PQ',12]]) {
    sameSet(portfolio[name].map(x => x.id), sequence(prefix, count), name);
  }
  for (const row of [...portfolio.source_rules, ...portfolio.source_acceptance]) {
    assert.ok(row.title?.trim(), `${row.id}: missing source requirement`);
    assert.match(row.test_path, /^tests\/portfolio\/sentinel\/[a-z0-9-]+\.test\.mjs$/, `${row.id}: missing planned test fixture`);
  }
  for (const row of portfolio.source_rules) assert.ok(['base-v1','property-process-extension-v1','heuristic-v1'].includes(row.profile), `${row.id}: invalid profile`);
  for (const row of portfolio.scenario_families) assert.ok(row.variants?.length >= 3, `${row.id}: missing scenario variants`);
  sameSet(portfolio.enterprise_scenarios.map(x => x.id), sequence('ES', 24), 'enterprise scenario baseline');
  for (const row of portfolio.enterprise_scenarios) {
    assert.ok(row.actor?.length && row.title?.length && row.success?.length > 20 && row.adverse?.length > 20, `${row.id}: missing enterprise story`);
    assert.ok(['core','model_and_review','governed_adapter','qualified_domain_pack'].includes(row.support_class), `${row.id}: unknown support class`);
  }
  for (const row of portfolio.boundaries) assert.ok(row.mutation?.length > 20, `${row.id}: missing boundary mutation`);
  const families = new Set(portfolio.scenario_families.map(x => x.id));
  for (const row of portfolio.high_risk_intersections) {
    assert.ok(row.family_ids.length >= 3 && row.scenario?.length > 20, `${row.id}: underspecified intersection`);
    for (const id of row.family_ids) assert.ok(families.has(id), `${row.id}: unknown family ${id}`);
  }
  assert.equal(portfolio.qualifier_task, 'T-132');
  const seen = new Set();
  function visit(id) {
    assert.ok(tasks.has(id), `Unknown qualifier dependency ${id}`);
    if (seen.has(id)) return;
    seen.add(id); tasks.get(id).depends_on.forEach(visit);
  }
  visit(portfolio.qualifier_task);
  sameSet([...seen], [...tasks.keys()], 'full portfolio qualifier dependency closure');
  if (tasks.get(portfolio.qualifier_task).status === 'complete') {
    for (const name of collections) assert.ok(portfolio[name].every(row => row.status === 'pass'), `Full qualification missing ${name} evidence`);
  }
  return { portfolio_requirements: portfolio.requirements.length + portfolio.saas_requirements.length, products: portfolio.products.length, lenses: portfolio.lenses.length, source_rules: portfolio.source_rules.length, source_acceptance: portfolio.source_acceptance.length, enterprise_scenarios: portfolio.enterprise_scenarios.length, scenario_families: families.size, boundary_mutations: portfolio.boundaries.length, high_risk_intersections: portfolio.high_risk_intersections.length, portfolio_journeys: portfolio.journeys.length, final_dependency_closure: seen.size };
}

export function selfTestPortfolio(plan, portfolio) {
  const mutations = [
    ['missing product', (p,c) => c.products.pop()],
    ['missing requirement', (p,c) => c.requirements.pop()],
    ['unknown owner', (p,c) => c.requirements[0].task_ids.push('T-9999')],
    ['missing source rule', (p,c) => c.source_rules.pop()],
    ['duplicate source acceptance', (p,c) => c.source_acceptance[1].id = c.source_acceptance[0].id],
    ['untracked acceptance', (p,c) => c.requirements[0].acceptance_ids.pop()],
    ['false portfolio pass', (p,c) => c.requirements[0].status = 'pass'],
    ['missing recovery case', p => p.tasks.find(t => t.id === 'T-49').acceptance[2].kind = 'positive'],
    ['unknown lens', p => p.tasks.find(t => t.id === 'T-49').lenses.push('L-99')],
    ['omitted final feature', p => { const t = p.tasks.find(t => t.id === 'T-64'); t.depends_on = t.depends_on.filter(id => id !== 'T-58'); }],
    ['unknown scenario intersection', (p,c) => c.high_risk_intersections[0].family_ids.push('F-99')],
    ['missing boundary mutation', (p,c) => c.boundaries[0].mutation = ''],
    ['unknown rule profile', (p,c) => c.source_rules[0].profile = 'anything'],
    ['missing journey', (p,c) => c.journeys.pop()],
    ['missing enterprise scenario', (p,c) => c.enterprise_scenarios.pop()],
    ['unbounded domain claim', (p,c) => c.enterprise_scenarios[0].support_class = 'everything-supported'],
  ];
  for (const [name, mutate] of mutations) {
    const p = structuredClone(plan), c = structuredClone(portfolio); mutate(p,c);
    assert.throws(() => validatePortfolio(p,c), undefined, `Portfolio validator missed ${name}`);
  }
  return mutations.length;
}
