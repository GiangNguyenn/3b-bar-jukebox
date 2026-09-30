/**
 * Unit tests for RemoteLogShipper: what gets uploaded, when, and what
 * happens to it when the upload fails.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  RemoteLogShipper,
  redact,
  trimSnapshotData,
  type RemoteLogEntry
} from '../remoteLogShipper'

interface SentBody {
  sessionId: string
  appVersion: string
  logs?: RemoteLogEntry[]
  snapshot?: { trigger: string; data: unknown }
  heartbeat?: { state: Record<string, unknown> }
}

function createFetch(statuses: Array<number | 'throw'> = []): {
  fetchFn: typeof fetch
  bodies: SentBody[]
} {
  const bodies: SentBody[] = []
  let call = 0
  const fetchFn = ((_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(init?.body as string) as SentBody)
    const status = statuses[call++] ?? 204
    if (status === 'throw') {
      return Promise.reject(new TypeError('Failed to fetch'))
    }
    return Promise.resolve(new Response(null, { status }))
  }) as typeof fetch
  return { fetchFn, bodies }
}

function createStorage(): {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  data: Map<string, string>
} {
  const data = new Map<string, string>()
  return {
    data,
    storage: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value)
      },
      removeItem: (key) => {
        data.delete(key)
      }
    }
  }
}

function createShipper(
  fetchFn: typeof fetch,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = null
): RemoteLogShipper {
  return new RemoteLogShipper({
    fetchFn,
    storage,
    autoFlush: false,
    sessionId: '11111111-1111-4111-8111-111111111111',
    appVersion: 'test'
  })
}

void describe('RemoteLogShipper', () => {
  void it('uploads WARN and ERROR lines but holds INFO back', async () => {
    const { fetchFn, bodies } = createFetch()
    const shipper = createShipper(fetchFn)
    shipper.setEnabled(true)

    shipper.enqueue({ level: 'INFO', message: 'track started' })
    shipper.enqueue({ level: 'WARN', message: 'slow response', context: 'Api' })
    shipper.enqueue({ level: 'ERROR', message: 'playback failed' })
    await shipper.flush()

    assert.equal(bodies.length, 1)
    assert.deepEqual(
      bodies[0].logs?.map((log) => log.message),
      ['slow response', 'playback failed']
    )
    assert.equal(bodies[0].logs?.[0].context, 'Api')
    assert.equal(bodies[0].sessionId, '11111111-1111-4111-8111-111111111111')
    assert.deepEqual(shipper.getQueueSizes(), {
      queued: 0,
      recorded: 1,
      snapshots: 0
    })
  })

  void it('uploads the held INFO lines once the recorder is flushed', async () => {
    const { fetchFn, bodies } = createFetch()
    const shipper = createShipper(fetchFn)
    shipper.setEnabled(true)

    shipper.enqueue({ level: 'INFO', message: 'track started' })
    shipper.enqueue({ level: 'ERROR', message: 'playback failed' })
    shipper.flushRecorder()
    await shipper.flush()

    assert.deepEqual(
      bodies[0].logs?.map((log) => log.message),
      ['track started', 'playback failed']
    )
  })

  void it('sends nothing while disabled, then everything once enabled', async () => {
    const { fetchFn, bodies } = createFetch()
    const shipper = createShipper(fetchFn)

    shipper.enqueue({ level: 'ERROR', message: 'early failure' })
    await shipper.flush()
    assert.equal(bodies.length, 0)

    shipper.setEnabled(true)
    await shipper.flush()
    assert.equal(bodies[0].logs?.[0].message, 'early failure')
  })

  void it('collapses consecutive identical lines into a repeat count', async () => {
    const { fetchFn, bodies } = createFetch()
    const shipper = createShipper(fetchFn)
    shipper.setEnabled(true)

    for (let i = 0; i < 4; i++) {
      shipper.enqueue({ level: 'WARN', message: 'retrying', context: 'Api' })
    }
    shipper.enqueue({ level: 'WARN', message: 'gave up', context: 'Api' })
    await shipper.flush()

    assert.deepEqual(
      bodies[0].logs?.map((log) => [log.message, log.repeatCount]),
      [
        ['retrying', 4],
        ['gave up', 1]
      ]
    )
  })

  void it('collapses a repeating line even when other lines are interleaved', async () => {
    const { fetchFn, bodies } = createFetch()
    const shipper = createShipper(fetchFn)
    shipper.setEnabled(true)

    for (let i = 0; i < 5; i++) {
      shipper.enqueue({ level: 'WARN', message: 'closed', context: 'Rt' })
      shipper.enqueue({ level: 'WARN', message: 'reconnecting', context: 'Rt' })
    }
    await shipper.flush()

    assert.deepEqual(
      bodies[0].logs?.map((log) => [log.message, log.repeatCount]),
      [
        ['closed', 5],
        ['reconnecting', 5]
      ]
    )
  })

  void it('uploads a line that keeps repeating once a minute, with a count', async () => {
    const { fetchFn, bodies } = createFetch()
    let now = 1_000_000
    const shipper = new RemoteLogShipper({
      fetchFn,
      storage: null,
      autoFlush: false,
      now: () => now
    })
    shipper.setEnabled(true)

    shipper.enqueue({ level: 'WARN', message: 'closed', context: 'Rt' })
    await shipper.flush()
    assert.equal(bodies.length, 1)

    // Already uploaded: further repeats in the same minute are held back
    for (let i = 0; i < 30; i++) {
      now += 1_000
      shipper.enqueue({ level: 'WARN', message: 'closed', context: 'Rt' })
    }
    await shipper.flush()
    assert.equal(bodies.length, 1)

    // Once the minute is up they go out as a single row
    now += 31_000
    await shipper.flush()
    assert.equal(bodies.length, 2)
    assert.deepEqual(
      bodies[1].logs?.map((log) => [log.message, log.repeatCount]),
      [['closed', 30]]
    )
  })

  void it('uploads INFO lines from the playback timeline as they happen', async () => {
    const { fetchFn, bodies } = createFetch()
    const shipper = createShipper(fetchFn)
    shipper.setEnabled(true)

    shipper.enqueue({
      level: 'INFO',
      context: 'PlaybackTimeline',
      message: 'Track started: "Black Betty"'
    })
    shipper.enqueue({ level: 'INFO', message: 'flagged', upload: true })
    shipper.enqueue({ level: 'INFO', message: 'routine' })
    await shipper.flush()

    assert.deepEqual(
      bodies[0].logs?.map((log) => log.message),
      ['Track started: "Black Betty"', 'flagged']
    )
    assert.equal(shipper.getQueueSizes().recorded, 1)
  })

  void it('sends at most 50 lines per request', async () => {
    const { fetchFn, bodies } = createFetch()
    const shipper = createShipper(fetchFn)
    shipper.setEnabled(true)

    for (let i = 0; i < 120; i++) {
      shipper.enqueue({ level: 'WARN', message: `line ${i}` })
    }
    await shipper.flush()
    await shipper.flush()
    await shipper.flush()

    assert.deepEqual(
      bodies.map((body) => body.logs?.length),
      [50, 50, 20]
    )
  })

  void it('keeps only the newest 500 queued lines', () => {
    const { fetchFn } = createFetch()
    const shipper = createShipper(fetchFn)

    for (let i = 0; i < 650; i++) {
      shipper.enqueue({ level: 'WARN', message: `line ${i}` })
    }

    assert.equal(shipper.getQueueSizes().queued, 500)
  })

  void it('keeps a batch for retry when the upload fails', async () => {
    const { fetchFn, bodies } = createFetch(['throw', 503, 204])
    const shipper = createShipper(fetchFn)
    shipper.setEnabled(true)

    shipper.enqueue({ level: 'ERROR', message: 'first' })
    await shipper.flush()
    shipper.enqueue({ level: 'ERROR', message: 'second' })
    await shipper.flush()
    assert.equal(shipper.getQueueSizes().queued, 2)

    await shipper.flush()
    assert.deepEqual(
      bodies[2].logs?.map((log) => log.message),
      ['first', 'second']
    )
    assert.equal(shipper.getQueueSizes().queued, 0)
  })

  void it('stops uploading after a 401 until re-enabled', async () => {
    const { fetchFn, bodies } = createFetch([401, 204])
    const shipper = createShipper(fetchFn)
    shipper.setEnabled(true)

    shipper.enqueue({ level: 'ERROR', message: 'while signed out' })
    await shipper.flush()
    await shipper.flush()
    assert.equal(bodies.length, 1)
    assert.equal(shipper.getQueueSizes().queued, 1)

    shipper.setEnabled(true)
    await shipper.flush()
    assert.equal(bodies.length, 2)
    assert.equal(shipper.getQueueSizes().queued, 0)
  })

  void it('drops a batch the server rejects as invalid', async () => {
    const { fetchFn } = createFetch([400])
    const shipper = createShipper(fetchFn)
    shipper.setEnabled(true)

    shipper.enqueue({ level: 'ERROR', message: 'malformed' })
    await shipper.flush()

    assert.equal(shipper.getQueueSizes().queued, 0)
  })

  void it('persists unsent lines and restores them on the next page load', async () => {
    const { storage, data } = createStorage()
    const failing = createFetch(['throw'])
    const first = createShipper(failing.fetchFn, storage)
    first.setEnabled(true)
    first.enqueue({ level: 'ERROR', message: 'lost connection' })
    await first.flush()
    assert.equal(data.size, 1)

    const working = createFetch()
    const second = new RemoteLogShipper({
      fetchFn: working.fetchFn,
      storage,
      autoFlush: false,
      sessionId: '22222222-2222-4222-8222-222222222222',
      appVersion: 'test'
    })
    second.setEnabled(true)
    await second.flush()

    const restored = working.bodies[0].logs?.[0]
    assert.equal(restored?.message, 'lost connection')
    // Attributed to the page load that logged it, not the one that sent it
    assert.equal(restored?.sid, '11111111-1111-4111-8111-111111111111')
    assert.equal(data.size, 0)
  })

  void it('sends snapshots and heartbeats', async () => {
    const { fetchFn, bodies } = createFetch()
    const shipper = createShipper(fetchFn)
    shipper.setEnabled(true)

    shipper.queueSnapshot({
      trigger: 'health_error',
      severity: 'error',
      data: { summary: { status: 'error' } }
    })
    shipper.setHeartbeat({ state: { online: true } })
    await shipper.flush()

    assert.equal(bodies[0].snapshot?.trigger, 'health_error')
    assert.deepEqual(bodies[0].heartbeat?.state, { online: true })
    assert.equal(shipper.getQueueSizes().snapshots, 0)
  })

  void it('redacts credentials from messages, errors and details', async () => {
    const { fetchFn, bodies } = createFetch()
    const shipper = createShipper(fetchFn)
    shipper.setEnabled(true)

    shipper.enqueue({
      level: 'ERROR',
      message: 'Request failed with Authorization: Bearer abc.def-123',
      error: new Error('GET /callback?code=secretcode&state=1 failed'),
      details: { url: 'https://x.test/?access_token=supersecret' }
    })
    await shipper.flush()

    const sent = JSON.stringify(bodies[0])
    assert.ok(!sent.includes('abc.def-123'))
    assert.ok(!sent.includes('secretcode'))
    assert.ok(!sent.includes('supersecret'))
    assert.ok(sent.includes('Bearer [redacted]'))
  })

  void it('truncates very long messages', async () => {
    const { fetchFn, bodies } = createFetch()
    const shipper = createShipper(fetchFn)
    shipper.setEnabled(true)

    shipper.enqueue({ level: 'ERROR', message: 'word '.repeat(1000) })
    await shipper.flush()

    assert.ok((bodies[0].logs?.[0].message.length ?? 0) <= 2003)
  })

  void it('notifies listeners of every line, including INFO', () => {
    const { fetchFn } = createFetch()
    const shipper = createShipper(fetchFn)
    const seen: string[] = []
    const unsubscribe = shipper.onEntry((entry) => seen.push(entry.level))

    shipper.enqueue({ level: 'INFO', message: 'a' })
    shipper.enqueue({ level: 'ERROR', message: 'b' })
    unsubscribe()
    shipper.enqueue({ level: 'WARN', message: 'c' })

    assert.deepEqual(seen, ['INFO', 'ERROR'])
  })
})

void describe('redact', () => {
  void it('removes JWTs and long opaque tokens', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop'
    const opaque = 'B'.repeat(120)
    const result = redact(`jwt ${jwt} token ${opaque} done`)
    assert.equal(result, 'jwt [redacted-jwt] token [redacted] done')
  })

  void it('leaves ordinary text alone', () => {
    const text = '[PlaybackHealth] Track 4uLU6hMCjMI75M1A2tKUQC stalled at 93s'
    assert.equal(redact(text), text)
  })
})

void describe('trimSnapshotData', () => {
  void it('returns small snapshots unchanged', () => {
    const data = { summary: { status: 'error' }, logs: { console: ['a'] } }
    assert.deepEqual(trimSnapshotData(data, 10_000), data)
  })

  void it('drops the heaviest sections first when over the limit', () => {
    const data = {
      summary: { status: 'error' },
      logs: { console: Array.from({ length: 200 }, () => 'x'.repeat(50)) },
      systemState: { playerStatus: 'error' }
    }
    const trimmed = trimSnapshotData(data, 1_000) as Record<string, unknown>

    assert.equal(trimmed.truncated, true)
    assert.equal(trimmed.logs, undefined)
    assert.deepEqual(trimmed.summary, { status: 'error' })
    assert.deepEqual(trimmed.systemState, { playerStatus: 'error' })
  })
})
