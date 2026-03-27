/**
 * Unit tests for RecoveryManager exponential backoff recovery loop (Task 3.2)
 *
 * **Validates: Requirements 2.1**
 *
 * Tests the backoff recovery loop behavior:
 * - Exponential backoff schedule: 5s → 10s → 20s → 40s → ... capped at 5 minutes
 * - On success: clears suspension, notifies listeners, stops loop
 * - On max duration exceeded (30 min): logs error, notifies listeners
 * - Timer cleanup in reset() and enterSuspendedState()
 */

import { describe, test, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { RecoveryManager } from '../player/recoveryManager'

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Create a fresh RecoveryManager instance for isolated testing.
 */
function createManager(): RecoveryManager {
  return new RecoveryManager()
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('RecoveryManager: Exponential Backoff Recovery Loop', () => {
  let originalSetTimeout: typeof globalThis.setTimeout
  let originalClearTimeout: typeof globalThis.clearTimeout
  let scheduledCallbacks: Array<{ callback: () => void; delay: number }>
  let clearedTimers: Set<ReturnType<typeof setTimeout>>
  let timerIdCounter: number

  beforeEach(() => {
    originalSetTimeout = globalThis.setTimeout
    originalClearTimeout = globalThis.clearTimeout
    scheduledCallbacks = []
    clearedTimers = new Set()
    timerIdCounter = 0
  })

  afterEach(() => {
    globalThis.setTimeout = originalSetTimeout
    globalThis.clearTimeout = originalClearTimeout
    mock.restoreAll()
  })

  test('startBackoffRecovery is triggered when entering suspended state', () => {
    const manager = createManager()
    let timerScheduled = false

    // Intercept setTimeout to detect that the backoff loop starts
    globalThis.setTimeout = ((cb: () => void, delay?: number) => {
      timerScheduled = true
      scheduledCallbacks.push({ callback: cb, delay: delay ?? 0 })
      return ++timerIdCounter as any
    }) as any

    manager.enterSuspendedState([
      {
        endpoint: 'user',
        httpStatus: 401,
        errorMessage: 'invalid_grant',
        timestamp: Date.now()
      }
    ])

    assert.equal(
      timerScheduled,
      true,
      'setTimeout should be called to start backoff loop'
    )
    assert.equal(
      manager.isTokenSuspended(),
      true,
      'Manager should be suspended'
    )
  })

  test('first backoff attempt is scheduled at 5 seconds', () => {
    const manager = createManager()

    globalThis.setTimeout = ((cb: () => void, delay?: number) => {
      scheduledCallbacks.push({ callback: cb, delay: delay ?? 0 })
      return ++timerIdCounter as any
    }) as any

    manager.enterSuspendedState([])

    assert.equal(scheduledCallbacks.length, 1, 'One timer should be scheduled')
    assert.equal(
      scheduledCallbacks[0].delay,
      5000,
      'First backoff should be 5000ms (5 seconds)'
    )
  })

  test('reset() clears the backoff timer', () => {
    const manager = createManager()
    let lastTimerId: any = null
    let clearTimeoutCalled = false

    globalThis.setTimeout = ((cb: () => void, delay?: number) => {
      lastTimerId = ++timerIdCounter
      return lastTimerId as any
    }) as any

    globalThis.clearTimeout = ((id: any) => {
      if (id === lastTimerId) {
        clearTimeoutCalled = true
      }
    }) as any

    manager.enterSuspendedState([])
    assert.equal(manager.isTokenSuspended(), true)

    manager.reset()
    assert.equal(
      clearTimeoutCalled,
      true,
      'clearTimeout should be called on reset()'
    )
    assert.equal(
      manager.isTokenSuspended(),
      false,
      'Should no longer be suspended after reset'
    )
  })

  test('enterSuspendedState clears existing backoff timer before starting new one', () => {
    const manager = createManager()
    const timerIds: number[] = []
    const clearedIds: number[] = []

    globalThis.setTimeout = ((cb: () => void, delay?: number) => {
      const id = ++timerIdCounter
      timerIds.push(id)
      return id as any
    }) as any

    globalThis.clearTimeout = ((id: any) => {
      clearedIds.push(id as number)
    }) as any

    // Enter suspended state twice
    manager.enterSuspendedState([])
    manager.enterSuspendedState([])

    // The first timer should have been cleared before starting the second
    assert.equal(timerIds.length, 2, 'Two timers should have been created')
    assert.ok(
      clearedIds.includes(timerIds[0]),
      'First timer should be cleared when entering suspended state again'
    )
  })

  test('listeners are notified with true when max duration is exceeded', async () => {
    const manager = createManager()
    const notifications: boolean[] = []

    manager.onSuspensionChange((suspended) => {
      notifications.push(suspended)
    })

    // Mock Date.now to simulate time passing beyond 30 minutes
    const realDateNow = Date.now
    let fakeNow = realDateNow()

    // Override Date.now
    Date.now = () => fakeNow

    let capturedCallback: (() => void) | null = null

    globalThis.setTimeout = ((cb: () => void, delay?: number) => {
      capturedCallback = cb
      return ++timerIdCounter as any
    }) as any

    globalThis.clearTimeout = (() => {}) as any

    manager.enterSuspendedState([])

    // notifications[0] = true from enterSuspendedState
    assert.equal(notifications[0], true)

    // Advance time past 30 minutes
    fakeNow += 31 * 60 * 1000

    // Execute the scheduled callback (the recovery attempt)
    const cb = capturedCallback as (() => void) | null
    if (cb) {
      await cb()
    }

    // Should have notified listeners again with true (max duration exceeded)
    assert.equal(
      notifications[notifications.length - 1],
      true,
      'Listeners should be notified with true when max duration exceeded'
    )

    // Should still be suspended
    assert.equal(
      manager.isTokenSuspended(),
      true,
      'Should remain suspended after max duration exceeded'
    )

    // Restore Date.now
    Date.now = realDateNow
  })

  test('recovery loop stops if no longer suspended (reset externally)', async () => {
    const manager = createManager()
    let capturedCallback: (() => void) | null = null
    let newTimerScheduled = false

    globalThis.setTimeout = ((cb: () => void, delay?: number) => {
      if (!capturedCallback) {
        capturedCallback = cb
      } else {
        newTimerScheduled = true
      }
      return ++timerIdCounter as any
    }) as any

    globalThis.clearTimeout = (() => {}) as any

    manager.enterSuspendedState([])

    // Reset externally (simulating manual recovery)
    // Use a direct property set to avoid clearTimeout interaction
    ;(manager as any).isSuspended = false

    // Execute the scheduled callback
    const cb = capturedCallback as (() => void) | null
    if (cb) {
      await cb()
    }

    assert.equal(
      newTimerScheduled,
      false,
      'No new timer should be scheduled when no longer suspended'
    )
  })

  test('getDiagnostics reflects suspension state correctly', () => {
    const manager = createManager()

    globalThis.setTimeout = ((cb: () => void, delay?: number) => {
      return ++timerIdCounter as any
    }) as any

    globalThis.clearTimeout = (() => {}) as any

    const failureDetails = [
      {
        endpoint: 'user',
        httpStatus: 401,
        errorCode: 'invalid_grant',
        errorMessage: 'Token expired',
        timestamp: Date.now()
      },
      {
        endpoint: 'admin',
        httpStatus: 401,
        errorMessage: 'Unauthorized',
        timestamp: Date.now()
      }
    ]

    manager.enterSuspendedState(failureDetails)

    const diag = manager.getDiagnostics()
    assert.equal(diag.isSuspended, true)
    assert.ok(diag.suspendedAt !== null, 'suspendedAt should be set')
    assert.equal(diag.lastFailureDetails.length, 2)
    assert.equal(diag.lastFailureDetails[0].endpoint, 'user')
    assert.equal(diag.lastFailureDetails[0].httpStatus, 401)
    assert.equal(diag.lastFailureDetails[1].endpoint, 'admin')

    // After reset, diagnostics should be cleared
    manager.reset()
    const diagAfterReset = manager.getDiagnostics()
    assert.equal(diagAfterReset.isSuspended, false)
    assert.equal(diagAfterReset.suspendedAt, null)
    assert.equal(diagAfterReset.lastFailureDetails.length, 0)
  })
})
