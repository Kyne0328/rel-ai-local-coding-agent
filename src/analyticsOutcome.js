const OUTCOME_CLASSES = Object.freeze({
  SUCCESS: 'success',
  OPERATION_FAILURE: 'operation_failure',
  RECOVERABLE_FAILURE: 'recoverable_failure',
  INFRASTRUCTURE_FAILURE: 'infrastructure_failure',
  CANCELLED: 'cancelled'
});

function classifyAnalyticsOutcome(event = {}) {
  if (event.ok === true) return OUTCOME_CLASSES.SUCCESS;

  const operation = String(event.operationName || event.tool || '').trim();
  const code = String(event.errorCode || '').trim().toUpperCase();
  const message = String(event.errorMessage || '').trim().toUpperCase();
  const signal = `${code} ${message}`;

  if (/\b(CANCELLED|CANCELED|CANCEL|ABORTED|ABORT)\b/.test(signal)) return OUTCOME_CLASSES.CANCELLED;

  if (/EDIT_CONTEXT_MISMATCH|INVALID_TASK_STATE|STALE_EXPECTED|CONCURRENT|ALREADY ACTIVE|ALREADY COMPLETED|ALREADY CANCELLED|NO LONGER APPLIES CLEANLY/.test(signal)) {
    return OUTCOME_CLASSES.RECOVERABLE_FAILURE;
  }

  if (operation === 'relai_validate' || operation === 'relai_run_checks') return OUTCOME_CLASSES.OPERATION_FAILURE;

  if (/TASK_ID_REQUIRED|SENSITIVE|PROTECTED|APPROVAL|RESTRICTED|DENIED|UNAUTHORIZED|FORBIDDEN|AUTHORIZATION|AUTHENTICATION|INVALID_(INPUT|ARGUMENT)|SCHEMA|PROTOCOL|WORKSPACE_(REQUIRED|UNKNOWN)|UNKNOWN WORKSPACE|UNSUPPORTED FIELD|UNMATCHED .*\(|INVALID REGEX|REGULAR EXPRESSION|BAD PATTERN/.test(signal)) {
    return OUTCOME_CLASSES.OPERATION_FAILURE;
  }

  return OUTCOME_CLASSES.INFRASTRUCTURE_FAILURE;
}

function reliabilityCountersForOutcome(outcome) {
  if (outcome === OUTCOME_CLASSES.CANCELLED) {
    return { reliabilityCalls: 0, reliableCalls: 0, infrastructureFailures: 0, operationFailures: 0, recoverableFailures: 0, cancellations: 1 };
  }
  if (outcome === OUTCOME_CLASSES.INFRASTRUCTURE_FAILURE) {
    return { reliabilityCalls: 1, reliableCalls: 0, infrastructureFailures: 1, operationFailures: 0, recoverableFailures: 0, cancellations: 0 };
  }
  return {
    reliabilityCalls: 1,
    reliableCalls: 1,
    infrastructureFailures: 0,
    operationFailures: outcome === OUTCOME_CLASSES.OPERATION_FAILURE ? 1 : 0,
    recoverableFailures: outcome === OUTCOME_CLASSES.RECOVERABLE_FAILURE ? 1 : 0,
    cancellations: 0
  };
}

export { OUTCOME_CLASSES, classifyAnalyticsOutcome, reliabilityCountersForOutcome };
