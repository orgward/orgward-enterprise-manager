const responsibilityTypes = new Set(['goal', 'capability', 'process', 'system']);

function statements(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim());
}

function withNotSpecified(values) {
  return values.length ? values : ['Not specified'];
}

function objectsIn(blueprint) {
  return Object.values(blueprint?.areas ?? {}).flatMap((area) => Array.isArray(area?.items) ? area.items : []);
}

export function processTaskAssignmentTransparency({ task, plan, project, bindings = [], bindingProjectId = null,
  bindingReadAvailable = false } = {}) {
  const assignee = task?.assignee ?? {};
  const pinnedBlueprint = project?.blueprintVersions?.find((entry) => entry.id === plan?.source?.blueprintId
    && Number(entry.version) === Number(plan?.source?.blueprintVersion));
  const blueprintObjects = objectsIn(pinnedBlueprint);
  const role = blueprintObjects.find((entry) => entry.type === 'role' && entry.id === assignee.roleId) ?? null;
  const actor = assignee.kind === 'blueprint-actor'
    ? blueprintObjects.find((entry) => ['actor-human', 'actor-agent'].includes(entry.type) && entry.id === assignee.actorId) ?? null
    : null;
  const roleReferences = (role?.responsibilities ?? []).map((id) => blueprintObjects.find((entry) => entry.id === id))
    .filter((entry) => entry && responsibilityTypes.has(entry.type))
    .map((entry) => entry.name).filter((name) => typeof name === 'string' && name.trim());
  const responsibility = [role?.detail, ...roleReferences]
    .filter((entry) => typeof entry === 'string' && entry.trim());
  const proposedScope = statements(role?.proposedScopeStatements).length
    ? statements(role?.proposedScopeStatements) : statements(role?.authority);
  const proposedInstructions = typeof role?.proposedInstructions === 'string' && role.proposedInstructions.trim()
    ? [role.proposedInstructions.trim()] : [];
  const proposedTools = statements(role?.proposedToolStatements);
  const proposedEscalationRules = statements(role?.proposedEscalationRules);

  const planVersion = Number(plan?.source?.blueprintVersion);
  const projectCurrentVersion = Number(project?.blueprintVersions?.at(-1)?.version);
  const binding = actor && assignee.roleId && bindingProjectId === project?.id && bindingReadAvailable
    && projectCurrentVersion === planVersion
    ? bindings.find((entry) => entry.blueprintVersion === planVersion
      && entry.actorId === actor.id && entry.roleId === assignee.roleId
      && entry.status === 'enabled' && Array.isArray(entry.eligibilityStatus)
      && entry.eligibilityStatus.length === 1 && entry.eligibilityStatus[0] === 'eligible'
      && entry.targetType === (actor.type === 'actor-human' ? 'human' : 'workload')
      && typeof entry.targetName === 'string' && entry.targetName.trim()) ?? null
    : null;

  const actorType = actor?.type === 'actor-human' ? 'human' : actor?.type === 'actor-agent' ? 'agent' : null;
  const permissionBoundary = actorType === 'human'
    ? 'Human checkpoint. Only the enabled bound human identity can start and record this task after its dependencies succeed.'
    : actorType === 'agent'
      ? 'Agent workload binding records organizational responsibility only; it does not grant or impersonate execution authority. The OrgWard worker runs a selected configured profile only after separate approval.'
      : 'Not specified. This plan has no resolved human or agent execution target.';

  return {
    pinnedBlueprintAvailable: Boolean(pinnedBlueprint),
    roleName: role?.name ?? (pinnedBlueprint ? 'Unresolved in pinned blueprint' : 'Unresolved (pinned blueprint unavailable)'),
    guidanceLabel: 'Proposed blueprint role guidance · not enabled authority or tools',
    responsibility: withNotSpecified(responsibility),
    scopeAndAuthority: withNotSpecified(proposedScope),
    instructions: withNotSpecified(proposedInstructions),
    tools: withNotSpecified(proposedTools),
    escalationRules: withNotSpecified(proposedEscalationRules),
    assignee: actor ? `${actor.name} · ${actorType}` : 'Not specified',
    organizationalTarget: binding?.targetName.trim() ?? 'Unresolved',
    disclosureSummary: `Planned actor ${actor ? 'specified' : 'unresolved'} · Enabled target ${binding ? 'resolved' : 'unresolved'}`,
    permissionBoundary,
  };
}
