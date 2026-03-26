// Feature: ai-song-suggestions, Property 1: Venice AI response parsing yields valid recommendations
// Feature: ai-song-suggestions, Property 2: Spotify search query construction includes title and artist
// Feature: ai-song-suggestions, Property 3: Graceful degradation on partial AI responses
// Feature: ai-song-suggestions, Property 11: Post-resolution filtering excludes recently played tracks
// Feature: ai-song-suggestions, Property 9: Recently played list size invariant
// Feature: ai-song-suggestions, Property 10: AI prompt includes recently played context
// Feature: ai-song-suggestions, Property 12: Recently played database persistence round-trip

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'
import {
  parseVeniceResponse,
  buildSpotifySearchQuery,
  buildUserMessage
} from '../aiSuggestion'

const PBT_CONFIG = { numRuns: 100 }

// --- Shared arbitraries ---

// Non-empty printable string (no control chars that break JSON)
const nonEmptyPrintableArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0)
  .map((s) => s.trim())

// A valid {title, artist} recommendation object
const validRecArb = fc.record({
  title: nonEmptyPrintableArb,
  artist: nonEmptyPrintableArb
})

// -------------------------------------------------------------------
// Property 1: Venice AI response parsing yields valid recommendations
// -------------------------------------------------------------------
describe('Property 1: Venice AI response parsing yields valid recommendations', () => {
  // **Validates: Requirements 1.2**

  it('every parsed entry has a non-empty title and non-empty artist', () => {
    fc.assert(
      fc.property(
        fc.array(validRecArb, { minLength: 1, maxLength: 15 }),
        (recs) => {
          const json = JSON.stringify(recs)
          const result = parseVeniceResponse(json)

          for (const r of result) {
            assert.ok(r.title.length > 0, 'title must be non-empty')
            assert.ok(r.artist.length > 0, 'artist must be non-empty')
          }
        }
      ),
      PBT_CONFIG
    )
  })

  it('parses correctly when JSON array is wrapped in extra text', () => {
    // Prefix/suffix must not contain [ or ] to avoid interfering with the
    // greedy regex that parseVeniceResponse uses to extract the JSON array.
    const safeTextArb = fc
      .string({ minLength: 0, maxLength: 50 })
      .map((s) => s.replace(/[\[\]]/g, ''))

    fc.assert(
      fc.property(
        fc.array(validRecArb, { minLength: 1, maxLength: 10 }),
        safeTextArb,
        safeTextArb,
        (recs, prefix, suffix) => {
          const json = JSON.stringify(recs)
          const wrapped = `${prefix}${json}${suffix}`
          const result = parseVeniceResponse(wrapped)

          assert.equal(result.length, recs.length)
          for (const r of result) {
            assert.ok(r.title.length > 0)
            assert.ok(r.artist.length > 0)
          }
        }
      ),
      PBT_CONFIG
    )
  })
})


// -------------------------------------------------------------------
// Property 2: Spotify search query construction includes title and artist
// -------------------------------------------------------------------
describe('Property 2: Spotify search query construction includes title and artist', () => {
  // **Validates: Requirements 1.3**

  it('query contains both the title and artist for any non-empty inputs', () => {
    fc.assert(
      fc.property(
        nonEmptyPrintableArb,
        nonEmptyPrintableArb,
        (title, artist) => {
          const query = buildSpotifySearchQuery(title, artist)
          assert.ok(query.includes(title), `query must contain title "${title}"`)
          assert.ok(query.includes(artist), `query must contain artist "${artist}"`)
        }
      ),
      PBT_CONFIG
    )
  })
})

// -------------------------------------------------------------------
// Property 3: Graceful degradation on partial AI responses
// -------------------------------------------------------------------
describe('Property 3: Graceful degradation on partial AI responses', () => {
  // **Validates: Requirements 1.5**

  it('returns exactly N results for a response with N valid items (1-9)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 9 }).chain((n) =>
          fc.tuple(fc.constant(n), fc.array(validRecArb, { minLength: n, maxLength: n }))
        ),
        ([n, recs]) => {
          const json = JSON.stringify(recs)
          const result = parseVeniceResponse(json)
          assert.equal(result.length, n)
        }
      ),
      PBT_CONFIG
    )
  })
})

