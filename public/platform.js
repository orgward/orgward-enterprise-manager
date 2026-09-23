import { apiErrorFrom } from './shared-interactions.mjs';

const views = new Set(['command', 'enterprise', 'changes', 'work', 'releases', 'evidence', 'administration']);
const manageableIdentityRoles = ['workspace-read', 'workspace-write', 'execution-approver', 'release-approver', 'control-owner', 'tenant-admin'];
const labels = {
  command: 'Product status', enterprise: 'Enterprise design', changes: 'Change foundation', work: 'Execution foundation',
  releases: 'External effects', evidence: 'Evidence status', administration: 'Administration',
};
const capabilityCopy = {
  enterpriseDesign: {
    title: 'Enterprise design',
    summary: 'A real persisted founder conversation, saved brief, proposed blueprint, integrity result, and graph/list map.',
    available: ['Create and reopen local development projects.', 'Complete four guided answers and inspect the persisted proposed design.'],
    missing: ['Authenticated enterprise identity is not available.', 'Editing, publication, and enabled assignments are later tasks.'],
  },
  governedChange: {
    title: 'Governed change foundation',
    summary: 'A persisted reference workflow supports clarification, proof results, bounded recovery, and protected human decisions.',
    available: ['Create and resume change cases in the reference workspace.', 'Exercise version conflicts, tenant filtering, proof routing, and restart recovery.'],
    missing: ['This is not yet connected to the editable enterprise design.', 'Enterprise identity and broader governed-command integration are not configured.'],
  },
  execution: {
    title: 'Controlled execution foundation',
    summary: 'Server-configured local execution can be enabled explicitly; it is not a hardened production worker plane.',
    available: ['When enabled, a distinct development approval precedes one fixed executable profile.', 'Results and artifact hashes persist locally.'],
    missing: ['No durable queue leases, container or microVM isolation, credential brokerage, or external effects.'],
  },
  externalEffects: {
    title: 'External effects',
    summary: 'Deployments, payments, messages, purchases, and other live business effects are disabled.',
    available: [],
    missing: ['No deployment provider or live-effect adapter is configured.', 'Reading this specification never performs an external action.'],
  },
  enterpriseIdentity: {
    title: 'Enterprise identity',
    summary: 'OIDC browser code flow and API bearer authentication are available when configured; managed identity lifecycle remains incomplete.',
    available: ['The server verifies signed ID and access tokens, issuer, audience, expiry, nonce, and tenant claims.', 'Browser sign-in uses state and PKCE, then stores an opaque HttpOnly session secret in PostgreSQL.', 'Tenant administrators can replace another identity’s exact local role set or revoke it. Changes are audited, generation-fenced, and cancel affected execution leases.'],
    missing: ['Identity-provider group changes do not grant or remove OrgWard roles; trusted SCIM/webhook synchronization and provider-session termination are not implemented.', 'Project membership scopes enterprise projects, change cases, execution runs, and generated artifact downloads through the API. Durable queued-job scopes remain incomplete.', 'Single-node execution dispatch is ordered with project access downgrade or membership revocation, and its configured process group is terminated before the change commits. A durable queue, multi-node cancellation, and a broker that reauthorizes each individual effect are still missing. Development headers are not a security boundary; explicit development mode is restricted to loopback listeners.'],
  },
  persistence: {
    title: 'Persistence',
    summary: 'The running server reports whether PostgreSQL is authoritative or legacy JSON compatibility mode is active.',
    available: ['PostgreSQL mode commits aggregate state, idempotent results, audit and outbox together.', 'Legacy project, case, and run JSON can be previewed and imported with invalid records quarantined.'],
    missing: ['Backup and point-in-time restore qualification remain a later operations task.'],
  },
};

const state = { view: 'command', foundation: null, error: null, loading: true, inspectorTrigger: null, importBusy: false, importResult: null, importCommand: null, identityAdmin: null, identityAction: null, secretAdmin: null, secretAction: null, session: null, sharing: { projects: [], projectId: '', members: [], loading: false, error: null, message: '', busy: false } };
const canvas = document.querySelector('#platform-canvas');
const inspector = document.querySelector('#spec-inspector');
const dialog = document.querySelector('#command-dialog');
const search = document.querySelector('#command-search');
const results = document.querySelector('#command-results');
const identityLabel = document.querySelector('#identity-label');
const identityButton = document.querySelector('#identity-button');
const signOutButton = document.querySelector('#platform-sign-out');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

async function api(route, options = {}) {
  const response = await fetch(route, {
    ...options,
    headers: { accept: 'application/json', ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) },
  });
  let result;
  try { result = await response.json(); }
  catch { throw apiErrorFrom(null, 'The server returned an unreadable response.'); }
  if (!response.ok) throw apiErrorFrom(result);
  return result;
}

