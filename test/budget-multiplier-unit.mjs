import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveBudget } = require('../src/budgetResolver.js');
const { normalizeConfig } = require('../src/config.js');

assert.equal(resolveBudget(100, null, { trustedBudgetMultiplier: 5 }), 100);
console.log('1. null policy: OK');

assert.equal(resolveBudget(100, { sessionActive: false }, { trustedBudgetMultiplier: 5 }), 100);
console.log('2. session inactive: OK');

assert.equal(resolveBudget(100, { sessionActive: true }, {}), 200);
console.log('3. default multiplier: OK');

assert.equal(resolveBudget(100, { sessionActive: true }, { trustedBudgetMultiplier: 3 }), 300);
console.log('4. explicit multiplier: OK');

assert.equal(resolveBudget(100, { sessionActive: true }, { trustedBudgetMultiplier: 'oops' }), 200);
console.log('5. NaN falls back to 2: OK');

assert.equal(resolveBudget(100, { sessionActive: true }, { trustedBudgetMultiplier: 50 }), 200);
console.log('6. >10 falls back to 2: OK');

assert.equal(resolveBudget(100, { sessionActive: true }, { trustedBudgetMultiplier: 0.5 }), 200);
console.log('7. <1 falls back to 2: OK');

assert.equal(resolveBudget(100, { sessionActive: true }, { trustedBudgetMultiplier: 2.7 }), 270);
console.log('8. fractional 2.7: OK');

assert.equal(normalizeConfig({}).trustedBudgetMultiplier, 2);
console.log('9. config default: OK');

assert.equal(normalizeConfig({ trustedBudgetMultiplier: 99 }).trustedBudgetMultiplier, 2);
console.log('10. normalize clamps: OK');

console.log('budget-multiplier unit tests passed.');
