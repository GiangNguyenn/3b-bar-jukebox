/**
 * Regression test — replacing the realtime channel must not trigger a reconnect
 *
 * removeChannel() reports CLOSED synchronously (phoenix leave() completes at
 * once for a channel it has just marked as leaving). The status handler treats
 * CLOSED on the current channel as a dead channel and schedules a reconnect,
 * so the ref must already be cleared when removeChannel() runs. Otherwise each
 * reconnect schedules the next one and the channel is rebuilt every second.
 */

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(
  resolve(process.cwd(), 'hooks/useNowPlayingRealtime.ts'),
  'utf-8'
)

describe('useNowPlayingRealtime channel replacement', () => {
  test('subscribe() clears channelRef before removing the old channel', () => {
    const subscribeStart = source.indexOf('const subscribe = () => {')
    const channelCreated = source.indexOf('.channel(`now_playing_')
    assert.ok(subscribeStart !== -1 && channelCreated > subscribeStart)

    const teardown = source.slice(subscribeStart, channelCreated)
    const cleared = teardown.indexOf('channelRef.current = null')
    const removed = teardown.indexOf('removeChannel(')
    assert.ok(cleared !== -1, 'subscribe() should clear channelRef')
    assert.ok(removed !== -1, 'subscribe() should remove the old channel')
    assert.ok(
      cleared < removed,
      'channelRef must be cleared before removeChannel(), which reports CLOSED synchronously'
    )
  })

  test('the status handler ignores a channel that has been replaced', () => {
    assert.match(source, /channelRef\.current !== channel\) return/)
  })
})
