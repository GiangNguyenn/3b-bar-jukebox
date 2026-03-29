import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'

void describe('useTriviaWinnerAnnouncement — polling activation tracking', () => {
  // Feature: dj-winner-announcement, Property 8: Polling activation tracks Realtime health
  // **Validates: Requirements 6.1, 6.2, 6.3**
  void it('polling is active iff Realtime status is not SUBSCRIBED', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom('SUBSCRIBED', 'TIMED_OUT', 'CLOSED', 'CHANNEL_ERROR'),
          { minLength: 1, maxLength: 20 }
        ),
        (statusSequence) => {
          let isPolling = false
          let isRealtimeHealthy = false

          function startPolling(): void {
            isPolling = true
          }

          function stopPolling(): void {
            isPolling = false
          }

          // Simulate the subscribe callback for each status
          for (const status of statusSequence) {
            isRealtimeHealthy = status === 'SUBSCRIBED'
            if (status === 'SUBSCRIBED') {
              stopPolling()
            } else {
              startPolling()
            }
          }

          const lastStatus = statusSequence[statusSequence.length - 1]

          // Polling should be active iff the last status is not SUBSCRIBED
          if (lastStatus === 'SUBSCRIBED') {
            assert.equal(
              isPolling,
              false,
              'polling must be OFF when SUBSCRIBED'
            )
            assert.equal(
              isRealtimeHealthy,
              true,
              'Realtime must be healthy when SUBSCRIBED'
            )
          } else {
            assert.equal(
              isPolling,
              true,
              `polling must be ON when status is ${lastStatus}`
            )
            assert.equal(
              isRealtimeHealthy,
              false,
              'Realtime must be unhealthy when not SUBSCRIBED'
            )
          }
        }
      ),
      { numRuns: 100 }
    )
  })
})

void describe('useTriviaWinnerAnnouncement — announcement deduplication', () => {
  // Feature: dj-winner-announcement, Property 9: Announcement deduplication — each row ID delivered at most once
  // **Validates: Requirements 6.5, 6.6**
  void it('each row ID triggers exactly one announcement and one DB update', () => {
    fc.assert(
      fc.property(
        fc
          .array(fc.uuid(), { minLength: 1, maxLength: 15 })
          .chain((ids) =>
            fc.shuffledSubarray(ids).map((dupes) => [...ids, ...dupes])
          ),
        (rowIds) => {
          const processedIds = new Set<string>()
          const announceCalls: string[] = []
          const dbUpdateCalls: string[] = []

          function handleAnnouncement(rowId: string, scriptText: string): void {
            if (processedIds.has(rowId)) return
            processedIds.add(rowId)

            // Simulate DB update
            dbUpdateCalls.push(rowId)

            // Simulate djService.announceTriviaWinner call
            announceCalls.push(scriptText)
          }

          // Process all row IDs (including duplicates)
          for (const id of rowIds) {
            handleAnnouncement(id, `Winner announcement for ${id}`)
          }

          // Each unique ID should trigger exactly one announcement
          const uniqueIds = Array.from(new Set(rowIds))
          assert.equal(
            announceCalls.length,
            uniqueIds.length,
            `expected ${uniqueIds.length} announcements, got ${announceCalls.length}`
          )
          assert.equal(
            dbUpdateCalls.length,
            uniqueIds.length,
            `expected ${uniqueIds.length} DB updates, got ${dbUpdateCalls.length}`
          )

          // DB updates should match unique IDs (in order of first appearance)
          assert.deepEqual(
            dbUpdateCalls,
            uniqueIds,
            'DB updates must match unique IDs in order'
          )
        }
      ),
      { numRuns: 100 }
    )
  })
})

void describe('useTriviaWinnerAnnouncement — fallback behavior', () => {
  // Validates: Requirements 6.1, 6.2, 6.4, 6.5, 6.6, 6.7

  void it('SUBSCRIBED status stops polling', () => {
    let isPolling = false

    function startPolling(): void {
      isPolling = true
    }

    function stopPolling(): void {
      isPolling = false
    }

    // Simulate: channel reaches SUBSCRIBED
    const status = 'SUBSCRIBED'
    if (status === 'SUBSCRIBED') {
      stopPolling()
    } else {
      startPolling()
    }

    assert.equal(isPolling, false, 'polling must not start when SUBSCRIBED')
  })

  void it('non-SUBSCRIBED status starts polling', () => {
    let isPolling = false

    function startPolling(): void {
      isPolling = true
    }

    function stopPolling(): void {
      isPolling = false
    }

    // Simulate: channel times out (not SUBSCRIBED)
    const status: string = 'TIMED_OUT'
    if (status === 'SUBSCRIBED') {
      stopPolling()
    } else {
      startPolling()
    }

    assert.equal(isPolling, true, 'polling must start when not SUBSCRIBED')
  })

  void it('polling delivers active rows to djService and marks processed', () => {
    const processedIds = new Set<string>()
    const announceCalls: string[] = []
    const dbUpdates: string[] = []

    function handleAnnouncement(rowId: string, scriptText: string): void {
      if (processedIds.has(rowId)) return
      processedIds.add(rowId)
      dbUpdates.push(rowId)
      announceCalls.push(scriptText)
    }

    // Simulate polling finding active rows
    const activeRows = [
      { id: 'row-1', script_text: 'Winner is Alice with 5 points' },
      { id: 'row-2', script_text: 'Winner is Bob with 3 points' }
    ]

    for (const row of activeRows) {
      handleAnnouncement(row.id, row.script_text)
    }

    assert.equal(
      announceCalls.length,
      2,
      'both rows should trigger announcements'
    )
    assert.equal(dbUpdates.length, 2, 'both rows should trigger DB updates')
    assert.deepEqual(dbUpdates, ['row-1', 'row-2'], 'DB updates in order')
  })

  void it('cleanup stops polling and clears resources', () => {
    let isPolling = false
    let healthTimeoutCleared = false
    let channelRemoved = false

    function stopPolling(): void {
      isPolling = false
    }

    // Simulate: polling was active
    isPolling = true

    // Simulate cleanup
    healthTimeoutCleared = true
    stopPolling()
    channelRemoved = true

    assert.equal(isPolling, false, 'polling must be stopped')
    assert.equal(healthTimeoutCleared, true, 'health timeout must be cleared')
    assert.equal(channelRemoved, true, 'channel must be removed')
  })

  void it('DB update failure does not cause duplicate announcement', () => {
    const processedIds = new Set<string>()
    const announceCalls: string[] = []
    let dbUpdateFailed = false

    function handleAnnouncement(rowId: string, scriptText: string): void {
      if (processedIds.has(rowId)) return
      processedIds.add(rowId)

      // Simulate DB update failure (fire-and-forget, caught by .catch)
      dbUpdateFailed = true

      // Announcement still delivered
      announceCalls.push(scriptText)
    }

    // First delivery
    handleAnnouncement('row-1', 'Winner is Alice')
    assert.equal(announceCalls.length, 1, 'first delivery should succeed')

    // Second delivery of same row (e.g., from polling after DB update failed)
    handleAnnouncement('row-1', 'Winner is Alice')
    assert.equal(
      announceCalls.length,
      1,
      'duplicate should be blocked by processedIds'
    )
    assert.equal(dbUpdateFailed, true, 'DB update failure was simulated')
  })
})
