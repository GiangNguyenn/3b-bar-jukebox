import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { JukeboxQueueItem } from '@/shared/types/queue'
import { QueueManager, RECENTLY_REMOVED_TTL_MS } from '@/services/queueManager'
import {
  blockRemovedTrack,
  clearBlockedTracks,
  getBlockedTrackIds,
  getBlockedTracks,
  isTrackBlocked,
  unblockTrack
} from '@/services/removedTrackBlocklist'
import { QueueAutoFiller } from '@/services/autoPlay/QueueAutoFiller'

let counter = 0
function makeItem(spotifyId = `sp${++counter}`): JukeboxQueueItem {
  const id = `q-${spotifyId}-${++counter}`
  return {
    id,
    profile_id: 'profile-1',
    track_id: `t-${id}`,
    votes: 1,
    queued_at: new Date(1_700_000_000_000 + counter).toISOString(),
    tracks: {
      id: `t-${id}`,
      spotify_track_id: spotifyId,
      name: `Song ${spotifyId}`,
      artist: `Artist ${spotifyId}`,
      album: 'Album',
      duration_ms: 1000,
      popularity: 50,
      spotify_url: `spotify:track:${spotifyId}`,
      genre: null,
      release_year: null,
      created_at: new Date().toISOString()
    }
  } as unknown as JukeboxQueueItem
}

const realFetch = globalThis.fetch
const realNow = Date.now

afterEach(() => {
  globalThis.fetch = realFetch
  Date.now = realNow
  clearBlockedTracks()
})

void describe('QueueManager.removeFromQueue (tombstones)', () => {
  let manager: QueueManager
  beforeEach(() => {
    manager = QueueManager.getInstance()
  })

  void it('keeps a removed row hidden from stale refreshes after the DELETE succeeds', async () => {
    const keep = makeItem()
    const gone = makeItem()
    manager.updateQueue([keep, gone])

    globalThis.fetch = (() =>
      Promise.resolve(new Response(null, { status: 200 }))) as typeof fetch
    await manager.removeFromQueue(gone, 0)

    // A fetch that started before the DELETE committed still contains the row
    manager.updateQueue([keep, gone])
    assert.deepEqual(
      manager.getQueue().map((i) => i.id),
      [keep.id]
    )
  })

  void it('hides the row while the DELETE is still in flight', async () => {
    const keep = makeItem()
    const gone = makeItem()
    manager.updateQueue([keep, gone])

    let release: () => void = () => {}
    globalThis.fetch = (() =>
      new Promise<Response>((resolve) => {
        release = () => resolve(new Response(null, { status: 200 }))
      })) as typeof fetch

    const pending = manager.removeFromQueue(gone, 0)
    manager.updateQueue([keep, gone])
    assert.deepEqual(
      manager.getQueue().map((i) => i.id),
      [keep.id]
    )
    release()
    await pending
  })

  void it('handles several rapid removals independently', async () => {
    const items = [makeItem(), makeItem(), makeItem(), makeItem()]
    manager.updateQueue(items)
    globalThis.fetch = (() =>
      Promise.resolve(new Response(null, { status: 200 }))) as typeof fetch

    await Promise.all([
      manager.removeFromQueue(items[0], 0),
      manager.removeFromQueue(items[1], 0),
      manager.removeFromQueue(items[2], 0)
    ])

    manager.updateQueue(items) // stale snapshot with all four
    assert.deepEqual(
      manager.getQueue().map((i) => i.id),
      [items[3].id]
    )
  })

  void it('treats a 404 as already removed', async () => {
    const gone = makeItem()
    manager.updateQueue([gone])
    globalThis.fetch = (() =>
      Promise.resolve(new Response(null, { status: 404 }))) as typeof fetch
    await manager.removeFromQueue(gone, 0)
    manager.updateQueue([gone])
    assert.equal(manager.getQueue().length, 0)
  })

  void it('forgets the tombstone after the TTL', async () => {
    const item = makeItem()
    manager.updateQueue([item])
    globalThis.fetch = (() =>
      Promise.resolve(new Response(null, { status: 200 }))) as typeof fetch

    const start = realNow()
    Date.now = () => start
    await manager.removeFromQueue(item, 0)

    Date.now = () => start + RECENTLY_REMOVED_TTL_MS + 1
    manager.updateQueue([item])
    assert.equal(manager.getQueue().length, 1)
  })

  void it('restores the row and throws when the DELETE fails, without a tombstone', async () => {
    const item = makeItem()
    manager.updateQueue([item])
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'db down' }), { status: 500 })
      )) as typeof fetch

    await assert.rejects(manager.removeFromQueue(item, 0), /db down/)
    assert.equal(
      manager.getQueue().some((i) => i.id === item.id),
      true
    )

    // and a later refresh still shows it
    manager.updateQueue([item])
    assert.equal(manager.getQueue().length, 1)
  })
})

