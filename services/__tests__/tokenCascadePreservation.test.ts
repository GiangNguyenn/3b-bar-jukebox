/**
 * Preservation Property Tests — Token Refresh Cascade Fix
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
 *
 * These tests capture BASELINE behavior on UNFIXED code.
 * They must PASS on unfixed code to establish the behavior that
 * must be preserved after the fix is implemented.
 *
 * Property 2: Preservation — Normal Token and Service Operation Unchanged
 *
 * For all valid token states (not expired, not in recovery):
 *   - getToken() returns cached token without network requests
 *   - fetchWithRetry retries per endpoint before falling through
 *   - onRefresh callbacks fire on successful refresh
 *   - diagnostic output contains all 6 existing top-level fields
 */

import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'
import { RecoveryManager } from '../player/recoveryManager'
import { tokenManager } from '@/shared/token/tokenManager'
import { formatDiagnosticsForClipboard } from '@/app/[username]/admin/components/dashboard/components/diagnostic-utils'
import type { HealthStatus } from '@/shared/types/health'

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Access private fields on the tokenManager singleton for test setup/teardown */
const tmAny = tokenManager as any

/** Save and restore tokenManager internal state between tests */
function resetTokenManager(): void {
  tmAny.tokenCache = { token: null, expiry: 0 }
  tmAny.refreshPromise = null
  tmAny.refreshInProgress = false
}

/**
 * Arbitrary for valid token strings (non-empty alphanumeric).
 */
const arbToken = fc.stringMatching(/^[A-Za-z0-9_-]{10,80}$/)

/**
 * Arbitrary for positive expiry durations in ms (1 minute to 1 hour).
 */
const arbExpiryMs = fc.integer({ min: 60_000, max: 3_600_000 })

/**
 * Arbitrary for a number of onRefresh callbacks to register (1–5).
 */
const arbCallbackCount = fc.integer({ min: 1, max: 5 })

/**
 * Arbitrary for HealthStatus objects representing a healthy system.
 */
function arbHealthyHealthStatus(): fc.Arbitrary<HealthStatus> {
  return fc.record({
    deviceId: fc.option(fc.stringMatching(/^[a-z0-9]{10,20}$/), { nil: null }),
    device: fc.constant('healthy' as const),
    playback: fc.constantFrom('playing' as const, 'paused' as const),
    token: fc.constant('valid' as const),
    tokenExpiringSoon: fc.constant(false),
    connection: fc.constantFrom('connected' as const, 'good' as const),
    recentEvents: fc.constant([]),
    queueState: fc.record({
      queueLength: fc.integer({ min: 0, max: 50 }),
      isEmpty: fc.constant(false),
      hasNextTrack: fc.constant(true)
    }),
    playbackDetails: fc.record({
      isPlaying: fc.boolean(),
      currentTrack: fc.option(
        fc.record({
          id: fc.stringMatching(/^[a-z0-9]{10}$/),
          name: fc.stringMatching(/^[A-Za-z ]{3,30}$/),
          artist: fc.stringMatching(/^[A-Za-z ]{3,30}$/),
          uri: fc.stringMatching(/^spotify:track:[a-z0-9]{10}$/)
        }),
        { nil: undefined }
      ),
      progress: fc.option(fc.integer({ min: 0, max: 300000 }), {
        nil: undefined
      }),
      duration: fc.option(fc.integer({ min: 30000, max: 600000 }), {
        nil: undefined
      })
    }),
    systemInfo: fc.option(
      fc.record({
        userAgent: fc.constant('TestAgent/1.0'),
        platform: fc.constant('test'),
        screenResolution: fc.constant('1920x1080'),
        windowSize: fc.constant('1920x1080'),
        timezone: fc.constant('UTC'),
        connectionType: fc.constant('wifi'),
        appVersion: fc.constant('1.0.0'),
        uptime: fc.integer({ min: 0, max: 86400 })
      }),
      { nil: undefined }
    )
  })
}

/**
 * Arbitrary for console log entries matching the LogEntry shape from ConsoleLogsProvider.
 */
function arbLogEntries() {
  // Generate timestamps as ISO strings directly to avoid Invalid Date issues
  const arbTimestamp = fc
    .integer({ min: 1704067200000, max: 1735689600000 }) // 2024-01-01 to 2025-01-01
    .map((ms) => new Date(ms).toISOString())

  return fc.array(
    fc.record({
      timestamp: arbTimestamp,
      level: fc.constantFrom(
        'WARN' as const,
        'ERROR' as const,
        'INFO' as const
      ),
      message: fc.stringMatching(/^[A-Za-z0-9 ]{5,60}$/),
      context: fc.option(fc.stringMatching(/^[A-Za-z]{3,15}$/), {
        nil: undefined
      })
    }),
    { minLength: 0, maxLength: 10 }
  )
}