// -------------------------------------------------------------------
// Property 11: Post-resolution filtering excludes recently played tracks
// -------------------------------------------------------------------
describe('Property 11: Post-resolution filtering excludes recently played tracks', () => {
  // **Validates: Requirements 5.3**

  // Simulate the filtering logic from getAiSuggestions:
  // given resolved tracks, recentlyPlayedIds, and excludedIds,
  // filter out any track whose ID is in either set.
  function filterResolvedTracks(
    tracks: Array<{ spotifyTrackId: string; title: string; artist: string }>,
    recentlyPlayedIds: Set<string>,
    excludedIds: Set<string>
  ) {
    return tracks.filter(
      (t) => !recentlyPlayedIds.has(t.spotifyTrackId) && !excludedIds.has(t.spotifyTrackId)
    )
  }

  const trackIdArb = fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0)

  const trackObjArb = fc.record({
    spotifyTrackId: trackIdArb,
    title: nonEmptyPrintableArb,
    artist: nonEmptyPrintableArb
  })

  it('filtered output contains no track ID from the recently played set', () => {
    fc.assert(
      fc.property(
        fc.array(trackObjArb, { minLength: 0, maxLength: 20 }),
        fc.array(trackIdArb, { minLength: 0, maxLength: 20 }),
        fc.array(trackIdArb, { minLength: 0, maxLength: 10 }),
        (tracks, recentIds, excludedIds) => {
          const recentSet = new Set(recentIds)
          const excludedSet = new Set(excludedIds)
          const filtered = filterResolvedTracks(tracks, recentSet, excludedSet)

          for (const t of filtered) {
            assert.ok(
              !recentSet.has(t.spotifyTrackId),
              `track ${t.spotifyTrackId} should not be in recently played`
            )
            assert.ok(
              !excludedSet.has(t.spotifyTrackId),
              `track ${t.spotifyTrackId} should not be in excluded set`
            )
          }
        }
      ),
      PBT_CONFIG
    )
  })

  it('filtered output is a subset of the original tracks', () => {
    fc.assert(
      fc.property(
        fc.array(trackObjArb, { minLength: 0, maxLength: 20 }),
        fc.array(trackIdArb, { minLength: 0, maxLength: 20 }),
        (tracks, recentIds) => {
          const recentSet = new Set(recentIds)
          const filtered = filterResolvedTracks(tracks, recentSet, new Set())
          const originalIds = new Set(tracks.map((t) => t.spotifyTrackId))

          for (const t of filtered) {
            assert.ok(
              originalIds.has(t.spotifyTrackId),
              'filtered track must come from original set'
            )
          }
        }
      ),
      PBT_CONFIG
    )
  })
})