void describe('removedTrackBlocklist', () => {
  void it('records, dedupes and unblocks tracks', () => {
    blockRemovedTrack({ id: 'a', title: 'A', artist: 'X' })
    blockRemovedTrack({ id: 'b', title: 'B', artist: 'Y' })
    blockRemovedTrack({ id: 'a', title: 'A', artist: 'X' })
    assert.deepEqual(getBlockedTrackIds(), ['b', 'a'])
    assert.equal(isTrackBlocked('a'), true)

    unblockTrack('a')
    assert.equal(isTrackBlocked('a'), false)
    assert.deepEqual(getBlockedTrackIds(), ['b'])
  })

  void it('caps the number of remembered tracks, keeping the newest', () => {
    for (let i = 0; i < 250; i++) {
      blockRemovedTrack({ id: `id${i}`, title: `T${i}`, artist: 'A' })
    }
    const ids = getBlockedTrackIds()
    assert.equal(ids.length, 200)
    assert.equal(ids[ids.length - 1], 'id249')
    assert.equal(isTrackBlocked('id0'), false)
    assert.equal(getBlockedTracks(5).length, 5)
  })

  void it('persists to sessionStorage when available', () => {
    const store = new Map<string, string>()
    ;(globalThis as { sessionStorage?: unknown }).sessionStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k)
    }
    try {
      blockRemovedTrack({ id: 'z', title: 'Z', artist: 'Q' })
      const saved = Array.from(store.values()).join('')
      assert.ok(saved.includes('"id":"z"'))
    } finally {
      delete (globalThis as { sessionStorage?: unknown }).sessionStorage
    }
  })
})

void describe('QueueAutoFiller honours removed (blocked) tracks', () => {
  function makeFiller(): QueueAutoFiller {
    const filler = new QueueAutoFiller(QueueManager.getInstance())
    filler.setUsername('venue')
    return filler
  }

  void it('sends blocked IDs to the random-track fallback', async () => {
    blockRemovedTrack({ id: 'blockedFallback', title: 'B', artist: 'A' })
    let body: { excludedTrackIds?: string[] } = {}
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      if (String(url).includes('/api/random-track')) {
        body = JSON.parse(init?.body as string)
      }
      return Promise.resolve(new Response('{}', { status: 404 }))
    }) as typeof fetch

    await (
      makeFiller() as unknown as { fallback: () => Promise<boolean> }
    ).fallback()
    assert.ok(body.excludedTrackIds?.includes('blockedFallback'))
  })

  void it('sends blocked IDs and titles to the AI suggestion request', async () => {
    blockRemovedTrack({
      id: 'blockedAi',
      title: 'Blocked Song',
      artist: 'Band'
    })
    let body: {
      excludedTrackIds?: string[]
      queuedTracks?: Array<{ title: string; artist: string }>
    } = {}
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      if (String(url).includes('/api/ai-suggestions')) {
        body = JSON.parse(init?.body as string)
      }
      return Promise.resolve(new Response('{}', { status: 500 }))
    }) as typeof fetch

    const filler = makeFiller()
    filler.setActivePrompt('anything')
    await (filler as unknown as { fill: () => Promise<number> }).fill()

    assert.ok(body.excludedTrackIds?.includes('blockedAi'))
    assert.ok(
      body.queuedTracks?.some(
        (t) => t.title === 'Blocked Song' && t.artist === 'Band'
      )
    )
  })
})
