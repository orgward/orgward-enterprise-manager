import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { enterpriseCommandStorageKey, enterpriseContextFailure, enterpriseContextReadOnly, enterpriseQuery, enterpriseRequestPath, enterpriseSourceAligned, hasEnterpriseContext,
  enterpriseInterchangeDraftStorageKey, persistEnterpriseCommand, persistEnterpriseInterchangeDraft, renderEnterpriseContext,
  renderEnterpriseObject, renderEnterpriseObjectHeader, restoreEnterpriseCommand, restoreEnterpriseInterchangeDraft, submitEnterpriseCommand } from '../../public/enterprise.mjs';
import { enterpriseBranchCommandPayload, enterpriseBranchWritable, enterpriseCandidateCurrent, enterpriseCommandResultRoute,
  renderEnterpriseBranches } from '../../public/enterprise-branches.mjs';
import { enterpriseProcessCommandPayload, enterpriseTypedValue, renderEnterpriseProcess, renderEnterpriseSimulation } from '../../public/enterprise-process.mjs';
import { activationForTask, evaluateManualFlowAdvice, manualFlowActivation, manualFlowAllowsAgent, manualFlowAgentRequestReady, manualFlowDecisionDefinition,
  mergeProcessPlanActivation, renderManualFlowDecisionChoice } from '../../public/manual-flow-ui.mjs';
import { renderEnterpriseEconomics } from '../../public/enterprise-economics.mjs';
import { renderEnterpriseRefinement } from '../../public/enterprise-refinement.mjs';
import { enterpriseInterchangeCommandPayload, enterpriseInterchangeWritable, renderEnterpriseInterchange } from '../../public/enterprise-interchange.mjs';
import { enterpriseIntegrityCommandPayload, enterpriseIntegrityExceptionPayload, renderEnterpriseIntegrity } from '../../public/enterprise-integrity.mjs';
import { enterpriseGovernanceCommandPayload, renderEnterpriseGovernance } from '../../public/enterprise-governance.mjs';
import { enterpriseStewardshipPayload, renderEnterpriseStewardship } from '../../public/enterprise-stewardship.mjs';
import { enterpriseSentinelCommandPayload, renderEnterpriseSentinel } from '../../public/enterprise-sentinel.mjs';
import { downloadPortfolioDesign, downloadPortfolioInventory, portfolioDesignExportFilename, portfolioInventoryBundle,
  portfolioInventoryFilename, projectPortfolioFacts, readPortfolioImportFile, renderProjectPortfolio,
  portfolioImportWorkspaceRoute, portfolioManageAccessRoute, verifyPortfolioDesignBundle } from '../../public/project-portfolio.mjs';
import { createProjectAccessController, platformViewUrl, projectAccessIdFromSearch, projectAccessSelectionMessage,
  createProjectMemberActions, resolveProjectAccessSelection } from '../../public/platform-sharing.mjs';
import { digest } from '../../src/sdlc/contracts.mjs';
import { isValidEnterpriseIntegrityAssessment, projectEnterpriseIntegrity } from '../../src/enterprise/integrity.mjs';
import { projectPortfolioIntegritySummary } from '../../src/platform/postgres-stores.mjs';
import { decodeStudioRoute, encodeStudioRoute } from '../../public/shared-interactions.mjs';
import { savedProjectPinSummary, sentinelAssessmentChoices } from '../../public/sdlc-view.mjs';
import { renderOutcomeInbox } from '../../public/outcomes.mjs';
import { renderProtectedRelease } from '../../public/protected-release.mjs';
import { renderBlueprintImpactPreview } from '../../public/blueprint-impact-preview.mjs';
import { renderChatBlueprintEdit } from '../../public/chat-blueprint-edit.mjs';

class NodeListFixture extends Array {
  constructor(entries) { super(...entries); this.at = undefined; }
  item(index) { return this[index] ?? null; }
}