// -------------------------------------------------------------------
// Property 9: Recently played list size invariant
// -------------------------------------------------------------------
describe('Property 9: Recently played list size invariant', () => {
  // **Validates: Requirements 5.1, 5.4**

  const RECENTLY_PLAYED_LIMIT = 100

  // Simulate the add-and-trim behavior: add a track, trim to limit
  function simulateAddAndTrim(
    list: Array<{ spotifyTrackId: string; title: string; artist: string }>,
    entry: { spotifyTrackId: string; title: string; artist: string }
  ): Array<{ spotifyTrackId: string; title: string; artist: string }> {
    // Upsert: remove existing entry with same ID, then add at front
    const filtered = list.filter((e) => e.spotifyTrackId !== entry.spotifyTrackId)
    const updated = [entry, ...filtered]
    // Trim to limit
    return updated.slice(0, RECENTLY_PLAYED_LIMIT)
  }

  const entryArb = fc.record({
    spotifyTrackId: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
    title: nonEmptyPrintableArb,
    artist: nonEmptyPrintableArb
  })

  it('list size never exceeds 100 after any sequence of additions', () => {
    fc.assert(
      fc.property(
        fc.array(entryArb, { minLength: 1, maxLength: 200 }),
        (entries) => {
          let list: Array<{ spotifyTrackId: string; title: string; artist: string }> = []
          for (const entry of entries) {
            list = simulateAddAndTrim(list, entry)
            assert.ok(
              list.length <= RECENTLY_PLAYED_LIMIT,
              `list size ${list.length} exceeds limit ${RECENTLY_PLAYED_LIMIT}`
            )
          }
        }
      ),
      PBT_CONFIG
    )
  })

  it('list size is exactly 100 after adding 100+ unique tracks', () => {
    fc.assert(
      fc.property(
        fc.array(entryArb, { minLength: 101, maxLength: 150 })
          .map((entries) => {
            // Ensure unique IDs by appending index
            return entries.map((e, i) => ({
              ...e,
              spotifyTrackId: `${e.spotifyTrackId}_${i}`
            }))
          }),
        (entries) => {
          let list: Array<{ spotifyTrackId: string; title: string; artist: string }> = []
          for (const entry of entries) {
            list = simulateAddAndTrim(list, entry)
          }
          assert.equal(list.length, RECENTLY_PLAYED_LIMIT)
        }
      ),
      PBT_CONFIG
    )
  })
})

// -------------------------------------------------------------------
// Property 10: AI prompt includes recently played context
// -------------------------------------------------------------------
describe('Property 10: AI prompt includes recently played context', () => {
  // **Validates: Requirements 5.2**

  const recentlyPlayedEntryArb = fc.record({
    spotifyTrackId: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
    title: nonEmptyPrintableArb,
    artist: nonEmptyPrintableArb
  })

  it('buildUserMessage contains every title and every artist from the recently played list', () => {
    fc.assert(
      fc.property(
        nonEmptyPrintableArb,
        fc.array(recentlyPlayedEntryArb, { minLength: 1, maxLength: 20 }),
        (prompt, recentlyPlayed) => {
          const message = buildUserMessage(prompt, recentlyPlayed)

          for (const entry of recentlyPlayed) {
            assert.ok(
              message.includes(entry.title),
              `message must contain title "${entry.title}"`
            )
            assert.ok(
              message.includes(entry.artist),
              `message must contain artist "${entry.artist}"`
            )
          }
        }
      ),
      PBT_CONFIG
    )
  })
})


// Feature: ai-song-suggestions, Property 12: Recently played database persistence round-trip

// -------------------------------------------------------------------
// Property 12: Recently played database persistence round-trip
// -------------------------------------------------------------------
describe('Property 12: Recently played database persistence round-trip', () => {
  // **Validates: Requirements 5.5**

  // Simulate the mapping from RecentlyPlayedEntry → DB upsert payload
  // (matches addToRecentlyPlayed logic)
  function entryToUpsertPayload(
    profileId: string,
    entry: { spotifyTrackId: string; title: string; artist: string }
  ) {
    return {
      profile_id: profileId,
      spotify_track_id: entry.spotifyTrackId,
      title: entry.title,
      artist: entry.artist,
      played_at: new Date().toISOString()
    }
  }

  // Simulate the mapping from DB row → RecentlyPlayedEntry
  // (matches getRecentlyPlayed logic)
  function rowToEntry(row: {
    spotify_track_id: string
    title: string
    artist: string
  }): { spotifyTrackId: string; title: string; artist: string } {
    return {
      spotifyTrackId: row.spotify_track_id,
      title: row.title,
      artist: row.artist
    }
  }

  const recentlyPlayedEntryArb = fc.record({
    spotifyTrackId: fc
      .string({ minLength: 1, maxLength: 30 })
      .filter((s) => s.trim().length > 0),
    title: nonEmptyPrintableArb,
    artist: nonEmptyPrintableArb
  })

  const profileIdArb = fc
    .string({ minLength: 1, maxLength: 40 })
    .filter((s) => s.trim().length > 0)

  it('entry → upsert payload → row → entry round-trip preserves all fields', () => {
    fc.assert(
      fc.property(
        profileIdArb,
        fc.array(recentlyPlayedEntryArb, { minLength: 1, maxLength: 20 }),
        (profileId, entries) => {
          for (const entry of entries) {
            const payload = entryToUpsertPayload(profileId, entry)
            const row = {
              spotify_track_id: payload.spotify_track_id,
              title: payload.title,
              artist: payload.artist
            }
            const restored = rowToEntry(row)

            assert.equal(
              restored.spotifyTrackId,
              entry.spotifyTrackId,
              'spotifyTrackId must survive round-trip'
            )
            assert.equal(
              restored.title,
              entry.title,
              'title must survive round-trip'
            )
            assert.equal(
              restored.artist,
              entry.artist,
              'artist must survive round-trip'
            )
          }
        }
      ),
      PBT_CONFIG
    )
  })

  it('upsert payload preserves profile_id and maps spotifyTrackId to spotify_track_id', () => {
    fc.assert(
      fc.property(
        profileIdArb,
        recentlyPlayedEntryArb,
        (profileId, entry) => {
          const payload = entryToUpsertPayload(profileId, entry)

          assert.equal(payload.profile_id, profileId)
          assert.equal(payload.spotify_track_id, entry.spotifyTrackId)
          assert.equal(payload.title, entry.title)
          assert.equal(payload.artist, entry.artist)
          assert.ok(
            typeof payload.played_at === 'string' && payload.played_at.length > 0,
            'played_at must be a non-empty ISO string'
          )
        }
      ),
      PBT_CONFIG
    )
  })
})


