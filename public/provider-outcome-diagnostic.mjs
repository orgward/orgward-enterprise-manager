export function deepSeekOutcomeDiagnostic(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.provider !== 'deepseek') return null;
  const httpStatus = Number.isInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599 ? value.httpStatus : null;
  const parserFailureClass = ['invalid_json', 'body_too_large', 'incomplete_response', 'missing_output_text', 'output_too_large'].includes(value.parserFailureClass)
    ? value.parserFailureClass : null;
  const transportFailureClass = ['dns_resolution_failed', 'connection_refused', 'connection_reset', 'transport_timeout'].includes(value.transportFailureClass)
    ? value.transportFailureClass : null;
  if (httpStatus === null && parserFailureClass === null && transportFailureClass === null) return null;
  return { provider: 'deepseek', ...(httpStatus === null ? {} : { httpStatus }), ...(parserFailureClass === null ? {} : { parserFailureClass }),
    ...(transportFailureClass === null ? {} : { transportFailureClass }) };
}

export function deepSeekOutcomeDiagnosticCopy(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)
    && value.outcome === 'outcome_unknown') {
    const diagnostic = deepSeekOutcomeDiagnostic(value);
    const parserLabel = diagnostic && ({
      invalid_json: 'response parsing failed (invalid JSON)',
      body_too_large: 'response body exceeded the size limit',
      incomplete_response: 'response was incomplete',
      missing_output_text: 'response was missing output text',
      output_too_large: 'output exceeded the size limit',
    }[diagnostic.parserFailureClass]);
    const transportLabel = diagnostic && ({
      dns_resolution_failed: 'hostname lookup failed',
      connection_refused: 'connection was refused',
      connection_reset: 'connection was reset',
      transport_timeout: 'request timed out',
    }[diagnostic.transportFailureClass]);
    const safeDetails = diagnostic ? [
      diagnostic.httpStatus === undefined ? null : `DeepSeek returned HTTP ${diagnostic.httpStatus}`,
      parserLabel,
      transportLabel === undefined ? null : `DeepSeek ${transportLabel}`,
    ].filter(Boolean).join('; ') : '';
    return `Outcome unknown.${safeDetails ? ` ${safeDetails}.` : ''} An external request may have been received. Delivery is unverified. Reconcile with the provider before retrying.`;
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
  const transportLabel = {
    dns_resolution_failed: 'hostname lookup failed',
    connection_refused: 'connection was refused',
    connection_reset: 'connection was reset',
    transport_timeout: 'request timed out',
  }[diagnostic.transportFailureClass];
  const cause = [
    diagnostic.httpStatus === undefined ? null : `DeepSeek returned HTTP ${diagnostic.httpStatus}`,
    parserLabel === undefined ? null : `response parsing failed (${parserLabel})`,
    transportLabel === undefined ? null : `DeepSeek ${transportLabel}`,
  ].filter(Boolean).join('; ');
  return `${cause}. Delivery remains unverified; this run cannot be retried.`;
}
