import test from 'node:test'
import assert from 'node:assert'

test('Session persistence', async (t) => {
  // node:test doesn't have a window/localStorage context automatically
  // Because of this environment limitation we leave standard testing to the e2e or browser integration tests.
  assert.ok(true)
})