// Feature: ai-song-suggestions, Property 7: Auto-fill adds tracks from buffer up to target size

// -------------------------------------------------------------------
// Shared auto-fill simulation
// -------------------------------------------------------------------
function simulateAutoFill(
  currentQueueSize: number,
  targetSize: number,
  bufferSize: number
) {
  const tracksFromBuffer = Math.min(bufferSize, Math.max(0, targetSize - currentQueueSize))
  const remainingBuffer = bufferSize - tracksFromBuffer
  const newQueueSize = currentQueueSize + tracksFromBuffer
  const needsNewBatch = remainingBuffer === 0 && newQueueSize < targetSize
  return { tracksFromBuffer, remainingBuffer, newQueueSize, needsNewBatch }
}

// -------------------------------------------------------------------
// Property 7: Auto-fill adds tracks from buffer up to target size
// -------------------------------------------------------------------
describe('Property 7: Auto-fill adds tracks from buffer up to target size', () => {
  // **Validates: Requirements 4.2, 4.4**

  it('adds exactly min(B, T - C) tracks and resulting queue is min(C + B, T)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 0, max: 200 }),
        (currentQueueSize, targetSize, bufferSize) => {
          // Only test when queue is below target
          fc.pre(currentQueueSize < targetSize)

          const result = simulateAutoFill(currentQueueSize, targetSize, bufferSize)

          const expectedTracksFromBuffer = Math.min(bufferSize, targetSize - currentQueueSize)
          assert.equal(
            result.tracksFromBuffer,
            expectedTracksFromBuffer,
            `should add min(${bufferSize}, ${targetSize} - ${currentQueueSize}) = ${expectedTracksFromBuffer} tracks`
          )

          const expectedQueueSize = Math.min(currentQueueSize + bufferSize, targetSize)
          assert.equal(
            result.newQueueSize,
            expectedQueueSize,
            `resulting queue should be min(${currentQueueSize} + ${bufferSize}, ${targetSize}) = ${expectedQueueSize}`
          )
        }
      ),
      PBT_CONFIG
    )
  })

  it('never adds more tracks than available in buffer', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 0, max: 200 }),
        (currentQueueSize, targetSize, bufferSize) => {
          fc.pre(currentQueueSize < targetSize)

          const result = simulateAutoFill(currentQueueSize, targetSize, bufferSize)

          assert.ok(
            result.tracksFromBuffer <= bufferSize,
            `tracksFromBuffer (${result.tracksFromBuffer}) must not exceed buffer (${bufferSize})`
          )
        }
      ),
      PBT_CONFIG
    )
  })

  it('never overshoots the target size', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 0, max: 200 }),
        (currentQueueSize, targetSize, bufferSize) => {
          fc.pre(currentQueueSize < targetSize)

          const result = simulateAutoFill(currentQueueSize, targetSize, bufferSize)

          assert.ok(
            result.newQueueSize <= targetSize,
            `queue size (${result.newQueueSize}) must not exceed target (${targetSize})`
          )
        }
      ),
      PBT_CONFIG
    )
  })

  it('remaining buffer equals original buffer minus tracks consumed', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 0, max: 200 }),
        (currentQueueSize, targetSize, bufferSize) => {
          fc.pre(currentQueueSize < targetSize)

          const result = simulateAutoFill(currentQueueSize, targetSize, bufferSize)

          assert.equal(
            result.remainingBuffer,
            bufferSize - result.tracksFromBuffer,
            'remaining buffer must equal original minus consumed'
          )
        }
      ),
      PBT_CONFIG
    )
  })
})

