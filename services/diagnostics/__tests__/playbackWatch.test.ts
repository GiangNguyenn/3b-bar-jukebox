/**
 * Unit tests for PlaybackWatch: the playback timeline, and the single
 * "Playback stopped" alarm raised when the jukebox falls silent.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  PlaybackWatch,
  PLAYBACK_WATCH_CONFIG,
  type PlaybackSample
} from '../playbackWatch'

interface Harness {
  watch: PlaybackWatch
  logs: Array<[string, string]>
  stopped: Array<string | null>
  advance: (ms: number) => void
  now: () => number
}

function createHarness(): Harness {
  let now = 1_000_000
  const logs: Array<[string, string]> = []
  const stopped: Array<string | null> = []
  const watch = new PlaybackWatch({
    log: (level, message) => logs.push([level, message]),
    onStoppedChange: (detail) => stopped.push(detail),
    now: () => now
  })
  return {
    watch,
    logs,
    stopped,
    advance: (ms) => {
      now += ms
    },
    now: () => now
  }
}

const DURATION = 200_000

function sample(
  harness: Harness,
  overrides: Partial<PlaybackSample> = {}
): PlaybackSample {
  return {
    status: 'ready',
    trackId: 'track-1',
    trackName: 'Black Betty',
    artist: 'Ram Jam',
    isPlaying: true,
    positionMs: 0,
    durationMs: DURATION,
    stateAt: harness.now(),
    manualPause: false,
    queueLength: 5,
    tab: 'visible',
    ...overrides
  }
}

const STOPPED = PLAYBACK_WATCH_CONFIG.STOPPED_AFTER_MS

void describe('PlaybackWatch', () => {
  void it('logs each track once when it starts', () => {
    const h = createHarness()

    h.watch.observe(sample(h))
    h.advance(5_000)
    h.watch.observe(sample(h, { positionMs: 5_000 }))
    h.advance(5_000)
    h.watch.observe(
      sample(h, { trackId: 'track-2', trackName: 'Free Bird', artist: '' })
    )

    assert.deepEqual(h.logs, [
      ['INFO', 'Track started: "Black Betty" by Ram Jam (3:20)'],
      ['INFO', 'Track started: "Free Bird" (3:20)']
    ])
  })

  void it('says nothing about the brief pause between two tracks', () => {
    const h = createHarness()

    h.watch.observe(sample(h))
    h.advance(DURATION)
    h.watch.observe(sample(h, { isPlaying: false, positionMs: DURATION }))
    h.advance(1_000)
    h.watch.observe(sample(h, { trackId: 'track-2', trackName: 'Free Bird' }))

    assert.equal(h.logs.length, 2)
    assert.deepEqual(h.stopped, [])
  })

  void it('raises one alarm when the next track never starts', () => {
    const h = createHarness()

    h.watch.observe(sample(h))
    h.advance(DURATION)
    const ended = { isPlaying: false, positionMs: DURATION }
    h.watch.observe(sample(h, ended))
    h.advance(5_000)
    h.watch.observe(sample(h, ended))
    assert.deepEqual(h.logs[1], [
      'INFO',
      'Track ended: "Black Betty" by Ram Jam — nothing has started after it yet'
    ])

    h.advance(STOPPED)
    h.watch.observe(sample(h, ended))
    h.advance(STOPPED)
    h.watch.observe(sample(h, ended))

    const errors = h.logs.filter(([level]) => level === 'ERROR')
    assert.equal(errors.length, 1)
    assert.match(errors[0][1], /^Playback stopped: silent for 35s/)
    assert.match(errors[0][1], /the track ended and the next one did not start/)
    assert.match(errors[0][1], /player ready, 5 in queue, tab visible/)
    assert.equal(h.stopped.length, 1)

    h.watch.observe(sample(h, { trackId: 'track-2', trackName: 'Free Bird' }))
    assert.equal(h.stopped[1], null)
    assert.match(
      h.logs[h.logs.length - 2][1],
      /^Playback resumed after 1m 5s of silence/
    )
  })

  void it('names the player error, and where the track had got to, when the player is torn down', () => {
    const h = createHarness()

    h.watch.observe(sample(h, { positionMs: 10_000 }))
    h.advance(50_000)
    const lost = {
      status: 'error',
      lastError: 'Player lost its Spotify connection',
      trackId: undefined,
      isPlaying: false,
      positionMs: 0,
      durationMs: 0,
      tab: 'hidden for 14m 5s'
    }
    h.watch.observe(sample(h, lost))
    h.advance(STOPPED)
    h.watch.observe(sample(h, lost))

    assert.match(
      h.logs[1][1],
      /^Playback paused: "Black Betty" by Ram Jam at 1:00 of 3:20/
    )
    const error = h.logs.find(([level]) => level === 'ERROR')
    assert.ok(error)
    assert.match(
      error[1],
      /the player is 'error' \(Player lost its Spotify connection\)/
    )
    assert.match(error[1], /tab hidden for 14m 5s/)
  })

  void it('notices a track that should have ended when the SDK goes quiet', () => {
    const h = createHarness()

    const started = sample(h)
    h.watch.observe(started)
    // The store still says "playing" long after the track's end
    h.advance(DURATION + PLAYBACK_WATCH_CONFIG.OVERRUN_GRACE_MS + 1_000)
    h.watch.observe(started)
    assert.deepEqual(h.stopped, [])
    h.advance(STOPPED)
    h.watch.observe(started)

    const error = h.logs.find(([level]) => level === 'ERROR')
    assert.ok(error)
    assert.match(
      error[1],
      /the Spotify SDK has sent no event since the track should have ended/
    )
    assert.equal(h.stopped.length, 1)
  })

  void it('treats a pause from the jukebox as intended silence', () => {
    const h = createHarness()

    h.watch.observe(sample(h))
    h.advance(20_000)
    const paused = { isPlaying: false, positionMs: 20_000, manualPause: true }
    h.watch.observe(sample(h, paused))
    h.advance(STOPPED * 4)
    h.watch.observe(sample(h, paused))

    assert.deepEqual(h.logs[1], [
      'INFO',
      'Playback paused from the jukebox: "Black Betty" by Ram Jam at 0:20'
    ])
    assert.equal(h.logs.length, 2)
    assert.deepEqual(h.stopped, [])
  })

  void it('stays quiet before anything has played', () => {
    const h = createHarness()

    const idle = { isPlaying: false, trackId: undefined }
    h.watch.observe(sample(h, idle))
    h.advance(STOPPED * 4)
    h.watch.observe(sample(h, idle))

    assert.deepEqual(h.logs, [])
    assert.deepEqual(h.stopped, [])
  })
})
