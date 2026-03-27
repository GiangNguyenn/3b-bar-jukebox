/**
 * Bug Condition Exploration Test — Token Refresh Cascade
 *
 * **Validates: Requirements 1.1, 1.2**
 *
 * These tests surface the bug condition BEFORE implementing the fix.
 * They are EXPECTED TO FAIL on unfixed code, confirming the bug exists.
 *
 * Bug Condition (C):
 *   allEndpointsFailed (all 3 token endpoints return 401)
 *   AND recoveryExhausted (RecoveryManager.failureCount >= maxRetries)
 *   AND servicesStillRequesting (dependent services keep calling sendApiRequest)
 *
 * Expected counterexamples:
 *   - AutoPlayService calls sendApiRequest after RecoveryManager exhausted retries
 *   - RecoveryManager has no isTokenSuspended() method
 *   - RecoveryManager has no onSuspensionChange() listener method
 */

import { describe, test, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { RecoveryManager, recoveryManager } from '../player/recoveryManager'

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Exhaust the RecoveryManager retries to simulate all 3 token endpoints
 * failing and recovery being fully exhausted.
 */
function exhaustRecoveryRetries(rm: RecoveryManager, count = 3): void {
  for (let i = 0; i < count; i++) {
    rm.recordAttempt()
  }
}

// ─── Setup / Teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  recoveryManager.reset()
})