class NodeFixture {
  constructor(tagName, options = {}) {
    this.tagName = tagName;
    this.attrs = options.attrs ?? {};
    this.text = options.text ?? '';
    this.className = options.className ?? '';
    this.children = [];
    this.listeners = new Map();
    this._value = options.attrs?.value ?? '';
    this.disabled = false;
    this.hidden = false;
    this.required = false;
    this.parent = null;
  }
  append(...nodes) {
    for (const node of nodes) { node.parent = this; this.children.push(node); }
    if (this.tagName === 'select' && !this.children.some((option) => String(option.attrs.value ?? '') === this._value)) {
      this._value = String(this.children[0]?.attrs.value ?? '');
    }
  }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  querySelectorAll(selector) {
    const selectors = selector.split(',').map((part) => part.trim());
    const matches = (child) => selectors.some((entry) => {
      const attribute = entry.match(/^\[([\w-]+)\]$/);
      return attribute ? Object.hasOwn(child.attrs, attribute[1]) : entry === child.tagName;
    });
    return new NodeListFixture(this.children.flatMap((child) => [
      ...(matches(child) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]));
  }
  reportValidity() { return true; }
  get value() {
    if (this.tagName === 'select') return this.children.find((option) => String(option.attrs.value ?? '') === this._value)?.attrs.value
      ?? this.children[0]?.attrs.value ?? '';
    return this._value;
  }
  set value(value) {
    const selected = String(value ?? '');
    if (this.tagName === 'select') {
      this._value = this.children.some((option) => String(option.attrs.value ?? '') === selected)
        ? selected : String(this.children[0]?.attrs.value ?? '');
    } else this._value = selected;
  }
  get firstChild() {
    if (this.text) {
      const parent = this;
      return { get textContent() { return parent.text; }, set textContent(value) { parent.text = String(value); }, parent };
    }
    return this.children[0] ?? null;
  }
  get textContent() { return [this.text, ...this.children.map((child) => child.textContent)].filter(Boolean).join(' '); }
  set textContent(value) { this.text = String(value); this.children = []; }
}

const el = (tag, options = {}, children = []) => {
  const node = new NodeFixture(tag, options);
  node.append(...(Array.isArray(children) ? children : [children]));
  return node;
};

test('blueprint impact preview shows exact pins, direct changes and explicit unknown downstream areas', () => {
  const preview = renderBlueprintImpactPreview({ status: 'INCOMPLETE',
    source: { blueprintId: 'blueprint-source', blueprintVersion: 7, projectVersion: 19, snapshotHash: 'a'.repeat(64) },
    proposedBlueprintVersion: 8,
    changedFields: [{ field: 'ownerRoleName', before: 'Operations owner', after: 'Founder' }],
    directlyAffectedObjects: [{ objectId: 'process-deliver', name: 'Deliver service', type: 'process', edited: true,
      source: { blueprintVersion: 7 } }, { objectId: 'role-operations', name: 'Operations', type: 'role', edited: false,
      source: { blueprintVersion: 7 } }],
    unknownAreas: ['Approvals and queued, running, or completed work'],
    limitation: 'This read-only preview does not authorize publication.' }, el);
  assert.match(preview.textContent, /Impact preview · INCOMPLETE/);
  assert.match(preview.textContent, /blueprint-source v7 · workspace v19/);
  assert.match(preview.textContent, /ownerRoleName: "Operations owner" → "Founder"/);
  assert.match(preview.textContent, /Operations · role · directly connected · source v7/);
  assert.match(preview.textContent, /Approvals and queued, running, or completed work/);
  assert.match(preview.textContent, /does not authorize publication/);
  const branchPreview = renderBlueprintImpactPreview({ status: 'INCOMPLETE',
    source: { kind: 'BRANCH_DRAFT', blueprintId: 'blueprint-branch-head', blueprintVersion: 4,
      projectVersion: 21, snapshotHash: 'b'.repeat(64), branchId: 'enterprise-branch-1', branchRevision: 6,
      mainBlueprintId: 'blueprint-main', mainBlueprintVersion: 9, mainSnapshotHash: 'c'.repeat(64) },
    proposedBlueprintVersion: 4, proposedBranchRevision: 7, changedFields: [], directlyAffectedObjects: [],
    unknownAreas: [], limitation: 'Read only.' }, el);
  assert.match(branchPreview.textContent, /branch enterprise-branch-1 revision 6/);
  assert.match(branchPreview.textContent, /main blueprint blueprint-main v9 SHA-256 c{64}/);
  assert.match(branchPreview.textContent, /Proposed branch revision 7/);
});

test('chat blueprint edit previews one exact customer replacement and only applies the unchanged current draft', async () => {
  const project = { id: 'project-one', version: 5, phase: 'blueprint_ready', latestBlueprint: { id: 'blueprint-one', version: 2,
    areas: { customers: { items: [{ id: 'customer-one', type: 'customer', name: 'Northstar customer', detail: 'Original customer detail.' }] } } } };
  const model = { permissions: { write: true }, context: { projectVersion: 5, blueprintId: 'blueprint-one', blueprintVersion: 2,
    snapshotHash: 'a'.repeat(64), isCurrent: true, sourceKind: 'MAIN_DESIGN' } };
  let current = { projectId: 'project-one', projectVersion: 5, blueprintId: 'blueprint-one', blueprintVersion: 2,
    snapshotHash: 'a'.repeat(64), selectedId: 'customer-one', writable: true };
  const calls = []; const applied = [];
  const panel = renderChatBlueprintEdit({ project, model, selectedId: 'customer-one', writable: true,
    readCurrentSource: () => current, el,
    api: async (path, options) => { calls.push([path, JSON.parse(options.body)]); return { data: {
      status: 'INCOMPLETE', source: { projectId: 'project-one', projectVersion: 5, blueprintId: 'blueprint-one',
        blueprintVersion: 2, snapshotHash: 'a'.repeat(64), kind: 'MAIN_DESIGN' }, proposedBlueprintVersion: 3,
      changedFields: [{ field: 'detail', before: 'Original customer detail.', after: 'Updated customer detail.' }],
      directlyAffectedObjects: [{ objectId: 'customer-one', name: 'Northstar customer', type: 'customer', edited: true,
        source: { blueprintVersion: 2 } }], coverage: { operationalAndDownstreamImpact: 'UNKNOWN' },
      unknownAreas: ['Sentinel, approvals, queued, running, or completed work'], limitation: 'Preview does not grant publication authority.' } }; },
    onApply: async (...args) => applied.push(args) });
  const find = (node, predicate) => predicate(node) ? node : node.children.map((child) => find(child, predicate)).find(Boolean);
  const form = find(panel, (node) => node.tagName === 'form');
  const field = find(form, (node) => node.attrs.name === 'field');
  const value = find(form, (node) => node.attrs.name === 'replacement');
  const apply = find(form, (node) => node.tagName === 'button' && node.text === 'Apply proposed change');
  assert.equal(apply.disabled, true);
  assert.equal(value.attrs.maxlength, '700');
  field.value = 'name'; field.listeners.get('change')?.();
  assert.equal(value.attrs.maxlength, '120');
  field.value = 'detail'; value.value = '  Updated customer detail  ';
  value.listeners.get('input')?.();
  await form.listeners.get('submit')?.({ preventDefault() {} });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/v1/projects/project-one/enterprise/impact-preview');
  assert.equal(calls[0][1].expectedVersion, 5);
  assert.deepEqual(calls[0][1].command, { kind: 'edit-blueprint-object', blueprintId: 'blueprint-one', blueprintVersion: 2,
    objectId: 'customer-one', name: 'Northstar customer', detail: 'Updated customer detail',
    reason: 'Chat proposed an exact customer name or detail replacement.' });
  assert.match(panel.textContent, /Updated customer detail/);
  assert.match(panel.textContent, /INCOMPLETE/);
  assert.match(panel.textContent, /UNKNOWN/);
  assert.equal(apply.disabled, false);
  await apply.listeners.get('click')?.();
  assert.equal(applied.length, 1);
  assert.equal(applied[0][0].detail, 'Updated customer detail');
  assert.match(applied[0][1], /^chat-blueprint-edit:/);
  assert.equal(applied[0][2], 5);
  value.value = 'A changed after preview'; value.listeners.get('input')?.();
  assert.equal(apply.disabled, true, 'editing the value invalidates the preview');
});

test('chat blueprint edit discards a late preview after selected target changes and excludes actor identities', async () => {
  const project = { id: 'project-one', version: 5, phase: 'blueprint_ready', latestBlueprint: { id: 'blueprint-one', version: 2,
    areas: { customers: { items: [{ id: 'customer-one', type: 'customer', name: 'Northstar customer', detail: 'Original.' }] } } } };
  const model = { permissions: { write: true }, context: { projectVersion: 5, blueprintId: 'blueprint-one', blueprintVersion: 2,
    snapshotHash: 'a'.repeat(64), isCurrent: true, sourceKind: 'MAIN_DESIGN' } };
  let current = { projectId: 'project-one', projectVersion: 5, blueprintId: 'blueprint-one', blueprintVersion: 2,
    snapshotHash: 'a'.repeat(64), selectedId: 'customer-one', writable: true };
  let finishPreview;
  const panel = renderChatBlueprintEdit({ project, model, selectedId: 'customer-one', writable: true,
    readCurrentSource: () => current, el, api: () => new Promise((resolve) => { finishPreview = resolve; }), onApply() { assert.fail('late preview must not apply'); } });
  const find = (node, predicate) => predicate(node) ? node : node.children.map((child) => find(child, predicate)).find(Boolean);
  const form = find(panel, (node) => node.tagName === 'form');
  const value = find(form, (node) => node.attrs.name === 'replacement');
  const apply = find(form, (node) => node.tagName === 'button' && node.text === 'Apply proposed change');
  value.value = 'Proposed customer detail'; value.listeners.get('input')?.();
  const pending = form.listeners.get('submit')?.({ preventDefault() {} });
  current = { ...current, selectedId: 'another-customer' };
  finishPreview({ data: { status: 'INCOMPLETE', source: { kind: 'MAIN_DESIGN', projectVersion: 5,
    blueprintId: 'blueprint-one', blueprintVersion: 2, snapshotHash: 'a'.repeat(64) }, proposedBlueprintVersion: 3,
    changedFields: [], directlyAffectedObjects: [], unknownAreas: [], limitation: 'Not complete.' } });
  await pending;
  assert.equal(apply.disabled, true);
  const actorProject = { ...project, latestBlueprint: { ...project.latestBlueprint,
    areas: { identity: { items: [{ id: 'actor-founder', type: 'actor-human', name: 'Founder', detail: 'Human owner.' }] } } } };
  const actorPanel = renderChatBlueprintEdit({ project: actorProject, model, selectedId: 'actor-founder', writable: true,
    readCurrentSource: () => ({ ...current, selectedId: 'actor-founder' }), el, api: async () => assert.fail('actor must not preview'), onApply() {} });
  assert.equal(find(actorPanel, (node) => node.tagName === 'form'), undefined);
  assert.match(actorPanel.textContent, /Actor identities and other record types are not available/);
  for (const context of [
    { ...model.context, sourceKind: 'BRANCH_DRAFT', branchId: 'branch-one' },
    { ...model.context, isCurrent: false },
  ]) {
    const readOnlyPanel = renderChatBlueprintEdit({ project, model: { ...model, context }, selectedId: 'customer-one', writable: true,
      readCurrentSource: () => current, el, api: async () => assert.fail('non-current source must not preview'), onApply() {} });
    assert.equal(find(readOnlyPanel, (node) => node.tagName === 'form'), undefined);
  }
});

test('portfolio cards show saved workspace state and access and open the chosen project', () => {
  const opened = [];
  const exported = [];
  const imported = [];
  const projects = [
    { id: 'project-a', name: 'Northstar', phase: 'design', blueprintVersion: 3,
      workspaceAccess: 'editor', openIncidentCount: 2, openSupportCount: 1, activeChangeCaseCount: 2,
      latestActiveChangeCaseId: 'change-case-00000000-0000-4000-8000-000000000012',
      latestActiveChangeCaseTitle: 'Customer data migration', integrityStatus: 'REVIEW', integritySourceCurrent: true,
      integrityReportId: 'enterprise-integrity-00000000-0000-4000-8000-000000000013', integrityFindingCount: 4,
      integrityBlueprintVersion: 3, updatedAt: '2026-10-03T12:00:00.000Z' },
    { id: 'project-b', name: 'Harbor', phase: 'discovery', blueprintVersion: null,
      workspaceAccess: 'reader', updatedAt: '2026-10-02T12:00:00.000Z' },
  ];
  const rendered = renderProjectPortfolio(projects, {
    el, onOpen: (id, options) => opened.push(options ? [id, options] : id),
    onExport: (id, button) => exported.push([id, button.text]),
    onImport: (id, file) => imported.push([id, file.name]),
  });
  assert.match(rendered.textContent, /Your portfolio Workspaces/);
  assert.match(rendered.textContent, /Northstar Editor access design Blueprint version 3/);
  assert.match(rendered.textContent, /Active incidents: 2 · Active support: 1/);
  assert.match(rendered.textContent, /Active governed changes: 2/);
  assert.match(rendered.textContent, /Integrity REVIEW · 4 findings · current blueprint v3/);
  assert.match(rendered.textContent, /Harbor Reader access discovery No saved blueprint yet/);
  const secondCard = rendered.children[1].children[1];
  const openButton = secondCard.children.find((child) => child.tagName === 'button');
  openButton.listeners.get('click')();
  const reviewIncidents = rendered.children[1].children[0].children.find((child) => child.text === 'Review incidents (2)');
  reviewIncidents.listeners.get('click')();
  const reviewSupport = rendered.children[1].children[0].children.find((child) => child.text === 'Review support (1)');
  reviewSupport.listeners.get('click')();
  const reviewIntegrity = rendered.children[1].children[0].children.find((child) => child.tagName === 'button' && child.text === 'Review integrity report');
  reviewIntegrity.listeners.get('click')();
  assert.deepEqual(opened, ['project-b', ['project-a', { focusOutcomes: true, focusOutcomeCategory: 'incident' }],
    ['project-a', { focusOutcomes: true, focusOutcomeCategory: 'support' }], ['project-a', { focusIntegrity: true }]]);
  const exportButton = rendered.children[1].children[0].children.find((child) => child.text === 'Export proposed design JSON');
  exportButton.listeners.get('click')();
  assert.deepEqual(exported, [['project-a', 'Export proposed design JSON']]);
  const governedChange = rendered.children[1].children[0].children.find((child) => child.tagName === 'a');
  assert.equal(governedChange.text, 'Open governed change: Customer data migration');
  assert.equal(governedChange.attrs.href, '/sdlc.html?case=change-case-00000000-0000-4000-8000-000000000012');
  const importLabel = rendered.children[1].children[0].children.find((child) => child.tagName === 'label');
  const importInput = importLabel.children[0];
  importInput.files = [{ name: 'customer-design.json', size: 42 }];
  importInput.listeners.get('change')();
  assert.deepEqual(imported, [['project-a', 'customer-design.json']]);
  const noBlueprint = rendered.children[1].children[1].children.find((child) => child.tagName === 'label').children[0];
  assert.equal(Object.hasOwn(noBlueprint.attrs, 'disabled'), true, 'projects without a saved blueprint cannot start an import');
  assert.equal(projectPortfolioFacts({}).access, 'Local workspace');
  const returned = renderProjectPortfolio([{ ...projects[0], openIncidentCount: 0, openSupportCount: 0 }], { el, onOpen() {} });
  assert.match(returned.textContent, /Active incidents: 0 · Active support: 0/);
  assert.equal(returned.children[1].children[0].children.some((child) => /Review (incidents|support)/.test(child.text)), false,
    'the refreshed portfolio removes category review actions after all incident/support items are closed');
});

test('portfolio owner access action opens management for the exact workspace', () => {
  const portfolio = renderProjectPortfolio([
    { id: 'workspace-owner/a', name: 'Owner workspace', workspaceAccess: 'owner' },
    { id: 'workspace-editor', name: 'Editor workspace', workspaceAccess: 'editor' },
    { id: 'workspace-reader', name: 'Reader workspace', workspaceAccess: 'reader' },
  ], { el, onOpen() {}, onExport() {}, onImport() {} });
  const cards = portfolio.querySelectorAll('[data-project-id]');
  const ownerCard = cards.find((card) => card.attrs['data-project-id'] === 'workspace-owner/a');
  const ownerAction = ownerCard.querySelectorAll('a').find((link) => link.text === 'Manage workspace access');
  assert.equal(ownerAction.attrs.href, '/platform.html?projectId=workspace-owner%2Fa#enterprise');
  for (const id of ['workspace-editor', 'workspace-reader']) {
    const card = cards.find((entry) => entry.attrs['data-project-id'] === id);
    assert.equal(card.querySelectorAll('a').some((link) => link.text === 'Manage workspace access'), false,
      `${id} cannot see an owner access-management action`);
  }
});

test('portfolio inventory export captures a membership-scoped active and archived summary only', () => {
  const active = [{ id: 'project-active', tenantId: 'tenant-private', name: 'Active workspace', workspaceAccess: 'editor',
    phase: 'design', blueprintVersion: 4, updatedAt: '2026-10-05T09:30:00.000Z', historyEventCount: 18,
    openIncidentCount: 2, openSupportCount: 1, activeChangeCaseCount: 3, integrityStatus: 'REVIEW',
    integritySourceCurrent: false, integrityFindingCount: 2, integrityBlueprintVersion: 3,
    members: [{ principal: 'private-member' }], events: [{ detail: 'private event body' }] }];
  const archived = [{ id: 'project-archived', tenantId: 'tenant-private', name: 'Archived workspace', workspaceAccess: 'owner',
    lifecycle: { status: 'archived', reason: 'private archive reason' }, historyEventCount: 11 }];
  const bundle = portfolioInventoryBundle(active, archived, { now: () => new Date('2026-10-05T10:00:00.000Z') });
  assert.equal(bundle.kind, 'orgward-enterprise-portfolio-inventory');
  assert.equal(bundle.schemaVersion, '1.0');
  assert.equal(bundle.exportedAt, '2026-10-05T10:00:00.000Z');
  assert.deepEqual(bundle.counts, { active: 1, archived: 1 });
  assert.deepEqual(bundle.workspaces[0], { id: 'project-active', name: 'Active workspace', access: 'editor', lifecycle: 'active',
    phase: 'design', blueprintVersion: 4, lastSavedAt: '2026-10-05T09:30:00.000Z', historyEventCount: 18,
    activeOutcomes: { incidents: 2, support: 1 }, activeGovernedChanges: 3,
    integrity: { status: 'REVIEW', sourceCurrent: false, findingCount: 2, blueprintVersion: 3, projectionIncomplete: false } });
  assert.equal(bundle.workspaces[1].lifecycle, 'archived');
  const json = JSON.stringify(bundle);
  for (const privateValue of ['tenant-private', 'private-member', 'private event body', 'private archive reason']) {
    assert.equal(json.includes(privateValue), false, `inventory omits ${privateValue}`);
  }
  assert.equal(portfolioInventoryFilename(bundle), 'orgward-portfolio-inventory-2026-10-05.json');
});

test('portfolio inventory action downloads the exact summary JSON bundle', async () => {
  const active = [{ id: 'project-download', name: 'Download workspace', workspaceAccess: 'owner', blueprintVersion: 2 }];
  let clickedAnchor = null;
  let downloadedBlob = null;
  const revoked = [];
  const download = downloadPortfolioInventory(active, [], { el: (tag, options) => {
    const anchor = el(tag, options); anchor.click = () => { clickedAnchor = anchor; }; return anchor;
  }, createObjectURL: (blob) => { downloadedBlob = blob; return 'blob:portfolio-inventory'; },
  revokeObjectURL: (url) => revoked.push(url), deferRevoke: (callback) => callback(),
  now: () => new Date('2026-10-05T10:00:00.000Z') });
  assert.equal(download.fileName, 'orgward-portfolio-inventory-2026-10-05.json');
  assert.deepEqual(download.counts, { active: 1, archived: 0 });
  assert.equal(clickedAnchor.attrs.download, download.fileName);
  assert.equal(clickedAnchor.attrs.href, 'blob:portfolio-inventory');
  assert.deepEqual(revoked, ['blob:portfolio-inventory']);
  const savedBundle = JSON.parse(await downloadedBlob.text());
  assert.equal(savedBundle.workspaces[0].id, 'project-download');

  let exportInvoked = null;
  const portfolio = renderProjectPortfolio(active, { el, onOpen() {}, onExportInventory: (button) => { exportInvoked = button.text; } });
  const exportButton = portfolio.querySelectorAll('button').find((button) => button.text === 'Export portfolio inventory JSON');
  assert.ok(exportButton);
  exportButton.listeners.get('click')();
  assert.equal(exportInvoked, 'Export portfolio inventory JSON');
});

test('portfolio starts a governed change from the exact writable workspace', () => {
  const portfolio = renderProjectPortfolio([
    { id: 'project-owner/workspace', name: 'Owner design', blueprintVersion: 4, workspaceAccess: 'owner' },
    { id: 'project-editor', name: 'Editor design', blueprintVersion: 2, workspaceAccess: 'editor' },
    { id: 'project-reader', name: 'Reader design', blueprintVersion: 5, workspaceAccess: 'reader' },
    { id: 'project-no-design', name: 'Unstarted design', workspaceAccess: 'owner' },
  ], { el, onOpen() {}, onExport() {}, onImport() {} });
  const cards = portfolio.querySelectorAll('[data-project-id]');
  const startLink = (id) => cards.find((card) => card.attrs['data-project-id'] === id)
    .querySelectorAll('a').find((link) => link.text === 'Start governed change');
  assert.equal(startLink('project-owner/workspace').attrs.href, '/sdlc.html?projectId=project-owner%2Fworkspace');
  assert.equal(startLink('project-editor').attrs.href, '/sdlc.html?projectId=project-editor');
  assert.equal(startLink('project-reader'), undefined, 'readers cannot start a writer-authorized case from the portfolio');
  assert.equal(startLink('project-no-design'), undefined, 'a saved source blueprint is required before starting a case');
});

test('portfolio incident and support creation handoffs are exact-workspace and writer scoped', () => {
  const opened = [];
  const portfolio = renderProjectPortfolio([
    { id: 'project-owner', name: 'Owner workspace', workspaceAccess: 'owner' },
    { id: 'project-editor', name: 'Editor workspace', workspaceAccess: 'editor' },
    { id: 'project-reader', name: 'Reader workspace', workspaceAccess: 'reader' },
  ], { el, archivedProjects: [{ id: 'project-archived-owner', name: 'Archived owner workspace', workspaceAccess: 'owner',
    lifecycle: { status: 'archived', reason: 'Retained.' } }], onOpen: (id, options) => opened.push([id, options]), onExport() {} });
  const cards = portfolio.querySelectorAll('[data-project-id]');
  const cardFor = (id) => cards.find((card) => card.attrs['data-project-id'] === id);
  const action = (card, text) => card.querySelectorAll('button').find((button) => button.text === text);
  for (const id of ['project-owner', 'project-editor']) {
    assert.ok(action(cardFor(id), 'Report incident'));
    assert.ok(action(cardFor(id), 'Request support'));
  }
  for (const label of ['Report incident', 'Request support']) assert.equal(action(cardFor('project-reader'), label), undefined,
    `readers do not see ${label.toLowerCase()} handoffs`);
  action(cardFor('project-owner'), 'Report incident').listeners.get('click')();
  action(cardFor('project-editor'), 'Request support').listeners.get('click')();
  assert.deepEqual(opened, [['project-owner', { focusOutcomes: true, focusOutcomeCategory: 'incident' }],
    ['project-editor', { focusOutcomes: true, focusOutcomeCategory: 'support' }]]);

  portfolio.querySelectorAll('button').find((button) => button.text === 'Archived workspaces').listeners.get('click')();
  const archivedCard = portfolio.querySelectorAll('[data-project-id]')[0];
  assert.equal(action(archivedCard, 'Report incident'), undefined);
  assert.equal(action(archivedCard, 'Request support'), undefined);
  assert.ok(action(archivedCard, 'Restore workspace'));
});

test('platform access management deep link selects the requested workspace', async () => {
  const projects = [
    { id: 'workspace-owner-first', workspaceAccess: 'owner' },
    { id: 'workspace-editor', workspaceAccess: 'editor' },
    { id: 'workspace-reader', workspaceAccess: 'reader' },
    { id: 'workspace-owner-requested', workspaceAccess: 'owner' },
  ];
  let currentUrl = '/platform.html?tab=access&projectId=old#enterprise';
  const ownerFetches = [];
  let selectionState = null;
  const controller = createProjectAccessController({ getProjects: () => projects,
    fetchMembers: async (id) => { ownerFetches.push(id); return [{ principal: 'owner-requested', access: 'owner' }]; },
    onState: (value) => { selectionState = value; },
  });
  const selectedOwner = await controller('workspace-owner-requested', {
    updateUrl: true, search: '?tab=access&projectId=old', view: 'enterprise', onUrlUpdate: (url) => { currentUrl = url; },
  });
  assert.deepEqual(selectedOwner, { projectId: 'workspace-owner-requested', status: 'owner', members: [{ principal: 'owner-requested', access: 'owner' }], loading: false, error: null, stale: false });
  assert.deepEqual(ownerFetches, ['workspace-owner-requested']);
  assert.equal(currentUrl, '/platform.html?tab=access&projectId=workspace-owner-requested#enterprise');
  const selectedAfterReload = await controller(projectAccessIdFromSearch(new URL(currentUrl, 'https://local.test').search));
  assert.equal(selectedAfterReload.projectId, 'workspace-owner-requested', 'the URL restores the dropdown selection after reload');

  for (const access of ['editor', 'reader']) {
    const id = `workspace-${access}`;
    let deniedUrl = '';
    const deniedSelection = await controller(id, {
      updateUrl: true, view: 'enterprise', onUrlUpdate: (url) => { deniedUrl = url; },
    });
    assert.deepEqual(deniedSelection, { projectId: id, status: 'denied', members: [], loading: false, error: null, stale: false });
    assert.equal(deniedUrl, `/platform.html?projectId=${id}#enterprise`);
    assert.equal(ownerFetches.length, 2, `${access} selection must not call the project members endpoint`);
    assert.equal(selectionState.projectId, id);
    assert.equal(selectionState.members.length, 0);
    assert.equal(selectionState.loading, false);
    assert.equal(selectionState.error, null);
  }
  assert.match(projectAccessSelectionMessage('denied'), /only to the owner.*No other workspace was selected/);
  assert.deepEqual(resolveProjectAccessSelection(projects, 'workspace-missing'),
    { projectId: '', status: 'unavailable' });
  assert.match(projectAccessSelectionMessage('unavailable'), /not available to your account.*No other workspace was selected/);
  assert.deepEqual(resolveProjectAccessSelection(projects, null),
    { projectId: '', status: 'unavailable' });
  assert.equal(platformViewUrl('enterprise', '?projectId=workspace-owner-requested'),
    '/platform.html?projectId=workspace-owner-requested#enterprise');
});

test('platform owner manages a collaborator through the selected workspace access view', async () => {
  const principal = `oidc:${'a'.repeat(64)}`;
  const ownerPrincipal = `oidc:${'b'.repeat(64)}`;
  const sharing = { projectId: 'project-selected-owner', deepLinkStatus: null, busy: false,
    error: null, message: '', members: [{ principal: ownerPrincipal, access: 'owner' }] };
  const calls = [];
  let renders = 0;
  const actions = createProjectMemberActions({
    getSharing: () => sharing,
    api: async (route, options) => {
      const body = JSON.parse(options.body);
      calls.push({ route, method: options.method, body });
      if (route.endsWith('/members')) {
        const existing = sharing.members.find((member) => member.principal === body.principal);
        if (existing) existing.access = body.access;
        else sharing.members.push({ principal: body.principal, access: body.access });
      } else {
        sharing.members = sharing.members.filter((member) => member.principal !== principal);
      }
      return { data: {} };
    },
    reloadMembers: async (projectId) => {
      assert.equal(projectId, 'project-selected-owner', 'the selected workspace ID scopes every roster refresh');
    },
    render: () => { renders += 1; },
  });
  const form = { elements: { principal: { value: ` ${principal} ` }, access: { value: 'reader' } } };
  let prevented = false;
  await actions.submit({ target: form, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true, 'the access form command prevents browser navigation');
  assert.deepEqual(calls[0], { route: '/api/v1/projects/project-selected-owner/members', method: 'POST',
    body: { principal, access: 'reader' } });
  assert.equal(sharing.members.find((member) => member.principal === principal)?.access, 'reader');
  assert.equal(sharing.message, 'Project access updated.');

  form.elements.access.value = 'editor';
  await actions.submit({ target: form, preventDefault() {} });
  assert.equal(sharing.members.find((member) => member.principal === principal)?.access, 'editor',
    'the same form updates the collaborator role');
  assert.equal(calls[1].body.access, 'editor');
  await actions.revoke(principal);
  assert.deepEqual(calls[2], { route: `/api/v1/projects/project-selected-owner/members/${principal}/revoke`, method: 'POST', body: {} });
  assert.equal(sharing.members.some((member) => member.principal === principal), false);
  assert.equal(sharing.message, 'Project access removed.');
  assert.equal(sharing.busy, false);
  assert.equal(renders, 6, 'each access action renders its saving and completed state');

  sharing.deepLinkStatus = 'denied';
  await actions.revoke(principal);
  assert.equal(calls.length, 3, 'a denied non-owner selection cannot issue membership mutations');
});

test('platform access selection ignores a stale members response after a newer non-owner selection', async () => {
  const projects = [
    { id: 'workspace-owner-a', workspaceAccess: 'owner' },
    { id: 'workspace-editor-b', workspaceAccess: 'editor' },
    { id: 'workspace-reader-b', workspaceAccess: 'reader' },
  ];
  let resolveOwnerMembers;
  let rejectOwnerMembers;
  let currentUrl = '';
  let rendered = null;
  const renderSnapshots = [];
  const fetches = [];
  const controller = createProjectAccessController({ getProjects: () => projects,
    fetchMembers: (projectId) => {
      fetches.push(projectId);
      return new Promise((resolve, reject) => { resolveOwnerMembers = resolve; rejectOwnerMembers = reject; });
    },
    onState: (selection) => {
      rendered = { ...selection, showMembershipControls: selection.status === 'owner' && selection.members.length > 0 };
      renderSnapshots.push(rendered);
    },
  });
  const ownerPending = controller('workspace-owner-a', { updateUrl: true,
    onUrlUpdate: (url) => { currentUrl = url; } });
  assert.equal(rendered.projectId, 'workspace-owner-a');
  assert.equal(rendered.loading, true);
  const editorSelected = await controller('workspace-editor-b', { updateUrl: true,
    onUrlUpdate: (url) => { currentUrl = url; } });
  assert.equal(editorSelected.status, 'denied');
  assert.equal(currentUrl, '/platform.html?projectId=workspace-editor-b#enterprise');
  assert.equal(rendered.projectId, 'workspace-editor-b');
  assert.equal(rendered.members.length, 0);
  assert.equal(rendered.loading, false);
  assert.equal(rendered.error, null);
  assert.equal(rendered.showMembershipControls, false);
  assert.deepEqual(fetches, ['workspace-owner-a'], 'the editor selection does not make a members request');

  const visibleSelection = rendered;
  const renderCount = renderSnapshots.length;
  resolveOwnerMembers([{ principal: 'owner-a-member', access: 'owner' }]);
  const staleOwnerResult = await ownerPending;
  assert.equal(staleOwnerResult.stale, true);
  assert.equal(renderSnapshots.length, renderCount, 'a stale success does not render after the newer selection');
  assert.equal(rendered, visibleSelection);
  assert.equal(rendered.projectId, 'workspace-editor-b');
  assert.deepEqual(rendered.members, []);
  assert.equal(rendered.loading, false);
  assert.equal(rendered.error, null);
  assert.equal(rendered.showMembershipControls, false);

  const ownerPendingFailure = controller('workspace-owner-a', { updateUrl: true,
    onUrlUpdate: (url) => { currentUrl = url; } });
  const readerSelected = await controller('workspace-reader-b', { updateUrl: true,
    onUrlUpdate: (url) => { currentUrl = url; } });
  assert.equal(readerSelected.status, 'denied');
  assert.equal(currentUrl, '/platform.html?projectId=workspace-reader-b#enterprise');
  assert.equal(rendered.projectId, 'workspace-reader-b');
  assert.deepEqual(rendered.members, []);
  assert.equal(rendered.loading, false);
  assert.equal(rendered.error, null);
  assert.equal(rendered.showMembershipControls, false);
  const readerState = rendered;
  const readerRenderCount = renderSnapshots.length;
  rejectOwnerMembers(new Error('stale owner A request failed'));
  const staleOwnerFailure = await ownerPendingFailure;
  assert.equal(staleOwnerFailure.stale, true);
  assert.equal(renderSnapshots.length, readerRenderCount, 'a stale error does not render after the newer selection');
  assert.equal(rendered, readerState);
  assert.equal(currentUrl, '/platform.html?projectId=workspace-reader-b#enterprise');
  assert.equal(rendered.projectId, 'workspace-reader-b');
  assert.deepEqual(rendered.members, []);
  assert.equal(rendered.loading, false);
  assert.equal(rendered.error, null, 'the stale owner error never replaces the newer state');
  assert.equal(rendered.showMembershipControls, false);
});

test('portfolio search and access filter find the matching workspace and preserve its identity', () => {
  const opened = []; const exported = []; const imported = [];
  const projects = [
    { id: 'project-harbor', name: 'Harbor Services', workspaceAccess: 'reader', blueprintVersion: 1 },
    { id: 'project-north', name: 'Northstar', workspaceAccess: 'editor', blueprintVersion: 2, openIncidentCount: 1 },
    { id: 'project-studio', name: 'Studio', workspaceAccess: 'owner', blueprintVersion: 3 },
  ];
  const portfolio = renderProjectPortfolio(projects, { el,
    onOpen: (id, options) => opened.push({ id, options }), onExport: (id) => exported.push(id), onImport: (id, file) => imported.push([id, file.name]),
  });
  const search = portfolio.querySelectorAll('input').find((input) => input.attrs.type === 'search');
  const access = portfolio.querySelectorAll('select').find((select) => select.attrs.name === 'workspace-access');
  assert.equal(search.attrs['aria-label'], 'Search workspaces by name');
  assert.equal(access.attrs['aria-label'], 'Filter workspaces by access');

  search.value = '  HARBOR '; search.listeners.get('input')();
  assert.deepEqual(Array.from(portfolio.querySelectorAll('[data-project-id]'), (card) => card.attrs['data-project-id']), ['project-harbor']);
  assert.match(portfolio.textContent, /Showing 1 of 3 workspaces/);
  access.value = 'reader'; access.listeners.get('change')();
  assert.deepEqual(Array.from(portfolio.querySelectorAll('[data-project-id]'), (card) => card.attrs['data-project-id']), ['project-harbor']);
  access.value = 'owner'; access.listeners.get('change')();
  assert.match(portfolio.textContent, /No workspaces match these filters/);
  const clear = portfolio.querySelectorAll('button').find((button) => button.text === 'Clear workspace filters and sorting');
  assert.ok(clear);
  clear.listeners.get('click')();
  assert.equal(search.value, '');
  assert.equal(access.value, 'all');
  assert.equal(portfolio.querySelectorAll('[data-project-id]').length, 3);
  assert.match(portfolio.textContent, /3 workspaces/);

  access.value = 'editor'; access.listeners.get('change')();
  const cards = portfolio.querySelectorAll('[data-project-id]');
  assert.deepEqual(Array.from(cards, (card) => card.attrs['data-project-id']), ['project-north']);
  const open = cards[0].querySelectorAll('button').find((button) => button.text === 'Open workspace');
  open.listeners.get('click')();
  const incidents = cards[0].querySelectorAll('button').find((button) => button.text === 'Review incidents (1)');
  incidents.listeners.get('click')();
  const exportButton = cards[0].querySelectorAll('button').find((button) => button.text === 'Export proposed design JSON');
  exportButton.listeners.get('click')();
  const importFile = cards[0].querySelectorAll('input').find((input) => input.attrs.type === 'file');
  importFile.files = [{ name: 'filtered-import.json' }];
  importFile.listeners.get('change')();
  assert.deepEqual(opened, [{ id: 'project-north', options: undefined },
    { id: 'project-north', options: { focusOutcomes: true, focusOutcomeCategory: 'incident' } }]);
  assert.deepEqual(exported, ['project-north']);
  assert.deepEqual(imported, [['project-north', 'filtered-import.json']]);
});

test('portfolio exposes separate active and archived views with owner lifecycle controls', () => {
  const opened = [];
  const active = [{ id: 'project-active', name: 'Active', version: 3, blueprintVersion: 2,
    workspaceAccess: 'owner', historyEventCount: 8 },
  { id: 'project-editor', name: 'Editor workspace', version: 2, blueprintVersion: 1, workspaceAccess: 'editor' }];
  const archived = [{ id: 'project-retired', name: 'Retired', version: 5, blueprintVersion: 4,
    workspaceAccess: 'owner', historyEventCount: 13, openIncidentCount: 1,
    lifecycle: { status: 'archived', archivedBy: 'owner-id', archivedAt: '2026-10-04T10:00:00.000Z', reason: 'Superseded.' } }];
  const portfolio = renderProjectPortfolio(active, { el, archivedProjects: archived, onOpen: (id) => opened.push(id), onExport() {} });
  const views = portfolio.querySelectorAll('button');
  const activeView = views.find((button) => button.text === 'Active workspaces');
  const archivedView = views.find((button) => button.text === 'Archived workspaces');
  assert.ok(activeView); assert.ok(archivedView);
  assert.deepEqual(Array.from(portfolio.querySelectorAll('[data-project-id]'), (card) => card.attrs['data-project-id']), ['project-active', 'project-editor']);
  const activeCard = portfolio.querySelectorAll('[data-project-id]').find((card) => card.attrs['data-project-id'] === 'project-active');
  const editorCard = portfolio.querySelectorAll('[data-project-id]').find((card) => card.attrs['data-project-id'] === 'project-editor');
  assert.ok(activeCard.querySelectorAll('button').some((button) => button.text === 'Archive workspace'));
  assert.equal(editorCard.querySelectorAll('button').some((button) => button.text === 'Archive workspace'), false);
  archivedView.listeners.get('click')();
  assert.deepEqual(Array.from(portfolio.querySelectorAll('[data-project-id]'), (card) => card.attrs['data-project-id']), ['project-retired']);
  assert.match(portfolio.textContent, /Superseded\./);
  assert.match(portfolio.textContent, /13 history events retained/);
  assert.match(portfolio.textContent, /Archived workspace is read-only\. Restore it before making changes\./);
  assert.equal(portfolio.querySelectorAll('[data-project-id]')[0].querySelectorAll('a').some((link) => link.text === 'Start governed change'), false,
    'archived workspaces do not offer a write journey');
  assert.ok(portfolio.querySelectorAll('button').some((button) => button.text === 'Restore workspace'));
  const open = portfolio.querySelectorAll('button').find((button) => button.text === 'Open workspace');
  open.listeners.get('click')();
  assert.deepEqual(opened, ['project-retired']);
});

test('portfolio filters are restored after opening a workspace and returning', () => {
  const projects = [
    { id: 'workspace-north', name: 'Northstar', workspaceAccess: 'editor', blueprintVersion: 2, updatedAt: '2026-10-02T12:00:00Z' },
    { id: 'workspace-harbor', name: 'Harbor', workspaceAccess: 'reader', blueprintVersion: 1, updatedAt: '2026-10-03T12:00:00Z' },
    { id: 'workspace-north-owner', name: 'North Annex', workspaceAccess: 'owner', blueprintVersion: 3, updatedAt: '2026-10-04T12:00:00Z' },
  ];
  let filterState = { search: '', access: 'all', sort: 'default' };
  const opened = [];
  const mountPortfolio = () => renderProjectPortfolio(projects, { el, filters: filterState,
    onFiltersChange: (next) => { filterState = next; }, onOpen: (id) => opened.push(id), onExport() {}, onImport() {},
  });

  const portfolio = mountPortfolio();
  const search = portfolio.querySelectorAll('input').find((input) => input.attrs.type === 'search');
  const access = portfolio.querySelectorAll('select').find((select) => select.attrs.name === 'workspace-access');
  const sort = portfolio.querySelectorAll('select').find((select) => select.attrs.name === 'workspace-sort');
  search.value = 'North'; search.listeners.get('input')();
  access.value = 'editor'; access.listeners.get('change')();
  sort.value = 'recent'; sort.listeners.get('change')();
  assert.deepEqual(filterState, { search: 'North', access: 'editor', sort: 'recent' });
  const matchingCard = portfolio.querySelectorAll('[data-project-id]')[0];
  assert.equal(matchingCard.attrs['data-project-id'], 'workspace-north');
  matchingCard.querySelectorAll('button').find((button) => button.text === 'Open workspace').listeners.get('click')();
  assert.deepEqual(opened, ['workspace-north']);

  const returned = mountPortfolio();
  assert.equal(returned.querySelectorAll('input').find((input) => input.attrs.type === 'search').value, 'North');
  assert.equal(returned.querySelectorAll('select').find((select) => select.attrs.name === 'workspace-access').value, 'editor');
  assert.equal(returned.querySelectorAll('select').find((select) => select.attrs.name === 'workspace-sort').value, 'recent');
  assert.deepEqual(Array.from(returned.querySelectorAll('[data-project-id]'), (card) => card.attrs['data-project-id']), ['workspace-north']);
  const clear = returned.querySelectorAll('button').find((button) => button.text === 'Clear workspace filters and sorting');
  assert.equal(clear.hidden, false, 'a matching filtered list still offers explicit filter reset');
  clear.listeners.get('click')();
  assert.deepEqual(filterState, { search: '', access: 'all', sort: 'default' });
  const cleared = mountPortfolio();
  assert.equal(cleared.querySelectorAll('[data-project-id]').length, 3);
  assert.equal(cleared.querySelectorAll('select').find((select) => select.attrs.name === 'workspace-sort').value, 'default');
});

test('portfolio sort orders filtered workspaces by name or most recent save without changing card actions', () => {
  const projects = [
    { id: 'workspace-zulu', name: 'Zulu', workspaceAccess: 'editor', updatedAt: '2026-10-04T12:00:00Z', blueprintVersion: 1, openIncidentCount: 1 },
    { id: 'workspace-alpha', name: 'Alpha', workspaceAccess: 'editor', updatedAt: '2026-10-01T12:00:00Z', blueprintVersion: 2 },
    { id: 'workspace-beta', name: 'Beta', workspaceAccess: 'reader', updatedAt: '2026-10-03T12:00:00Z', blueprintVersion: 3 },
  ];
  const opened = []; const exported = []; const imported = [];
  const portfolio = renderProjectPortfolio(projects, { el, filters: { search: '', access: 'all', sort: 'name-asc' },
    onFiltersChange() {}, onOpen: (id, options) => opened.push({ id, options }),
    onExport: (id) => exported.push(id), onImport: (id, file) => imported.push([id, file.name]),
  });
  const sort = portfolio.querySelectorAll('select').find((select) => select.attrs.name === 'workspace-sort');
  assert.equal(sort.attrs['aria-label'], 'Sort workspaces');
  assert.deepEqual(Array.from(portfolio.querySelectorAll('[data-project-id]'), (card) => card.attrs['data-project-id']),
    ['workspace-alpha', 'workspace-beta', 'workspace-zulu']);

  const access = portfolio.querySelectorAll('select').find((select) => select.attrs.name === 'workspace-access');
  access.value = 'editor'; access.listeners.get('change')();
  assert.deepEqual(Array.from(portfolio.querySelectorAll('[data-project-id]'), (card) => card.attrs['data-project-id']),
    ['workspace-alpha', 'workspace-zulu'], 'sort order is applied after access filtering');
  sort.value = 'recent'; sort.listeners.get('change')();
  const cards = portfolio.querySelectorAll('[data-project-id]');
  assert.deepEqual(Array.from(cards, (card) => card.attrs['data-project-id']), ['workspace-zulu', 'workspace-alpha'],
    'recent sorting is applied to the filtered records');
  const zulu = cards[0];
  zulu.querySelectorAll('button').find((button) => button.text === 'Open workspace').listeners.get('click')();
  zulu.querySelectorAll('button').find((button) => button.text === 'Review incidents (1)').listeners.get('click')();
  zulu.querySelectorAll('button').find((button) => button.text === 'Export proposed design JSON').listeners.get('click')();
  const importFile = zulu.querySelectorAll('input').find((input) => input.attrs.type === 'file');
  importFile.files = [{ name: 'sorted.json' }]; importFile.listeners.get('change')();
  assert.deepEqual(opened, [{ id: 'workspace-zulu', options: undefined },
    { id: 'workspace-zulu', options: { focusOutcomes: true, focusOutcomeCategory: 'incident' } }]);
  assert.deepEqual(exported, ['workspace-zulu']);
  assert.deepEqual(imported, [['workspace-zulu', 'sorted.json']]);
});

test('portfolio filter feedback is announced and its layout adapts to narrow screens', () => {
  let status = null;
  const portfolio = renderProjectPortfolio([
    { id: 'project-a', name: 'Northstar', workspaceAccess: 'owner' },
  ], { el: (tag, options, children) => {
    const node = el(tag, options, children);
    if (options.className === 'portfolio-count') { assert.equal(node.textContent, ''); status = node; }
    return node;
  }, onOpen: () => {}, onExport: () => {}, onImport: () => {} });
  assert.ok(status);
  assert.equal(status.attrs.role, 'status');
  assert.equal(status.attrs['aria-live'], 'polite');
  assert.equal(status.attrs['aria-atomic'], 'true');
  const list = portfolio.querySelectorAll('div').find((entry) => entry.attrs.role === 'list');
  assert.equal(list.contains(status), false);

  const search = portfolio.querySelectorAll('input').find((entry) => entry.attrs.type === 'search');
  search.value = 'north'; search.listeners.get('input')();
  assert.equal(list.contains(status), false, 'the same live region remains outside the replaceable list');
  assert.match(status.textContent, /1 workspace/);
  search.value = 'missing'; search.listeners.get('input')();
  assert.equal(portfolio.querySelectorAll('p').find((entry) => entry.className === 'portfolio-count'), status);
  assert.match(status.textContent, /Showing 0 of 1 workspaces/);
  assert.match(status.textContent, /No workspaces match these filters/);
  assert.match(status.textContent, /Adjust the search or access level, or clear filters/);
  assert.equal(list.contains(status), false, 'filter changes update the same live region outside the replaceable list');

  const css = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.portfolio-heading\s*\{[^}]*min-width:\s*0/);
  assert.match(css, /\.portfolio-filters\s*\{[^}]*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.portfolio-filters input, \.portfolio-filters select\s*\{[^}]*width:\s*100%[^}]*max-width:\s*100%[^}]*min-width:\s*0/);
  assert.match(css, /@media\s*\(max-width:\s*520px\)[\s\S]*?\.portfolio-heading\s*\{[^}]*flex-direction:\s*column/);
  assert.match(css, /@media\s*\(max-width:\s*520px\)[\s\S]*?\.portfolio-filters\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.portfolio-count\s*\{[^}]*white-space:\s*normal/);
});

test('portfolio issue actions open the selected workspace and focus the requested inbox category', () => {
  const opened = [];
  const portfolio = renderProjectPortfolio([{ id: 'project-issues', name: 'Issue workspace', blueprintVersion: 1,
    workspaceAccess: 'editor', openIncidentCount: 3, openSupportCount: 2 }], { el,
    onOpen: (id, options) => opened.push({ id, options }), onExport() {}, onImport() {},
  });
  const buttons = portfolio.querySelectorAll('button');
  buttons.find((button) => button.text === 'Review incidents (3)').listeners.get('click')();
  buttons.find((button) => button.text === 'Review support (2)').listeners.get('click')();
  assert.deepEqual(opened, [
    { id: 'project-issues', options: { focusOutcomes: true, focusOutcomeCategory: 'incident' } },
    { id: 'project-issues', options: { focusOutcomes: true, focusOutcomeCategory: 'support' } },
  ]);
});

test('outcome inbox focuses the requested incident or support category', async () => {
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = storageFixture();
  try {
    const outcomes = [
      { id: 'incident-closed', version: 1, status: 'RESOLVED', title: 'Closed incident', category: 'incident', ownerPrincipal: 'owner',
        source: { kind: 'manual', summary: 'Resolved.' }, observations: [], proposals: [], events: [] },
      { id: 'support-open', version: 1, status: 'OPEN', title: 'Open support request', category: 'support', ownerPrincipal: 'owner',
        source: { kind: 'manual', summary: 'Needs support.' }, observations: [], proposals: [], events: [] },
      { id: 'incident-open', version: 1, status: 'IN_PROGRESS', title: 'Active incident', category: 'incident', ownerPrincipal: 'owner',
        source: { kind: 'manual', summary: 'Being reviewed.' }, observations: [], proposals: [], events: [] },
    ];
    const api = async () => ({ available: true, outcomes, permissions: { write: false, review: false, assign: false, followUp: false }, sources: {} });
    const outcomeEl = (tag, options, children) => { const node = el(tag, options, children); node.style = {}; return node; };
    for (const category of ['incident', 'support']) {
      const inbox = renderOutcomeInbox({ projectId: 'project-issues', principal: 'owner', el: outcomeEl, api, preferredCategory: category });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(inbox.attrs['data-focused-category'], category);
      const focusedId = category === 'incident' ? 'incident-open' : 'support-open';
      const focused = inbox.querySelectorAll('[data-outcome-id]').find((row) => row.attrs['data-outcome-id'] === focusedId);
      assert.equal(focused?.attrs.open, 'open', `the first active ${category} item is expanded`);
      const otherId = category === 'incident' ? 'support-open' : 'incident-open';
      const other = inbox.querySelectorAll('[data-outcome-id]').find((row) => row.attrs['data-outcome-id'] === otherId);
      assert.equal(other?.attrs.open, undefined, 'the unrelated category stays collapsed');
      assert.match(inbox.textContent, new RegExp(`Focused on the first active ${category} item`));
    }
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
  }
});

