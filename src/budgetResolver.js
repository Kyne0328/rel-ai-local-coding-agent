function resolveBudget(baseValue, policy, config) {
  if (!policy || policy.sessionActive !== true) return baseValue;
  const raw = Number(config?.trustedBudgetMultiplier);
  const multiplier = Number.isFinite(raw) && raw >= 1 && raw <= 10 ? raw : 2;
  return Math.floor(baseValue * multiplier);
}

module.exports = { resolveBudget };
