const {test} = require('node:test');
const assert = require('node:assert/strict');
const {checkRuntime} = require('../scripts/check-runtime.cjs');

test('native Windows setup accepts supported x64 LTS builds', () => {
  checkRuntime('v22.12.0', 'x64');
  checkRuntime('v22.23.3', 'x64');
  checkRuntime('v24.0.0', 'x64');
});
test('old, odd-release and 32-bit Node fail before installing native packages', () => {
  for (const version of ['v18.20.0', 'v20.0.0', 'v22.11.0', 'v23.0.0', 'v25.0.0']) {
    assert.throws(() => checkRuntime(version, 'x64'), /Install Node.js/);
  }
  assert.throws(() => checkRuntime('v22.23.3', 'ia32'), /x64 Node.js/);
});
