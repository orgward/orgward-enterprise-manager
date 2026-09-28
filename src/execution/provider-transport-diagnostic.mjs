const NODE_TRANSPORT_FAILURE_CLASSES = Object.freeze({
  ENOTFOUND: 'dns_resolution_failed',
  EAI_AGAIN: 'dns_resolution_failed',
  ECONNREFUSED: 'connection_refused',
  ECONNRESET: 'connection_reset',
  ETIMEDOUT: 'transport_timeout',
  ESOCKETTIMEDOUT: 'transport_timeout',
  ERR_SOCKET_TIMEOUT: 'transport_timeout',
});

export const PROVIDER_TRANSPORT_FAILURE_CLASSES = Object.freeze([
  'dns_resolution_failed', 'connection_refused', 'connection_reset', 'transport_timeout',
]);

export function allowlistedProviderTransportFailureClass(value) {
  return PROVIDER_TRANSPORT_FAILURE_CLASSES.includes(value) ? value : null;
}

export function classifyProviderTransportFailure(error, { timedOut = false } = {}) {
  if (timedOut) return 'transport_timeout';
  const code = typeof error?.code === 'string' ? error.code : null;
  return code ? NODE_TRANSPORT_FAILURE_CLASSES[code] ?? null : null;
}

export function providerOutcomeDiagnosticForAttempt(attemptStatus, failureDiagnostic) {
  if (attemptStatus !== 'outcome_unknown') return null;
  const result = { outcome: 'outcome_unknown' };
  if (failureDiagnostic?.provider !== 'deepseek') return result;
  const httpStatus = Number.isInteger(failureDiagnostic.httpStatus)
    && failureDiagnostic.httpStatus >= 100 && failureDiagnostic.httpStatus <= 599
    ? failureDiagnostic.httpStatus : null;
  const parserFailureClass = [
    'invalid_json', 'body_too_large', 'incomplete_response', 'missing_output_text', 'output_too_large',
  ].includes(failureDiagnostic.parserFailureClass) ? failureDiagnostic.parserFailureClass : null;
  const transportFailureClass = allowlistedProviderTransportFailureClass(failureDiagnostic.transportFailureClass);
  if (httpStatus !== null || parserFailureClass || transportFailureClass) {
    result.provider = 'deepseek';
    if (httpStatus !== null) result.httpStatus = httpStatus;
    if (parserFailureClass) result.parserFailureClass = parserFailureClass;
    if (transportFailureClass) result.transportFailureClass = transportFailureClass;
  }
  return result;
}
