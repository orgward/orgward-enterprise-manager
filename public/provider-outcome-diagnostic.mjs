export function deepSeekOutcomeDiagnostic(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.provider !== 'deepseek') return null;
  const httpStatus = Number.isInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599 ? value.httpStatus : null;
  const parserFailureClass = ['invalid_json', 'body_too_large', 'incomplete_response', 'missing_output_text', 'output_too_large'].includes(value.parserFailureClass)
    ? value.parserFailureClass : null;
  if (httpStatus === null && parserFailureClass === null) return null;
  return { provider: 'deepseek', ...(httpStatus === null ? {} : { httpStatus }), ...(parserFailureClass === null ? {} : { parserFailureClass }) };
}

export function deepSeekOutcomeDiagnosticCopy(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)
    && value.outcome === 'outcome_unknown') {
    return 'Outcome unknown. An external request may have been received. Delivery is unverified. Reconcile with the provider before retrying.';
  }
  const diagnostic = deepSeekOutcomeDiagnostic(value);
  if (!diagnostic) return null;
  const parserLabel = {
    invalid_json: 'invalid JSON',
    body_too_large: 'response body exceeded the size limit',
    incomplete_response: 'incomplete response',
    missing_output_text: 'missing output text',
    output_too_large: 'output exceeded the size limit',
  }[diagnostic.parserFailureClass];
  const cause = [
    diagnostic.httpStatus === undefined ? null : `DeepSeek returned HTTP ${diagnostic.httpStatus}`,
    parserLabel === undefined ? null : `response parsing failed (${parserLabel})`,
  ].filter(Boolean).join('; ');
  return `${cause}. Delivery remains unverified; this run cannot be retried.`;
}