// ─── Teardown ────────────────────────────────────────────────────────────────

afterEach(() => {
  resetTokenManager()
})

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('Preservation: Token Caching — getToken() returns cached token without network requests', () => {
  /**
   * **Validates: Requirements 3.1**
   *
   * For all valid token states (not expired, not in recovery):
   * getToken() returns the cached token without making any fetch calls.
   */
  it('getToken() returns cached token when valid, no fetch calls made', async () => {
    await fc.assert(
      fc.asyncProperty(arbToken, arbExpiryMs, async (tokenValue, expiryMs) => {
        // Set up a valid cached token
        tmAny.tokenCache = {
          token: tokenValue,
          expiry: Date.now() + expiryMs
        }

        // Track fetch calls — if getToken uses the cache, no fetch should happen
        let fetchCalled = false
        const originalFetch = globalThis.fetch
        globalThis.fetch = (() => {
          fetchCalled = true
          throw new Error('fetch should not be called when token is cached')
        }) as any

        try {
          const result = await tokenManager.getToken()

          // Property: cached token returned as-is
          assert.equal(
            result,
            tokenValue,
            'getToken() should return the cached token'
          )

          // Property: no network request made
          assert.equal(
            fetchCalled,
            false,
            'No fetch call should be made for a valid cached token'
          )
        } finally {
          globalThis.fetch = originalFetch
          resetTokenManager()
        }
      }),
      { numRuns: 50 }
    )
  })
})

describe('Preservation: fetchWithRetry retries on transient failure then falls through', () => {
  /**
   * **Validates: Requirements 3.2**
   *
   * For all single-transient-failure scenarios: fetchWithRetry retries
   * up to 2 times with backoff per endpoint before falling through,
   * and the token is eventually obtained from a working endpoint.
   */
  it('fetchWithRetry retries on transient error then succeeds on next attempt', async () => {
    // Patch setTimeout to speed up backoff delays in fetchWithRetry
    const originalSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = ((fn: () => void, _delay?: number) => {
      return originalSetTimeout(fn, 0)
    }) as any

    try {
      await fc.assert(
        fc.asyncProperty(
          arbToken,
          fc.integer({ min: 1, max: 2 }),
          async (tokenValue, failCount) => {
            // Clear cache to force a refresh
            resetTokenManager()

            let attemptCount = 0
            const originalFetch = globalThis.fetch
            globalThis.fetch = (async () => {
              attemptCount++
              if (attemptCount <= failCount) {
                // Simulate transient network error (retryable)
                throw new Error('fetch failed: network error')
              }
              // Succeed with a valid token response
              return {
                ok: true,
                json: async () => ({
                  access_token: tokenValue,
                  expires_in: 3600,
                  token_type: 'Bearer'
                })
              } as Response
            }) as any

            try {
              const result = await tokenManager.getToken()

              // Property: token eventually obtained after transient failures
              assert.equal(
                result,
                tokenValue,
                'Token should be obtained after retries'
              )

              // Property: retries happened (more attempts than 1)
              assert.ok(
                attemptCount > failCount,
                `Should have retried: ${attemptCount} attempts for ${failCount} failures`
              )
            } finally {
              globalThis.fetch = originalFetch
              resetTokenManager()
            }
          }
        ),
        { numRuns: 20 }
      )
    } finally {
      globalThis.setTimeout = originalSetTimeout
    }
  })
})