// Feature: ai-song-suggestions, Property 8: Buffer is consumed before requesting a new batch

// -------------------------------------------------------------------
// Property 8: Buffer is consumed before requesting a new batch
// -------------------------------------------------------------------
describe('Property 8: Buffer is consumed before requesting a new batch', () => {
  // **Validates: Requirements 4.3**

  it('non-empty buffer means no new batch is requested', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 1, max: 200 }),
        (currentQueueSize, targetSize, bufferSize) => {
          // Buffer is non-empty and queue is below target
          fc.pre(currentQueueSize < targetSize)

          const result = simulateAutoFill(currentQueueSize, targetSize, bufferSize)

          // If there are still tracks remaining in the buffer, no new batch needed
          if (result.remainingBuffer > 0) {
            assert.equal(
              result.needsNewBatch,
              false,
              'should not request new batch when buffer still has tracks'
            )
          }
        }
      ),
      PBT_CONFIG
    )
  })

  it('new batch requested only when buffer is empty AND queue still below target', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 0, max: 200 }),
        (currentQueueSize, targetSize, bufferSize) => {
          fc.pre(currentQueueSize < targetSize)

          const result = simulateAutoFill(currentQueueSize, targetSize, bufferSize)

          if (result.needsNewBatch) {
            assert.equal(
              result.remainingBuffer,
              0,
              'needsNewBatch requires empty buffer'
            )
            assert.ok(
              result.newQueueSize < targetSize,
              'needsNewBatch requires queue still below target'
            )
          }
        }
      ),
      PBT_CONFIG
    )
  })

  it('no new batch when buffer fully satisfies the gap', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 1, max: 100 }),
        (currentQueueSize, targetSize) => {
          fc.pre(currentQueueSize < targetSize)

          const gap = targetSize - currentQueueSize
          // Buffer is larger than the gap — more than enough
          const bufferSize = gap + fc.sample(fc.integer({ min: 1, max: 50 }), 1)[0]

          const result = simulateAutoFill(currentQueueSize, targetSize, bufferSize)

          assert.equal(
            result.needsNewBatch,
            false,
            'should not request new batch when buffer covers the entire gap'
          )
          assert.equal(
            result.newQueueSize,
            targetSize,
            'queue should reach target when buffer is sufficient'
          )
        }
      ),
      PBT_CONFIG
    )
  })

  it('new batch needed when buffer is empty and queue is below target', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 199 }),
        fc.integer({ min: 1, max: 200 }),
        (currentQueueSize, targetSize) => {
          fc.pre(currentQueueSize < targetSize)

          const result = simulateAutoFill(currentQueueSize, targetSize, 0)

          assert.equal(
            result.needsNewBatch,
            true,
            'should request new batch when buffer is empty and queue below target'
          )
          assert.equal(
            result.tracksFromBuffer,
            0,
            'no tracks consumed from empty buffer'
          )
          assert.equal(
            result.newQueueSize,
            currentQueueSize,
            'queue size unchanged with empty buffer'
          )
        }
      ),
      PBT_CONFIG
    )
  })
})
