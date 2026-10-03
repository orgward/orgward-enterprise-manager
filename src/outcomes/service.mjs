import { digest } from '../sdlc/contracts.mjs';
import { OUTCOME_CATEGORIES, OUTCOME_STATUSES, normalizeOutcomeMeasures, outcomeCommand, outcomeFailure, outcomeText, outcomeImport } from './contracts.mjs';

const baseFields = ['commandId', 'expectedVersion'];
const commandFields = {
  observe: ['window', 'measures'], propose: ['title', 'recommendation', 'rationale', 'observationHash'],
  review: ['proposalHash', 'decision', 'reason'], assign: ['ownerPrincipal', 'reason'], status: ['status', 'reason'],
  'follow-up': ['proposalHash', 'expectedProjectVersion', 'expectedBlueprintId', 'expectedBlueprintVersion', 'sourceObjectId'],
};
export class OutcomeService {
  constructor(store) { this.store = store; }
  #available() { if (!this.store) throw outcomeFailure('OUTCOME_PERSISTENCE_REQUIRED', 'Customer outcomes require PostgreSQL persistence.', 503); }
  #hash(context, input) { return digest({ principal: context.principal, input }); }
  #principal(value) {
    if (typeof value !== 'string' || !/^oidc:[a-f0-9]{64}$/.test(value)) {
      throw outcomeFailure('INVALID_OUTCOME_OWNER', 'Select a current human project editor as the inbox owner.', 400);
    }
  }
  list(context) { this.#available(); return this.store.list(context); }
  async read(context, outcomeId) {
    this.#available();
    const outcome = await this.store.read(context, outcomeId);
    if (!outcome) throw outcomeFailure('OUTCOME_NOT_FOUND', 'The outcome was not found in this project.', 404);
    return outcome;
  }
  async export(context, outcomeId) {
    const outcome = await this.read(context, outcomeId);
    const core = { version: 'orgward-outcome-export-v1', projectId: context.projectId, outcome };
    return { ...core, exportHash: digest(core) };
  }
  previewImport(context, input) {
    this.#available();
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some((key) => key !== 'bundle')) {
      throw outcomeFailure('INVALID_OUTCOME_IMPORT', 'Provide only the exported outcome bundle for preview.', 400);
    }
    return this.store.previewImport(context, outcomeImport(input.bundle));
  }
  import(context, input) {
    this.#available();
    outcomeCommand(input, ['commandId', 'bundle', 'ownerPrincipal', 'expectedImportHash'], { version: false });
    this.#principal(input.ownerPrincipal);
    const prepared = outcomeImport(input.bundle);
    if (input.expectedImportHash !== prepared.importHash) {
      throw outcomeFailure('OUTCOME_IMPORT_PREVIEW_STALE', 'Preview the exact exported evidence before importing it.');
    }
    return this.store.import(context, input, prepared, this.#hash(context, input));
  }
  create(context, input) {
    this.#available();
    outcomeCommand(input, ['commandId', 'title', 'category', 'source', 'ownerPrincipal'], { version: false });
    this.#principal(input.ownerPrincipal);
    if (!OUTCOME_CATEGORIES.includes(input.category)) throw outcomeFailure('INVALID_OUTCOME_CATEGORY', 'Choose improvement, incident or support.', 400);
    const source = input.source;
    if (!source || typeof source !== 'object' || Array.isArray(source) || !['release', 'task', 'manual'].includes(source.kind)) {
      throw outcomeFailure('INVALID_OUTCOME_SOURCE', 'Choose a saved release, task run, or explicit human-reported manual source.', 400);
    }
    const allowed = source.kind === 'release' ? ['kind', 'actionId'] : source.kind === 'task' ? ['kind', 'runId'] : ['kind', 'summary'];
    if (Object.keys(source).some((key) => !allowed.includes(key))
      || (source.kind === 'release' && !/^release-action-[0-9a-f-]{36}$/.test(source.actionId ?? ''))
      || (source.kind === 'task' && !/^execution-run-[0-9a-f-]{36}$/.test(source.runId ?? ''))) {
      throw outcomeFailure('INVALID_OUTCOME_SOURCE', 'Provide only the selected scoped source identifier or manual evidence summary.', 400);
    }
    const normalized = { ...input, title: outcomeText(input.title, 'Outcome title', 160),
      source: source.kind === 'manual' ? { kind: 'manual', summary: outcomeText(source.summary, 'Human-reported source summary', 800) } : source };
    return this.store.create(context, normalized, this.#hash(context, input));
  }
  command(context, outcomeId, operation, input) {
    this.#available();
    if (!commandFields[operation]) throw outcomeFailure('INVALID_OUTCOME_COMMAND', 'This outcome action is unavailable.', 400);
    outcomeCommand(input, [...baseFields, ...commandFields[operation]]);
    let normalized = { ...input };
    if (operation === 'observe') normalized = { ...input,
      window: outcomeText(input.window, 'Observation window', 200), measures: normalizeOutcomeMeasures(input.measures) };
    else if (operation === 'propose') {
      if (!/^[a-f0-9]{64}$/.test(input.observationHash ?? '')) throw outcomeFailure('INVALID_OUTCOME_OBSERVATION', 'Select the current saved observation hash.', 400);
      normalized = { ...input, title: outcomeText(input.title, 'Learning title', 160),
        recommendation: outcomeText(input.recommendation, 'Recommended change', 2000), rationale: outcomeText(input.rationale, 'Learning rationale', 1000) };
    } else if (operation === 'review' || operation === 'follow-up') {
      if (!/^[a-f0-9]{64}$/.test(input.proposalHash ?? '')) throw outcomeFailure('INVALID_OUTCOME_PROPOSAL', 'Review the exact saved learning proposal hash.', 400);
      if (operation === 'review') {
        if (!['accept', 'reject'].includes(input.decision)) throw outcomeFailure('INVALID_OUTCOME_REVIEW', 'Accept or reject the proposal explicitly.', 400);
        normalized.reason = outcomeText(input.reason, 'Review reason', 500);
      } else if (!Number.isSafeInteger(input.expectedProjectVersion) || input.expectedProjectVersion < 1
        || !/^blueprint-[0-9a-f-]{36}$/.test(input.expectedBlueprintId ?? '')
        || !Number.isSafeInteger(input.expectedBlueprintVersion) || input.expectedBlueprintVersion < 1
        || typeof input.sourceObjectId !== 'string' || !input.sourceObjectId || input.sourceObjectId.length > 120) {
        throw outcomeFailure('SOURCE_REFERENCE_REQUIRED', 'Choose the current saved-design source and submit its project and blueprint versions.', 400);
      }
    } else {
      normalized.reason = outcomeText(input.reason, 'Owner or status reason', 500);
      if (operation === 'assign') this.#principal(input.ownerPrincipal);
      else if (!OUTCOME_STATUSES.includes(input.status)) throw outcomeFailure('INVALID_OUTCOME_STATUS', 'Choose an available inbox status.', 400);
    }
    return this.store.command(context, outcomeId, operation, normalized, this.#hash(context, input));
  }
}