describe('Preservation: onRefresh callbacks fire and RecoveryManager resets on success', () => {
  /**
   * **Validates: Requirements 3.3**
   *
   * For all successful refresh scenarios: every registered onRefresh
   * callback is invoked, and recoveryManager.failureCount resets to 0.
   */
  it('all registered onRefresh callbacks are invoked on successful token refresh', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbToken,
        arbCallbackCount,
        async (tokenValue, cbCount) => {
          // Clear cache to force a refresh
          resetTokenManager()

          // Register N callbacks and track invocations
          const invocations: number[] = []
          const unsubscribers: Array<() => void> = []

          for (let i = 0; i < cbCount; i++) {
            const idx = i
            const unsub = tokenManager.onRefresh(() => {
              invocations.push(idx)
            })
            unsubscribers.push(unsub)
          }

          // Mock fetch to return a valid token
          const originalFetch = globalThis.fetch
          globalThis.fetch = (async () => {
            return {
              ok: true,
              json: async () => ({
                access_token: tokenValue,
                expires_in: 3600,
                token_type: 'Bearer'
              })
            } as Response
          }) as any

          try {
            await tokenManager.getToken()

            // Property: every registered callback was invoked exactly once
            assert.equal(
              invocations.length,
              cbCount,
              `All ${cbCount} onRefresh callbacks should be invoked, got ${invocations.length}`
            )

            // Property: each callback index appears exactly once
            const uniqueIndices = new Set(invocations)
            assert.equal(
              uniqueIndices.size,
              cbCount,
              'Each callback should be invoked exactly once'
            )
          } finally {
            globalThis.fetch = originalFetch
            // Clean up callbacks
            for (const unsub of unsubscribers) {
              unsub()
            }
            resetTokenManager()
          }
        }
      ),
      { numRuns: 30 }
    )
  })

  it('RecoveryManager failureCount resets to 0 on recordSuccess()', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), (failureCount) => {
        const rm = new RecoveryManager()

        // Simulate some failures
        for (let i = 0; i < failureCount; i++) {
          rm.recordAttempt()
        }
        assert.ok(rm.getRetryCount() > 0, 'Should have recorded failures')

        // Record success — should reset
        rm.recordSuccess()

        // Property: failureCount resets to 0
        assert.equal(
          rm.getRetryCount(),
          0,
          'failureCount should reset to 0 after recordSuccess()'
        )

        // Property: canAttemptRecovery returns true again
        assert.equal(
          rm.canAttemptRecovery(),
          true,
          'canAttemptRecovery() should return true after reset'
        )
      }),
      { numRuns: 50 }
    )
  })
})

describe('Preservation: Diagnostic output contains all 6 existing top-level fields', () => {
  /**
   * **Validates: Requirements 3.5, 3.6**
   *
   * For all healthy system states: formatDiagnosticsForClipboard output
   * JSON contains all 6 existing top-level fields unchanged:
   * summary, criticalIssues, systemState, details, errorAnalysis, logs
   */
  it('diagnostic output JSON contains all 6 required top-level fields', () => {
    fc.assert(
      fc.property(
        arbHealthyHealthStatus(),
        arbLogEntries(),
        fc.constantFrom('ready', 'initializing', 'reconnecting'),
        (healthStatus, logEntries, playerStatus) => {
          const output = formatDiagnosticsForClipboard(
            healthStatus,
            true, // isReady
            playerStatus,
            'ready', // currentPlayerStatus
            logEntries
          )

          // Property: output is valid JSON
          let parsed: Record<string, unknown>
          try {
            parsed = JSON.parse(output)
          } catch {
            assert.fail('Diagnostic output should be valid JSON')
          }

          // Property: all 6 existing top-level fields are present
          const requiredFields = [
            'summary',
            'criticalIssues',
            'systemState',
            'details',
            'errorAnalysis',
            'logs'
          ]

          for (const field of requiredFields) {
            assert.ok(
              field in parsed,
              `Diagnostic output must contain top-level field "${field}"`
            )
          }

          // Property: each field is a non-null object
          for (const field of requiredFields) {
            assert.ok(
              parsed[field] !== null && typeof parsed[field] === 'object',
              `Field "${field}" should be a non-null object`
            )
          }

          // Property: summary contains status and timestamp
          const summary = parsed.summary as Record<string, unknown>
          assert.ok('status' in summary, 'summary should contain status')
          assert.ok('timestamp' in summary, 'summary should contain timestamp')

          // Property: systemState contains tokenStatus
          const systemState = parsed.systemState as Record<string, unknown>
          assert.ok(
            'tokenStatus' in systemState,
            'systemState should contain tokenStatus'
          )

          // Property: errorAnalysis contains errorCounts and repeatedFailures
          const errorAnalysis = parsed.errorAnalysis as Record<string, unknown>
          assert.ok(
            'errorCounts' in errorAnalysis,
            'errorAnalysis should contain errorCounts'
          )
          assert.ok(
            'repeatedFailures' in errorAnalysis,
            'errorAnalysis should contain repeatedFailures'
          )

          // Property: logs contains console field
          const logs = parsed.logs as Record<string, unknown>
          assert.ok('console' in logs, 'logs should contain console field')
        }
      ),
      { numRuns: 50 }
    )
  })
})
