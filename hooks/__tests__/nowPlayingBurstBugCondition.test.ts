/**
 * Bug Condition Exploration Test — Stale Song Detection After Tab Backgrounding
 *
 * **Validates: Requirements 1.1, 1.2, 1.3**
 *
 * These tests surface the bug condition BEFORE implementing the fix.
 * They are EXPECTED TO FAIL on unfixed code, confirming the bug exists.
 *
 * Bug Condition (C):
 *   tabWasBackgrounded = true
 *   AND songChangedWhileBackgrounded = true
 *   AND timeSinceVisibilityRestore <= fallbackInterval (30s default)
 *
 * Expected counterexamples:
 *   - After visibility restore with stale re-fetch, hook does not poll again for 30s
 *   - No burst polling mechanism exists — only a single fetchFromTable fires on visibility change
 *   - useTriviaGame does not pass fallbackInterval to useNowPlayingRealtime (relies on 30s default)
 */

import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import fc from 'fast-check'

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Read a source file relative to project root */
function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf-8')
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('Bug Condition: Stale Song Detection After Tab Backgrounding', () => {
  /**
   * Test 1: useNowPlayingRealtime has NO burst polling refs
   *
   * The bug: after visibility restore, the hook calls fetchFromTable() once
   * and resubscribes to Realtime. If the single re-fetch returns stale data
   * (race condition with DB write), there is no accelerated polling burst
   * to retry sooner. The next poll is 30s away.
   *
   * We verify this by checking that the hook source has no burstIntervalRef
   * or burstTimeoutRef — confirming no burst mechanism exists.
   *
   * EXPECTED: This test should FAIL on unfixed code because burst refs
   * do not exist — confirming the bug.
   */
  test('useNowPlayingRealtime should have burstIntervalRef for accelerated polling after visibility restore', () => {
    const hookSource = readSource('hooks/useNowPlayingRealtime.ts')

    // BUG CONDITION: The hook should have a burstIntervalRef to manage
    // accelerated polling after visibility restore. Without it, a stale
    // re-fetch on visibility change leaves the user waiting up to 30s.
    assert.ok(
      hookSource.includes('burstIntervalRef'),
      'useNowPlayingRealtime should declare burstIntervalRef — ' +
        'Counterexample: After visibility restore, if fetchFromTable() returns stale data ' +
        '(race condition), the next poll is 30s away. No burst mechanism exists to retry sooner.'
    )
  })

  /**
   * Test 2: useNowPlayingRealtime has NO burst timeout ref
   *
   * The burst mechanism needs a timeout to stop the accelerated polling
   * after a set duration (e.g., 10s) and revert to normal interval.
   * Without burstTimeoutRef, there is no way to manage the burst lifecycle.
   *
   * EXPECTED: This test should FAIL on unfixed code because burstTimeoutRef
   * does not exist — confirming the bug.
   */
  test('useNowPlayingRealtime should have burstTimeoutRef for burst duration management', () => {
    const hookSource = readSource('hooks/useNowPlayingRealtime.ts')

    // BUG CONDITION: The hook should have a burstTimeoutRef to control
    // how long the accelerated polling burst lasts before reverting to
    // the normal fallbackInterval.
    assert.ok(
      hookSource.includes('burstTimeoutRef'),
      'useNowPlayingRealtime should declare burstTimeoutRef — ' +
        'Counterexample: No burst duration management exists. The hook has only intervalRef ' +
        'for the 30s fallback polling. After visibility restore, a single fetchFromTable() fires ' +
        'and then silence for 30s.'
    )
  })

  /**
   * Test 3: handleVisibilityChange should trigger burst polling, not just a single fetch
   *
   * The current handleVisibilityChange only calls fetchFromTable() and subscribe().
   * It should ALSO start an accelerated polling burst (e.g., every 2s for 10s)
   * to catch song changes that the single re-fetch might miss.
   *
   * EXPECTED: This test should FAIL on unfixed code because the visibility
   * handler has no burst polling logic — confirming the bug.
   */
  test('handleVisibilityChange should start burst polling on visibility restore', () => {
    const hookSource = readSource('hooks/useNowPlayingRealtime.ts')

    // Find the handleVisibilityChange function body
    const visHandlerMatch = hookSource.match(
      /const handleVisibilityChange\s*=\s*\(\)\s*=>\s*\{([\s\S]*?)\n\s{4}\}/
    )
    assert.ok(
      visHandlerMatch,
      'handleVisibilityChange should exist in the hook source'
    )

    const handlerBody = visHandlerMatch[1]

    // BUG CONDITION: The handler should reference burstIntervalRef to start
    // accelerated polling. Currently it only calls fetchFromTable() and subscribe().
    assert.ok(
      handlerBody.includes('burstIntervalRef') || handlerBody.includes('burst'),
      'handleVisibilityChange should start burst polling on visibility restore — ' +
        'Counterexample: The handler only calls fetchFromTable() once and subscribe(). ' +
        'If the single fetch races with the DB write and returns stale data, the user ' +
        'sees the old trivia question for up to 30 seconds until the next fallback poll fires.'
    )
  })

  /**
   * Test 4: useTriviaGame should pass a shorter fallbackInterval to useNowPlayingRealtime
   *
   * The game page calls useNowPlayingRealtime({ profileId }) without passing
   * fallbackInterval, relying on the 30s default. For trivia gameplay, this is
   * too slow — a 5s interval would reduce the worst-case detection gap.
   *
   * EXPECTED: This test should FAIL on unfixed code because useTriviaGame
   * does not pass fallbackInterval — confirming the bug.
   */
  test('useTriviaGame should pass fallbackInterval to useNowPlayingRealtime', () => {
    const triviaSource = readSource('hooks/trivia/useTriviaGame.ts')

    // Find the useNowPlayingRealtime call in useTriviaGame
    const callMatch = triviaSource.match(
      /useNowPlayingRealtime\(\s*\{([^}]*)\}\s*\)/
    )
    assert.ok(callMatch, 'useTriviaGame should call useNowPlayingRealtime')

    const callArgs = callMatch[1]

    // BUG CONDITION: The call should include fallbackInterval with a value
    // shorter than the 30s default. Currently it only passes { profileId }.
    assert.ok(
      callArgs.includes('fallbackInterval'),
      'useTriviaGame should pass fallbackInterval to useNowPlayingRealtime — ' +
        'Counterexample: useTriviaGame calls useNowPlayingRealtime({ profileId }) without ' +
        'passing fallbackInterval, relying on the 30s default. For trivia gameplay where ' +
        'song changes must be detected quickly, 30s is far too slow.'
    )
  })

  /**
   * Test 5 (PBT): For any backgrounding scenario with a song change,
   * the unfixed hook has no mechanism to detect the change within 5s
   *
   * Property: For all inputs where tabWasBackgrounded AND songChangedWhileBackgrounded,
   * the hook should have burst polling that fires within 5s of visibility restore.
   * On unfixed code, this property fails because no burst mechanism exists.
   *
   * EXPECTED: This test should FAIL on unfixed code — confirming the bug.
   */
  test('Property: burst polling should exist for all backgrounding scenarios with song changes', () => {
    const hookSource = readSource('hooks/useNowPlayingRealtime.ts')

    // Check structural properties that must hold for the fix
    const hasBurstInterval = hookSource.includes('burstIntervalRef')
    const hasBurstTimeout = hookSource.includes('burstTimeoutRef')
    const hasBurstCleanup =
      hookSource.includes('clearInterval(burstIntervalRef') ||
      hookSource.includes('burstIntervalRef.current')

    fc.assert(
      fc.property(
        fc.record({
          tabWasBackgrounded: fc.constant(true),
          songChangedWhileBackgrounded: fc.constant(true),
          secondsSinceVisibilityRestore: fc.integer({ min: 0, max: 10 }),
          staleReFetchOccurred: fc.boolean()
        }),
        (input) => {
          // For ANY scenario where the tab was backgrounded and a song changed,
          // the hook must have burst polling infrastructure to detect the change
          // within a few seconds of visibility restore.
          assert.ok(
            hasBurstInterval && hasBurstTimeout,
            `Burst polling infrastructure missing for scenario: ` +
              `visibility restored ${input.secondsSinceVisibilityRestore}s ago, ` +
              `stale re-fetch: ${input.staleReFetchOccurred} — ` +
              'Counterexample: No burstIntervalRef or burstTimeoutRef exists. ' +
              'After visibility restore, only a single fetchFromTable() fires. ' +
              'If it returns stale data, the next poll is 30s away.'
          )

          // The burst cleanup must also exist to prevent timer leaks
          assert.ok(
            hasBurstCleanup,
            'Burst polling cleanup missing — burst timers would leak on unmount'
          )
        }
      ),
      { numRuns: 50 }
    )
  })
})