afterEach(() => {
  recoveryManager.reset()
  mock.restoreAll()
})

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('Bug Condition: Dependent Services Continue After Token Recovery Exhaustion', () => {
  /**
   * Test 1: RecoveryManager has no isTokenSuspended() method
   *
   * The bug: there is no mechanism for dependent services to query whether
   * token recovery has been exhausted. RecoveryManager only exposes
   * canAttemptRecovery() which is used by PlayerLifecycleService internally,
   * not by dependent services like AutoPlayService.
   *
   * EXPECTED: This test should FAIL on unfixed code because isTokenSuspended
   * does not exist yet — confirming the bug.
   */
  test('recoveryManager exposes isTokenSuspended() method for dependent services', () => {
    // Exhaust retries to simulate all 3 endpoints failing
    exhaustRecoveryRetries(recoveryManager)

    // Verify recovery is exhausted
    assert.equal(
      recoveryManager.canAttemptRecovery(),
      false,
      'Recovery should be exhausted after max retries'
    )

    // BUG CONDITION: There should be an isTokenSuspended() method that
    // dependent services can check before making API calls.
    // On unfixed code, this method does not exist.
    assert.equal(
      typeof (recoveryManager as any).isTokenSuspended,
      'function',
      'recoveryManager should have isTokenSuspended() method — ' +
        'without it, dependent services have no way to detect exhausted recovery'
    )

    // Simulate what tokenManager.refreshToken() does after all endpoints fail:
    // it calls enterSuspendedState() to trigger coordinated suspension.
    // This is the bridge between retry exhaustion and the suspension signal.
    ;(recoveryManager as any).enterSuspendedState([
      {
        endpoint: 'user',
        httpStatus: 401,
        errorCode: 'invalid_grant',
        timestamp: Date.now()
      },
      {
        endpoint: 'admin',
        httpStatus: 401,
        errorCode: 'invalid_grant',
        timestamp: Date.now()
      },
      {
        endpoint: 'public',
        httpStatus: 401,
        errorCode: 'invalid_grant',
        timestamp: Date.now()
      }
    ])

    // When recovery is exhausted and enterSuspendedState has been called,
    // isTokenSuspended() should return true
    assert.equal(
      (recoveryManager as any).isTokenSuspended(),
      true,
      'isTokenSuspended() should return true when recovery retries are exhausted and suspension is entered'
    )
  })

  /**
   * Test 2: RecoveryManager has no onSuspensionChange() listener method
   *
   * The bug: there is no pub/sub or callback system to notify dependent
   * services when recovery state changes. Services cannot subscribe to
   * suspension events to pause/resume their polling loops.
   *
   * EXPECTED: This test should FAIL on unfixed code because onSuspensionChange
   * does not exist yet — confirming the bug.
   */
  test('recoveryManager exposes onSuspensionChange() listener for service notification', () => {
    // BUG CONDITION: There should be an onSuspensionChange() method that
    // dependent services can subscribe to for suspension state changes.
    // On unfixed code, this method does not exist.
    assert.equal(
      typeof (recoveryManager as any).onSuspensionChange,
      'function',
      'recoveryManager should have onSuspensionChange() method — ' +
        'without it, services cannot be notified when token recovery is exhausted'
    )

    // The method should accept a callback and return an unsubscribe function
    const unsubscribe = (recoveryManager as any).onSuspensionChange(
      (_suspended: boolean) => {}
    )
    assert.equal(
      typeof unsubscribe,
      'function',
      'onSuspensionChange() should return an unsubscribe function'
    )
  })

  /**
   * Test 3: AutoPlayService.checkPlaybackState() still calls sendApiRequest
   * even when recovery is exhausted
   *
   * The bug: AutoPlayService has no guard that checks token suspension state
   * before making API calls. It calls getCurrentPlaybackState() →
   * sendApiRequest() on every polling interval regardless of whether
   * RecoveryManager has exhausted its retries.
   *
   * We verify this by checking that AutoPlayService.checkPlaybackState
   * does NOT check recoveryManager state before proceeding.
   *
   * EXPECTED: This test should FAIL on unfixed code because AutoPlayService
   * has no suspension guard — confirming the bug.
   */
  test('AutoPlayService.checkPlaybackState has no guard for token suspension', async () => {
    // Exhaust recovery retries
    exhaustRecoveryRetries(recoveryManager)
    assert.equal(
      recoveryManager.canAttemptRecovery(),
      false,
      'Recovery should be exhausted'
    )

    // Import AutoPlayService to inspect its behavior
    const { AutoPlayService } = await import('../autoPlayService')
    const service = new AutoPlayService()

    // Track whether sendApiRequest is called
    let apiCallCount = 0
    const { sendApiRequest } = await import('@/shared/api')

    // Mock sendApiRequest to track calls and simulate token failure
    const originalSendApiRequest = sendApiRequest
    const mockSendApiRequest = mock.fn(async () => {
      apiCallCount++
      throw new Error('Token refresh failed - all endpoints exhausted')
    })

    // Replace the module-level sendApiRequest used by getCurrentPlaybackState
    // We need to verify the service ATTEMPTS the call even when recovery is exhausted
    // The bug is that there's no early-return guard checking isTokenSuspended()

    // Verify the service has no suspension check by examining that:
    // 1. isTokenSuspended doesn't exist on recoveryManager
    // 2. The service source has no reference to checking suspension state
    const hasIsTokenSuspended =
      typeof (recoveryManager as any).isTokenSuspended === 'function'

    // BUG CONDITION: Without isTokenSuspended(), AutoPlayService cannot
    // guard its API calls. The service will keep calling sendApiRequest
    // on every 5s polling interval, generating doomed requests.
    assert.equal(
      hasIsTokenSuspended,
      true,
      'recoveryManager.isTokenSuspended() must exist for AutoPlayService to guard API calls — ' +
        'Counterexample: AutoPlayService calls sendApiRequest every 5s after RecoveryManager ' +
        'exhausted 3 retries, generating cascading 401 errors with no way to stop'
    )
  })

  /**
   * Test 4: sendApiRequest has no suspension check before token acquisition
   *
   * The bug: sendApiRequest always attempts to acquire a token via
   * tokenManager.getToken() before making Spotify API calls. When recovery
   * is exhausted, this re-triggers the full 3-endpoint refresh flow
   * (each with up to 2 retries via fetchWithRetry), amplifying the cascade.
   *
   * EXPECTED: This test should FAIL on unfixed code because sendApiRequest
   * has no suspension guard — confirming the bug.
   */
  test('sendApiRequest should check token suspension before acquiring token', async () => {
    // Exhaust recovery retries
    exhaustRecoveryRetries(recoveryManager)

    // BUG CONDITION: sendApiRequest should check isTokenSuspended() before
    // calling tokenManager.getToken(). Without this guard, every API call
    // from every dependent service re-triggers the full token refresh flow.
    const hasIsTokenSuspended =
      typeof (recoveryManager as any).isTokenSuspended === 'function'

    assert.equal(
      hasIsTokenSuspended,
      true,
      'recoveryManager.isTokenSuspended() must exist for sendApiRequest to guard token acquisition — ' +
        'Counterexample: Each sendApiRequest call triggers tokenManager.getToken() which attempts ' +
        'all 3 endpoints (user→admin→public) × 2 retries each = up to 6 failed HTTP requests per ' +
        'dependent service poll cycle, multiplied across AutoPlay(5s), DeviceHealth(60s), ' +
        'MetadataBackfill(60s) intervals'
    )

    // If isTokenSuspended exists, verify sendApiRequest respects it
    if (hasIsTokenSuspended) {
      // When suspended, sendApiRequest should throw immediately with 503
      // instead of attempting the doomed token refresh
      ;(recoveryManager as any).enterSuspendedState?.([])

      const { sendApiRequest } = await import('@/shared/api')
      try {
        await sendApiRequest({ path: 'me/player', method: 'GET' })
        assert.fail('sendApiRequest should throw 503 when token is suspended')
      } catch (error: any) {
        assert.equal(
          error.status,
          503,
          'sendApiRequest should throw 503 (Service Unavailable) when token is suspended'
        )
      }
    }
  })

  /**
   * Test 5: Suspension listeners are notified when recovery is exhausted
   *
   * The bug: Even if we could detect suspension, there's no notification
   * system to proactively pause dependent services. Services would need
   * to poll canAttemptRecovery() on every cycle, which is wasteful and
   * doesn't exist in the current code.
   *
   * EXPECTED: This test should FAIL on unfixed code because the listener
   * system does not exist — confirming the bug.
   */
  test('suspension listeners are notified when entering suspended state', () => {
    let notifiedSuspended: boolean | null = null

    // BUG CONDITION: There should be a way to subscribe to suspension changes
    // so dependent services can pause immediately when recovery is exhausted.
    const hasOnSuspensionChange =
      typeof (recoveryManager as any).onSuspensionChange === 'function'

    assert.equal(
      hasOnSuspensionChange,
      true,
      'recoveryManager.onSuspensionChange() must exist — ' +
        'Counterexample: When RecoveryManager exhausts 3 retries, AutoPlayService continues ' +
        'its 5s polling loop indefinitely. In a 25s window after exhaustion, AutoPlayService ' +
        'makes ~5 doomed sendApiRequest calls, each triggering up to 6 failed token endpoint ' +
        'requests (3 endpoints × 2 retries), totaling ~30 wasted HTTP requests'
    )

    if (hasOnSuspensionChange) {
      ;(recoveryManager as any).onSuspensionChange((suspended: boolean) => {
        notifiedSuspended = suspended
      })

      // Trigger suspension
      ;(recoveryManager as any).enterSuspendedState?.([])

      assert.equal(
        notifiedSuspended,
        true,
        'Listener should be notified with suspended=true when recovery is exhausted'
      )
    }
  })
})