async function commandApi(route, body) {
  const response = await fetch(route, {
    method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  let result;
  try { result = await response.json(); }
  catch { throw apiErrorFrom(null, 'The server returned an unreadable response.'); }
  if (!response.ok) throw apiErrorFrom(result);
  return result;
}

function heading(kicker, title, description, actions = '') {
  return `<header class="page-head"><div><span class="micro-label">${escapeHtml(kicker)}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div><div class="page-actions">${actions}</div></header>`;
}

function statusChip(status) {
  const color = ['available', 'current', 'postgresql_transactional'].includes(status) ? 'chip-green' : status === 'foundation' || status.startsWith('development') || status === 'legacy_json' ? 'chip-amber' : status === 'disabled' ? 'chip-red' : 'chip-violet';
  return `<span class="status-chip ${color}">${escapeHtml(status.replaceAll('_', ' '))}</span>`;
}

function count(source) {
  return source?.status === 'current' ? String(source.count) : 'Unavailable';
}

function freshness(source) {
  if (source?.status !== 'current') return 'Retry to check this source';
  return `Actual records · checked ${new Date(source.asOf).toLocaleString()}`;
}

function capabilityRow(id) {
  const capability = state.foundation.capabilities[id];
  const copy = capabilityCopy[id];
  return `<div class="health-row"><span>${statusChip(capability.status)}</span><div><b>${escapeHtml(copy.title)}</b><small>${escapeHtml(copy.summary)}</small></div><button class="platform-button" type="button" data-capability="${id}">${capability.action === 'View specification' ? 'View specification' : escapeHtml(capability.action)}</button></div>`;
}

function renderCommand() {
  const { sources, productGates } = state.foundation;
  const gateSummary = productGates.status === 'current' ? `${productGates.passed} of ${productGates.total} verified` : 'Unavailable';
  return `${heading('Truthful product foundation', 'Product status', 'Actual local records, available product slices, and unavailable production capabilities. No sample activity is counted as live.', '<a class="platform-button primary" href="/">Open enterprise design</a>')}
    <section class="notice"><div><b>First-release gates: ${gateSummary}.</b><p>Source: ${escapeHtml(productGates.source)}. Implemented foundations do not mark a release gate complete.</p></div><button class="platform-button" type="button" data-view="administration">View status details</button></section>
    <div class="metric-grid metric-grid-three">
      <article class="metric"><span>Enterprise projects</span><strong>${count(sources.projects)}</strong><small>${freshness(sources.projects)}</small></article>
      <article class="metric amber"><span>Change cases</span><strong>${count(sources.changeCases)}</strong><small>${freshness(sources.changeCases)}</small></article>
      <article class="metric violet"><span>Execution runs</span><strong>${count(sources.executionRuns)}</strong><small>${freshness(sources.executionRuns)}</small></article>
    </div>
    <div class="dashboard-grid"><section class="panel"><header class="panel-head"><h2>Usable now</h2><span>Local development installation</span></header><div class="panel-body">${capabilityRow('enterpriseDesign')}${capabilityRow('governedChange')}${capabilityRow('execution')}</div></section>
    <section class="panel"><header class="panel-head"><h2>Unavailable or disabled</h2><span>No inferred success</span></header><div class="panel-body">${capabilityRow('enterpriseIdentity')}${capabilityRow('externalEffects')}</div></section></div>`;
}

function renderEnterprise() {
  const source = state.foundation.sources.projects;
  const sharing = state.sharing;
  const selectedProject = sharing.projects.find((project) => project.id === sharing.projectId);
  const selfMembership = sharing.members.find((member) => member.principal === state.session?.principal);
  const canManageMembers = selfMembership?.access === 'owner';
  const sharingProjects = sharing.projects.length
    ? `<label class="sharing-field" for="sharing-project">Project</label><select id="sharing-project" class="sharing-control" aria-label="Project to manage sharing">${sharing.projects.map((project) => `<option value="${escapeHtml(project.id)}" ${project.id === sharing.projectId ? 'selected' : ''}>${escapeHtml(project.name)}</option>`).join('')}</select>`
    : '<p class="muted-copy">No accessible projects yet. Create a project to manage its membership.</p>';
  const memberRows = sharing.members.length
    ? `<ul class="import-results" aria-label="Project members">${sharing.members.map((member) => `<li><span><b>${escapeHtml(member.displayName)}</b>${member.principal === state.session?.principal ? ' · You' : ''}<br><code title="${escapeHtml(member.principal)}">${escapeHtml(member.principal.slice(0, 23))}…</code></span><span>${escapeHtml(member.access)}${canManageMembers && member.access !== 'owner' ? ` <button class="platform-button" type="button" data-revoke-member="${escapeHtml(member.principal)}" ${sharing.busy ? 'disabled' : ''}>Remove</button>` : ''}</span></li>`).join('')}</ul>`
    : selectedProject ? '<p class="muted-copy">No active project members were returned.</p>' : '';
  const memberControls = canManageMembers
    ? `<form id="project-member-form"><label for="member-principal">Verified tenant principal</label><input class="sharing-control" id="member-principal" name="principal" required pattern="oidc:[a-f0-9]{64}" maxlength="69" placeholder="oidc:…" aria-describedby="member-principal-help"><small id="member-principal-help">The colleague must sign in once first. Then use the principal ID shown in Administration → Identity access. Only active identities in this tenant can be added.</small><label for="member-access">Project access</label><select class="sharing-control" id="member-access" name="access"><option value="reader">Reader · view project and linked work</option><option value="editor">Editor · view and change project work</option></select><button class="platform-button primary" type="submit" ${sharing.busy ? 'disabled' : ''}>${sharing.busy ? 'Saving…' : 'Add member'}</button></form>`
    : selectedProject ? '<p class="muted-copy">Only a project owner can add or remove members.</p>' : '';
  return `${heading('Real persisted slice', 'Enterprise design', 'Create a project, answer the guided questions, and inspect the saved proposed blueprint in graph or list form.', '<a class="platform-button primary" href="/">Open workspace</a>')}
    <div class="metric-grid metric-grid-three"><article class="metric"><span>Actual projects</span><strong>${count(source)}</strong><small>${freshness(source)}</small></article><article class="metric amber"><span>Maturity</span><strong>Foundation</strong><small>Conversation and proposed blueprint only</small></article><article class="metric red"><span>Enabled assignments</span><strong>Unavailable</strong><small>Planned for a later product task</small></article></div>
    <section class="panel panel-spaced"><header class="panel-head"><h2>Project access</h2><span>${selectedProject ? escapeHtml(selectedProject.name) : 'OIDC project memberships'}</span></header><div class="panel-body">${sharingProjects}${sharing.loading ? '<p class="muted-copy" role="status">Loading project members…</p>' : ''}${sharing.error ? `<p class="muted-copy" role="status">${escapeHtml(sharing.error)}</p>` : ''}${memberRows}${memberControls}<p class="muted-copy" role="status" aria-live="polite">${escapeHtml(sharing.message)}</p></div></section>
    <section class="panel panel-spaced"><header class="panel-head"><h2>Current boundary</h2><button type="button" data-capability="enterpriseDesign">View specification</button></header><div class="panel-body"><p class="muted-copy">Generated structures are proposed designs based on founder answers. They are not verified market evidence, legal formation, enabled automation, or proof of business performance.</p></div></section>`;
}

async function loadProjectMembers(projectId = state.sharing.projectId) {
  state.sharing.projectId = projectId;
  state.sharing.members = [];
  state.sharing.error = null;
  state.sharing.message = '';
  if (!projectId) { render(); return; }
  state.sharing.loading = true;
  render();
  try {
    state.sharing.members = await api(`/api/v1/projects/${encodeURIComponent(projectId)}/members`).then((result) => result.data);
  } catch (error) {
    state.sharing.error = error.message;
  } finally {
    state.sharing.loading = false;
    render();
  }
}

async function saveProjectMember(event) {
  event.preventDefault();
  if (state.sharing.busy || !state.sharing.projectId) return;
  const form = event.currentTarget;
  const principal = form.elements.principal.value.trim();
  const access = form.elements.access.value;
  state.sharing.busy = true; state.sharing.message = ''; render();
  try {
    await api(`/api/v1/projects/${encodeURIComponent(state.sharing.projectId)}/members`, {
      method: 'POST', body: JSON.stringify({ principal, access }),
    });
    state.sharing.message = 'Project access updated.';
    await loadProjectMembers(state.sharing.projectId);
  } catch (error) {
    state.sharing.error = error.message;
  } finally {
    state.sharing.busy = false; render();
  }
}

async function revokeProjectMember(principal) {
  if (state.sharing.busy || !state.sharing.projectId) return;
  state.sharing.busy = true; state.sharing.error = null; state.sharing.message = ''; render();
  try {
    await api(`/api/v1/projects/${encodeURIComponent(state.sharing.projectId)}/members/${principal}/revoke`, {
      method: 'POST', body: JSON.stringify({}),
    });
    state.sharing.message = 'Project access removed.';
    await loadProjectMembers(state.sharing.projectId);
  } catch (error) {
    state.sharing.error = error.message;
  } finally {
    state.sharing.busy = false; render();
  }
}

function renderChanges() {
  const source = state.foundation.sources.changeCases;
  return `${heading('Persisted reference workflow', 'Change foundation', 'Exercise clarification, proof, recovery, and protected human-decision behavior in the existing governed-change foundation.', '<a class="platform-button primary" href="/sdlc.html">Open foundation</a>')}
    <div class="metric-grid metric-grid-three"><article class="metric"><span>Actual change cases</span><strong>${count(source)}</strong><small>${freshness(source)}</small></article><article class="metric amber"><span>Integration</span><strong>Not connected</strong><small>Enterprise design and change cases are separate foundations</small></article><article class="metric violet"><span>External effects</span><strong>Disabled</strong><small>No production release action is available</small></article></div>
    <section class="panel panel-spaced"><header class="panel-head"><h2>Foundation behavior</h2><button type="button" data-capability="governedChange">View specification</button></header><div class="panel-body"><p class="muted-copy">The reference workflow persists stage, clarification, proof, routing, recovery, and decision history. It does not represent a production-qualified SDLC or a completed product gate.</p></div></section>`;
}

function renderWork() {
  const source = state.foundation.sources.executionRuns;
  const capability = state.foundation.capabilities.execution;
  return `${heading('Controlled local profile', 'Execution foundation', 'Inspect actual locally persisted runs. The worker profile is available only when the server explicitly enables it.', '<a class="platform-button primary" href="/execution.html">Open foundation</a>')}
    <div class="metric-grid metric-grid-three"><article class="metric"><span>Actual runs</span><strong>${count(source)}</strong><small>${freshness(source)}</small></article><article class="metric amber"><span>Execution profile</span><strong>${escapeHtml(capability.status)}</strong><small>${capability.status === 'unavailable' ? 'Server started without local execution' : 'Controlled local profile enabled'}</small></article><article class="metric red"><span>Production isolation</span><strong>Unavailable</strong><small>No hardened worker plane</small></article></div>
    <section class="panel panel-spaced"><header class="panel-head"><h2>Worker boundary</h2><button type="button" data-capability="execution">View specification</button></header><div class="panel-body"><p class="muted-copy">No sample run is shown as completed or live. Enabling the local profile does not make the installation production-ready.</p></div></section>`;
}

function renderReleases() {
  return `${heading('Protected effect boundary', 'External effects', 'No deployment, payment, message, purchase, or other live business-effect adapter is enabled.', '<button class="platform-button" type="button" data-capability="externalEffects">View specification</button>')}
    <section class="notice"><div><b>External effects are disabled.</b><p>There is no production environment, candidate artifact, provider operation, approval, or rollback result to display.</p></div></section>`;
}

function renderEvidence() {
  return `${heading('Current evidence boundary', 'Evidence status', 'Events persist with the implemented project and change foundations; a cross-product audit export is not available.', '<button class="platform-button" type="button" data-capability="persistence">View specification</button>')}
    <section class="panel"><header class="panel-head"><h2>Available evidence</h2><span>Object-local</span></header><div class="panel-body"><div class="health-row">${statusChip('available')}<div><b>Project command events</b><small>Versioned events are returned and persisted by the /api/v1 project journey.</small></div><a class="platform-button" href="/">Open workspace</a></div><div class="health-row">${statusChip('foundation')}<div><b>Change-case evidence ledger</b><small>Reference case history and integrity checks are available in the SDLC foundation.</small></div><a class="platform-button" href="/sdlc.html">Open foundation</a></div><div class="health-row">${statusChip('unavailable')}<div><b>Cross-product audit export</b><small>No aggregate export or production retention/signing service exists.</small></div><button class="platform-button" type="button" data-capability="persistence">View specification</button></div></div></section>`;
}

function renderAdministration() {
  const { identity, persistence, productGates, sources } = state.foundation;
  const gateSummary = productGates.status === 'current' ? `${productGates.passed} of ${productGates.total}` : 'Unavailable';
  const canImport = persistence.status === 'postgresql_transactional' && persistence.legacyImportAvailable;
  const importResult = state.importResult;
  const identityRows = state.identityAdmin?.records?.length
    ? `<ul class="import-results" aria-label="Verified identity access">${state.identityAdmin.records.map((entry) => `<li><span><b>${escapeHtml(entry.displayName)}</b> · ${escapeHtml(entry.actorType)} · ${escapeHtml(entry.roles.join(', ') || 'no local roles')}<br><code title="${escapeHtml(entry.principal)}">${escapeHtml(entry.principal.slice(0, 19))}…</code></span><span>${escapeHtml(entry.status)}</span>${entry.status === 'active' && entry.principal !== state.session?.principal ? `<form class="identity-role-form" data-identity-principal="${escapeHtml(entry.principal)}"><input type="hidden" name="expectedAuthzGeneration" value="${entry.authzGeneration}"><fieldset><legend>Exact local role set</legend>${manageableIdentityRoles.map((role) => `<label><input type="checkbox" name="roles" value="${role}" ${entry.roles.includes(role) ? 'checked' : ''} ${entry.actorType === 'workload' && role === 'tenant-admin' ? 'disabled' : ''}> ${escapeHtml(role)}</label>`).join('')}</fieldset><label>Reason<input name="reason" maxlength="500" required></label><button class="platform-button" type="submit" ${state.identityAction?.busy ? 'disabled' : ''}>Replace roles</button></form>` : entry.principal === state.session?.principal ? '<small>Your own identity cannot be changed here.</small>' : ''}</li>`).join('')}</ul>`
    : state.identityAdmin?.records ? '<p class="muted-copy">No verified identities have signed in to this tenant.</p>' : '';
  const identityAdminContent = state.identityAdmin?.error
    ? `<p class="muted-copy" role="status">${escapeHtml(state.identityAdmin.error)}</p>`
    : state.identityAdmin?.records
      ? identityRows || '<p class="muted-copy">No verified identities have signed in to this tenant.</p>'
      : '<p class="muted-copy">Identity access management is available to tenant administrators.</p>';
  const secretRows = state.secretAdmin?.records?.length
    ? `<ul class="import-results" aria-label="Encrypted secret references">${state.secretAdmin.records.map((entry) => `<li><span><b>${escapeHtml(entry.reference)}</b><br>${entry.status === 'candidate' ? 'No active credential · candidate staged' : `Version ${entry.version}`} · updated ${escapeHtml(new Date(entry.updatedAt).toLocaleString())}<br><small>${entry.encryptionAvailable ? 'Encrypted credential present' : 'Encryption key unavailable'} · ${entry.expiresAt ? `expires ${escapeHtml(new Date(entry.expiresAt).toLocaleString())}` : 'expiry required'}${entry.requiresRotation ? ' · rotation required before use' : ''} · upstream revocation ${escapeHtml(entry.upstreamRevocationStatus ?? 'not_applicable')}${entry.upstreamRevocations?.length ? ` · prior generations: ${entry.upstreamRevocations.map((item) => `v${item.credentialVersion} ${item.status}`).join(', ')}` : ''}${entry.candidate ? ` · OpenAI candidate ${escapeHtml(entry.candidate.status)} (${escapeHtml(entry.candidate.model)})` : ''}</small></span><span>${escapeHtml(entry.requiresRotation ? 'rotation required' : entry.status)}</span>${entry.candidate ? `<div class="page-actions">${entry.candidate.status === 'staged' ? `<button class="platform-button openai-candidate-action" data-action="validate" data-reference="${escapeHtml(entry.reference)}" data-version="${entry.candidate.version}" data-current-version="${entry.version}">Validate candidate</button>` : ''}${entry.candidate.status === 'validated' ? `<button class="platform-button primary openai-candidate-action" data-action="activate" data-reference="${escapeHtml(entry.reference)}" data-version="${entry.candidate.version}" data-current-version="${entry.version}">Activate validated candidate</button>` : ''}</div>` : ''}${entry.status === 'active' ? `<form class="secret-revoke-form" data-secret-reference="${escapeHtml(entry.reference)}"><input type="hidden" name="expectedVersion" value="${entry.version}"><label>Reason<input name="reason" maxlength="500" required></label><button class="platform-button" type="submit" ${state.secretAction?.busy ? 'disabled' : ''}>Revoke credential</button></form>` : ''}</li>`).join('')}</ul>`
    : state.secretAdmin?.records ? '<p class="muted-copy">No encrypted credential references are configured.</p>' : '';
  const secretAdminContent = state.secretAdmin?.error
    ? `<p class="muted-copy" role="status">${escapeHtml(state.secretAdmin.error)}</p>`
    : state.secretAdmin?.records
      ? secretRows
      : '<p class="muted-copy">Secret reference management is available to tenant administrators.</p>';
  const itemDetails = importResult?.data?.items?.length
    ? `<ul class="import-results" aria-label="Legacy import record results">${importResult.data.items.slice(0, 20).map((item) => `<li><code>${escapeHtml(item.sourcePath)}</code><span>${escapeHtml(item.status)}${item.errorCode ? ` · ${escapeHtml(item.errorCode)}` : ''}</span></li>`).join('')}</ul>${importResult.data.items.length > 20 ? `<p class="muted-copy">Showing 20 of ${escapeHtml(importResult.data.items.length)} records.</p>` : ''}`
    : '';
  const importSummary = importResult?.error
    ? `<div class="notice" role="status" aria-live="polite"><div><b>Import request failed.</b><p>${escapeHtml(importResult.error.message)}${importResult.error.correlationId ? ` Reference ${escapeHtml(importResult.error.correlationId)}.` : ''} Your retry uses the same command ID.</p></div></div>`
    : importResult?.data
      ? `<div class="notice" role="status" aria-live="polite"><div><b>${importResult.data.mode === 'dry-run' ? 'Preview complete' : 'Import complete'}.</b><p>${escapeHtml(importResult.data.counts.imported ?? importResult.data.counts.importable ?? 0)} ${importResult.data.mode === 'dry-run' ? 'importable' : 'imported'}, ${escapeHtml(importResult.data.counts.unchanged)} unchanged, ${escapeHtml(importResult.data.counts.quarantined)} quarantined from ${escapeHtml(importResult.data.counts.discovered)} discovered records.</p></div></div>${itemDetails}`
      : '';
  return `${heading('Local installation facts', 'Administration', 'Configuration and readiness facts that the running application can currently substantiate.', '<button class="platform-button primary" type="button" data-retry>Refresh status</button>')}
    <section class="panel"><header class="panel-head"><h2>First-release status · ${gateSummary}</h2><span>${statusChip(productGates.status)} ${escapeHtml(productGates.source)}</span></header><div class="panel-body"><div class="health-row">${statusChip(identity.status)}<div><b>Identity</b><small>${escapeHtml(identity.description)}</small></div><button class="platform-button" type="button" data-capability="enterpriseIdentity">View specification</button></div><div class="health-row">${statusChip(persistence.status)}<div><b>Persistence</b><small>${escapeHtml(persistence.description)}${persistence.schemaVersion ? ` Schema ${escapeHtml(persistence.schemaVersion)}.` : ''}</small></div><button class="platform-button" type="button" data-capability="persistence">View details</button></div>${Object.entries(sources).map(([name, source]) => `<div class="health-row">${statusChip(source.status)}<div><b>${escapeHtml(name)}</b><small>${freshness(source)}</small></div><span>${source.count ?? '—'}</span></div>`).join('')}</div></section>
    <section class="panel panel-spaced"><header class="panel-head"><h2>Identity access</h2><span>${state.identityAdmin?.records ? `${state.identityAdmin.records.length} verified` : 'Tenant admin'}</span></header><div class="panel-body"><p class="muted-copy">Local persisted roles are authoritative. Signed provider groups do not grant or remove OrgWard roles; a tenant administrator must replace a user's exact role set here. Provider group-only changes take effect in OrgWard only after this local update until a trusted provider-sync adapter exists. New identities receive no roles by default. The only automatic enrollment is a one-time minimal grant to an operator-configured exact issuer, subject, and mapped tenant.</p>${identityAdminContent}${state.identityAdmin?.records?.some((entry) => entry.status === 'active' && entry.principal !== state.session?.principal) ? `<form id="identity-revoke-form"><label for="identity-revoke-select">Identity to revoke</label><select id="identity-revoke-select" name="principal" required><option value="">Choose another active identity…</option>${state.identityAdmin.records.filter((entry) => entry.status === 'active' && entry.principal !== state.session?.principal).map((entry) => `<option value="${escapeHtml(entry.principal)}" data-generation="${entry.authzGeneration}">${escapeHtml(entry.displayName)} · ${escapeHtml(entry.actorType)} · generation ${entry.authzGeneration}</option>`).join('')}</select><label for="identity-revoke-reason">Revocation reason</label><input id="identity-revoke-reason" name="reason" maxlength="500" required aria-describedby="identity-revoke-help"><small id="identity-revoke-help">Revocation is transactional, cancels sessions and active worker leases, and cannot remove the last tenant administrator.</small><button class="platform-button primary" type="submit" ${state.identityAction?.busy ? 'disabled' : ''}>${state.identityAction?.busy ? 'Revoking…' : 'Revoke identity'}</button></form>` : ''}<p class="muted-copy" role="status" aria-live="polite">${state.identityAction?.message ? escapeHtml(state.identityAction.message) : ''}</p></div></section>
    <section class="panel panel-spaced"><header class="panel-head"><h2>Provider credentials</h2><span>${state.secretAdmin?.records ? `${state.secretAdmin.records.length} references` : 'Tenant admin'}</span></header><div class="panel-body"><p class="muted-copy">Values are encrypted in PostgreSQL and are never returned by the API or shown in reference details. Configure <code>ORGWARD_SECRET_ENCRYPTION_KEY</code> on the server. Generic fixed-version credentials remain available for server-configured fixture providers. OpenAI credentials use staged validation against the fixed OpenAI model endpoint; activation invalidates old leases. Replacing a prior credential records its upstream revocation as unconfirmed; first activation has no predecessor.</p>${secretAdminContent}${state.secretAdmin?.records ? `<form id="openai-candidate-form"><h3>Stage OpenAI credential</h3><label>Reference ID<input name="reference" required pattern="secret-[a-z0-9][a-z0-9._-]{0,79}" maxlength="87" placeholder="secret-openai"></label><label>OpenAI model ID<input name="model" required maxlength="100" placeholder="gpt-…"></label><label>Credential value<input name="value" type="password" minlength="8" maxlength="65536" autocomplete="new-password" required></label><label>Credential expiry<input name="expiresAt" type="datetime-local" required></label><label>Reason<input name="reason" maxlength="500" required></label><button class="platform-button primary" type="submit" ${state.secretAction?.busy ? 'disabled' : ''}>Stage encrypted candidate</button></form><form id="secret-reference-form"><details><summary>Generic fixed-version provider credential</summary><label for="secret-reference-id">Reference ID</label><input id="secret-reference-id" name="reference" required pattern="secret-[a-z0-9][a-z0-9._-]{0,79}" maxlength="87" placeholder="secret-fixture"><label for="secret-reference-value">Credential value</label><input id="secret-reference-value" name="value" type="password" minlength="8" maxlength="65536" autocomplete="new-password" required><label for="secret-reference-expiry">Credential expiry</label><input id="secret-reference-expiry" name="expiresAt" type="datetime-local" required><label for="secret-reference-reason">Reason</label><input id="secret-reference-reason" name="reason" maxlength="500" required><button class="platform-button" type="submit">Store fixed-version credential</button></details></form>` : ''}<p class="muted-copy" role="status" aria-live="polite">${state.secretAction?.message ? escapeHtml(state.secretAction.message) : ''}</p></div></section>
    <section class="panel panel-spaced"><header class="panel-head"><h2>Legacy JSON import</h2><span>${canImport ? 'Transactional and restart-safe' : 'Unavailable in this mode'}</span></header><div class="panel-body"><p class="muted-copy">Preview configured legacy project, change-case, and execution-run directories before importing. Apply preserves valid IDs and source hashes, skips unchanged records, and quarantines invalid or conflicting records without overwriting PostgreSQL state.</p>${importSummary}<div class="page-actions import-actions"><button class="platform-button" type="button" data-import-mode="dry-run" ${canImport && !state.importBusy ? '' : 'disabled'}>${state.importBusy ? 'Working…' : 'Preview import'}</button><button class="platform-button primary" type="button" data-import-mode="apply" ${canImport && !state.importBusy ? '' : 'disabled'}>Import valid records</button></div><p class="muted-copy" role="status" aria-live="polite">${state.importBusy ? 'Checking configured legacy records…' : canImport ? 'No files are changed or deleted by this import.' : 'Start the server with PostgreSQL to use legacy import.'}</p></div></section>`;
}

const renderers = { command: renderCommand, enterprise: renderEnterprise, changes: renderChanges, work: renderWork, releases: renderReleases, evidence: renderEvidence, administration: renderAdministration };

function render() {
  document.querySelectorAll('.global-nav button[data-view]').forEach((button) => button.setAttribute('aria-current', button.dataset.view === state.view ? 'page' : 'false'));
  document.querySelector('#current-view-label').textContent = labels[state.view];
  if (state.loading) {
    canvas.setAttribute('aria-busy', 'true');
    canvas.innerHTML = `${heading('Product status', 'Loading actual records', 'Checking the current installation without substituting sample data.')}<section class="panel"><div class="panel-body"><p class="muted-copy" role="status">Loading…</p></div></section>`;
  } else if (state.error) {
    canvas.setAttribute('aria-busy', 'false');
    canvas.innerHTML = `${heading('Product status', 'Status unavailable', state.error.message)}<section class="notice"><div><b>Actual counts are unavailable.</b><p>No zero or sample success has been substituted.${state.error.correlationId ? ` Reference ${escapeHtml(state.error.correlationId)}.` : ''}</p></div><button class="platform-button primary" type="button" data-retry>Try again</button></section>`;
  } else {
    canvas.setAttribute('aria-busy', 'false');
    canvas.innerHTML = renderers[state.view]();
  }
  canvas.focus({ preventScroll: true });
}

function setView(view, { history = 'push' } = {}) {
  if (!views.has(view)) return;
  state.view = view;
  render();
  if (history) window.history[history === 'replace' ? 'replaceState' : 'pushState'](null, '', `/platform.html#${view}`);
}

function showInspector(id, trigger) {
  const copy = capabilityCopy[id];
  if (!copy) return;
  const live = state.foundation?.capabilities?.[id];
  state.inspectorTrigger = trigger ?? document.activeElement;
  document.querySelector('#inspector-title').textContent = copy.title;
  document.querySelector('#inspector-content').innerHTML = `<div class="inspector-body">${statusChip(live?.status ?? 'unavailable')}<p>${escapeHtml(copy.summary)}</p><section class="inspector-section"><h3>Available behavior</h3>${copy.available.length ? `<ul>${copy.available.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul>` : '<p class="muted-copy">No live behavior is available.</p>'}</section><section class="inspector-section"><h3>Missing production behavior</h3><ul>${copy.missing.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul></section></div>`;
  inspector.hidden = false;
  inspector.focus();
}

function closeInspector() {
  if (inspector.hidden) return;
  inspector.hidden = true;
  state.inspectorTrigger?.focus?.();
  state.inspectorTrigger = null;
}

function renderSearch(query = '') {
  const entries = [
    ...Object.entries(labels).map(([id, label]) => ({ id, label, kind: 'view', description: 'Screen' })),
    ...Object.entries(capabilityCopy).map(([id, value]) => ({ id, label: value.title, kind: 'capability', description: 'Capability status' })),
  ];
  const matches = entries.filter((entry) => `${entry.label} ${entry.description}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 12);
  results.innerHTML = matches.length
    ? matches.map((entry) => `<button class="command-result" type="button" data-command-id="${entry.id}" data-command-kind="${entry.kind}"><b>${escapeHtml(entry.label)}</b><span>${entry.description}</span></button>`).join('')
    : '<p class="muted-copy" role="status">No matching screen or capability. Try “execution” or “identity”.</p>';
}

function openSearch() {
  search.value = '';
  renderSearch();
  dialog.showModal();
  setTimeout(() => search.focus(), 0);
}

async function loadFoundation() {
  state.loading = true; state.error = null; render();
  try {
    const [response, sessionResponse] = await Promise.all([
      api('/api/v1/foundation'), fetch('/auth/session').then((result) => result.json()),
    ]);
    state.foundation = response.data;
    const authenticated = sessionResponse.authenticated;
    state.session = sessionResponse;
    identityLabel.textContent = authenticated ? 'Signed in · OIDC' : 'Development identity · unverified';
    identityButton.textContent = authenticated ? 'OIDC' : 'DEV';
    signOutButton.hidden = !authenticated;
    state.identityAdmin = null;
    state.secretAdmin = null;
    if (sessionResponse.roles?.includes('tenant-admin')) {
      const [identities, secrets] = await Promise.allSettled([api('/api/v1/identities'), api('/api/v1/secrets')]);
      state.identityAdmin = identities.status === 'fulfilled' ? { records: identities.value.data } : { error: identities.reason.message };
      state.secretAdmin = secrets.status === 'fulfilled' ? { records: secrets.value.data } : { error: secrets.reason.message };
    }
    if (authenticated) {
      try {
        const projects = await api('/api/v1/projects');
        state.sharing.projects = projects.data;
        const selected = state.sharing.projects.some((project) => project.id === state.sharing.projectId)
          ? state.sharing.projectId : state.sharing.projects[0]?.id ?? '';
        await loadProjectMembers(selected);
      } catch (error) {
        state.sharing = { ...state.sharing, loading: false, error: error.message };
      }
    } else {
      state.sharing = { projects: [], projectId: '', members: [], loading: false, error: null, message: '', busy: false };
    }
    document.querySelector('#nav-runs').textContent = response.data.sources.executionRuns.count ?? '—';
  } catch (error) {
    if (error.code === 'AUTHENTICATION_REQUIRED') {
      window.location.replace(`/sign-in.html?returnTo=${encodeURIComponent(`${window.location.pathname}${window.location.search}${window.location.hash}`)}`);
      return;
    }
    state.error = error;
  }
  finally { state.loading = false; render(); }
}

signOutButton.addEventListener('click', async () => {
  signOutButton.disabled = true;
  try {
    const response = await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
    if (!response.ok) throw new Error('Sign-out could not be completed.');
    window.location.assign('/sign-in.html?signed_out=1');
  } catch {
    signOutButton.disabled = false;
    signOutButton.textContent = 'Try sign out again';
  }
});

async function runImport(mode) {
  if (state.importBusy) return;
  if (!state.importCommand || state.importCommand.mode !== mode) {
    state.importCommand = { mode, commandId: `legacy-import-${crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}` };
  }
  state.importBusy = true;
  state.importResult = null;
  render();
  try {
    const response = await commandApi('/api/v1/persistence/imports', {
      schemaVersion: '1.0', commandId: state.importCommand.commandId, payload: { mode },
    });
    state.importResult = response;
    state.importCommand = null;
    const refreshed = await api('/api/v1/foundation');
    state.foundation = refreshed.data;
  } catch (error) {
    state.importResult = { error };
  } finally {
    state.importBusy = false;
    render();
  }
}

async function revokeIdentity(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const principal = form.elements.principal.value;
  const reason = form.elements.reason.value.trim();
  const expectedAuthzGeneration = Number(form.elements.principal.selectedOptions[0]?.dataset.generation);
  if (!principal || !reason || state.identityAction?.busy) return;
  state.identityAction = { message: 'Revoking identity…', busy: true };
  render();
  try {
    await api(`/api/v1/identities/${principal}/revoke`, {
      method: 'POST', body: JSON.stringify({ reason, expectedAuthzGeneration }),
    });
    state.identityAction = { message: 'Identity revoked. Its sessions and subsequent bearer requests are denied.', busy: false };
    await loadFoundation();
  } catch (error) {
    state.identityAction = { message: `Revocation failed: ${error.message}`, busy: false };
    render();
  }
}

async function replaceIdentityRoles(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const principal = form.dataset.identityPrincipal;
  const roles = new FormData(form).getAll('roles');
  const expectedAuthzGeneration = Number(form.elements.expectedAuthzGeneration.value);
  const reason = form.elements.reason.value.trim();
  if (!principal || !Number.isSafeInteger(expectedAuthzGeneration) || !reason || state.identityAction?.busy) return;
  state.identityAction = { message: 'Updating local roles…', busy: true };
  render();
  try {
    await api(`/api/v1/identities/${principal}/roles`, {
      method: 'PUT', body: JSON.stringify({ roles, expectedAuthzGeneration, reason }),
    });
    state.identityAction = { message: 'Local role set updated. Provider group claims do not change this grant.', busy: false };
    await loadFoundation();
  } catch (error) {
    state.identityAction = { message: `Role update failed: ${error.message}`, busy: false };
    render();
  }
}

async function storeSecretReference(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const reference = form.elements.reference.value.trim();
  const value = form.elements.value.value;
  const reason = form.elements.reason.value.trim();
  const expiresAt = form.elements.expiresAt.value;
  const existing = state.secretAdmin?.records?.find((entry) => entry.reference === reference);
  if (!reference || !value || !reason || !expiresAt || state.secretAction?.busy) return;
  state.secretAction = { message: existing ? 'Rotating encrypted credential…' : 'Encrypting credential…', busy: true };
  render();
  const request = api(`/api/v1/secrets/${encodeURIComponent(reference)}`, {
    method: 'PUT',
    body: JSON.stringify({
      schemaVersion: '1.0', commandId: `secret-write-${crypto.randomUUID()}`,
      expectedVersion: existing?.version ?? 0, payload: { value, reason, expiresAt: new Date(expiresAt).toISOString() },
    }),
  });
  try {
    await request;
    state.secretAction = { message: 'Credential encrypted. Its value is not returned by the API.', busy: false };
    await loadFoundation();
  } catch (error) {
    state.secretAction = { message: `Credential update failed: ${error.message}`, busy: false };
    render();
  }
}

async function stageOpenAiCandidate(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const reference = form.elements.reference.value.trim();
  const existing = state.secretAdmin?.records?.find((entry) => entry.reference === reference);
  const value = form.elements.value.value;
  const reason = form.elements.reason.value.trim();
  if (state.secretAction?.busy || !reference || !value || !reason) return;
  state.secretAction = { message: 'Encrypting OpenAI candidate…', busy: true };
  render();
  try {
    await api(`/api/v1/secrets/${encodeURIComponent(reference)}/openai-candidate`, { method: 'PUT', body: JSON.stringify({
      schemaVersion: '1.0', commandId: `openai-stage-${crypto.randomUUID()}`, expectedVersion: existing?.version ?? 0,
      payload: { value, model: form.elements.model.value.trim(), reason, expiresAt: new Date(form.elements.expiresAt.value).toISOString() },
    }) });
    state.secretAction = { message: 'Candidate encrypted. Validate it before activation.', busy: false };
    await loadFoundation();
  } catch (error) {
    state.secretAction = { message: `Candidate staging failed: ${error.message}`, busy: false };
    render();
  }
}

async function openAiCandidateAction(button) {
  if (state.secretAction?.busy) return;
  const { action, reference } = button.dataset;
  const candidateVersion = Number(button.dataset.version);
  const expectedVersion = Number(button.dataset.currentVersion);
  state.secretAction = { message: action === 'validate' ? 'Checking model access with OpenAI…' : 'Activating validated credential…', busy: true };
  render();
  try {
    const validate = action === 'validate';
    const result = await api(`/api/v1/secrets/${encodeURIComponent(reference)}/openai-candidate/${validate ? 'validate' : 'activate'}`, { method: 'POST', body: JSON.stringify({
      schemaVersion: '1.0', commandId: `openai-${action}-${crypto.randomUUID()}`, expectedVersion,
      payload: validate ? { candidateVersion } : { candidateVersion, reason: 'Activate validated OpenAI credential' },
    }) });
    state.secretAction = { message: validate ? 'OpenAI confirmed access to the selected model.' : result.data.upstreamRevocationStatus === 'unconfirmed' ? 'Validated credential activated. Prior upstream revocation remains unconfirmed.' : 'Validated credential activated. No prior upstream credential required revocation.', busy: false };
    await loadFoundation();
  } catch (error) {
    state.secretAction = { message: `OpenAI credential ${action} failed: ${error.message}`, busy: false };
    render();
  }
}

async function revokeSecretReference(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const reference = form.dataset.secretReference;
  const expectedVersion = Number(form.elements.expectedVersion.value);
  const reason = form.elements.reason.value.trim();
  if (!reference || !Number.isSafeInteger(expectedVersion) || !reason || state.secretAction?.busy) return;
  state.secretAction = { message: 'Revoking credential…', busy: true };
  render();
  try {
    await api(`/api/v1/secrets/${encodeURIComponent(reference)}/revoke`, {
      method: 'POST',
      body: JSON.stringify({
        schemaVersion: '1.0', commandId: `secret-revoke-${crypto.randomUUID()}`,
        expectedVersion, payload: { reason },
      }),
    });
    state.secretAction = { message: 'Credential disabled in OrgWard; upstream revocation remains unconfirmed.', busy: false };
    await loadFoundation();
  } catch (error) {
    state.secretAction = { message: `Credential revocation failed: ${error.message}`, busy: false };
    render();
  }
}

document.addEventListener('click', (event) => {
  const revokeMember = event.target.closest('[data-revoke-member]');
  if (revokeMember) { revokeProjectMember(revokeMember.dataset.revokeMember); return; }
  const importButton = event.target.closest('[data-import-mode]');
  if (importButton) { runImport(importButton.dataset.importMode); return; }
  const retry = event.target.closest('[data-retry]');
  if (retry) { loadFoundation(); return; }
  const view = event.target.closest('[data-view]');
  if (view) { setView(view.dataset.view); return; }
  const capability = event.target.closest('[data-capability]');
  if (capability) { showInspector(capability.dataset.capability, capability); }
  const candidateAction = event.target.closest('.openai-candidate-action');
  if (candidateAction) { void openAiCandidateAction(candidateAction); }
});
document.querySelector('#close-inspector').addEventListener('click', closeInspector);
document.querySelector('#open-search').addEventListener('click', openSearch);
document.addEventListener('submit', (event) => {
  if (event.target.id === 'identity-revoke-form') revokeIdentity(event);
  if (event.target.matches('.identity-role-form')) replaceIdentityRoles(event);
  if (event.target.id === 'project-member-form') saveProjectMember(event);
  if (event.target.id === 'secret-reference-form') storeSecretReference(event);
  if (event.target.id === 'openai-candidate-form') stageOpenAiCandidate(event);
  if (event.target.matches('.secret-revoke-form')) revokeSecretReference(event);
});
document.addEventListener('change', (event) => {
  if (event.target.id === 'sharing-project') loadProjectMembers(event.target.value);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !inspector.hidden) { event.preventDefault(); closeInspector(); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch(); }
});
search.addEventListener('input', () => renderSearch(search.value));
results.addEventListener('click', (event) => {
  const button = event.target.closest('[data-command-id]');
  if (!button) return;
  dialog.close();
  if (button.dataset.commandKind === 'view') setView(button.dataset.commandId);
  else showInspector(button.dataset.commandId, document.querySelector('#open-search'));
});
window.addEventListener('popstate', () => setView(window.location.hash.slice(1) || 'command', { history: null }));

const initialView = window.location.hash.slice(1);
if (views.has(initialView)) state.view = initialView;
setView(state.view, { history: 'replace' });
await loadFoundation();
