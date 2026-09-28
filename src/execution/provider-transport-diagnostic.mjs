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
  const transportFailureClass = failureDiagnostic?.provider === 'deepseek'
    ? allowlistedProviderTransportFailureClass(failureDiagnostic.transportFailureClass) : null;
  if (transportFailureClass) {
    result.provider = 'deepseek';
    result.transportFailureClass = transportFailureClass;
  }
  return result;
}
