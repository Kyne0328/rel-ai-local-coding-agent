import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveBudget } = require('../src/budgetResolver.js');

// 1. No policy = base value
{
  assert.equal(resolveBudget(100, null, { trustedBudgetMultiplier: 5 }), 100);
  console.log('1. null policy: OK');
}

// 2. Session inactive = base value
{
  assert.equal(resolveBudget(100, { sessionActive: false }, { trustedBudgetMultiplier: 5 }), 100);
  console.log('2. session inactive: OK');
}

// 3. Session active with default multiplier (2) = 2x
{
  assert.equal(resolveBudget(100, { sessionActive: true }, {}), 200);
  console.log('3. default multiplier: OK');
}

// 4. Session active with explicit multiplier
{
  assert.equal(resolveBudget(100, { sessionActive: true }, { trustedBudgetMultiplier: 3 }), 300);
  console.log('4. explicit multiplier: OK');
}

// 5. Invalid (NaN) multiplier falls back to 2
{
  assert.equal(resolveBudget(100, { sessionActive: true }, { trustedBudgetMultiplier: 'oops' }), 200);
  console.log('5. NaN falls back to 2: OK');
}

// 6. Out-of-range multiplier (>10) falls back to 2
{
  assert.equal(resolveBudget(100, { sessionActive: true }, { trustedBudgetMultiplier: 50 }), 200);
  console.log('6. >10 falls back to 2: OK');
}

// 7. Out-of-range multiplier (<1) falls back to 2
{
  assert.equal(resolveBudget(100, { sessionActive: true }, { trustedBudgetMultiplier: 0.5 }), 200);
  console.log('7. <1 falls back to 2: OK');
}

// 8. Fractional valid multiplier produces floor result
{
  assert.equal(resolveBudget(100, { sessionActive: true }, { trustedBudgetMultiplier: 2.7 }), 270);
  console.log('8. fractional 2.7: OK');
}

// 9. Config-default integration: normalizeConfig adds trustedBudgetMultiplier=2
{
  const { normalizeConfig } = require('../src/config.js');
  const out = normalizeConfig({});
  assert.equal(out.trustedBudgetMultiplier, 2);
  console.log('9. config default: OK');
}

// 10. Config-normalize clamps invalid value
{
  const { normalizeConfig } = require('../src/config.js');
  const out = normalizeConfig({ trustedBudgetMultiplier: 99 });
  assert.equal(out.trustedBudgetMultiplier, 2);
  console.log('10. normalize clamps: OK');
}

console.log('budget-multiplier unit tests passed.');