test('archived outcome inbox retains issue evidence and history with every edit disabled', async () => {
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = storageFixture();
  try {
    const requests = [];
    const outcome = { id: 'outcome-archived-support', version: 3, status: 'IN_PROGRESS', title: 'Archived support request',
      category: 'support', ownerPrincipal: 'owner', source: { kind: 'manual', summary: 'Customer supplied the original context.' },
      latestEvaluation: { technical: 'PASS', control: 'REVIEW', business: 'UNKNOWN', observationHash: 'observed-hash' },
      observations: [{ id: 'observation-1', window: '2026-10-01', recordedAt: '2026-10-01T10:00:00Z', measures: [
        { dimension: 'business', name: 'response time', actual: 10, target: 5, comparison: 'lte', unit: 'minutes', evidenceSummary: 'Ticket timeline.' },
      ] }], proposals: [{ id: 'proposal-1', title: 'Follow up', status: 'PROPOSED', recommendation: 'Review queue ownership.',
        rationale: 'Repeated delays.', observationHash: 'old-hash' }], events: [{ type: 'CustomerOutcomeObserved', actor: 'owner', at: '2026-10-01T10:00:00Z', reason: 'Record retained.' }] };
    const api = async (route, options) => {
      requests.push({ route, method: options?.method ?? 'GET' });
      return { available: true, outcomes: [outcome], permissions: { write: true, review: true, assign: true, followUp: true },
        sources: { members: [{ principal: 'owner', access: 'owner', displayName: 'Owner' }] } };
    };
    const outcomeEl = (tag, options, children) => { const node = el(tag, options, children); node.style = {}; return node; };
    const inbox = renderOutcomeInbox({ projectId: 'project-archived', principal: 'owner', el: outcomeEl, api, readOnly: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(inbox.textContent, /available read-only/);
    assert.match(inbox.textContent, /Customer supplied the original context/);
    assert.match(inbox.textContent, /response time: 10 minutes/);
    assert.match(inbox.textContent, /CustomerOutcomeObserved/);
    assert.equal(inbox.querySelectorAll('form').some((form) => form.attrs['aria-label'] === 'Add outcome to inbox'), false);
    assert.ok(inbox.querySelectorAll('form').length > 0);
    assert.ok(inbox.querySelectorAll('form').every((form) => form.querySelectorAll('input,select,textarea,button').every((control) => control.disabled)));
    assert.ok(inbox.querySelectorAll('button').some((button) => button.text === 'Download outcome JSON export' && !button.disabled),
      'read-only evidence export remains available');
    assert.deepEqual(requests.map((entry) => entry.method), ['GET']);
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
  }
});

test('archived protected-release history remains visible while request, approval, execution, and retry controls are disabled', async () => {
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = storageFixture();
  try {
    const requests = [];
    const run = { id: 'execution-run-00000000-0000-4000-8000-000000000001', projectId: 'project-archived',
      status: 'SUCCEEDED', execution: { repositoryCandidate: { runId: 'execution-run-00000000-0000-4000-8000-000000000001',
        source: { type: 'github-app' }, candidateEvidence: { hash: 'candidate-hash' }, treeDigest: 'tree-hash',
        buildReceipt: { status: 'REPRODUCIBLE', runs: [{ outputManifestHash: 'manifest-hash' }] } } } };
    const action = { id: 'release-action-00000000-0000-4000-8000-000000000001', version: 1, status: 'AWAITING_APPROVAL',
      requestHash: 'request-hash', events: [{ type: 'ReleaseRequested', occurredAt: '2026-10-01T10:00:00Z' }], observations: [],
      request: { kind: 'release', requestedBy: 'requester', expectedGeneration: 2,
        environment: { configurationHash: 'configuration-hash' }, candidate: { runId: run.id, candidateEvidenceHash: 'candidate-hash',
          candidateTreeDigest: 'tree-hash', outputManifestHash: 'manifest-hash', outputManifest: [] } } };
    const api = async (route, options) => {
      requests.push({ route, method: options?.method ?? 'GET' });
      return { available: true, environments: [{ id: 'environment-1', label: 'Staging', riskClass: 'low', assetIds: ['asset-1'],
        state: { generation: 2, pendingActionId: null, current: null, previous: null },
        actions: [action], actionsAllowed: ['release', 'rollback'], permissions: { request: true, approve: true, execute: true } }] };
    };
    const releaseEl = (tag, options, children) => { const node = el(tag, options, children); node.style = {}; return node; };
    const panel = renderProtectedRelease({ run, principal: 'owner', el: releaseEl, api, readOnly: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(panel.textContent, /release requests, approvals and evidence are read-only/);
    assert.match(panel.textContent, /ReleaseRequested/);
    const protectedButtons = Array.from(panel.querySelectorAll('button')).filter((button) => /Request release|Request rollback|Approve exact request|Execute approved action|Check saved outcome|Retry saved command/.test(button.text));
    assert.equal(protectedButtons.length, 3);
    assert.ok(protectedButtons.every((button) => button.disabled));
    assert.equal(panel.querySelectorAll('textarea')[0].disabled, true);
    assert.deepEqual(requests.map((entry) => entry.method), ['GET']);
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
  }
});

test('protected release shows exact candidate status across configured promotion environments', async () => {
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = storageFixture();
  try {
    const requests = [];
    const run = { id: 'execution-run-00000000-0000-4000-8000-000000000021', projectId: 'project-promotion',
      status: 'SUCCEEDED', execution: { repositoryCandidate: { runId: 'execution-run-00000000-0000-4000-8000-000000000021',
        source: { type: 'github-app' }, candidateEvidence: { hash: 'candidate-hash' }, treeDigest: 'tree-hash',
        buildReceipt: { status: 'REPRODUCIBLE', runs: [{ outputManifestHash: 'manifest-hash' }] } } } };
    const action = { id: 'release-action-00000000-0000-4000-8000-000000000021', version: 1, status: 'AWAITING_APPROVAL',
      requestHash: 'request-hash', events: [], observations: [], request: { kind: 'release', requestedBy: 'requester', expectedGeneration: 2,
        environment: { configurationHash: 'configuration-hash' }, candidate: { runId: run.id, candidateEvidenceHash: 'candidate-hash',
          candidateTreeDigest: 'tree-hash', outputManifestHash: 'manifest-hash', outputManifest: [] } } };
    const environments = [
      { id: 'staging', label: 'Staging', riskClass: 'low', assetIds: ['service'],
        state: { generation: 1, pendingActionId: action.id, current: null, previous: null }, actions: [action],
        actionsAllowed: ['release', 'rollback'], permissions: { request: true, approve: true, execute: true } },
      { id: 'production', label: 'Production', riskClass: 'high', assetIds: ['service'],
        state: { generation: 2, pendingActionId: null, current: { runId: run.id, candidateEvidenceHash: 'candidate-hash' }, previous: null }, actions: [],
        actionsAllowed: ['release', 'rollback'], permissions: { request: true, approve: true, execute: true } },
      { id: 'canary', label: 'Canary', riskClass: 'moderate', assetIds: ['service'],
        state: { generation: 0, pendingActionId: null, current: null, previous: null }, actions: [],
        actionsAllowed: ['release', 'rollback'], permissions: { request: true, approve: true, execute: true } },
      { id: 'preproduction', label: 'Preproduction', riskClass: 'moderate', assetIds: ['service'],
        state: { generation: 3, pendingActionId: null, current: { runId: 'execution-run-other' }, previous: { runId: run.id } }, actions: [],
        actionsAllowed: ['release', 'rollback'], permissions: { request: true, approve: true, execute: true } },
    ];
    const api = async (route, options) => {
      requests.push({ route, method: options?.method ?? 'GET' });
      return { available: true, environments };
    };
    const releaseEl = (tag, options, children) => { const node = el(tag, options, children); node.style = {}; return node; };
    const panel = renderProtectedRelease({ run, principal: 'owner', el: releaseEl, api });
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(panel.textContent, /Selected candidate promotion status/);
    assert.match(panel.textContent, /Staging · low risk · Action for this candidate: awaiting approval/);
    assert.match(panel.textContent, /Production · high risk · Selected candidate is currently deployed/);
    assert.match(panel.textContent, /Canary · moderate risk · Selected candidate has not been promoted here/);
    assert.match(panel.textContent, /Preproduction · moderate risk · Selected candidate was previously deployed; another candidate is current/);
    assert.deepEqual(requests.map((entry) => entry.method), ['GET'], 'the progression summary is read-only');
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
  }
});

test('category focus announcement preserves a rejected outcome command status after inbox refresh', async () => {
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = storageFixture();
  try {
    const outcome = { id: 'incident-command', version: 1, status: 'OPEN', title: 'Active incident', category: 'incident', ownerPrincipal: 'owner',
      source: { kind: 'manual', summary: 'Needs review.' }, observations: [], proposals: [], events: [] };
    let reads = 0;
    const api = async (_route, options) => {
      if (options?.method === 'POST') throw Object.assign(new Error('Membership changed; reload before retrying.'), { status: 403 });
      reads += 1;
      return { available: true, outcomes: [outcome], permissions: { write: true, review: false, assign: true, followUp: false },
        sources: { members: [{ principal: 'owner', displayName: 'Owner', access: 'owner' }] } };
    };
    const outcomeEl = (tag, options, children) => { const node = el(tag, options, children); node.style = {}; return node; };
    const inbox = renderOutcomeInbox({ projectId: 'project-issues', principal: 'owner', el: outcomeEl, api, preferredCategory: 'incident' });
    await new Promise((resolve) => setImmediate(resolve));
    const update = inbox.querySelectorAll('form').find((form) => form.attrs['aria-label'] === 'Save inbox status');
    assert.ok(update);
    update.querySelectorAll('select').find((field) => field.attrs.name === 'status').value = 'IN_PROGRESS';
    update.querySelectorAll('textarea')[0].value = 'The workspace access changed during review.';
    update.listeners.get('submit')({ preventDefault() {} });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(reads, 2, 'the failed command is followed by a successful inbox refresh');
    assert.match(inbox.textContent, /Membership changed; reload before retrying\. Review the refreshed outcome, current design and permissions before trying a new command\./);
    assert.match(inbox.textContent, /Focused on the first active incident item\./);
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
  }
});

test('portfolio integrity summary requires a valid complete report history', () => {
  const projectId = 'project-00000000-0000-4000-8000-000000000001';
  const blueprint = { id: 'blueprint-00000000-0000-4000-8000-000000000002', version: 2 };
  const report = (id, sourceBlueprint, sourceVersion, snapshotHash) => {
    const entry = { source: { projectId, blueprintId: sourceBlueprint, blueprintVersion: sourceVersion, snapshotHash },
      engineVersion: 'test', status: 'PASS', counts: { rules: 1, passedRules: 1, failedRules: 0, reviewRules: 0, findings: 0,
        high: 0, medium: 0, low: 0 },
      rules: [{ id: 'design.typed-structure', status: 'PASS', findingCount: 0, summary: 'Valid fixture.' }], findings: [],
      id: `enterprise-integrity-${id}`, createdAt: '2026-10-04T00:00:00.000Z', createdBy: 'owner', reason: 'Review' };
    return { ...entry, reportHash: digest(entry) };
  };
  const currentHash = digest(blueprint);
  const currentReport = report('00000000-0000-4000-8000-000000000003', blueprint.id, blueprint.version, currentHash);
  const current = projectPortfolioIntegritySummary({ id: projectId, blueprintVersions: [blueprint], enterpriseIntegrityAssessments: [currentReport] });
  assert.equal(current.integrityProjectionIncomplete, false);
  assert.equal(current.integritySourceCurrent, true);
  const stale = projectPortfolioIntegritySummary({ id: projectId, blueprintVersions: [{ ...blueprint, version: 3 }],
    enterpriseIntegrityAssessments: [currentReport] });
  assert.equal(stale.integrityProjectionIncomplete, false);
  assert.equal(stale.integritySourceCurrent, false);

  const { reportHash: _validHistoricalHash, ...malformedHistoricalCore } = currentReport;
  malformedHistoricalCore.id = 'enterprise-integrity-00000000-0000-4000-8000-000000000004';
  malformedHistoricalCore.rules = null;
  const malformedHistorical = { ...malformedHistoricalCore, reportHash: digest(malformedHistoricalCore) };
  assert.equal(isValidEnterpriseIntegrityAssessment(malformedHistorical, projectId), false,
    'the report hash is valid, but missing rule data makes the historical record unusable');
  assert.throws(() => projectEnterpriseIntegrity({ id: projectId, blueprintVersions: [blueprint],
    enterpriseIntegrityAssessments: [malformedHistorical, currentReport] }, blueprint), { code: 'INTEGRITY_REPORT_CORRUPT' },
  'the detailed report projection rejects the same historical record');
  const incomplete = projectPortfolioIntegritySummary({ id: projectId, blueprintVersions: [blueprint],
    enterpriseIntegrityAssessments: [malformedHistorical, currentReport] });
  assert.equal(incomplete.integrityProjectionIncomplete, true,
    'a valid latest report cannot hide malformed earlier saved evidence');
  const card = renderProjectPortfolio([{ id: projectId, name: 'Evidence unavailable', blueprintVersion: 2,
    ...incomplete, integrityStatus: current.integrityStatus, integrityReportId: current.integrityReportId }], { el, onOpen() {} });
  assert.match(card.textContent, /Integrity report details unavailable/);
  assert.equal(card.textContent.includes('Review integrity report'), false,
    'incomplete history does not offer a review action that implies the summary is complete');

  for (const [label, source] of [['missing', { ...currentReport.source, projectId: undefined }],
    ['unrelated', { ...currentReport.source, projectId: 'project-00000000-0000-4000-8000-000000000099' }]]) {
    const { reportHash: _hash, ...core } = currentReport;
    const foreignReportCore = { ...core, source };
    const invalidBinding = { ...foreignReportCore, reportHash: digest(foreignReportCore) };
    assert.equal(isValidEnterpriseIntegrityAssessment(invalidBinding, projectId), false,
      `${label} source project binding is invalid even with a correct report hash`);
    assert.throws(() => projectEnterpriseIntegrity({ id: projectId, blueprintVersions: [blueprint],
      enterpriseIntegrityAssessments: [invalidBinding] }, blueprint), { code: 'INTEGRITY_REPORT_CORRUPT' },
    `detailed projection rejects a ${label} source project binding`);
    assert.equal(projectPortfolioIntegritySummary({ id: projectId, blueprintVersions: [blueprint],
      enterpriseIntegrityAssessments: [invalidBinding] }).integrityProjectionIncomplete, true,
    `portfolio projection rejects a ${label} source project binding`);
  }
});

test('portfolio import reads one bounded JSON file for preview', async () => {
  const file = { name: 'design.json', size: 12, text: async () => '{"kind":"orgward-enterprise-blueprint"}' };
  assert.deepEqual(await readPortfolioImportFile(file), { fileName: 'design.json',
    bundle: { kind: 'orgward-enterprise-blueprint' }, recordIds: [], sourceSelections: [], reason: '' });
  await assert.rejects(() => readPortfolioImportFile({ ...file, size: 1_000_001 }), /no larger than 1 MB/);
  await assert.rejects(() => readPortfolioImportFile({ ...file, text: async () => '{broken' }), /not valid JSON/);
});

test('portfolio import opens the selected workspace information detail with its current preview', async () => {
  const blueprint = { id: 'blueprint-current', version: 8, areas: { responsibilityAuthority: { items: [
    { id: 'info-record', type: 'information', name: 'Import target', detail: 'Saved information record.' },
  ] } } };
  const route = portfolioImportWorkspaceRoute(blueprint);
  assert.deepEqual(route, { view: 'map', selectedId: 'info-record' });
  const model = { context: { isCurrent: true, blueprintId: blueprint.id, blueprintVersion: blueprint.version }, blueprint,
    permissions: { write: true }, scopes: [], graph: { nodes: [] }, selection: null };
  const preview = { source: { projectId: 'source-project', blueprintId: 'source-blueprint', blueprintVersion: 2, snapshotHash: 'source-hash' },
    currentSource: { projectId: 'selected-workspace', projectVersion: 11, blueprintId: blueprint.id, blueprintVersion: blueprint.version, snapshotHash: 'current-hash' }, recordCount: 1,
    recognizedFields: 1, readyRecordIds: ['imported-row'], previewHash: 'preview-hash', unknownFields: [], lossyFields: [],
    collisions: [], validationErrors: [], rows: [{ id: 'imported-row', type: 'information', status: 'READY', changedFields: ['name'], recognizedFields: ['name'],
      impact: { status: 'INCOMPLETE', changedFields: [{ field: 'name', before: 'Before import', after: 'After import' }],
        directlyAffectedObjects: [{ objectId: 'imported-row', name: 'After import', type: 'information', edited: true }],
        unknownAreas: ['Approvals and work'] } }] };
  const draft = { fileName: 'portfolio.json', bundle: { kind: 'orgward-enterprise-blueprint' } };
  let requestedPath;
  const selectedObject = blueprint.areas.responsibilityAuthority.items[0];
  const enterprisePanel = renderEnterpriseObject({ projectId: 'selected-workspace', model, object: selectedObject,
    interchangeDraft: draft, el, ui: branchUi, api: async (path) => { requestedPath = path; return { data: preview }; }, onCommand() {} });
  const detail = el('aside', { attrs: { 'data-selected-object': selectedObject.id } }, [
    ...renderEnterpriseObjectHeader({ object: selectedObject, el }), enterprisePanel,
  ]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requestedPath, '/api/v1/projects/selected-workspace/enterprise/import-preview');
  assert.match(detail.textContent, /Import target/);
  assert.match(detail.textContent, /Import preview/);
  assert.match(detail.textContent, /Current destination: workspace v11 · blueprint blueprint-current v8/);
  assert.match(detail.textContent, /Direct impact preview · INCOMPLETE/);
  assert.match(detail.textContent, /name: "Before import" → "After import"/);
  assert.match(detail.textContent, /Approvals and work/);
  assert.equal(detail.querySelectorAll('[data-enterprise-interchange]').length, 1,
    'the selected workspace detail visibly contains the saved draft preview');
});

test('enterprise import live status announces incomplete direct impact and unknown downstream effects', async () => {
  const model = { permissions: { write: true }, context: { isCurrent: true, blueprintId: 'blueprint-current', blueprintVersion: 4 },
    blueprint: { id: 'blueprint-current', version: 4, areas: {} } };
  const preview = { source: { projectId: 'source-project', blueprintId: 'source-blueprint', blueprintVersion: 2, snapshotHash: 'source-hash' },
    currentSource: { projectId: 'target-project', projectVersion: 11, blueprintId: 'blueprint-current', blueprintVersion: 4, snapshotHash: 'target-hash' },
    recordCount: 1, recognizedFields: 1, readyRecordIds: ['goal-imported'], previewHash: 'preview-hash',
    unknownFields: [], lossyFields: [], collisions: [], validationErrors: [],
    rows: [{ id: 'goal-imported', type: 'goal', status: 'READY', changedFields: ['name'], recognizedFields: ['name'],
      impact: { status: 'INCOMPLETE', changedFields: [{ field: 'name', before: 'Before', after: 'After' }],
        directlyAffectedObjects: [{ objectId: 'goal-imported', name: 'After', type: 'goal', edited: true }],
        unknownAreas: ['Approvals and work'] } }] };
  let requestedPath = null;
  const rendered = renderEnterpriseInterchange({ projectId: 'target-project', model, el, ui: branchUi,
    api: async (path) => { requestedPath = path; return { data: preview }; }, onCommand() {} });
  const file = rendered.querySelectorAll('input').find((input) => input.attrs.type === 'file');
  file.files = [{ name: 'design.json', size: 12, text: async () => '{"kind":"orgward-enterprise-blueprint"}' }];
  const upload = rendered.querySelectorAll('button').find((button) => button.text === 'Preview import');
  await upload.listeners.get('click')();

  const status = rendered.querySelectorAll('p').find((paragraph) => paragraph.attrs.role === 'status');
  assert.equal(requestedPath, '/api/v1/projects/target-project/enterprise/import-preview');
  assert.equal(status.attrs['aria-live'], 'polite');
  assert.match(status.textContent, /Import preview ready\. 1 record has direct impact preview marked INCOMPLETE/);
  assert.match(status.textContent, /operational and downstream impact is UNKNOWN/);
  assert.match(rendered.textContent, /Direct impact preview · INCOMPLETE/);
  assert.match(rendered.textContent, /Approvals and work/);
});

test('portfolio process-pack import opens its exact destination on the packed root process and exposes reviewed mappings', async () => {
  const blueprint = { id: 'blueprint-00000000-0000-4000-8000-000000000001', version: 8, areas: { capabilitiesProcesses: { items: [
    { id: 'process-source', type: 'process', name: 'Pack root process', detail: 'Reusable work.' },
    { id: 'process-target', type: 'process', name: 'Pack root process', detail: 'Existing target work.' },
  ] } } };
  const bundle = { kind: 'orgward-enterprise-process-pack', rootId: 'process-source', packHash: 'c'.repeat(64), source: {
    projectId: 'workspace-source', blueprintId: 'blueprint-source', blueprintVersion: 2, snapshotHash: 'a'.repeat(64) } };
  assert.deepEqual(portfolioImportWorkspaceRoute(bundle), { view: 'map', selectedId: 'process-source' });
  const model = { context: { isCurrent: true, blueprintId: blueprint.id, blueprintVersion: blueprint.version,
      projectVersion: 20, effectiveAt: null, recordedAtCutoff: null }, blueprint,
    permissions: { write: true }, scopes: [], graph: { nodes: [] }, selection: null };
  const sourceProcess = blueprint.areas.capabilitiesProcesses.items[0];
  const blockedPreview = { mode: 'DESIGN_PACK_PREVIEW', source: bundle.source, sourceTrust: 'UNTRUSTED_UPLOADED_JSON',
    currentSource: { projectId: 'workspace-target', blueprintId: blueprint.id, blueprintVersion: blueprint.version, snapshotHash: 'b'.repeat(64) },
    rootId: sourceProcess.id, rootName: sourceProcess.name, recordCount: 2, packHash: bundle.packHash,
    rows: [
      { sourceRecordId: 'process-source', sourceName: 'Pack root process', type: 'process', status: 'MAPPING_REQUIRED', targetId: null,
        candidates: [{ id: 'process-target', name: 'Pack root process', type: 'process' }] },
      { sourceRecordId: 'capability-source', sourceName: 'Pack capability', type: 'capability', status: 'CREATE_NEW', targetId: 'capability-generated', candidates: [] },
    ], identityMap: {}, unresolvedDependencies: [{ sourceRecordId: 'process-source', candidates: [{ id: 'process-target' }], reason: 'Choose reuse or new.' }],
    dependencies: [], omissions: [], ready: false, previewHash: 'd'.repeat(64) };
  const readyPreview = { ...blockedPreview, rows: blockedPreview.rows.map((row) => ({ ...row,
    status: 'CREATE_NEW', targetId: row.type === 'process' ? 'process-generated' : row.targetId })),
    dependencies: [{ sourceId: 'capability-source', sourceName: 'Pack capability', field: 'capability', includedInPack: true }],
    identityMap: { 'process-source': 'process-generated', 'capability-source': 'capability-generated' },
    unresolvedDependencies: [], ready: true, previewHash: 'e'.repeat(64) };
  const draft = { fileName: 'process-pack.json', bundle, mappings: {}, preview: blockedPreview, reason: '' };
  const processPanel = renderEnterpriseObject({ projectId: 'workspace-target', model, object: sourceProcess, interchangeDraft: draft,
    el, ui: branchUi, api: async (_path, options) => {
      assert.equal(JSON.parse(options.body).mappings['process-source'], null);
      return { data: readyPreview };
    }, onCommand() {} });
  assert.match(processPanel.textContent, /workspace-source/);
  assert.match(processPanel.textContent, /workspace-target/);
  assert.match(processPanel.textContent, /Uploaded JSON and its claimed source identity are untrusted/);
  assert.match(processPanel.textContent, /Resolve name collision/);
  const choice = processPanel.querySelectorAll('select').find((control) => control.attrs.name === 'pack-map-process-source');
  assert.ok(choice);
  choice.value = '__new__';
  await choice.listeners.get('change')();
  await new Promise((resolve) => setImmediate(resolve));
  const applyForm = processPanel.querySelectorAll('form').find((entry) => entry.attrs['data-enterprise-action'] === 'import-design-pack');
  assert.ok(applyForm, 'a reviewed mapping exposes one deliberate apply form');
  applyForm.querySelectorAll('textarea')[0].value = 'Reuse this process after reviewing its local copy.';
  let applied;
  // Re-render with the command callback so submission proves the exact pack and explicit choice are sent.
  const readyPanel = renderEnterpriseObject({ projectId: 'workspace-target', model, object: sourceProcess,
    interchangeDraft: { ...draft, mappings: { 'process-source': null }, preview: readyPreview }, el, ui: branchUi,
    api: async () => ({ data: readyPreview }), onCommand: (payload) => { applied = payload; } });
  const readyForm = readyPanel.querySelectorAll('form').find((entry) => entry.attrs['data-enterprise-action'] === 'import-design-pack');
  readyForm.querySelectorAll('textarea')[0].value = 'Reuse this process after reviewing its local copy.';
  readyForm.listeners.get('submit')({ preventDefault() {} });
  assert.deepEqual(applied, { kind: 'import-design-pack', bundle, mappings: { 'process-source': null },
    previewHash: readyPreview.previewHash, reason: 'Reuse this process after reviewing its local copy.' });
});

test('portfolio import round trip previews, applies one reviewed record and persists the saved change', async () => {
  const projectId = 'portfolio-import-destination';
  const blueprint = { id: 'blueprint-current', version: 8, areas: { responsibilityAuthority: { items: [
    { id: 'info-record', type: 'information', name: 'Import target', detail: 'Saved information record.' },
  ] } } };
  const fileBundle = { kind: 'orgward-enterprise-blueprint', source: { projectId: 'portfolio-import-source' } };
  let selectedFile;
  const portfolio = renderProjectPortfolio([{ id: projectId, name: 'Destination', blueprintVersion: 8, workspaceAccess: 'editor' }], {
    el, onOpen() {}, onExport() {}, onImport: async (id, file) => { selectedFile = { id, ...(await readPortfolioImportFile(file)) }; },
  });
  const importInput = portfolio.querySelectorAll('input').find((input) => input.attrs.type === 'file');
  importInput.files = [{ name: 'proposed-design.json', size: 1, text: async () => JSON.stringify(fileBundle) }];
  importInput.listeners.get('change')();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(selectedFile.id, projectId, 'the portfolio stages the file against the chosen workspace');
  const route = portfolioImportWorkspaceRoute(blueprint);
  assert.deepEqual(route, { view: 'map', selectedId: 'info-record' });
  const model = { context: { isCurrent: true, blueprintId: blueprint.id, blueprintVersion: blueprint.version }, blueprint,
    permissions: { write: true }, scopes: [], graph: { nodes: [] }, selection: null };
  const preview = { source: { projectId: 'portfolio-import-source', blueprintId: 'blueprint-source', blueprintVersion: 2, snapshotHash: 'a'.repeat(64) },
    currentSource: { blueprintId: blueprint.id, blueprintVersion: blueprint.version, snapshotHash: 'b'.repeat(64) }, recordCount: 2,
    recognizedFields: 2, readyRecordIds: ['imported-customer', 'imported-information'], previewHash: 'c'.repeat(64),
    unknownFields: [], lossyFields: [], collisions: [], validationErrors: [], rows: [
      { id: 'imported-customer', type: 'customer', status: 'READY', changedFields: ['name'], recognizedFields: ['name'] },
      { id: 'imported-information', type: 'information', status: 'READY', changedFields: ['name'], recognizedFields: ['name'] },
    ] };
  let requestedPath; let applied;
  const selectedObject = blueprint.areas.responsibilityAuthority.items[0];
  const detail = renderEnterpriseObject({ projectId, model, object: selectedObject, interchangeDraft: selectedFile, el, ui: branchUi,
    api: async (path) => { requestedPath = path; return { data: preview }; }, onCommand: (command) => { applied = command; } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requestedPath, `/api/v1/projects/${projectId}/enterprise/import-preview`);
  assert.match(detail.textContent, /Current destination: blueprint blueprint-current v8/);
  const applyForm = detail.querySelectorAll('form').find((form) => form.attrs['data-enterprise-action'] === 'bulk-edit-objects');
  assert.ok(applyForm, 'the current-source review exposes the deliberate apply action');
  const checkboxes = applyForm.querySelectorAll('input');
  for (const checkbox of checkboxes) checkbox.checked = checkbox.attrs.value === 'imported-information';
  applyForm.querySelectorAll('textarea')[0].value = 'Reviewed portfolio import for the destination workspace.';
  applyForm.listeners.get('submit')({ preventDefault() {} });
  assert.deepEqual(applied, { kind: 'bulk-edit-objects', bundle: fileBundle, recordIds: ['imported-information'],
    reason: 'Reviewed portfolio import for the destination workspace.' });
});

test('portfolio design export downloads the authenticated saved blueprint pin', async () => {
  const baseline = { id: 'blueprint-00000000-0000-4000-8000-000000000001', version: 7, areas: { items: [{ id: 'item-z', type: 'goal' }, { id: 'item-a', type: 'process' }] } };
  const bundle = { kind: 'orgward-enterprise-blueprint', schemaVersion: '1.0',
    source: { projectId: 'project-round-trip', blueprintId: baseline.id,
      blueprintVersion: baseline.version, snapshotHash: digest(baseline) }, baseline, records: [], recordsCount: 0 };
  let requestedPath;
  let savedAnchor;
  let savedBlob;
  let revokedUrl;
  const result = await downloadPortfolioDesign('project-round-trip', {
    api: async (route) => { requestedPath = route; return { data: bundle }; },
    el: (tag, options) => {
      const node = el(tag, options);
      node.click = () => { savedAnchor = node; };
      return node;
    },
    createObjectURL: (blob) => { savedBlob = blob; return 'blob:portfolio-export'; },
    revokeObjectURL: (url) => { revokedUrl = url; }, deferRevoke: (action) => action(),
  });
  assert.equal(requestedPath, '/api/v1/projects/project-round-trip/enterprise/export');
  assert.equal(result.fileName, 'orgward-enterprise-blueprint-00000000-0000-4000-8000-000000000001-v7.json');
  assert.equal(savedAnchor.attrs.href, 'blob:portfolio-export');
  assert.equal(savedAnchor.attrs.download, result.fileName);
  assert.equal(savedAnchor.parent, null);
  assert.equal((await savedBlob.text()).includes('"blueprintVersion": 7'), true);
  assert.equal(revokedUrl, 'blob:portfolio-export');
  assert.equal(portfolioDesignExportFilename(bundle), result.fileName);
  await assert.rejects(() => verifyPortfolioDesignBundle('project-round-trip', {
    ...bundle, baseline: { ...baseline, version: 8 },
  }), /exact workspace and saved blueprint pin/);
  await assert.rejects(() => verifyPortfolioDesignBundle('project-round-trip', {
    ...bundle, source: { ...bundle.source, snapshotHash: 'b'.repeat(64) },
  }), /snapshot hash check/);
});
const branchUi = {
  field(name, label, { entries = null, value = '', required = true, multiline = false } = {}) {
    const control = el(entries ? 'select' : multiline ? 'textarea' : 'input', { attrs: { name } },
      entries ? entries.map(([optionValue, text]) => el('option', { text, attrs: { value: optionValue } })) : []);
    control.value = value ?? ''; control.required = required;
    return { control, node: el('label', { text: label }, [control]) };
  },
  form(kind, label, controls, submit, disabled) {
    const node = el('form', { attrs: { 'data-enterprise-action': kind, 'aria-label': label } }, controls);
    const save = el('button', { text: label }); node.append(save);
    if (disabled) for (const control of node.querySelectorAll('input,select,textarea,button')) control.disabled = true;
    node.addEventListener('submit', submit);
    return node;
  },
};

test('enterprise interchange UI binds edits to the visible source and restores and submits a retained preview draft', async () => {
  const model = { permissions: { write: true }, context: { isCurrent: true, blueprintId: 'blueprint-00000000-0000-4000-8000-000000000001',
    blueprintVersion: 4, effectiveAt: null, recordedAtCutoff: null, proposalId: null, branchId: null }, blueprint: { id: 'visible' } };
  assert.equal(enterpriseInterchangeWritable(model), true);
  assert.deepEqual(enterpriseInterchangeCommandPayload(model, { kind: 'bulk-edit-objects', recordIds: ['customer-x'] }), {
    kind: 'bulk-edit-objects', recordIds: ['customer-x'], blueprintId: model.context.blueprintId, blueprintVersion: 4,
  });
  for (const context of [{ ...model.context, isCurrent: false }, { ...model.context, branchId: 'branch-x' }, { ...model.context, effectiveAt: '2026-10-01' }]) {
    assert.equal(enterpriseInterchangeWritable({ ...model, context }), false);
    assert.equal(enterpriseInterchangeCommandPayload({ ...model, context }, { kind: 'bulk-edit-objects' }), null);
  }
  const rendered = renderEnterpriseInterchange({ projectId: 'project-x', model, el, ui: branchUi, api: async () => ({}), onCommand() {} });
  assert.match(rendered.textContent, /never runs or publishes work/);
  assert.equal(rendered.querySelectorAll('button').some((button) => button.text === 'Apply selected edits as one proposed version'), false);

  const bundle = { kind: 'orgward-enterprise-blueprint' };
  const preview = { source: { projectId: 'source-project', blueprintId: 'source-blueprint', blueprintVersion: 2, snapshotHash: 'source-hash' },
    currentSource: { blueprintId: model.context.blueprintId, blueprintVersion: 4, snapshotHash: 'current-hash' }, recordCount: 1,
    recognizedFields: 1, readyRecordIds: ['customer-x'], previewHash: 'preview-hash', unknownFields: [], lossyFields: [], collisions: [], validationErrors: [],
    rows: [{ id: 'customer-x', type: 'customer', status: 'READY', changedFields: ['name'], recognizedFields: ['name'], unknownFields: [], validationErrors: [] }] };
  const restoredDraft = { bundle, recordIds: ['customer-x'], reason: 'Retained after a definitive rejection.' };
  let restored = null; let called = null; let previewCalls = 0;
  const retryRoot = renderEnterpriseInterchange({ projectId: 'project-x', model, draft: restoredDraft, el, ui: branchUi,
    api: async (_path, options) => { previewCalls += 1; assert.equal(options.method, 'POST'); return { data: preview }; },
    onDraftChange(value) { restored = value; }, onCommand(payload) { called = payload; } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(previewCalls, 1);
  assert.equal(restored.preview, preview);
  assert.match(retryRoot.textContent, /Import preview/);
  const form = retryRoot.querySelectorAll('form').find((node) => node.attrs['data-enterprise-action'] === 'bulk-edit-objects');
  assert.ok(form);
  const reason = form.querySelectorAll('textarea')[0]; reason.value = 'Reviewed and corrected';
  form.listeners.get('submit')({ preventDefault() {} });
  assert.deepEqual(called, { kind: 'bulk-edit-objects', bundle, recordIds: ['customer-x'], reason: 'Reviewed and corrected' });
});

test('source evidence preview and human acceptance show provenance and retain explicit target and claim selections', async () => {
  const currentModel = { permissions: { write: true }, context: { isCurrent: true, blueprintId: 'blueprint-00000000-0000-4000-8000-000000000001',
    blueprintVersion: 4, effectiveAt: null, recordedAtCutoff: null, proposalId: null, branchId: null }, blueprint: { id: 'visible',
    areas: { customersOfferingsValueEconomics: { items: [{ id: 'customer-1', type: 'customer', name: 'Small business' }] } } } };
  const bundle = { kind: 'orgward-enterprise-source-evidence', schemaVersion: '1.0', source: { id: 'crm-export', label: 'CRM export' },
    records: [{ id: 'crm-1', type: 'customer', name: 'Small business', claims: [{ id: 'claim-1', path: 'name', value: 'Updated name' }] }] };
  const sourcePreview = { mode: 'SOURCE_ONBOARDING_PREVIEW', meaning: 'UNTRUSTED_EVIDENCE_PROPOSALS_ONLY',
    source: { id: 'crm-export', label: 'CRM export', locator: 'crm://exports/october', snapshotHash: 'a'.repeat(64) },
    currentSource: { blueprintId: currentModel.context.blueprintId, blueprintVersion: 4, snapshotHash: 'b'.repeat(64) },
    recordCount: 2, claimCount: 2, previewHash: 'c'.repeat(64), unknowns: [], collisions: [],
    proposals: [{ identity: { sourceRecordId: 'crm-1', type: 'customer', name: 'Small business', status: 'CANDIDATE', candidateObjectIds: ['customer-1'],
      provenance: { sourceId: 'crm-export', sourceLabel: 'CRM export', sourceLocator: 'crm://exports/october', recordLocator: 'crm-1', sourceHash: 'a'.repeat(64) } },
      claims: [{ id: 'claim-1', path: 'name', value: 'Updated name', status: 'PROPOSED', targetObjectId: 'customer-1',
        provenance: { sourceId: 'crm-export', sourceLocator: 'crm://exports/october', sourceRecordId: 'crm-1', recordLocator: 'crm-1', claimLocator: 'crm-1/name', sourceHash: 'a'.repeat(64) } }] },
      { identity: { sourceRecordId: 'crm-2', type: 'customer', name: 'Another source row', status: 'UNMATCHED', candidateObjectIds: [],
        provenance: { sourceId: 'crm-export', sourceLabel: 'CRM export', sourceLocator: 'crm://exports/october', recordLocator: 'crm-2', sourceHash: 'a'.repeat(64) } },
        claims: [{ id: 'claim-2', path: 'name', value: 'Another name', status: 'IDENTITY_UNRESOLVED', targetObjectId: null,
          provenance: { sourceId: 'crm-export', sourceLocator: 'crm://exports/october', sourceRecordId: 'crm-2', recordLocator: 'crm-2', claimLocator: 'crm-2/name', sourceHash: 'a'.repeat(64) } }] }],
    limitations: ['Preview does not authenticate the source or verify claim truth.', 'No record is written or published.'] };
  const draft = { fileName: 'crm.json', bundle, preview: sourcePreview };
  let accepted = null;
  const rendered = renderEnterpriseInterchange({ projectId: 'project-x', model: currentModel, draft, el, ui: branchUi, api: async () => ({}), onCommand(value) { accepted = value; } });
  assert.match(rendered.textContent, /Source evidence preview · proposals only/);
  assert.match(rendered.textContent, /crm-export\/crm:\/\/exports\/october\/crm-1\/crm-1\/name/);
  assert.match(rendered.textContent, /Updated name/);
  assert.match(rendered.textContent, /does not authenticate the source or verify claim truth/);
  assert.equal(rendered.querySelectorAll('form').some((form) => form.attrs['data-enterprise-action'] === 'bulk-edit-objects'), false);
  const acceptanceForm = rendered.querySelectorAll('form').find((form) => form.attrs['data-enterprise-action'] === 'accept-source-evidence');
  assert.ok(acceptanceForm);
  const targets = acceptanceForm.querySelectorAll('select');
  targets[0].value = 'customer-1'; targets[0].listeners.get('change')();
  const firstClaim = acceptanceForm.querySelectorAll('input').find((input) => input.attrs.value === 'claim-1');
  firstClaim.checked = true; firstClaim.listeners.get('change')();
  assert.equal(targets[0].required, true);
  assert.equal(targets[1].required, false, 'a target is required only for a source record with a selected claim');
  acceptanceForm.querySelectorAll('textarea')[0].value = 'Reviewed against customer record.';
  acceptanceForm.listeners.get('submit')({ preventDefault() {} });
  assert.deepEqual(accepted, { kind: 'accept-source-evidence', bundle, previewHash: sourcePreview.previewHash,
    blueprintHash: sourcePreview.currentSource.snapshotHash,
    selections: [{ sourceRecordId: 'crm-1', targetObjectId: 'customer-1', claimIds: ['claim-1'] }], reason: 'Reviewed against customer record.' });
  const baselineId = 'source-acceptance-00000000-0000-4000-8000-000000000001';
  const baseline = { id: baselineId, source: { id: 'crm-export' }, receivedAt: '2026-10-01T00:00:00.000Z',
    acceptedBlueprint: { version: 5 } };
  const report = { id: 'source-reconciliation-1', receivedAt: '2026-10-02T00:00:00.000Z', uploader: 'owner',
    input: { sourceId: 'crm-export', sourceBundleHash: 'd'.repeat(64) }, baseline: { acceptanceReceiptId: baselineId },
    sourceAuthentication: 'UNVERIFIED', freshness: 'UNKNOWN', counts: { DRIFTED: 1, MISSING: 1, UNVERIFIABLE: 0 },
    issues: [{ status: 'UNVERIFIABLE', reason: 'The baseline receipt failed its integrity check.' }],
    claims: [{ sourceRecordId: 'crm-1', targetObjectId: 'customer-1', path: 'name', status: 'DRIFTED', reason: 'Value differs.' },
      { sourceRecordId: 'crm-2', targetObjectId: 'customer-2', path: 'detail', status: 'MISSING', reason: 'Absent in this upload.' }] };
  const comparisonModel = { ...currentModel, sourceAcceptanceReceipts: [baseline], sourceReconciliationReports: [report] };
  let comparisonCommand = null;
  const comparisonView = renderEnterpriseInterchange({ projectId: 'project-x', model: comparisonModel, draft, el, ui: branchUi,
    api: async () => ({}), onCommand(value) { comparisonCommand = value; } });
  assert.match(comparisonView.textContent, /Uploaded claim comparison — source unverified/);
  assert.match(comparisonView.textContent, /Changed in upload/);
  assert.match(comparisonView.textContent, /Absent from upload/);
  assert.match(comparisonView.textContent, /freshness UNKNOWN/);
  assert.match(comparisonView.textContent, /UNVERIFIABLE · The baseline receipt failed its integrity check/);
  const compareButton = comparisonView.querySelectorAll('button').find((button) => button.text === 'Compare uploaded claims');
  const baselineSelect = comparisonView.querySelectorAll('select').find((select) => select.attrs.name === 'source-acceptance-baseline');
  assert.ok(compareButton && baselineSelect);
  assert.equal(compareButton.disabled, false);
  baselineSelect.value = baselineId;
  compareButton.listeners.get('click')();
  assert.deepEqual(comparisonCommand, { kind: 'compare-source-evidence', acceptanceReceiptId: baselineId, bundle });
  const readerPanel = renderEnterpriseInterchange({ projectId: 'project-x', model: { ...currentModel, permissions: { write: false } },
    el, ui: branchUi, api: async () => ({}), onCommand() {} });
  assert.equal(readerPanel.querySelectorAll('button').find((button) => button.text === 'Preview import').disabled, false);

  const storage = storageFixture();
  persistEnterpriseInterchangeDraft(storage, 'owner', 'project-x', draft);
  assert.equal(storage.getItem(enterpriseInterchangeDraftStorageKey('reader', 'project-x')), null);
  assert.deepEqual(restoreEnterpriseInterchangeDraft(storage, 'owner', 'project-x'), { fileName: 'crm.json', bundle, preview: null, recordIds: [], sourceSelections: [], reason: '' });
  assert.equal(restoreEnterpriseInterchangeDraft(storage, 'owner', 'project-y'), null);
  const retainedAcceptance = { ...draft, sourceSelections: [{ sourceRecordId: 'crm-1', targetObjectId: 'customer-1', claimIds: ['claim-1'] }],
    reason: 'Keep the human selection after reload.' };
  persistEnterpriseInterchangeDraft(storage, 'owner', 'project-x', retainedAcceptance);
  assert.deepEqual(restoreEnterpriseInterchangeDraft(storage, 'owner', 'project-x'), {
    fileName: 'crm.json', bundle, preview: null, recordIds: [], sourceSelections: retainedAcceptance.sourceSelections, reason: retainedAcceptance.reason });
  const retainedDesignDraft = { fileName: 'design.json', bundle: { kind: 'orgward-enterprise-blueprint', records: [] },
    recordIds: ['customer-1'], reason: 'Retain reviewer choice.' };
  persistEnterpriseInterchangeDraft(storage, 'owner', 'project-x', retainedDesignDraft);
  assert.deepEqual(restoreEnterpriseInterchangeDraft(storage, 'owner', 'project-x'), { ...retainedDesignDraft, preview: null, sourceSelections: [] });
  const malformedSourceDraft = { fileName: 'malformed-source.json', bundle: { kind: 'orgward-enterprise-source-evidence', schemaVersion: '1.0', records: null } };
  persistEnterpriseInterchangeDraft(storage, 'owner', 'project-x', malformedSourceDraft);
  assert.deepEqual(restoreEnterpriseInterchangeDraft(storage, 'owner', 'project-x'), { ...malformedSourceDraft, preview: null, recordIds: [], sourceSelections: [], reason: '' });
  const repairPanel = renderEnterpriseInterchange({ projectId: 'project-x', model: currentModel, draft: malformedSourceDraft, el, ui: branchUi,
    api: async () => { throw Object.assign(new Error('records must be an array'), { status: 400 }); }, onCommand() {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(repairPanel.textContent, /Retained source JSON needs review/);
  assert.equal(repairPanel.querySelectorAll('button').some((button) => button.text === 'Download retained source JSON'), true);
  persistEnterpriseInterchangeDraft(storage, 'owner', 'project-x', retainedAcceptance);
  const restoredDraft = restoreEnterpriseInterchangeDraft(storage, 'owner', 'project-x');
  let recoveredDraft = null;
  const recovered = renderEnterpriseInterchange({ projectId: 'project-x', model: currentModel, draft: restoredDraft, el, ui: branchUi,
    api: async (_path, options) => { assert.equal(options.method, 'POST'); return { data: sourcePreview }; },
    onDraftChange(value) { recoveredDraft = value; }, onCommand() {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(recoveredDraft.preview, sourcePreview);
  assert.match(recovered.textContent, /Source evidence preview · proposals only/);
  const recoveredForm = recovered.querySelectorAll('form').find((form) => form.attrs['data-enterprise-action'] === 'accept-source-evidence');
  assert.ok(recoveredForm, 'the rechecked source preview restores its acceptance form');
  assert.equal(recoveredForm.querySelectorAll('select')[0].value, 'customer-1');
  assert.equal(recoveredForm.querySelectorAll('input').find((input) => input.attrs.value === 'claim-1').checked, true);
  assert.equal(recoveredForm.querySelectorAll('textarea')[0].value, retainedAcceptance.reason);
  persistEnterpriseInterchangeDraft(storage, 'owner', 'project-x', null);
  assert.equal(storage.getItem(enterpriseInterchangeDraftStorageKey('owner', 'project-x')), null);

  let releasePreview;
  let isCurrent = true;
  let staleDraftCallback = false;
  const selected = { id: 'customer-1', type: 'customer', name: 'Small business', detail: 'Canonical customer.' };
  const objectModel = model({ blueprint: { areas: { customersOfferingsValueEconomics: { items: [selected] } } },
    selection: { object: selected, states: { basisHash: 'd'.repeat(64) }, visible: true, hiddenBy: [] } });
  const late = renderEnterpriseObject({ projectId: 'project-x', model: objectModel, object: selected, interchangeDraft: { bundle }, el,
    api: () => new Promise((resolve) => { releasePreview = resolve; }), isCurrentContext: () => isCurrent,
    onDraftChange() { staleDraftCallback = true; }, onCommand() {} });
  await new Promise((resolve) => setImmediate(resolve));
  isCurrent = false;
  releasePreview({ data: sourcePreview });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(staleDraftCallback, false);
  assert.doesNotMatch(late.textContent, /Source evidence preview · proposals only/);
});

test('collector attestation UI discloses trust boundary and submits profile and signed manifest commands', () => {
  const model = { permissions: { write: true, sourceAttestationAdmin: true },
    context: { isCurrent: true, blueprintId: 'blueprint-00000000-0000-4000-8000-000000000001', blueprintVersion: 5,
      effectiveAt: null, recordedAtCutoff: null, proposalId: null, branchId: null },
    blueprint: { id: 'visible' }, sourceAttestationProfiles: [{ id: 'source-profile-00000000-0000-4000-8000-000000000001',
      tenantId: 'tenant-fixture', sourceId: 'crm', sourceAccountId: 'acct', sourceInstanceId: 'prod', resourceNamespace: 'customers',
      collectorId: 'collector', version: 1, active: true, activeKeyId: 'key-1', keys: [], intervalSeconds: 120,
      freshnessPolicy: { maxAgeSeconds: 300 }, coverageScope: { recordTypes: ['customer'], paths: ['name'] },
      pushStatus: { status: 'OVERDUE', reason: 'Push interval elapsed.' } }], sourceReconciliationReports: [] };
  const submitted = [];
  const view = renderEnterpriseInterchange({ projectId: 'project-x', model, el, ui: branchUi, api: async () => ({}), onCommand(value) { submitted.push(value); } });
  assert.match(view.textContent, /does not independently verify third-party acquisition or source truth/);
  const profile = view.querySelectorAll('form').find((entry) => entry.attrs['data-enterprise-action'] === 'configure-source-attestation-profile');
  const manifest = view.querySelectorAll('form').find((entry) => entry.attrs['data-enterprise-action'] === 'ingest-source-attestation-manifest');
  assert.ok(profile && manifest);
  const fields = Object.fromEntries(Array.from(profile.querySelectorAll('input,select,textarea'), (entry) => [entry.attrs.name, entry]));
  fields.mode.value = 'CREATE'; fields.sourceId.value = 'crm'; fields.sourceAccountId.value = 'account'; fields.sourceInstanceId.value = 'instance';
  fields.resourceNamespace.value = 'customers'; fields.collectorId.value = 'collector'; fields.recordTypes.value = 'customer'; fields.paths.value = 'name';
  fields.keyId.value = 'key-1'; fields.publicKeyPem.value = '-----BEGIN PUBLIC KEY----- test'; fields.intervalSeconds.value = '120'; fields.maxAgeSeconds.value = '300';
  fields.maxClockSkewSeconds.value = '30'; fields.reason.value = 'Pin reviewed local collector';
  profile.listeners.get('submit')({ preventDefault() {} });
  assert.equal(submitted[0].kind, 'configure-source-attestation-profile');
  assert.deepEqual(submitted[0].profile.coverageScope, { recordTypes: ['customer'], paths: ['name'] });
  assert.equal(submitted[0].profile.intervalSeconds, 120);
  assert.match(view.textContent, /Expected collector push interval in seconds/);
  assert.match(view.textContent, /Collector push endpoint: POST \/api\/v1\/tenants\/tenant-fixture\/projects\/project-x\/source-attestation-profiles\//);
  assert.match(view.textContent, /Send a signed complete snapshot every 120s/);
  manifest.querySelectorAll('textarea')[0].value = '{"kind":"orgward-enterprise-observation-manifest"}';
  manifest.listeners.get('submit')({ preventDefault() {} });
  assert.deepEqual(submitted[1], { kind: 'ingest-source-attestation-manifest', manifest: { kind: 'orgward-enterprise-observation-manifest' } });
  const reader = renderEnterpriseInterchange({ projectId: 'project-x', model: { ...model, permissions: { write: false, sourceAttestationAdmin: false } },
    el, ui: branchUi, api: async () => ({}), onCommand() {} });
  assert.equal(reader.querySelectorAll('form').some((entry) => entry.attrs['data-enterprise-action'] === 'configure-source-attestation-profile'), false);
  assert.equal(reader.querySelectorAll('form').some((entry) => entry.attrs['data-enterprise-action'] === 'ingest-source-attestation-manifest'), false);
});

test('collector finding UI stays pending until an owner explicitly creates a proposed correction', async () => {
  const blueprintId = 'blueprint-00000000-0000-4000-8000-000000000001';
  const finding = { findingId: 'source-finding-00000000-0000-4000-8000-000000000001', findingStatus: 'PENDING_REVIEW',
    findingRowIndex: 0, sourceRecordId: 'crm-row-1', sourceRecordType: 'customer', sourceRecordName: 'North Star',
    targetObjectId: 'customer-1', claimId: 'crm-name', path: 'name', acceptedValue: 'Accepted name', observedValue: 'Observed name',
    status: 'CONTRADICTED', reason: 'Fresh collector-attested evidence differs.' };
  const report = { id: 'source-reconciliation-00000000-0000-4000-8000-000000000001', reportHash: 'a'.repeat(64),
    comparatorVersion: 'collector-attestation/v1', receivedAt: '2026-10-06T10:00:00.000Z', manifest: { hash: 'b'.repeat(64) },
    sourceProfile: { sourceId: 'crm' }, counts: { CONTRADICTED: 1 }, claims: [finding] };
  const model = { permissions: { write: true, sourceAttestationAdmin: true },
    context: { isCurrent: true, blueprintId, blueprintVersion: 5, effectiveAt: null, recordedAtCutoff: null, proposalId: null, branchId: null },
    blueprint: { id: blueprintId, areas: { customers: { items: [{ id: 'customer-1', type: 'customer', name: 'Current name' }] } } },
    sourceReconciliationReports: [report], sourceAttestationCorrectionReceipts: [], sourceAcceptanceReceipts: [] };
  const signedManifest = { kind: 'orgward-enterprise-observation-manifest', signature: { value: 'fixture' } };
  const proposalPreview = { reportId: report.id, reportHash: report.reportHash, manifestHash: report.manifest.hash, finding,
    previewHash: 'c'.repeat(64), currentSource: { blueprintId, blueprintVersion: 5, snapshotHash: 'd'.repeat(64) },
    proposals: [{ identity: { sourceRecordId: finding.sourceRecordId, type: 'customer', name: 'North Star', status: 'UNMATCHED', candidateObjectIds: [] },
      claims: [{ id: finding.claimId, path: finding.path, value: finding.observedValue, status: 'PROPOSED',
        provenance: { claimLocator: 'row/name' } }] }] };
  const requests = []; let submitted = null;
  const view = renderEnterpriseInterchange({ projectId: 'project-x', model, el, ui: branchUi,
    api: async (path, options) => { requests.push({ path, options: JSON.parse(options.body) }); return { data: proposalPreview }; },
    onCommand(payload) { submitted = payload; } });
  const findingRoot = view.querySelectorAll('[data-attested-correction-finding]')[0];
  assert.ok(findingRoot);
  assert.match(findingRoot.textContent, /Pending review/);
  const textArea = findingRoot.querySelectorAll('textarea')[0]; textArea.value = JSON.stringify(signedManifest);
  const review = findingRoot.querySelectorAll('button').find((button) => button.text === 'Review signed finding');
  review.listeners.get('click')();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(requests[0], { path: '/api/v1/projects/project-x/enterprise/attestation-proposal-preview',
    options: { reportId: report.id, reportHash: report.reportHash, findingId: finding.findingId, manifest: signedManifest } });
  assert.equal(submitted, null, 'report preview does not mutate the design or create a proposal');
  assert.match(findingRoot.textContent, /Create proposed correction/);
  const form = findingRoot.querySelectorAll('form').find((node) => node.attrs['data-enterprise-action'] === 'propose-attested-source-correction');
  assert.ok(form);
  const checkbox = form.querySelectorAll('input').find((input) => input.attrs.value === finding.claimId);
  assert.equal(checkbox.checked, true);
  const target = form.querySelectorAll('select')[0];
  assert.equal(target.value, '', 'the owner must explicitly confirm the finding’s pinned target');
  assert.deepEqual(Array.from(target.querySelectorAll('option'), (option) => option.attrs.value), ['', finding.targetObjectId]);
  target.value = finding.targetObjectId;
  form.querySelectorAll('textarea')[0].value = 'Owner reviewed the immutable source finding.';
  form.listeners.get('submit')({ preventDefault() {} });
  assert.equal(submitted.kind, 'propose-attested-source-correction');
  assert.equal(submitted.reportId, report.id);
  assert.equal(submitted.findingId, finding.findingId);
  assert.deepEqual(submitted.manifest, signedManifest);
  assert.deepEqual(submitted.selections, [{ sourceRecordId: finding.sourceRecordId, targetObjectId: finding.targetObjectId,
    claimIds: [finding.claimId] }]);
  assert.equal(submitted.reason, 'Owner reviewed the immutable source finding.');
});

test('source report consumer UI separates stale historical status from explicit owner recomputation and mapping repair', () => {
  const blueprintId = 'blueprint-00000000-0000-4000-8000-000000000001';
  const profileId = 'source-profile-00000000-0000-4000-8000-000000000001';
  const report = { id: 'source-reconciliation-00000000-0000-4000-8000-000000000001', reportHash: 'a'.repeat(64),
    comparatorVersion: 'collector-attestation/v1', receivedAt: '2026-10-06T10:00:00.000Z', uploader: 'collector',
    sourceAuthentication: 'COLLECTOR_ATTESTED', freshness: 'WITHIN_POLICY_WINDOW', sourceProfile: { id: profileId, sourceId: 'crm' },
    baseline: { acceptanceReceiptId: 'source-acceptance-00000000-0000-4000-8000-000000000001', receiptHash: 'c'.repeat(64) },
    manifest: { hash: 'b'.repeat(64) }, counts: { CURRENT: 1 }, claims: [{ sourceRecordId: 'row-1', sourceRecordType: 'customer',
      sourceRecordName: 'North Star', targetObjectId: 'customer-1', claimId: 'name-claim', path: 'name', status: 'CURRENT', reason: 'Matches.' }] };
  const model = { permissions: { write: true, sourceAttestationAdmin: true },
    context: { isCurrent: true, blueprintId, blueprintVersion: 5, effectiveAt: null, recordedAtCutoff: null, proposalId: null, branchId: null },
    blueprint: { id: blueprintId, areas: { customers: { items: [{ id: 'customer-1', type: 'customer', name: 'North Star' },
      { id: 'customer-2', type: 'customer', name: 'Other customer' }] } } },
    sourceReconciliationReports: [report], sourceReconciliationCurrentness: [{ reportId: report.id, state: 'STALE', mappingRevision: 2,
      reason: 'Mapping changed.' }], sourceAttestationMappingRevisions: [{ profileId, version: 2 }],
    sourceAttestationProfiles: [{ id: profileId, version: 1, tenantId: 'tenant-x', sourceId: 'crm', sourceAccountId: 'acct',
      sourceInstanceId: 'prod', resourceNamespace: 'customers', collectorId: 'collector', active: true, activeKeyId: 'key', keys: [],
      intervalSeconds: 300, freshnessPolicy: { maxAgeSeconds: 3600 }, coverageScope: { recordTypes: ['customer'], paths: ['name'] },
      pushStatus: { reportId: report.id } }] };
  let submitted = null;
  const view = renderEnterpriseInterchange({ projectId: 'project-x', model, el, ui: branchUi, api: async () => ({}), onCommand(payload) { submitted = payload; } });
  const history = view.querySelectorAll('[data-source-reconciliation-report]')[0];
  assert.match(history.textContent, /Historical status only; this report is not current/);
  const forms = history.querySelectorAll('form');
  const recompute = forms.find((form) => form.attrs['data-enterprise-action'] === 'recompute-source-reconciliation-report');
  const repair = forms.find((form) => form.attrs['data-enterprise-action'] === 'repair-source-claim-mapping');
  assert.ok(recompute && repair);
  recompute.querySelectorAll('textarea')[0].value = '{"signature":{"value":"signed"}}';
  recompute.listeners.get('submit')({ preventDefault() {} });
  assert.equal(submitted.kind, 'recompute-source-reconciliation-report');
  assert.equal(submitted.reportId, report.id);
  assert.deepEqual(submitted.manifest, { signature: { value: 'signed' } });
  const target = repair.querySelectorAll('select')[0]; target.value = 'customer-2';
  repair.querySelectorAll('textarea')[0].value = 'Repair exact mapping.';
  repair.listeners.get('submit')({ preventDefault() {} });
  assert.deepEqual(submitted, { kind: 'repair-source-claim-mapping', profileId, expectedProfileVersion: 1, expectedMappingVersion: 2,
    baselineAcceptanceReceiptId: report.baseline.acceptanceReceiptId, baselineReceiptHash: report.baseline.receiptHash,
    reportId: report.id, reportHash: report.reportHash,
    oldBinding: { sourceRecordId: 'row-1', claimId: 'name-claim', path: 'name', targetObjectId: 'customer-1' },
    replacementTargetObjectId: 'customer-2', reason: 'Repair exact mapping.' });
});
function storageFixture(values = new Map()) {
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key), values };
}
const lenses = Array.from({ length: 16 }, (_, index) => ({ id: `L-${String(index + 1).padStart(2, '0')}`, label: `Perspective ${index + 1}`, types: [] }));
const object = { id: 'process-deliver', type: 'process', name: 'Deliver the core offering', detail: 'Complete the service.' };
const model = (overrides = {}) => ({
  context: { projectVersion: 7, blueprintId: 'blueprint-00000000-0000-4000-8000-000000000001', blueprintVersion: 3, isCurrent: true, lensId: 'all', scopeId: null, branch: 'main' },
  blueprint: { areas: { responsibilityAuthority: { items: [object] } } },
  scopes: [], versions: [{ id: 'blueprint-current', version: 3, createdAt: '2026-10-01T00:00:00.000Z' }],
  lenses, gaps: [], permissions: { write: true, scopeAdmin: true }, selection: null,
  ...overrides,
});

test('enterprise route preserves the exact perspective, optional scope, history, and selected object', () => {
  assert.deepEqual(enterpriseQuery({}), { lensId: 'all', scopeId: null, blueprintVersion: null });
  const allRoute = enterpriseRequestPath('project one', enterpriseQuery({ lensId: 'all' }), 'process-deliver');
  assert.equal(allRoute, '/api/v1/projects/project%20one/enterprise?lensId=all&selectedId=process-deliver');
  assert.equal(enterpriseRequestPath('project-one', enterpriseQuery({ scopeId: 'organization-one' })),
    '/api/v1/projects/project-one/enterprise?lensId=all&scopeId=organization-one');
  assert.equal(enterpriseRequestPath('project-one', enterpriseQuery({ lensId: 'L-05', blueprintVersion: 2 }), 'unit-child'),
    '/api/v1/projects/project-one/enterprise?lensId=L-05&blueprintVersion=2&selectedId=unit-child');
  const simulationId = 'process-simulation-00000000-0000-4000-8000-000000000001';
  const simulationQuery = enterpriseQuery({ simulationId });
  assert.equal(simulationQuery.simulationId, simulationId);
  assert.equal(enterpriseRequestPath('project-one', simulationQuery, 'process-deliver'),
    `/api/v1/projects/project-one/enterprise?lensId=all&simulationId=${simulationId}&selectedId=process-deliver`);
  assert.equal(hasEnterpriseContext({ simulationId }), true);
  const savedRoute = { projectId: 'project-one', view: 'map', selectedId: 'process-deliver', simulationId };
  assert.equal(decodeStudioRoute(encodeStudioRoute(savedRoute)).simulationId, simulationId);
  assert.equal(enterpriseContextReadOnly({ isCurrent: true }), false);
  assert.equal(enterpriseCommandStorageKey('oidc:owner', 'project-one'),
    'orgward:enterprise-command:oidc%3Aowner:project-one');
});

test('enterprise temporal routes preserve exact proposal and effective/recorded dates', () => {
  const temporal = enterpriseQuery({ proposalId: 'proposal-one', effectiveAt: '2026-10-04T00:00:00.000Z', recordedAt: '2026-10-03T12:00:00.000Z' });
  assert.deepEqual(temporal, { lensId: 'all', scopeId: null, blueprintVersion: null, proposalId: 'proposal-one',
    effectiveAt: '2026-10-04T00:00:00.000Z', recordedAt: '2026-10-03T12:00:00.000Z' });
  assert.equal(enterpriseRequestPath('project-one', temporal, 'process-deliver'),
    '/api/v1/projects/project-one/enterprise?lensId=all&proposalId=proposal-one&effectiveAt=2026-10-04T00%3A00%3A00.000Z&recordedAt=2026-10-03T12%3A00%3A00.000Z&selectedId=process-deliver');
  assert.equal(enterpriseContextReadOnly({ isCurrent: true, effectiveAt: temporal.effectiveAt }), true);
  assert.equal(enterpriseContextReadOnly({ isCurrent: true, proposalId: temporal.proposalId }), true);
  assert.equal(enterpriseContextReadOnly({ isCurrent: true, recordedAtCutoff: temporal.recordedAt }), true);
});

test('branch context route and command helpers retain exact draft revision, source, candidate and recovery destination', async () => {
  const projectId = 'project-00000000-0000-4000-8000-000000000001';
  const branchId = 'enterprise-branch-00000000-0000-4000-8000-000000000002';
  const mainId = 'blueprint-00000000-0000-4000-8000-000000000003';
  const draftId = 'blueprint-00000000-0000-4000-8000-000000000004';
  const candidateId = 'enterprise-merge-00000000-0000-4000-8000-000000000005';
  const candidateHash = 'd'.repeat(64);
  const route = { projectId, view: 'map', selectedId: 'process-deliver', branchId, branchRevision: 2 };
  const decoded = decodeStudioRoute(encodeStudioRoute(route));
  assert.equal(decoded.projectId, projectId);
  assert.equal(decoded.branchId, branchId);
  assert.equal(decoded.branchRevision, 2);
  assert.equal(decoded.selectedId, 'process-deliver');
  assert.equal(encodeStudioRoute(decoded), encodeStudioRoute(route));
  const query = enterpriseQuery({ branchId, branchRevision: 2 });
  assert.deepEqual(query, { lensId: 'all', scopeId: null, blueprintVersion: null, branchId, branchRevision: 2 });
  assert.equal(enterpriseRequestPath(projectId, query, 'process-deliver'),
    `/api/v1/projects/${projectId}/enterprise?lensId=all&branchId=${branchId}&branchRevision=2&selectedId=process-deliver`);

  const createSource = { permissions: { branchCreate: true }, context: { blueprintId: mainId, blueprintVersion: 7,
    branchId: null, proposalId: 'enterprise-proposal-00000000-0000-4000-8000-000000000006' }, blueprint: { id: mainId } };
  assert.deepEqual(enterpriseBranchCommandPayload(createSource, { kind: 'create-branch', title: 'Draft from future source', reason: 'Compare exact proposal.' }), {
    kind: 'create-branch', title: 'Draft from future source', reason: 'Compare exact proposal.', blueprintId: mainId, blueprintVersion: 7,
    proposalId: createSource.context.proposalId,
  });

  const comparison = { mainBlueprintId: mainId, mainBlueprintVersion: 7, mainSnapshotHash: 'a'.repeat(64), conflicts: [] };
  const branchModel = { permissions: { branchCreate: true, branchWrite: true, branchAdmin: true },
    context: { branchId, branchRevision: 2, blueprintId: draftId, blueprintVersion: 3 },
    blueprint: { id: draftId }, branch: { id: branchId, status: 'DRAFT', revision: 2, isHead: true, comparison,
      candidate: { id: candidateId, hash: candidateHash, status: 'PENDING', branchRevision: 2,
        mainBlueprintId: mainId, mainBlueprintVersion: 7, eligibility: { status: 'UNKNOWN' } } } };
  assert.equal(enterpriseBranchWritable(branchModel), true);
  assert.equal(enterpriseCandidateCurrent(branchModel), true);
  assert.equal(enterpriseBranchWritable({ ...branchModel, context: { ...branchModel.context, effectiveAt: '2030-01-01T00:00:00.000Z' } }), false);
  assert.equal(enterpriseBranchWritable({ ...branchModel, context: { ...branchModel.context, branchRevision: 1 } }), false);
  assert.equal(enterpriseCandidateCurrent({ ...branchModel,
    branch: { ...branchModel.branch, revision: 3, candidate: { ...branchModel.branch.candidate, branchRevision: 2 } } }), false);
  assert.equal(enterpriseCandidateCurrent({ ...branchModel, branch: { ...branchModel.branch,
    comparison: { ...comparison, mainBlueprintVersion: 8 } } }), false);
  assert.deepEqual(enterpriseBranchCommandPayload(branchModel, { kind: 'edit-branch-object', edit: { objectId: 'process-deliver' }, reason: 'Draft change.' }), {
    kind: 'edit-branch-object', edit: { objectId: 'process-deliver' }, reason: 'Draft change.', branchId, branchRevision: 2,
    blueprintId: draftId, blueprintVersion: 3,
  });
  assert.deepEqual(enterpriseBranchCommandPayload(branchModel, { kind: 'prepare-merge', resolutions: [], reason: 'Prepare exact candidate.' }), {
    kind: 'prepare-merge', resolutions: [], reason: 'Prepare exact candidate.', branchId, branchRevision: 2,
    blueprintId: mainId, blueprintVersion: 7,
  });
  const reviewPayload = { kind: 'review-merge', candidateId, candidateHash, decision: 'ACCEPT', reason: 'Review.' };
  assert.equal(enterpriseBranchCommandPayload(branchModel, reviewPayload).blueprintId, mainId);
  assert.equal(enterpriseBranchCommandPayload({ ...branchModel, permissions: { ...branchModel.permissions, branchAdmin: false } }, reviewPayload), null);
  for (const status of ['ACCEPTED', 'REJECTED']) assert.equal(enterpriseBranchCommandPayload({ ...branchModel,
    branch: { ...branchModel.branch, candidate: { ...branchModel.branch.candidate, status } } }, reviewPayload), null,
  `${status} is immutable and cannot receive a second review`);
  const failed = enterpriseCommandResultRoute(route, { kind: 'edit-branch-object' }, null);
  assert.deepEqual(failed, route, 'an uncertain or failed command leaves the exact branch route available for recovery');
  assert.deepEqual(enterpriseCommandResultRoute(route, { kind: 'edit-branch-object' }, { branchId, branchRevision: 3, affectedObjectId: 'process-deliver' }),
    { ...route, blueprintVersion: null, proposalId: null, effectiveAt: null, recordedAt: null,
      branchRevision: 3, selectedId: 'process-deliver' });
  const applied = enterpriseCommandResultRoute(route, { kind: 'apply-reviewed-merge' }, { affectedObjectId: 'process-deliver' });
  assert.equal(applied.branchId, null);
  assert.equal(applied.branchRevision, null);
  assert.equal(applied.selectedId, 'process-deliver');

  const storage = storageFixture();
  const saved = { projectId, envelope: { schemaVersion: '1.0', commandId: 'uncertain-branch-command', expectedVersion: 20,
    payload: { kind: 'edit-branch-object', blueprintId: draftId, blueprintVersion: 3, branchId, branchRevision: 2,
      reason: 'Recover this exact draft change.', edit: { objectId: 'process-deliver', name: 'Delivery branch' } } } };
  persistEnterpriseCommand(storage, 'oidc:owner', projectId, saved);
  const restored = restoreEnterpriseCommand(storage, 'oidc:owner', projectId);
  assert.deepEqual(restored, saved);
  const calls = [];
  await submitEnterpriseCommand(async (...args) => { calls.push(args); return { data: {} }; }, projectId, restored);
  assert.deepEqual(calls, [[`/api/v1/projects/${projectId}/enterprise/commands`, { method: 'POST', body: JSON.stringify(saved.envelope) }]]);
});

test('historical blueprint can create an isolated restore draft from its exact saved version', () => {
  const historical = { blueprintId: 'blueprint-00000000-0000-4000-8000-000000000011', blueprintVersion: 2,
    projectVersion: 9, branchId: null, proposalId: null, effectiveAt: null, recordedAtCutoff: null, isCurrent: false };
  const model = { context: historical, blueprint: { id: historical.blueprintId, version: historical.blueprintVersion },
    versions: [{ version: 1 }, { version: 2 }, { version: 3 }], permissions: { branchCreate: true } };
  let command;
  const root = renderEnterpriseBranches({ model, query: { blueprintVersion: 2 }, el, ui: branchUi,
    onContext() {}, onCommand: (value) => { command = value; }, utcTime: (value) => value || null });
  assert.match(root.textContent, /Restore this saved version as a draft/);
  assert.match(root.textContent, /Current main remains unchanged until the normal merge review is completed/);
  const form = root.querySelectorAll('form').find((entry) => entry.attrs['data-enterprise-action'] === 'create-branch');
  assert.ok(form);
  assert.match(form.attrs['aria-label'], /version 2/);
  const controls = form.querySelectorAll('input,textarea');
  controls[0].value = 'Restore from version two';
  controls[1].value = 'Recover the earlier customer-approved structure for review.';
  form.listeners.get('submit')({ preventDefault() {} });
  assert.deepEqual(enterpriseBranchCommandPayload(model, command), {
    kind: 'create-branch', title: 'Restore from version two', reason: 'Recover the earlier customer-approved structure for review.',
    blueprintId: historical.blueprintId, blueprintVersion: 2, proposalId: null,
  });
  const currentModel = { ...model, context: { ...historical, blueprintVersion: 3, blueprintId: 'blueprint-00000000-0000-4000-8000-000000000012', isCurrent: true },
    blueprint: { id: 'blueprint-00000000-0000-4000-8000-000000000012', version: 3 } };
  const ordinary = renderEnterpriseBranches({ model: currentModel, query: {}, el, ui: branchUi,
    onContext() {}, onCommand() {}, utcTime: (value) => value || null });
  assert.doesNotMatch(ordinary.textContent, /Restore this saved version as a draft/,
    'the latest main version keeps its ordinary branch action');
});

test('branch review UI compares main and draft fields and keeps unresolved choices explicit', () => {
  const branchId = 'enterprise-branch-00000000-0000-4000-8000-000000000002';
  const mainId = 'blueprint-00000000-0000-4000-8000-000000000003';
  const draftId = 'blueprint-00000000-0000-4000-8000-000000000004';
  const conflicts = [
    { conflictId: `conflict-${'1'.repeat(64)}`, objectId: 'process-deliver', objectName: 'Delivery', field: 'name', kind: 'CONTENT', base: 'Base', current: 'Main', proposed: 'Draft' },
    { conflictId: `conflict-${'2'.repeat(64)}`, objectId: 'process-deliver', objectName: 'Delivery', field: 'inputs', kind: 'REFERENCE', base: ['information-customer-signal'], current: ['information-prioritised-need'], proposed: ['information-delivery-result'] },
    { conflictId: `conflict-${'3'.repeat(64)}`, objectId: 'process-deliver', objectName: 'Delivery', field: 'enterpriseScope', kind: 'SCOPE', base: { organizationId: 'org-base' }, current: { organizationId: 'org-main' }, proposed: { organizationId: 'org-draft' } },
  ];
  const comparison = { mainBlueprintId: mainId, mainBlueprintVersion: 7, conflicts, changes: conflicts,
    relations: { currentAdded: [], currentRemoved: [], branchAdded: [{ source: 'process-deliver', target: 'org-draft', type: 'within-organization' }], branchRemoved: [] } };
  const modelValue = { context: { branchId, branchRevision: 2, blueprintId: draftId, blueprintVersion: 3, validity: null },
    permissions: { branchCreate: true, branchWrite: true, branchAdmin: false },
    blueprint: { areas: { capabilitiesProcesses: { items: [object] } } },
    branches: [], branch: { id: branchId, title: 'Delivery branch', status: 'DRAFT', revision: 2, headRevision: 2,
      baseBlueprintId: mainId, baseBlueprintVersion: 6, baseSnapshotHash: 'a'.repeat(64), isHead: true,
      revisions: [{ revision: 1, recordedAt: '2026-10-03T00:00:00.000Z' }, { revision: 2, recordedAt: '2026-10-03T01:00:00.000Z' }],
      comparison, candidate: { id: 'enterprise-merge-00000000-0000-4000-8000-000000000005', hash: 'b'.repeat(64), status: 'PENDING', branchRevision: 2,
        mainBlueprintId: mainId, mainBlueprintVersion: 7, changes: conflicts, eligibility: { status: 'UNKNOWN' } } } };
  const root = renderEnterpriseBranches({ model: modelValue, query: { branchId, branchRevision: 2 }, el, ui: branchUi,
    onContext: () => {}, onCommand: () => {}, utcTime: (value) => value || null });
  assert.equal(root.attrs['aria-label'], 'Design branches and reviewed merge');
  assert.match(root.textContent, /Both main and draft changed this field/);
  assert.match(root.textContent, /Main added/);
  assert.match(root.textContent, /Draft added/);
  const resolve = root.querySelectorAll('form').find((form) => form.attrs['data-enterprise-action'] === 'prepare-merge');
  assert.ok(resolve);
  assert.equal(resolve.querySelectorAll('select').length, 3);
  assert.ok(resolve.querySelectorAll('select').every((control) => control.children.some((entry) => entry.textContent.startsWith('Keep main:'))
    && control.children.some((entry) => entry.textContent.startsWith('Use draft:'))));
  const apply = root.querySelectorAll('form').find((form) => form.attrs['data-enterprise-action'] === 'apply-reviewed-merge');
  assert.ok(apply.querySelectorAll('button').every((button) => button.disabled), 'pending candidates cannot be applied');
});

test('branch conflict labels use names from the matching base, current, and draft snapshots', () => {
  const branchId = 'enterprise-branch-00000000-0000-4000-8000-000000000012';
  const conflictId = `conflict-${'4'.repeat(64)}`;
  const conflict = { conflictId, objectId: 'process-deliver', objectName: 'Delivery', field: 'enterpriseScope', kind: 'SCOPE',
    base: { organizationId: 'org-base-only' }, current: { organizationId: 'org-current-only' }, proposed: { organizationId: 'org-draft-only' } };
  const referenceNames = { base: { 'org-base-only': 'Base Commerce Group' },
    current: { 'org-current-only': 'Northstar Services' }, proposed: { 'org-draft-only': 'Draft Customer Operations' } };
  const modelValue = { context: { branchId, branchRevision: 1, blueprintId: 'blueprint-draft', blueprintVersion: 1 },
    permissions: { branchWrite: true, branchAdmin: false },
    blueprint: { areas: { capabilitiesProcesses: { items: [object] } } }, branches: [],
    branch: { id: branchId, title: 'Delivery branch', status: 'DRAFT', revision: 1, headRevision: 1, isHead: true,
      revisions: [{ revision: 1, recordedAt: '2026-10-03T00:00:00.000Z' }],
      comparison: { mainBlueprintId: 'blueprint-main', mainBlueprintVersion: 2, changes: [conflict], conflicts: [conflict], referenceNames,
        relations: { currentAdded: [{ source: 'process-deliver', target: 'org-current-only', type: 'within-organization' }], currentRemoved: [],
          branchAdded: [{ source: 'process-deliver', target: 'org-draft-only', type: 'within-organization' }], branchRemoved: [] } },
      candidate: null } };
  let command = null;
  const root = renderEnterpriseBranches({ model: modelValue, query: { branchId, branchRevision: 1 }, el, ui: branchUi,
    onContext: () => {}, onCommand: (value) => { command = value; }, utcTime: (value) => value || null });
  assert.match(root.textContent, /Saved base:.*Base Commerce Group/);
  assert.match(root.textContent, /Current main:.*Northstar Services/);
  assert.match(root.textContent, /Draft:.*Draft Customer Operations/);
  assert.match(root.textContent, /Main added:.*Northstar Services/);
  assert.match(root.textContent, /Draft added:.*Draft Customer Operations/);
  const resolve = root.querySelectorAll('form').find((form) => form.attrs['data-enterprise-action'] === 'prepare-merge');
  const choice = resolve.querySelectorAll('select')[0];
  assert.ok(choice.children.some((entry) => entry.textContent.includes('Keep main:') && entry.textContent.includes('Northstar Services')));
  assert.ok(choice.children.some((entry) => entry.textContent.includes('Use draft:') && entry.textContent.includes('Draft Customer Operations')));
  choice.value = 'current';
  resolve.listeners.get('submit')?.({ preventDefault() {} });
  assert.deepEqual(command.resolutions, [{ conflictId, choice: 'current' }]);
});

test('enterprise process authoring binds current and branch snapshots and requires explicit typed scenario values', () => {
  const process = { id: 'process-transfer', type: 'process', name: 'Transfer funds', detail: 'Move a transfer.' };
  const current = { permissions: { processWrite: true, simulate: true }, context: { blueprintId: 'blueprint-main', blueprintVersion: 8, isCurrent: true }, blueprint: { id: 'blueprint-main' } };
  assert.deepEqual(enterpriseProcessCommandPayload(current, { kind: 'define-process-flow', objectId: process.id, processFlow: { schemaVersion: '1.0' }, reason: 'Record route design.' }), {
    kind: 'define-process-flow', objectId: process.id, processFlow: { schemaVersion: '1.0' }, reason: 'Record route design.',
    blueprintId: 'blueprint-main', blueprintVersion: 8,
  });
  const draft = { ...current, permissions: { processWrite: true, branchWrite: true, simulate: true }, context: { blueprintId: 'blueprint-draft', blueprintVersion: 3,
    branchId: 'enterprise-branch-00000000-0000-4000-8000-000000000021', branchRevision: 4 },
    branch: { id: 'enterprise-branch-00000000-0000-4000-8000-000000000021', status: 'DRAFT', revision: 4, isHead: true } };
  const draftEdit = enterpriseProcessCommandPayload(draft, { kind: 'define-process-flow', objectId: process.id, processFlow: { schemaVersion: '1.0' }, reason: 'Edit the exact draft.' });
  assert.equal(draftEdit.blueprintId, 'blueprint-draft');
  assert.equal(draftEdit.branchId, draft.context.branchId);
  assert.equal(draftEdit.branchRevision, 4);
  const simulation = enterpriseProcessCommandPayload(draft, { kind: 'simulate-process', processId: process.id,
    scenario: { inputs: [], activityOutcomes: [], decisionChoices: [], stepLimit: 12 }, reason: 'Inspect the exact draft flow.' });
  assert.equal(simulation.blueprintId, 'blueprint-draft');
  assert.equal(simulation.branchRevision, 4);
  const staffing = enterpriseProcessCommandPayload(draft, { kind: 'simulate-staffing', processId: process.id,
    scenario: { schemaVersion: '1.0', arrivals: { value: 12, unit: 'requests' }, interval: { value: 1, unit: 'days' },
      capacityPerWorker: { value: 8, unit: 'requests' }, workerCounts: [1, 2] }, reason: 'Compare unvalidated assumptions.' });
  assert.equal(staffing.blueprintId, 'blueprint-draft');
  assert.equal(staffing.branchRevision, 4);
  assert.equal(enterpriseProcessCommandPayload({ ...draft, permissions: { write: false, simulate: false } }, {
    kind: 'simulate-staffing', processId: process.id, scenario: {}, reason: 'Denied.' }), null);
  assert.equal(enterpriseProcessCommandPayload({ ...draft, permissions: { write: false, simulate: false } }, {
    kind: 'simulate-process', processId: process.id, scenario: {}, reason: 'Denied.' }), null);
  assert.equal(enterpriseTypedValue('number', '12.5'), 12.5);
  assert.equal(enterpriseTypedValue('boolean', 'false'), false);
  assert.deepEqual(enterpriseTypedValue('number', '1\n2', true), [1, 2]);
  assert.throws(() => enterpriseTypedValue('number', 'NaN'), /finite number/);
});

test('enterprise staffing UI submits source-bound assumptions and renders accessible worker comparisons', () => {
  const process = { id: 'process-service', type: 'process', name: 'Serve requests', detail: 'Provide support.' };
  const blueprint = { id: 'blueprint-main', areas: { capabilitiesProcesses: { items: [process] } } };
  const modelValue = { context: { blueprintId: blueprint.id, blueprintVersion: 8, snapshotHash: 'a'.repeat(64), isCurrent: true }, blueprint,
    permissions: { processWrite: true, simulate: true } };
  let submitted = null;
  const root = renderEnterpriseProcess({ model: modelValue, object: process, el, ui: branchUi, onCommand: (value) => { submitted = value; } });
  assert.match(root.textContent, /unvalidated assumptions/);
  assert.match(root.textContent, /never hires staff, reserves capacity, or starts work/);
  const form = root.querySelectorAll('form').find((entry) => entry.attrs['data-enterprise-action'] === 'simulate-staffing');
  assert.ok(form);
  form.listeners.get('submit')?.({ preventDefault() {} });
  assert.deepEqual(submitted, { kind: 'simulate-staffing', processId: process.id, scenario: { schemaVersion: '1.0',
    arrivals: { value: 12, unit: 'requests' }, interval: { value: 1, unit: 'hours' },
    capacityPerWorker: { value: 8, unit: 'requests' }, workerCounts: [1, 2] }, reason: '' });
  const result = { id: 'process-simulation-00000000-0000-4000-8000-000000000032', status: 'SIMULATED', simulationType: 'STAFFING_CAPACITY',
    assumptionStatus: 'UNVALIDATED', createdAt: '2026-10-05T12:00:00.000Z', createdBy: 'oidc:operator',
    source: { blueprintId: blueprint.id, blueprintVersion: 8, processId: process.id, snapshotHash: 'a'.repeat(64) },
    engineVersion: 'orgward-staffing-capacity-v1', scenarioHash: 'b'.repeat(64), resultHash: 'c'.repeat(64), meaning: 'SIMULATION_ONLY',
    scenario: { schemaVersion: '1.0', arrivals: { value: 12, unit: 'requests' }, interval: { value: 1, unit: 'days' },
      capacityPerWorker: { value: 8, unit: 'requests' }, workerCounts: [1, 2] }, comparisons: [
      { workers: 1, capacity: 8, throughput: 8, queue: 4, workUnit: 'requests' },
      { workers: 2, capacity: 16, throughput: 12, queue: 0, workUnit: 'requests' }] };
  const compared = renderEnterpriseSimulation({ simulation: result, model: modelValue, el });
  const table = compared.querySelectorAll('table').find((entry) => Object.hasOwn(entry.attrs, 'data-staffing-simulation-comparison'));
  assert.ok(table);
  assert.equal(table.querySelectorAll('th').length, 6);
  assert.deepEqual(Array.from(table.querySelectorAll('tr')).slice(1).map((row) => row.textContent), [
    '1 8 requests 8 requests 4 requests', '2 16 requests 12 requests 0 requests']);
  assert.match(compared.textContent, /SIMULATED/);
  assert.match(compared.textContent, /UNVALIDATED/);
  assert.match(compared.textContent, /does not establish actual staffing or verified operating performance/);
  assert.match(compared.textContent, /No hiring, reservation, assignment, spending, or work occurs/);
});

test('sandbox procurement UI makes owner approval and local-only evidence explicit', () => {
  const process = { id: 'process-deliver', type: 'process', name: 'Deliver the core offering', detail: 'Complete the service.', processFlow: {
    schemaVersion: '1.0', startStepId: 'effect-test', steps: [
      { id: 'effect-test', kind: 'sandbox-procurement', title: 'Test procurement', resourceId: 'resource-capacity', windowId: 'window-delivery', allocationId: 'allocation-delivery', nextStepId: 'end-test' },
      { id: 'end-test', kind: 'end', title: 'End' },
    ],
  } };
  const resource = { id: 'resource-capacity', type: 'resource', name: 'Delivery capacity', resourcePlan: { schemaVersion: '1.0', provider: 'reported', windows: [
    { id: 'window-delivery', window: { start: '2026-10-01T00:00:00.000Z', end: '2026-10-02T00:00:00.000Z', timezone: 'UTC' },
      capacity: { value: 40, unit: 'hours', source: 'owner report' }, available: { value: 40, unit: 'hours', source: 'owner report' },
      allocations: [{ id: 'allocation-delivery', processId: process.id, state: 'COMMITTED_REPORTED', quantity: { value: 12, unit: 'hours', source: 'owner report' } }] },
  ] } };
  const blueprint = { id: model().context.blueprintId, version: model().context.blueprintVersion,
    areas: { capabilitiesProcesses: { items: [process] }, resources: { items: [resource] } } };
  const context = { ...model().context, snapshotHash: 'a'.repeat(64) };
  const modelValue = model({ context, blueprint, permissions: { processWrite: true, simulate: true, sandboxExecute: true } });
  let submitted = null;
  const root = renderEnterpriseProcess({ model: modelValue, object: process, el, ui: branchUi, onCommand: (value) => { submitted = value; } });
  assert.match(root.textContent, /explicit project-owner approval/);
  assert.match(root.textContent, /no external provider is contacted/);
  const approve = root.querySelectorAll('button').find((button) => /Approve local sandbox effect/.test(button.textContent));
  assert.ok(approve); assert.equal(approve.disabled, false); approve.listeners.get('click')?.();
  assert.deepEqual(submitted, { kind: 'run-sandbox-procurement-test', processId: process.id, stepId: 'effect-test',
    reason: 'Approve one local sandbox test effect using committed allocation allocation-delivery.' });
  assert.ok(enterpriseProcessCommandPayload(modelValue, submitted));
  assert.equal(enterpriseProcessCommandPayload({ ...modelValue, permissions: { ...modelValue.permissions, sandboxExecute: false } }, submitted), null);
  const record = { operationId: 'sandbox-transaction-00000000-0000-4000-8000-000000000001', status: 'RECORDED_IN_SANDBOX',
    label: 'Sandbox test effect · Test procurement', source: { processId: process.id, blueprintId: blueprint.id,
      blueprintVersion: blueprint.version, blueprintHash: context.snapshotHash, stepId: 'effect-test' }, providerKey: `orgward-local-sandbox:${'b'.repeat(64)}`,
    commitment: { quantity: { value: 12, unit: 'hours' } }, approval: { at: '2026-10-05T12:00:00.000Z' }, evidenceHash: 'c'.repeat(64) };
  const history = renderEnterpriseProcess({ model: { ...modelValue, sandboxTransactions: [record] }, object: process, el, ui: branchUi, onCommand() {} });
  assert.match(history.textContent, /RECORDED_IN_SANDBOX · current source/);
  assert.match(history.textContent, /Local sandbox record only\. No external provider was called/);
  const serviceReceipt = { serviceId: 'orgward.sandbox-provider.local/v1', receiptId: 'local-provider-receipt-test',
    providerKey: record.providerKey, requestHash: 'd'.repeat(64), outcome: 'RECORDED_IN_SANDBOX',
    recordedAt: '2026-10-05T12:01:00.000Z', evidenceHash: 'e'.repeat(64) };
  const providerRecord = { ...record, adapterId: 'orgward.loopback-sandbox.procurement-test/v1',
    effect: { externalProviderCalled: false, externalServiceCalled: true,
      adapterResponse: { result: { providerEvidence: serviceReceipt } } } };
  const providerHistory = renderEnterpriseProcess({ model: { ...modelValue, sandboxTransactions: [providerRecord] }, object: process, el, ui: branchUi, onCommand() {} });
  assert.match(providerHistory.textContent, /separate loopback sandbox service recorded this test effect/);
  assert.match(providerHistory.textContent, /local-provider-receipt-test/);
  assert.match(providerHistory.textContent, /No third-party provider or live commercial transaction was used/);

  let dispatchCommand = null;
  const pendingRecord = { ...record, status: 'APPROVED_PENDING', effect: { result: 'NOT_DISPATCHED', externalProviderCalled: false } };
  const pendingView = renderEnterpriseProcess({ model: { ...modelValue, sandboxTransactions: [pendingRecord] }, object: process, el, ui: branchUi,
    onCommand: (value) => { dispatchCommand = value; } });
  assert.match(pendingView.textContent, /Approval is saved; dispatch has not been confirmed/);
  const dispatch = pendingView.querySelectorAll('button').find((button) => /Dispatch approved local test effect/.test(button.textContent));
  assert.ok(dispatch); dispatch.listeners.get('click')?.();
  assert.deepEqual(dispatchCommand, { kind: 'dispatch-sandbox-procurement-test', operationId: record.operationId,
    reason: 'Dispatch the already approved local sandbox request once by its stable provider key.' });

  let recoveryCommand = null;
  const unknown = { ...record, status: 'UNKNOWN_EFFECT', effect: { result: 'UNKNOWN_EFFECT', externalProviderCalled: false, reconciliationRequired: true } };
  const recovery = renderEnterpriseProcess({ model: { ...modelValue, sandboxTransactions: [unknown] }, object: process, el, ui: branchUi,
    onCommand: (value) => { recoveryCommand = value; } });
  assert.match(recovery.textContent, /outcome is unknown[.] Reconcile this provider key before any retry or compensation/);
  const reconcile = recovery.querySelectorAll('button').find((button) => /Reconcile by provider key/.test(button.textContent));
  assert.ok(reconcile); reconcile.listeners.get('click')?.();
  assert.deepEqual(recoveryCommand, { kind: 'reconcile-sandbox-procurement-test', operationId: record.operationId,
    reason: 'Reconcile the unknown local sandbox outcome by its stable provider key before any retry.' });
  assert.ok(enterpriseProcessCommandPayload(modelValue, recoveryCommand));
  assert.equal(enterpriseProcessCommandPayload({ ...modelValue, permissions: { ...modelValue.permissions, sandboxExecute: false } }, recoveryCommand), null);
});

test('sandbox transaction history shows partial two-step outcomes and separate compensation approval', () => {
  const originalId = 'sandbox-transaction-00000000-0000-4000-8000-000000000001';
  const original = { operationId: originalId, kind: 'PROCUREMENT_TEST_EFFECT', status: 'RECORDED_IN_SANDBOX', compensable: true,
    group: { id: 'sandbox-group-a'.padEnd(34, 'a'), sequence: 1, total: 2, stepIds: ['effect-test', 'effect-two'] },
    label: 'Sandbox test effect · Test procurement', source: { processId: 'process-deliver', blueprintId: model().context.blueprintId,
      blueprintVersion: model().context.blueprintVersion, blueprintHash: 'a'.repeat(64), stepId: 'effect-test' },
    providerKey: `orgward-local-sandbox:${'b'.repeat(64)}`, commitment: { quantity: { value: 12, unit: 'hours' } },
    approval: { at: '2026-10-05T12:00:00.000Z' }, evidenceHash: 'c'.repeat(64) };
  const failed = { ...original, operationId: 'sandbox-transaction-00000000-0000-4000-8000-000000000002',
    kind: 'PROCUREMENT_TEST_EFFECT', status: 'FAILED_IN_SANDBOX', compensable: false,
    label: 'Sandbox test effect · Second step', group: { ...original.group, sequence: 2, stepIds: ['effect-test', 'effect-two'] },
    source: { ...original.source, stepId: 'effect-two' } };
  let command = null;
  const process = { id: 'process-deliver', type: 'process', name: 'Deliver the core offering', processFlow: { schemaVersion: '1.0', startStepId: 'effect-test', steps: [
    { id: 'effect-test', kind: 'sandbox-procurement', title: 'Test procurement', resourceId: 'resource-capacity', windowId: 'window-delivery', allocationId: 'allocation-delivery', nextStepId: 'effect-two', compensable: true },
    { id: 'effect-two', kind: 'sandbox-procurement', title: 'Second step', resourceId: 'resource-capacity', windowId: 'window-delivery', allocationId: 'allocation-delivery', nextStepId: 'end-test' },
    { id: 'end-test', kind: 'end', title: 'End' },
  ] } };
  const modelValue = model({ permissions: { processWrite: true, simulate: true, sandboxExecute: true },
    sandboxTransactions: [original, failed] });
  const root = renderEnterpriseProcess({ model: modelValue, object: process, el, ui: branchUi, onCommand: (value) => { command = value; } });
  assert.match(root.textContent, /partial group failure/);
  assert.match(root.textContent, /two-step group .* step 2 of 2/);
  const approveCompensation = root.querySelectorAll('button').find((button) => button.textContent === 'Approve separate local compensation');
  assert.ok(approveCompensation);
  approveCompensation.listeners.get('click')?.();
  assert.equal(command.kind, 'compensate-sandbox-procurement-test');
  assert.equal(command.operationId, originalId);
  assert.match(command.reason, /separate local compensation/);
});

test('enterprise process UI shows a saved simulation as exact hypothetical evidence', () => {
  const process = { ...object, id: 'process-transfer', type: 'process', name: 'Transfer funds', owner: 'role-operator', processFlow: {
    schemaVersion: '1.0', startStepId: 'step-intake', steps: [
      { id: 'step-intake', kind: 'manual', title: 'Review transfer', processId: 'process-transfer', roleId: 'role-operator',
        inputIds: ['information-transfer-amount'], outputIds: [], nextStepId: 'step-end', exceptionStepId: null },
      { id: 'step-end', kind: 'end', title: 'Done' },
    ],
  } };
  const information = { id: 'information-transfer-amount', type: 'information', name: 'Transfer amount' };
  const role = { id: 'role-operator', type: 'role', name: 'Operations' };
  const blueprint = { id: 'blueprint-main', areas: { capabilitiesProcesses: { items: [process, information, role] } } };
  const modelValue = { context: { blueprintId: blueprint.id, blueprintVersion: 8, snapshotHash: 'a'.repeat(64), isCurrent: true }, blueprint,
    permissions: { write: true, processWrite: true, simulate: true }, simulations: [] };
  const result = { id: 'process-simulation-00000000-0000-4000-8000-000000000031', status: 'COMPLETED',
    createdAt: '2026-10-03T12:00:00.000Z', createdBy: 'oidc:operator', source: { blueprintId: blueprint.id, blueprintVersion: 8,
      processId: process.id, snapshotHash: 'a'.repeat(64) }, engineVersion: 'orgward-declared-flow-v1', scenarioHash: 'b'.repeat(64),
    resultHash: 'c'.repeat(64), meaning: 'SIMULATION_ONLY', scenario: { inputs: [{ informationId: information.id, value: 125 }] },
    trace: [{ sequence: 1, stepId: 'step-intake', iteration: 0, kind: 'manual', status: 'SUCCEEDED', detail: 'Scenario assumption only.' },
      { sequence: 2, stepId: 'step-end', iteration: 0, kind: 'end', status: 'ENDED', detail: 'Design path ended.' }], unresolved: [] };
  let selectedSimulation = null;
  const root = renderEnterpriseProcess({ model: { ...modelValue, simulation: result, simulations: [{ id: result.id, status: result.status, meaning: result.meaning,
    createdAt: result.createdAt, source: result.source, resultHash: result.resultHash }] }, object: process, simulation: result,
    selectedSimulationId: result.id, el, ui: branchUi, onCommand: () => {}, onSimulationSelection: (id) => { selectedSimulation = id; } });
  assert.equal(root.attrs['aria-label'], 'Typed process authoring and simulation');
  assert.match(root.textContent, /Simulation never starts work, approves a decision or applies a design/);
  assert.match(root.textContent, /Input Transfer amount: 125/);
  assert.match(root.textContent, /Review transfer · iteration 0 · SUCCEEDED/);
  assert.match(root.textContent, /Blueprint blueprint-main · version 8/);
  assert.equal(Array.from(root.querySelectorAll('section')).filter((node) => node.attrs['data-enterprise-simulation-result'] === result.id).length, 1);
  assert.equal(root.querySelectorAll('ol').find((node) => Object.hasOwn(node.attrs, 'data-enterprise-simulation-trace')).querySelectorAll('li').length, 2);
  assert.ok(root.querySelectorAll('form').some((form) => form.attrs['data-enterprise-action'] === 'define-process-flow'));
  assert.ok(root.querySelectorAll('form').some((form) => form.attrs['data-enterprise-action'] === 'simulate-process'));
  const savedFlowTarget = root.querySelectorAll('select').find((control) => control.attrs.name === 'nextStepId');
  assert.equal(savedFlowTarget.value, 'step-end', 'the DOM selection retains a saved forward target after every step is loaded');
  assert.ok(savedFlowTarget.children.some((option) => option.attrs.value === 'step-end'));
  const simulationPicker = root.querySelectorAll('select').find((control) => control.attrs.name === 'simulationId');
  assert.ok(simulationPicker);
  simulationPicker.value = result.id;
  simulationPicker.listeners.get('change')?.();
  assert.equal(selectedSimulation, result.id, 'choosing saved history requests the exact detail record');
});

test('manual-flow UI binds activation, decisions and task occurrences to the exact plan instance', () => {
  const taskId = 'task-flow-0123456789abcdef01234567';
  const decisionTable = { schemaVersion: '1.0', hitPolicy: 'UNIQUE', inputs: [{ informationId: 'information-score', valueType: 'number' }],
    rules: [{ id: 'rule-high', conditions: [{ informationId: 'information-score', operator: 'gte', value: 5 }], outcome: 'HIGH' }], defaultOutcome: 'LOW' };
  const task = { id: taskId, title: 'Review transaction risk', inputs: [{ objectId: 'information-score', label: 'Customer risk score' }],
    flowRef: { stepId: 'risk-gate', iteration: 2, kind: 'decision', decisionId: 'decision-risk',
    decisionTable, outcomes: ['HIGH', 'LOW'], decisionInputs: [{ informationId: 'information-score', valueType: 'number' }] } };
  const taskActivation = { taskId, state: 'READY', reason: 'Reached by verified saved outcomes.', identity: 'a'.repeat(64), trace: [] };
  const planActivation = { planInstanceId: null, state: 'WAITING', identity: 'b'.repeat(64), trace: [], tasks: [taskActivation], steps: [] };
  const plan = { id: 'process-plan-1', kind: 'manual_process_flow_plan', revision: 3,
    source: { projectId: 'project-one', blueprintId: 'blueprint-pinned', blueprintVersion: 4 },
    tasks: [task], activation: planActivation };
  const instanceId = 'process-task-instance-00000000-0000-4000-8000-000000000001';
  const instanceActivation = { ...planActivation, planInstanceId: instanceId, identity: 'c'.repeat(64), tasks: [{ ...taskActivation, state: 'WAITING' }] };
  const rows = [{ projectId: 'project-one', processPlanId: plan.id, revision: plan.revision, planInstanceId: instanceId, activation: instanceActivation }];
  const changedTable = { ...decisionTable, defaultOutcome: 'REVIEW' };
  const project = { blueprintVersions: [{ id: 'blueprint-pinned', version: 4,
    areas: { governanceRiskControls: { items: [{ id: 'decision-risk', decisionTable: changedTable }] } } },
  { id: 'blueprint-latest', version: 5, areas: { governanceRiskControls: { items: [{ id: 'decision-risk', decisionTable: changedTable }] } } }] };

  const merged = mergeProcessPlanActivation([plan], [{ id: plan.id, revision: 3, activation: planActivation }]);
  assert.equal(merged[0].activation.identity, planActivation.identity);
  assert.equal(manualFlowActivation(merged[0], rows, null).planInstanceId, null);
  assert.equal(manualFlowActivation(merged[0], rows, instanceId).identity, instanceActivation.identity);
  assert.equal(manualFlowActivation(merged[0], [{ planInstanceId: 'process-task-instance-other', activation: instanceActivation }], instanceId), null);
  assert.equal(manualFlowActivation(merged[0], [{ ...rows[0], projectId: 'project-other' }], instanceId), null);
  assert.equal(activationForTask(merged[0], rows, taskId, instanceId).state, 'WAITING');
  assert.equal(activationForTask(merged[0], rows, 'task-flow-stale', instanceId), null);
  assert.equal(manualFlowDecisionDefinition(plan, project, task), decisionTable, 'runtime task carries the immutable compiled table instead of a later blueprint definition');
  assert.deepEqual(evaluateManualFlowAdvice(decisionTable, []), { status: 'UNKNOWN', outcome: null });
  assert.deepEqual(evaluateManualFlowAdvice(decisionTable, [{ informationId: 'information-score', value: 8 }]), { status: 'RESOLVED', outcome: 'HIGH' });
  const overlap = { ...decisionTable, rules: [...decisionTable.rules,
    { id: 'rule-overlap', conditions: [{ informationId: 'information-score', operator: 'gte', value: 7 }], outcome: 'LOW' }] };
  assert.deepEqual(evaluateManualFlowAdvice(overlap, [{ informationId: 'information-score', value: 8 }]), { status: 'CONFLICTED', outcome: null });
  const staleRevisionMerge = mergeProcessPlanActivation([plan], [{ id: plan.id, revision: 2, activation: planActivation }]);
  assert.equal(staleRevisionMerge[0], plan, 'a runtime projection from another saved plan revision cannot replace the current plan');
  assert.equal(staleRevisionMerge[1].revision, 2, 'unmatched historical runtime is retained as a separately identified revision');

  task.flowRef.decisionTable = overlap;
  const choice = renderManualFlowDecisionChoice({ project, plan, task, el });
  const scoreControl = choice.node.querySelectorAll('input').find((control) => control.attrs.name === 'information-score');
  const knownControl = choice.node.querySelectorAll('select').find((control) => control.attrs.name === 'known:information-score');
  const outcomeControl = choice.node.querySelectorAll('select').find((control) => control.attrs.name === 'decisionOutcome');
  const reasonControl = choice.node.querySelectorAll('textarea').find((control) => control.attrs.name === 'decisionReason');
  assert.match(choice.node.textContent, /Human decision — Review transaction risk/);
  assert.match(choice.node.textContent, /Observed Customer risk score/);
  assert.match(choice.node.textContent, /Customer risk score: information-score/);
  scoreControl.value = '8'; scoreControl.listeners.get('input')?.();
  assert.ok(choice.node.textContent.includes('Choose the human outcome explicitly'));
  outcomeControl.value = 'LOW'; reasonControl.value = 'Operator records a cautious route.';
  assert.match(choice.node.querySelectorAll('p').find((node) => node.className === 'manual-flow-table-advice').textContent, /CONFLICTED/);
  const savedChoice = choice.read();
  assert.deepEqual(savedChoice, { outcome: 'LOW', observations: [{ informationId: 'information-score', value: 8 }], reason: 'Operator records a cautious route.' });
  const restored = renderManualFlowDecisionChoice({ project, plan, task, el });
  restored.restore(savedChoice);
  assert.deepEqual(restored.read(), savedChoice, 'the exact saved human choice is restored for retry');
  const unknownChoice = { outcome: 'HIGH', observations: [{ informationId: 'information-score', value: null }], reason: 'Input is not known.' };
  restored.restore(unknownChoice);
  assert.equal(restored.node.querySelectorAll('select').find((control) => control.attrs.name === 'known:information-score').value, 'unknown');
  assert.equal(restored.node.querySelectorAll('input').find((control) => control.attrs.name === 'information-score').disabled, true);
  assert.deepEqual(restored.read(), unknownChoice);

  const enforcedTask = { ...task, flowRef: { ...task.flowRef, decisionTable: { ...decisionTable, decisionMode: 'ENFORCED' } } };
  const enforcedChoice = renderManualFlowDecisionChoice({ project, plan, task: enforcedTask, el });
  assert.match(enforcedChoice.node.textContent, /pinned enforced decision table/);
  const enforcedScore = enforcedChoice.node.querySelectorAll('input').find((control) => control.attrs.name === 'information-score');
  const enforcedOutcome = enforcedChoice.node.querySelectorAll('select').find((control) => control.attrs.name === 'decisionOutcome');
  const enforcedReason = enforcedChoice.node.querySelectorAll('textarea').find((control) => control.attrs.name === 'decisionReason');
  enforcedScore.value = '8'; enforcedOutcome.value = 'LOW'; enforcedReason.value = 'An inconsistent route.';
  assert.throws(() => enforcedChoice.read(), /must match a resolved outcome/);
  enforcedOutcome.value = 'HIGH';
  assert.equal(enforcedChoice.read().outcome, 'HIGH');
});

test('manual-flow agent requests are limited to the exact supported READY occurrence', () => {
  const instanceId = '9f2ac136-bfe2-496f-8502-1eaee607d75e';
  const agentTask = { id: 'task-agent-review', flowRef: { stepId: 'review', iteration: 1, kind: 'manual' } };
  const plan = { id: 'process-plan-manual-agent', kind: 'manual_process_flow_plan', revision: 2,
    source: { projectId: 'project-manual-agent', blueprintId: 'blueprint-1', blueprintVersion: 4 }, tasks: [agentTask],
    activation: { planInstanceId: null, tasks: [{ taskId: agentTask.id, state: 'READY' }] } };
  const runtimeTask = { ...agentTask, activation: undefined };
  const instanceActivation = { planInstanceId: instanceId, tasks: [{ taskId: agentTask.id, state: 'READY' }] };
  const rows = [{ projectId: plan.source.projectId, processPlanId: plan.id, revision: plan.revision,
    planInstanceId: instanceId, taskId: agentTask.id, activation: instanceActivation }];
  assert.equal(manualFlowAllowsAgent(agentTask), true);
  assert.equal(manualFlowAllowsAgent({ ...agentTask, flowRef: { ...agentTask.flowRef, kind: 'manual-exception' } }), true);
  for (const kind of ['decision', 'loop', 'fork', 'join', 'end', 'legacy-dag']) {
    assert.equal(manualFlowAllowsAgent({ ...agentTask, flowRef: { ...agentTask.flowRef, kind } }), false, `${kind} cannot be assigned to an agent`);
  }
  assert.equal(manualFlowAgentRequestReady(plan, [], agentTask, null), true);
  assert.equal(manualFlowAgentRequestReady(plan, rows, agentTask, instanceId), true);
  assert.equal(manualFlowAgentRequestReady({ ...plan, kind: 'process_plan' }, rows, agentTask, instanceId), false);
  assert.equal(manualFlowAgentRequestReady(plan, rows, { ...agentTask, id: 'task-copied-elsewhere' }, instanceId), false);
  for (const patch of [
    { stepId: 'other-step' }, { iteration: 2 }, { kind: 'decision' },
  ]) assert.equal(manualFlowAgentRequestReady(plan, rows, { ...agentTask, flowRef: { ...agentTask.flowRef, ...patch } }, instanceId), false,
    `the pinned occurrence rejects ${JSON.stringify(patch)}`);
  assert.equal(manualFlowAgentRequestReady(plan, [{ ...rows[0], projectId: 'project-other' }], agentTask, instanceId), false);
  assert.equal(manualFlowAgentRequestReady(plan, [{ ...rows[0], processPlanId: 'process-plan-other' }], agentTask, instanceId), false);
  assert.equal(manualFlowAgentRequestReady(plan, [{ ...rows[0], revision: 1 }], agentTask, instanceId), false);
  assert.equal(manualFlowAgentRequestReady(plan, [{ ...rows[0], planInstanceId: '9f2ac136-bfe2-496f-8502-1eaee607d75f' }], agentTask, instanceId), false);
  for (const state of ['WAITING', 'SKIPPED', 'BLOCKED', 'SUCCEEDED', 'FAILED']) {
    const notReady = [{ ...rows[0], activation: { ...instanceActivation, tasks: [{ taskId: agentTask.id, state }] } }];
    assert.equal(manualFlowAgentRequestReady(plan, notReady, agentTask, instanceId), false, `${state} does not authorize a new agent request`);
  }
  assert.equal(runtimeTask.flowRef.kind, 'manual');
});

test('an unavailable requested enterprise context stays explicit and offers an intentional reset', () => {
  const requested = { lensId: 'L-99', scopeId: 'missing-scope', blueprintVersion: 42 };
  const root = renderEnterpriseContext({ model: null, query: requested, error: 'Requested context is unavailable', el,
    onContext: () => {}, onCommand: () => {}, onRetry: () => {} });
  assert.match(root.textContent, /Requested enterprise context unavailable/i);
  assert.match(root.textContent, /has not been replaced with another context/i);
  assert.equal(root.querySelectorAll('select').length, 0);
  assert.ok(root.querySelectorAll('button').some((button) => button.textContent === 'Open current design with all objects'));
});

test('default perspective failure preserves the existing map while explicit route context stays unavailable', async () => {
  assert.equal(hasEnterpriseContext({}), false);
  assert.equal(hasEnterpriseContext({ lensId: 'all' }), true, 'an explicit all-lens route is still an explicit request');
  assert.deepEqual(enterpriseContextFailure(false, 'API unavailable'), { error: null, unavailable: 'API unavailable' });
  assert.deepEqual(enterpriseContextFailure(true, 'scope was deleted'), { error: 'scope was deleted', unavailable: null });
  let reloads = 0;
  const defaultFailure = renderEnterpriseContext({ model: model(), query: { lensId: 'all', scopeId: null, blueprintVersion: null },
    unavailable: 'API unavailable', el, onContext: () => {}, onCommand: () => {}, onRetry: () => {}, onReload: () => { reloads += 1; } });
  assert.match(defaultFailure.textContent, /existing saved blueprint and map remain available/);
  assert.equal(defaultFailure.querySelectorAll('form').length, 0);
  await defaultFailure.querySelectorAll('button').find((button) => button.attrs['data-enterprise-reload'] !== undefined)
    .listeners.get('click')?.({ preventDefault() {} });
  assert.equal(reloads, 1);
  const requestedFailure = renderEnterpriseContext({ model: null, query: { lensId: 'L-08', scopeId: null, blueprintVersion: null },
    ...enterpriseContextFailure(true, 'API unavailable'), el, onContext: () => {}, onCommand: () => {}, onRetry: () => {} });
  assert.match(requestedFailure.textContent, /requested lens, scope or version has not been replaced/);
});

test('enterprise API source must align with the loaded project while historical snapshots align to its version', () => {
  const project = { version: 8, latestBlueprint: { id: 'blueprint-current', version: 4 } };
  const currentModel = { context: { projectVersion: 8, blueprintId: 'blueprint-current', blueprintVersion: 4, isCurrent: true },
    blueprint: { id: 'blueprint-current' } };
  assert.equal(enterpriseSourceAligned(project, currentModel), true);
  assert.equal(enterpriseSourceAligned({ ...project, version: 9 }, currentModel), false);
  assert.equal(enterpriseSourceAligned(project, { ...currentModel, context: { ...currentModel.context, blueprintVersion: 3 } }), false);
  assert.equal(enterpriseSourceAligned(project, { context: { projectVersion: 8, blueprintId: 'blueprint-history', blueprintVersion: 2, isCurrent: false },
    blueprint: { id: 'blueprint-history' } }), true);
  assert.equal(enterpriseSourceAligned(project, { context: { projectVersion: 7, blueprintId: 'blueprint-history', blueprintVersion: 2, isCurrent: false },
    blueprint: { id: 'blueprint-history' } }), false);
});

test('dated and future enterprise contexts show human-report provenance and disable mutation controls', () => {
  const selected = { ...object };
  const states = { basisHash: 'a'.repeat(64),
    lifecycle: { value: 'ACTIVE', evidenceKind: 'HUMAN_REPORTED', recordedBy: 'oidc:owner', recordedAt: '2026-10-03T10:00:00.000Z',
      reason: 'Owner report.', evidenceSummary: 'Reported active use.', stale: false },
    review: { value: 'UNREVIEWED', evidenceKind: 'UNKNOWN', stale: false },
    implementation: { value: 'UNKNOWN', evidenceKind: 'UNKNOWN', stale: false },
    observation: { value: 'UNKNOWN', evidenceKind: 'UNKNOWN', stale: false } };
  const datedModel = model({ context: { projectVersion: 8, blueprintId: 'blueprint-current', blueprintVersion: 4,
    isCurrent: false, lensId: 'all', scopeId: null, branch: 'main', effectiveAt: '2026-10-04T00:00:00.000Z',
    effectiveStatus: 'IN_RANGE' }, selection: { object: selected, states, visible: true, hiddenBy: [] },
  permissions: { write: true, scopeAdmin: true } });
  const root = renderEnterpriseObject({ model: datedModel, object: selected, el, onCommand: () => {} });
  assert.match(root.textContent, /Human reported/);
  assert.match(root.textContent, /Reported evidence: Reported active use/);
  for (const action of ['record-state', 'propose-future-design', 'assign-object-scope']) {
    const form = root.querySelectorAll('form').find((entry) => entry.attrs['data-enterprise-action'] === action);
    assert.ok(form, `${action} remains visible for explanation`);
    assert.ok(form.querySelectorAll('input,select,textarea,button').every((control) => control.disabled), `${action} is read-only`);
  }
  assert.equal(enterpriseContextReadOnly({ isCurrent: true, recordedAtCutoff: '2026-10-03T10:00:00.000Z' }), true);
});

test('future proposal remains visibly proposed after its effective date and has no context mutation authority', () => {
  const proposalId = 'enterprise-proposal-00000000-0000-4000-8000-000000000001';
  const futureModel = model({
    context: { projectVersion: 9, blueprintId: 'blueprint-future', blueprintVersion: 5, isCurrent: false,
      lensId: 'all', scopeId: null, branch: 'main', proposalId, sourceKind: 'FUTURE_PROPOSAL',
      effectiveAt: '2030-01-02T00:00:00.000Z', effectiveStatus: 'IN_RANGE',
      validity: { effectiveFrom: '2030-01-01T00:00:00.000Z', effectiveTo: null } },
    blueprint: { id: 'blueprint-future', areas: { responsibilityAuthority: { items: [object] } } },
    versions: [{ id: 'blueprint-main', version: 4, createdAt: '2026-10-01T00:00:00.000Z' }],
    proposals: [{ id: proposalId, title: 'Future service design', baseBlueprintVersion: 4, effectiveFrom: '2030-01-01T00:00:00.000Z' }],
    proposal: { id: proposalId, title: 'Future service design', status: 'PROPOSED', baseBlueprintId: 'blueprint-main',
      baseBlueprintVersion: 4, baseSnapshotHash: 'b'.repeat(64), proposalHash: 'c'.repeat(64), baseStale: false,
      diff: { before: { name: object.name }, after: { name: 'Future service' }, changedFields: ['name'] } },
    permissions: { write: false, scopeAdmin: false },
  });
  const root = renderEnterpriseContext({ model: futureModel, query: { lensId: 'all', scopeId: null, blueprintVersion: null,
    proposalId, effectiveAt: futureModel.context.effectiveAt }, el, onContext: () => {}, onCommand: () => {}, onRetry: () => {} });
  assert.match(root.textContent, /proposed future draft · read only/);
  assert.match(root.textContent, /The draft stays proposed after its effective date/);
  assert.match(root.textContent, /within the declared interval/);
  for (const action of ['create-scope', 'set-validity']) {
    const form = root.querySelectorAll('form').find((entry) => entry.attrs['data-enterprise-action'] === action);
    assert.ok(form, `${action} remains visible as a disabled explanation`);
    assert.ok(form.querySelectorAll('input,select,textarea,button').every((control) => control.disabled));
  }
});

test('a filtered selection remains inspectable with a clear lens and scope explanation', () => {
  const selected = { ...object, enterpriseScope: { organizationId: 'org-one', legalEntityId: null, unitId: null } };
  const projected = model({
    context: { projectVersion: 8, blueprintId: 'blueprint-next', blueprintVersion: 4, isCurrent: true, lensId: 'L-01', scopeId: 'org-two', branch: 'main' },
    selection: { object: selected, visible: false, hiddenBy: ['scope', 'lens'] },
  });
  const root = renderEnterpriseObject({ model: projected, object: selected, el, onCommand: () => {} });
  assert.equal(root.attrs['aria-label'], 'Selected object design scope');
  assert.match(root.textContent, /outside this perspective: design scope filter, perspective filter/i);
  assert.match(root.textContent, /Its saved identity and inspector remain selected/);
  assert.ok(root.querySelectorAll('form').some((form) => form.attrs['data-enterprise-action'] === 'assign-object-scope'));
});

test('pending enterprise command exposes exact-result recovery and disables new scope edits', async () => {
  const savedCommand = { commandId: 'same-command', payload: { kind: 'create-scope', name: 'North Division' } };
  const recovery = [];
  const root = renderEnterpriseContext({ model: model(), query: { lensId: 'all', scopeId: null, blueprintVersion: null },
    pending: savedCommand, el, onContext: () => {}, onCommand: () => {}, onRetry: () => recovery.push(savedCommand) });
  const createForm = root.querySelectorAll('form').find((form) => form.attrs['data-enterprise-action'] === 'create-scope');
  assert.ok(createForm);
  assert.ok(createForm.querySelectorAll('input,select,textarea,button').every((control) => control.disabled));
  const retry = root.querySelectorAll('button').find((button) => button.attrs['data-enterprise-retry'] !== undefined);
  assert.ok(retry);
  await retry.listeners.get('click')?.({ preventDefault() {} });
  assert.deepEqual(recovery, [savedCommand]);
});

test('enterprise command recovery persists and resubmits the identical envelope after remount', async () => {
  const values = new Map();
  const saved = { projectId: 'project-one', envelope: { schemaVersion: '1.0', commandId: 'cmd-123', expectedVersion: 8,
    payload: { kind: 'rename-scope', blueprintId: 'blueprint-1', blueprintVersion: 4, objectId: 'org_north_1',
      name: 'Northstar Group', detail: 'Parent scope', reason: 'Persist this exact command.' } } };
  persistEnterpriseCommand(storageFixture(values), 'oidc:owner', 'project-one', saved);
  const restored = restoreEnterpriseCommand(storageFixture(values), 'oidc:owner', 'project-one');
  assert.deepEqual(restored, saved);
  const calls = [];
  const api = async (...args) => { calls.push(args); return { data: { affectedObjectId: 'org_north_1' } }; };
  await submitEnterpriseCommand(api, 'project-one', restored);
  assert.deepEqual(calls, [['/api/v1/projects/project-one/enterprise/commands', {
    method: 'POST', body: JSON.stringify(saved.envelope),
  }]]);
  persistEnterpriseCommand(storageFixture(values), 'oidc:owner', 'project-one', null);
  assert.equal(restoreEnterpriseCommand(storageFixture(values), 'oidc:owner', 'project-one'), null);
  const exceptionSaved = { projectId: 'project-one', envelope: { schemaVersion: '1.0', commandId: 'cmd-integrity-exception', expectedVersion: 9,
    payload: { kind: 'accept-integrity-exception', findingId: `finding-${'a'.repeat(32)}`,
      reportId: 'enterprise-integrity-00000000-0000-4000-8000-000000000001', reportHash: 'b'.repeat(64),
      blueprintId: 'blueprint-00000000-0000-4000-8000-000000000001', blueprintVersion: 3,
      snapshotHash: 'c'.repeat(64), reason: 'Recover the exact human exception.', expiresAt: null } } };
  persistEnterpriseCommand(storageFixture(values), 'oidc:owner', 'project-one', exceptionSaved);
  assert.deepEqual(restoreEnterpriseCommand(storageFixture(values), 'oidc:owner', 'project-one'), exceptionSaved);
});

test('chat blueprint edit recovery restores and retries the exact semantic command after reload', async () => {
  const values = new Map();
  const saved = { projectId: 'project-one', envelope: { schemaVersion: '1.0', commandId: 'chat-blueprint-edit:stable-id', expectedVersion: 42,
    payload: { kind: 'edit-blueprint-object', blueprintId: 'blueprint-one', blueprintVersion: 7, objectId: 'customer-one',
      name: 'Northstar', detail: 'Updated delivery details.', reason: 'Clarify the customer-facing description.' } } };
  persistEnterpriseCommand(storageFixture(values), 'oidc:owner', 'project-one', saved);

  // A remount uses the same principal/project storage key and retries the retained envelope.
  const restored = restoreEnterpriseCommand(storageFixture(values), 'oidc:owner', 'project-one');
  assert.deepEqual(restored, saved);
  const calls = [];
  await submitEnterpriseCommand(async (...args) => { calls.push(args); return { data: { affectedObjectId: 'customer-one' } }; }, 'project-one', restored);

  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0][1].body), saved.envelope);
  assert.equal(JSON.parse(calls[0][1].body).commandId, 'chat-blueprint-edit:stable-id');
  assert.equal(JSON.parse(calls[0][1].body).expectedVersion, 42);
  assert.deepEqual([...calls.map(([, options]) => JSON.parse(options.body).commandId)], [saved.envelope.commandId]);
});

test('chat blueprint editor has a bounded desktop scroll area and grows the completed mobile panel', () => {
  const css = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /#chat-blueprint-edit-slot\s*\{[^}]*min-height:\s*0[^}]*max-height:\s*min\(48vh,\s*480px\)[^}]*overflow-y:\s*auto/);
  assert.match(css, /@media\s*\(max-width:\s*900px\)[\s\S]*?\.studio\.complete \.conversation-panel\s*\{[^}]*max-height:\s*none/);
  assert.match(css, /@media\s*\(max-width:\s*900px\)[\s\S]*?\.studio\.complete #chat-blueprint-edit-slot\s*\{[^}]*max-height:\s*none[^}]*overflow:\s*visible/);
});

test('first-run enterprise context gives blueprint guidance without rendering scope mutation forms', () => {
  const initial = model({
    context: { projectVersion: 1, blueprintId: null, blueprintVersion: null, isCurrent: false, lensId: 'all', scopeId: null, branch: 'main' },
    blueprint: null, graph: { nodes: [], links: [], types: [] }, scopes: [], versions: [],
    permissions: { write: false, scopeAdmin: false }, gaps: [{ code: 'BLUEPRINT_REQUIRED', message: 'Save the initial blueprint to explore and define enterprise scopes.' }],
  });
  const root = renderEnterpriseContext({ model: initial, query: { lensId: 'all', scopeId: null, blueprintVersion: null }, el,
    onContext: () => {}, onCommand: () => {}, onRetry: () => {} });
  assert.match(root.textContent, /Save the initial blueprint to explore and define enterprise scopes/);
  assert.equal(root.querySelectorAll('form').length, 0);
});

test('saved economics UI explains each allocation with its process identity and source', () => {
  const process = { id: 'process-deliver', type: 'process', name: 'Deliver the core offering', detail: 'Complete the service.' };
  const resource = { id: 'resource-capacity', type: 'resource', name: 'Delivery capacity', detail: 'Staffing.' };
  const economics = { id: 'economics-launch', type: 'economics', name: 'Launch economics', detail: 'Declared assumptions.' };
  const evaluation = { id: 'economic-evaluation-00000000-0000-4000-8000-000000000001', economicsId: economics.id,
    createdAt: '2026-10-04T00:00:00.000Z', createdBy: 'oidc:owner', reason: 'Review reported allocation.', status: 'CONSTRAINED',
    source: { blueprintId: model().context.blueprintId, blueprintVersion: 3, snapshotHash: 'a'.repeat(64), branchId: null, branchRevision: null, proposalId: null },
    sourceLabels: { records: { [economics.id]: economics.name, [process.id]: process.name } },
    scenario: { window: { start: '2026-10-01T00:00:00.000Z', end: '2026-10-02T00:00:00.000Z' } }, metrics: {},
    resources: [{ resourceId: resource.id, resourceName: resource.name, status: 'CONSTRAINED',
      window: { start: '2026-10-01T00:00:00.000Z', end: '2026-10-02T00:00:00.000Z' }, metrics: {}, constraints: [], demands: [],
      allocations: [{ id: 'allocation-staffing', processId: process.id, state: 'COMMITTED_REPORTED',
        quantity: { value: 12, unit: 'hours', source: 'Human staffing forecast' } }],
    }], constraints: [], explanations: [] };
  const sourceModel = model({ context: { ...model().context, snapshotHash: 'a'.repeat(64) },
    blueprint: { areas: { responsibilityAuthority: { items: [economics] }, capabilitiesProcesses: { items: [process] }, resources: { items: [resource] } } },
    permissions: { economicWrite: true, economicEvaluate: true }, economics: { evaluation } });
  const panel = renderEnterpriseEconomics({ model: sourceModel, object: economics, el, ui: branchUi, onCommand() {} });
  assert.match(panel.textContent, /allocation-staffing/);
  assert.match(panel.textContent, /Deliver the core offering/);
  assert.match(panel.textContent, /Human staffing forecast/);
});

test('refinement UI names both reverse trace directions and saves selected existing records', () => {
  const parent = { id: 'goal-safe-service', name: 'Safe service', type: 'goal' };
  const selected = { id: 'process-review', name: 'Review exception', type: 'process', refines: [] };
  const child = { id: 'task-check-evidence', name: 'Check evidence', type: 'process' };
  const sourceModel = model({ blueprint: { areas: { purposeStrategy: { items: [parent] }, capabilitiesProcesses: { items: [selected, child] } } },
    context: { ...model().context, blueprintId: 'blueprint-00000000-0000-4000-8000-000000000001' },
    permissions: { processWrite: true }, refinementTrace: { selectedId: selected.id, status: 'LINKED', explanation: 'Saved design links only.',
      ancestors: [{ id: parent.id, name: parent.name, type: parent.type, depth: 1, path: [selected.id, parent.id] }],
      descendants: [{ id: child.id, name: child.name, type: child.type, depth: 1, path: [selected.id, child.id] }] } });
  let submitted = null;
  const panel = renderEnterpriseRefinement({ model: sourceModel, object: selected, el, ui: branchUi, onCommand: (payload) => { submitted = payload; } });
  assert.match(panel.textContent, /Refinement and reverse trace/);
  assert.match(panel.textContent, /Refines \/ higher-level \(1\)/);
  assert.match(panel.textContent, /Refined by \/ lower-level \(1\)/);
  assert.match(panel.textContent, /do not establish implementation, evidence or operational status/);
  const controls = Array.from(panel.querySelectorAll('input')).filter((control) => control.attrs.name === 'refines');
  assert.equal(controls.length, 2);
  for (const control of controls) control.value = control.attrs.value;
  controls.find((control) => control.value === parent.id).checked = true;
  const form = panel.querySelectorAll('form')[0];
  form.listeners.get('submit')({ preventDefault() {} });
  assert.deepEqual(submitted, { kind: 'define-refinement', objectId: selected.id, refines: [parent.id], reason: '' });
});

test('governance UI guides requests, owner decisions, requester appeals and appeal review on exact current source', () => {
  const blueprint = { areas: { governanceRiskControls: { items: [{ id: 'decision-priority', type: 'decision', name: 'Operating priority', detail: 'Choose the next priority.' }] } } };
  const source = { blueprintId: 'blueprint-00000000-0000-4000-8000-000000000001', blueprintVersion: 3, snapshotHash: 'a'.repeat(64) };
  const base = model({ blueprint, context: { ...model().context, ...source, isCurrent: true, sourceKind: 'MAIN_DESIGN' },
    selection: { object: { id: 'decision-priority' } }, permissions: { governanceRequest: true, governanceDecide: false,
      governanceReviewAppeal: false }, governance: { ledgerLength: 0, ledgerHead: null, cases: [] } });
  let submitted = null;
  const requestPanel = renderEnterpriseGovernance({ model: base, el, ui: branchUi, onCommand: (payload) => { submitted = payload; } });
  const requestForm = requestPanel.querySelectorAll('form').find((entry) => entry.attrs['data-enterprise-action'] === 'request-governance-decision');
  assert.ok(requestForm);
  const requestControls = requestForm.querySelectorAll('input,select,textarea');
  requestControls[0].value = 'decision-priority'; requestControls[1].value = 'Exception review authority';
  requestControls[2].value = 'Who may approve exceptions?'; requestControls[3].value = 'Require an owner review.';
  requestControls[4].value = 'Clarify the decision right.';
  requestForm.listeners.get('submit')({ preventDefault() {} });
  assert.deepEqual(submitted, { kind: 'request-governance-decision', ...source, objectId: 'decision-priority',
    title: 'Exception review authority', question: 'Who may approve exceptions?', proposedOption: 'Require an owner review.',
    reason: 'Clarify the decision right.' });

  const caseId = 'governance-decision-00000000-0000-4000-8000-000000000001';
  const request = { id: caseId, title: 'Exception review authority', question: 'Who may approve exceptions?',
    proposedOption: 'Require an owner review.', objectId: 'decision-priority', source, requestedBy: 'oidc:editor',
    status: 'REQUESTED', revision: 1, appliesToContext: true, sourceDrift: false,
    decisions: [], appeals: [], history: [{ sequence: 1, hash: 'b'.repeat(64), action: 'request-governance-decision',
      caseRevision: 1, actor: 'oidc:editor', at: '2026-10-04T10:00:00.000Z', reason: 'Clarify the decision right.' }] };
  const ownerModel = { ...base, permissions: { governanceRequest: true, governanceDecide: true, governanceReviewAppeal: true },
    governance: { ledgerLength: 1, ledgerHead: 'b'.repeat(64), cases: [request] } };
  const ownerPanel = renderEnterpriseGovernance({ model: ownerModel, el, ui: branchUi, onCommand: (payload) => { submitted = payload; } });
  assert.match(ownerPanel.textContent, /append-only decision history entries/);
  assert.match(ownerPanel.textContent, /Exact saved source applies to this context/);
  const decideForm = ownerPanel.querySelectorAll('form').find((entry) => entry.attrs['data-enterprise-action'] === `decide-governance-decision-${caseId}`);
  assert.ok(decideForm);
  const decideControls = decideForm.querySelectorAll('input,select,textarea');
  decideControls[0].value = 'DECLINE'; decideControls[1].value = 'Owner keeps this decision right.';
  decideForm.listeners.get('submit')({ preventDefault() {} });
  assert.deepEqual(submitted, { kind: 'decide-governance-decision', ...source, caseId, caseRevision: 1,
    outcome: 'DECLINE', reason: 'Owner keeps this decision right.' });

  const decided = { ...request, status: 'DECIDED', revision: 2,
    decisions: [{ outcome: 'DECLINE', actor: 'oidc:owner', at: '2026-10-04T11:00:00.000Z', reason: 'Owner keeps this decision right.' }], canAppeal: true };
  const requesterModel = { ...base, permissions: { governanceRequest: true, governanceDecide: false, governanceReviewAppeal: false },
    governance: { ledgerLength: 2, ledgerHead: 'c'.repeat(64), cases: [decided] } };
  const requesterPanel = renderEnterpriseGovernance({ model: requesterModel, el, ui: branchUi, onCommand: (payload) => { submitted = payload; } });
  const appealForm = requesterPanel.querySelectorAll('form').find((entry) => entry.attrs['data-enterprise-action'] === `appeal-governance-decision-${caseId}`);
  assert.ok(appealForm);
  appealForm.querySelectorAll('textarea')[0].value = 'Separate exception review from process ownership.';
  appealForm.listeners.get('submit')({ preventDefault() {} });
  assert.deepEqual(submitted, { kind: 'appeal-governance-decision', ...source, caseId, caseRevision: 2,
    reason: 'Separate exception review from process ownership.' });

  const appealed = { ...decided, status: 'APPEALED', revision: 3,
    appeals: [{ actor: 'oidc:editor', at: '2026-10-04T12:00:00.000Z', reason: 'Separate exception review from process ownership.' }] };
  const reviewPanel = renderEnterpriseGovernance({ model: { ...ownerModel, governance: { ledgerLength: 3, ledgerHead: 'd'.repeat(64), cases: [appealed] } },
    el, ui: branchUi, onCommand: (payload) => { submitted = payload; } });
  const reviewForm = reviewPanel.querySelectorAll('form').find((entry) => entry.attrs['data-enterprise-action'] === `review-governance-appeal-${caseId}`);
  assert.ok(reviewForm);
  const reviewControls = reviewForm.querySelectorAll('input,select,textarea');
  reviewControls[0].value = 'REOPEN'; reviewControls[1].value = 'Ask the process owner to reconsider.';
  reviewForm.listeners.get('submit')({ preventDefault() {} });
  assert.deepEqual(submitted, { kind: 'review-governance-appeal', ...source, caseId, caseRevision: 3,
    outcome: 'REOPEN', reason: 'Ask the process owner to reconsider.' });

  const upheld = { ...appealed, status: 'DECISION_UPHELD', revision: 4,
    appeals: [{ ...appealed.appeals[0], review: { outcome: 'UPHOLD', actor: 'oidc:owner',
      at: '2026-10-04T13:00:00.000Z', reason: 'The owner decision remains appropriate.' } }] };
  const upheldPanel = renderEnterpriseGovernance({ model: { ...ownerModel, governance: { ledgerLength: 4,
    ledgerHead: 'e'.repeat(64), cases: [upheld] } }, el, ui: branchUi, onCommand() {} });
  assert.match(upheldPanel.textContent, /Decision upheld · appeal denied/);
  assert.doesNotMatch(upheldPanel.textContent, /Appeal upheld/);

  const staleModel = { ...requesterModel, governance: { ledgerLength: 1, ledgerHead: 'b'.repeat(64),
    cases: [{ ...request, sourceDrift: true, appliesToContext: false, canAppeal: false }] } };
  assert.equal(enterpriseGovernanceCommandPayload(staleModel, 'decide-governance-decision', { caseId, caseRevision: 1, outcome: 'APPROVE', reason: 'stale' }), null);
  const stalePanel = renderEnterpriseGovernance({ model: staleModel, el, ui: branchUi, onCommand() {} });
  assert.match(stalePanel.textContent, /SOURCE DRIFT/);
  assert.equal(stalePanel.querySelectorAll('form').some((entry) => entry.attrs['data-enterprise-action'] === `appeal-governance-decision-${caseId}`), false);
});

test('information stewardship UI assigns saved roles and records human review against assignment revision', () => {
  const selected = { id: 'information-customer-signal', type: 'information', name: 'Customer signal' };
  const source = { blueprintId: 'blueprint-00000000-0000-4000-8000-000000000001', blueprintVersion: 3, snapshotHash: 'a'.repeat(64) };
  const blueprint = { areas: { peopleAgents: { items: [{ id: 'role-data-steward', type: 'role', name: 'Data steward' }] } } };
  const model = { selection: { object: selected }, context: { ...source, isCurrent: true, sourceKind: 'MAIN_DESIGN' }, blueprint,
    permissions: { stewardAssign: true, stewardReview: true }, stewardship: { ledgerLength: 0, ledgerHead: null, roleNames: { 'role-data-steward': 'Data steward' }, assignments: [] } };
  let submitted = null;
  const assignmentPanel = renderEnterpriseStewardship({ model, el, ui: branchUi, onCommand: (payload) => { submitted = payload; } });
  const assignmentForm = assignmentPanel.querySelectorAll('form')[0];
  const assignmentRole = assignmentForm.querySelectorAll('select')[0];
  const assignmentReason = assignmentForm.querySelectorAll('textarea')[0];
  assignmentRole.value = 'role-data-steward'; assignmentReason.value = 'Stewards customer signal definition.';
  assignmentForm.listeners.get('submit')({ preventDefault() {} });
  assert.deepEqual(submitted, { kind: 'assign-information-steward', ...source, objectId: selected.id,
    roleId: 'role-data-steward', reason: 'Stewards customer signal definition.' });

  const assignment = { objectId: selected.id, roleId: 'role-data-steward', assignmentRevision: 1,
    source, appliesToContext: true, sourceDrift: false, assignedBy: 'oidc:owner', assignedAt: '2026-10-04T10:00:00.000Z',
    history: [{ sequence: 1, action: 'assign-information-steward', actor: 'oidc:owner', at: '2026-10-04T10:00:00.000Z',
      assignmentRevision: 1, roleId: 'role-data-steward', reason: 'Stewards customer signal definition.', source }], latestReview: null };
  const reviewModel = { ...model, stewardship: { ledgerLength: 1, ledgerHead: 'b'.repeat(64), roleNames: { 'role-data-steward': 'Data steward' }, assignments: [assignment] } };
  const reviewPanel = renderEnterpriseStewardship({ model: reviewModel, el, ui: branchUi, onCommand: (payload) => { submitted = payload; } });
  assert.match(reviewPanel.textContent, /Current steward role: Data steward/);
  const reviewForm = reviewPanel.querySelectorAll('form').find((entry) => entry.attrs['data-enterprise-action'] === 'record-information-stewardship-review');
  const outcome = reviewForm.querySelectorAll('select')[0]; const reason = reviewForm.querySelectorAll('textarea')[0];
  outcome.value = 'CONFIRMED'; reason.value = 'Definition reviewed against current usage.';
  reviewForm.listeners.get('submit')({ preventDefault() {} });
  assert.deepEqual(submitted, { kind: 'record-information-stewardship-review', ...source, objectId: selected.id,
    assignmentRevision: 1, outcome: 'CONFIRMED', reason: 'Definition reviewed against current usage.' });
  assert.equal(enterpriseStewardshipPayload({ ...reviewModel, permissions: { stewardReview: false } },
    'record-information-stewardship-review', { objectId: selected.id, assignmentRevision: 1, outcome: 'CONFIRMED', reason: 'Denied.' }), null);
  const staleAssignment = { ...assignment, source: { ...source, blueprintVersion: 2, snapshotHash: 'b'.repeat(64) },
    appliesToContext: false, sourceDrift: true };
  const stalePanel = renderEnterpriseStewardship({ model: { ...reviewModel, stewardship: { ...reviewModel.stewardship, assignments: [staleAssignment] } },
    el, ui: branchUi, onCommand() {} });
  assert.match(stalePanel.textContent, /does not carry to the selected source/);
  assert.equal(stalePanel.querySelectorAll('form').some((entry) => entry.attrs['data-enterprise-action'] === 'record-information-stewardship-review'), false);
});

test('integrity UI keeps findings unresolved and binds exception review to current exact report source', () => {
  const assessment = { id: 'enterprise-integrity-00000000-0000-4000-8000-000000000001', status: 'REVIEW',
    reportHash: 'c'.repeat(64), source: { projectId: 'project-current', blueprintId: 'blueprint-00000000-0000-4000-8000-000000000001',
      blueprintVersion: 3, snapshotHash: 'a'.repeat(64) }, appliesToContext: true,
    createdAt: '2026-10-04T10:00:00.000Z', createdBy: 'owner', reason: 'Check proposed design.',
    counts: { failedRules: 0, reviewRules: 1, findings: 1 },
    rules: [{ id: 'design.completeness', status: 'REVIEW', findingCount: 1, summary: 'Completeness gaps remain.' }],
    exceptions: [], findings: [{ id: 'finding-one', severity: 'high', code: 'gap-owner', objectId: 'process-deliver', message: 'Assign an owner.', action: 'Choose an owner.' }] };
  const staleException = { id: 'integrity-exception-00000000-0000-4000-8000-000000000001', findingId: 'finding-one',
    reportId: 'enterprise-integrity-00000000-0000-4000-8000-000000000002', reportHash: 'd'.repeat(64),
    blueprintId: 'blueprint-00000000-0000-4000-8000-000000000000', blueprintVersion: 2,
    snapshotHash: 'e'.repeat(64), actor: 'owner', acceptedAt: '2026-10-03T10:00:00.000Z', expiresAt: null,
    reason: 'Prior source exception.', status: 'STALE', findingRemainsUnresolved: true };
  const remediationItem = { reportId: assessment.id, reportHash: assessment.reportHash, source: assessment.source,
    reportCreatedAt: assessment.createdAt, reportStatus: assessment.status, reportDrift: false, appliesToContext: true,
    finding: assessment.findings[0], status: 'UNRESOLVED', exception: null };
  const historicalAssessment = { ...assessment, id: 'enterprise-integrity-00000000-0000-4000-8000-000000000002',
    createdAt: '2026-10-04T09:00:00.000Z' };
  const historicalItem = { ...remediationItem, reportId: historicalAssessment.id, reportHash: 'd'.repeat(64),
    reportCreatedAt: historicalAssessment.createdAt, notReturnedInLatest: true, latestSameSourceReportId: assessment.id };
  const remediationInbox = { currentSource: { blueprintId: assessment.source.blueprintId, blueprintVersion: 3, snapshotHash: 'a'.repeat(64) },
    reportWindowCount: 2, totalSavedReports: 2, totalFindings: 2, unresolvedFindings: 2, visibleItems: 2, omittedItems: 0, driftedReports: 0,
    bySeverity: { high: 1, medium: 0, low: 0 }, byRule: [{ ruleId: 'design.completeness', reports: 1, findings: 1 }],
    exceptionCoverage: { ACTIVE: 0, EXPIRED: 0, STALE: 0, NONE: 2 }, items: [historicalItem, remediationItem] };
  const sourceModel = model({ context: { ...model().context, snapshotHash: 'a'.repeat(64), sourceKind: 'MAIN_DESIGN' },
    permissions: { integrityRun: true, integrityException: true }, integrity: { current: assessment, latest: assessment, assessments: [historicalAssessment, assessment], exceptions: [staleException], remediationInbox } });
  const exactPayload = enterpriseIntegrityCommandPayload(sourceModel, ' Recheck ');
  assert.deepEqual(exactPayload, { kind: 'run-integrity-checks', blueprintId: sourceModel.context.blueprintId,
    blueprintVersion: 3, snapshotHash: 'a'.repeat(64), reason: 'Recheck' });
  assert.equal(enterpriseIntegrityCommandPayload({ ...sourceModel, context: { ...sourceModel.context, isCurrent: false } }, 'Recheck'), null);
  const exceptionPayload = enterpriseIntegrityExceptionPayload(sourceModel, assessment, assessment.findings[0], ' Temporary exception ', '2026-10-05T12:00');
  assert.deepEqual(exceptionPayload, { kind: 'accept-integrity-exception', findingId: 'finding-one', reportId: assessment.id,
    reportHash: assessment.reportHash, blueprintId: assessment.source.blueprintId, blueprintVersion: 3,
    snapshotHash: 'a'.repeat(64), reason: 'Temporary exception', expiresAt: '2026-10-05T12:00:00.000Z' });
  assert.equal(enterpriseIntegrityExceptionPayload({ ...sourceModel, permissions: { integrityException: false } }, assessment,
    assessment.findings[0], 'Temporary exception'), null);
  assert.equal(enterpriseIntegrityExceptionPayload({ ...sourceModel, context: { ...sourceModel.context, isCurrent: false } },
    assessment, assessment.findings[0], 'Temporary exception'), null);
  assert.equal(enterpriseIntegrityExceptionPayload(sourceModel, historicalAssessment, assessment.findings[0], 'Temporary exception'), null,
    'a historical same-source report is inspect-only even when it applies to the current blueprint');

  let submitted = null;
  let inspected = null;
  const panel = renderEnterpriseIntegrity({ model: sourceModel, el, ui: branchUi, onCommand: (payload) => { submitted = payload; },
    onInspectFinding: (finding, item) => { inspected = { finding, item }; } });
  assert.equal(panel.attrs['aria-label'], 'Integrity and lineage assessment');
  assert.match(panel.textContent, /never changes design, grants authority or verifies business outcomes/);
  assert.match(panel.textContent, /gap-owner/);
  assert.match(panel.textContent, /UNRESOLVED/);
  assert.match(panel.textContent, /Target: process-deliver/);
  assert.match(panel.textContent, new RegExp(`Not returned in latest same-source report ${assessment.id}`));
  assert.match(panel.textContent, /Exceptions requiring re-review/);
  assert.match(panel.textContent, /They do not carry forward/);
  assert.match(panel.textContent, /Severity coverage · high 1 · medium 0 · low 0/);
  assert.match(panel.textContent, /design\.completeness · 1 findings across 1 reports/);
  const currentReportRow = panel.querySelectorAll('li').find((entry) => entry.attrs['data-remediation-report'] === assessment.id);
  const inspectButton = currentReportRow.querySelectorAll('button').find((button) => button.text === 'Inspect record in current design');
  assert.ok(inspectButton);
  inspectButton.listeners.get('click')();
  assert.deepEqual(inspected, { finding: assessment.findings[0], item: remediationItem });
  const form = panel.querySelectorAll('form').find((entry) => entry.attrs['data-enterprise-action'] === 'run-integrity-checks');
  form.querySelectorAll('textarea')[0].value = 'Recheck';
  form.listeners.get('submit')({ preventDefault() {} });
  assert.deepEqual(submitted, exactPayload);
  const exceptionForm = panel.querySelectorAll('form').find((entry) => entry.attrs['data-enterprise-action'] === `accept-integrity-exception-${assessment.id}-finding-one`);
  assert.ok(exceptionForm);
  assert.equal(Array.from(panel.querySelectorAll('form')).filter((entry) => entry.attrs['data-enterprise-action']?.startsWith('accept-integrity-exception-')).length, 1,
    'only the current report gets an exception form when older same-source reports are also shown');
  const exceptionInputs = exceptionForm.querySelectorAll('input,select,textarea');
  exceptionInputs[0].value = 'Temporary exception'; exceptionInputs[1].value = '2026-10-05T12:00';
  exceptionForm.listeners.get('submit')({ preventDefault() {} });
  assert.deepEqual(submitted, exceptionPayload);

  const accepted = { ...assessment, exceptions: [{ id: 'integrity-exception-1', findingId: 'finding-one',
    reportId: assessment.id, actor: 'owner', acceptedAt: '2026-10-04T11:00:00.000Z', expiresAt: null,
    reason: 'Temporary exception', status: 'ACTIVE', findingRemainsUnresolved: true }] };
  const acceptedInbox = { ...remediationInbox, items: [{ ...remediationItem, exception: accepted.exceptions[0] }],
    exceptionCoverage: { ACTIVE: 1, EXPIRED: 0, STALE: 0, NONE: 0 } };
  const acceptedPanel = renderEnterpriseIntegrity({ model: { ...sourceModel, integrity: { current: accepted, latest: accepted, assessments: [accepted], exceptions: [...sourceModel.integrity.exceptions, ...accepted.exceptions], remediationInbox: acceptedInbox } },
    el, ui: branchUi, onCommand() {} });
  assert.match(acceptedPanel.textContent, /ACTIVE exception/);
  assert.match(acceptedPanel.textContent, /Finding remains unresolved/);
  assert.equal(acceptedPanel.querySelectorAll('form').some((entry) => entry.attrs['data-enterprise-action'] === `accept-integrity-exception-${assessment.id}-finding-one`), false);

  const staleAssessment = { ...assessment, appliesToContext: false };
  const staleModel = { ...sourceModel, context: { ...sourceModel.context, snapshotHash: 'b'.repeat(64) },
    integrity: { current: null, latest: staleAssessment, assessments: [staleAssessment], exceptions: [staleException],
      remediationInbox: { ...remediationInbox, driftedReports: 1, items: [{ ...remediationItem, reportDrift: true, appliesToContext: false }] } } };
  const stalePanel = renderEnterpriseIntegrity({ model: staleModel, el, ui: branchUi, onCommand() {} });
  assert.match(stalePanel.textContent, /STALE · This saved assessment/);
  assert.match(stalePanel.textContent, new RegExp(assessment.source.snapshotHash));
  assert.match(stalePanel.textContent, /Assign an owner\./);
  assert.match(stalePanel.textContent, /SOURCE DRIFT/);
  assert.equal(stalePanel.querySelectorAll('form').some((entry) => entry.attrs['data-enterprise-action'] === `accept-integrity-exception-${assessment.id}-finding-one`), false);

  const omittedCurrentFinding = { ...assessment.findings[0], objectId: null, path: 'processes.items.process-deliver' };
  omittedCurrentFinding.id = 'finding-two';
  const oldCurrentAssessment = { ...assessment, findings: [assessment.findings[0], omittedCurrentFinding], createdAt: '2026-09-01T10:00:00.000Z' };
  const recentReports = Array.from({ length: 10 }, (_, index) => ({ ...assessment,
    id: `enterprise-integrity-00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`, findings: [], createdAt: `2026-10-0${index + 1}T10:00:00.000Z` }));
  const recentInboxItem = { ...remediationItem, reportId: recentReports.at(-1).id,
    finding: { ...remediationItem.finding, id: 'recent-finding' } };
  const outsideWindowModel = { ...sourceModel, context: { ...sourceModel.context, isCurrent: false, sourceKind: 'HISTORICAL' },
    integrity: { current: oldCurrentAssessment, latest: recentReports.at(-1),
    assessments: recentReports, remediationInbox: { ...remediationInbox,
      currentSource: { blueprintId: 'blueprint-current', blueprintVersion: 4, snapshotHash: 'f'.repeat(64) },
      reportWindowCount: 10, totalSavedReports: 11, totalFindings: 2001, unresolvedFindings: 2001,
      visibleItems: 2000, omittedItems: 1, items: [recentInboxItem] } } };
  const outsideWindowPanel = renderEnterpriseIntegrity({ model: outsideWindowModel, el, ui: branchUi, onCommand() {} });
  assert.match(outsideWindowPanel.textContent, /Current context findings omitted from the recent inbox/);
  assert.match(outsideWindowPanel.textContent, /Target: processes\.items\.process-deliver/);
  assert.match(outsideWindowPanel.textContent, /SOURCE DRIFT/);
  assert.equal(Array.from(outsideWindowPanel.querySelectorAll('form')).some((entry) => entry.attrs['data-enterprise-action']?.startsWith('accept-integrity-exception-')), false,
    'a fallback row for an older selected blueprint is inspect-only');
  const withinWindowModel = { ...outsideWindowModel, integrity: { ...outsideWindowModel.integrity,
    assessments: [oldCurrentAssessment, ...recentReports.slice(0, 9)], latest: recentReports[8],
    remediationInbox: { ...outsideWindowModel.integrity.remediationInbox, items: [remediationItem] } } };
  const withinWindowPanel = renderEnterpriseIntegrity({ model: withinWindowModel, el, ui: branchUi, onCommand() {} });
  const withinWindowRows = Array.from(withinWindowPanel.querySelectorAll('li')).filter((entry) => entry.attrs['data-remediation-report'] === oldCurrentAssessment.id);
  assert.deepEqual(withinWindowRows.map((entry) => entry.attrs['data-remediation-finding']).sort(), ['finding-one', 'finding-two'],
    'a selected report in the ten-report window has its inbox finding and capped-out finding rendered exactly once each');
  assert.equal(Array.from(withinWindowPanel.querySelectorAll('form')).some((entry) => entry.attrs['data-enterprise-action']?.startsWith('accept-integrity-exception-')), false);
});

test('Sentinel UI binds a human assessment to exact source and labels scope and unknown coverage honestly', () => {
  const submitted = [];
  const modelValue = { blueprint: { id: 'blueprint-sentinel' }, context: { isCurrent: true, blueprintId: 'blueprint-sentinel',
    blueprintVersion: 4, snapshotHash: 'a'.repeat(64), sourceKind: 'MAIN_DESIGN' }, permissions: { integrityRun: true },
  sentinel: { profile: { id: 'orgward-sentinel-operational-accountability', version: '1.0.0', evaluatorRevision: 'sentinel-evaluator-1', hash: 'b'.repeat(64) },
    current: { id: 'sentinel-assessment-00000000-0000-4000-8000-000000000001', status: 'PASS', appliesToContext: true,
      evaluatedAt: '2026-10-06T12:00:00.000Z', source: { assessedAggregateVersion: 9 },
      profile: { id: 'orgward-sentinel-operational-accountability', version: '1.0.0' }, reportHash: 'c'.repeat(64),
      coverage: { applicable: 2 }, findings: [] } } };
  const command = enterpriseSentinelCommandPayload(modelValue, 'Review current processes.');
  assert.deepEqual(command, { kind: 'run-sentinel-assessment', blueprintId: 'blueprint-sentinel', blueprintVersion: 4,
    snapshotHash: 'a'.repeat(64), reason: 'Review current processes.' });
  const root = renderEnterpriseSentinel({ model: modelValue, el, ui: branchUi, onCommand: (value) => submitted.push(value) });
  assert.match(root.textContent, /does not assess authority conflicts, control effectiveness/);
  assert.match(root.textContent, /assessed project aggregate v9; the report append advanced the project aggregate separately/);
  assert.match(root.textContent, /bounded profile checks accountable owner roles/);
  const form = root.querySelectorAll('form').find((entry) => entry.attrs['data-enterprise-action'] === 'run-sentinel-assessment');
  form.querySelectorAll('textarea').find((entry) => entry.attrs.name === 'reason').value = 'Review current processes.';
  form.listeners.get('submit')({ preventDefault() {} });
  assert.deepEqual(submitted, [command]);
  assert.equal(enterpriseSentinelCommandPayload({ ...modelValue, context: { ...modelValue.context, isCurrent: false } }, 'review'), null);
  assert.equal(enterpriseSentinelCommandPayload({ ...modelValue, permissions: { integrityRun: false } }, 'review'), null);
});

test('Sentinel case selector offers only reports pinned to the current blueprint version', () => {
  const eligible = { id: 'sentinel-report-1', reportHash: 'a'.repeat(64), source: { blueprintId: 'blueprint-1', blueprintVersion: 3 } };
  const staleVersion = { id: 'sentinel-report-2', reportHash: 'b'.repeat(64), source: { blueprintId: 'blueprint-1', blueprintVersion: 2 } };
  const otherBlueprint = { id: 'sentinel-report-3', reportHash: 'c'.repeat(64), source: { blueprintId: 'blueprint-2', blueprintVersion: 3 } };
  const malformed = { id: 'sentinel-report-4', source: { blueprintId: 'blueprint-1', blueprintVersion: 3 } };
  assert.deepEqual(sentinelAssessmentChoices({ latestBlueprint: { id: 'blueprint-1', version: 3 },
    enterpriseSentinelAssessments: [eligible, staleVersion, otherBlueprint, malformed] }), [eligible]);
  assert.deepEqual(sentinelAssessmentChoices({ latestBlueprint: null, enterpriseSentinelAssessments: [eligible] }), []);
});

test('saved-project pin summary distinguishes exact manifest versions and legacy snapshot unavailability', () => {
  const summary = savedProjectPinSummary({ manifestVersion: 2, savedProjectPin: { projectId: 'project-example', projectVersion: 8,
    blueprintId: 'blueprint-example', blueprintVersion: 4, blueprintSchemaVersion: 2, sourceObjectId: 'process-one',
    sourceObjectType: 'process', sourceHash: 'a'.repeat(64), bindingHash: 'b'.repeat(64), blueprintSnapshotHash: null,
    blueprintSnapshotStatus: 'UNAVAILABLE_LEGACY' } });
  assert.match(summary, /Project project-example v8 · blueprint blueprint-example v4/);
  assert.match(summary, /binding SHA-256 b{64}/);
  assert.match(summary, /blueprint snapshot hash unavailable in this legacy source binding/);
  assert.match(savedProjectPinSummary({ manifestVersion: 1 }), /Historical context manifest v1/);
  assert.match(savedProjectPinSummary({ manifestVersion: 2, savedProjectPin: null }), /No saved project is pinned/);
});
