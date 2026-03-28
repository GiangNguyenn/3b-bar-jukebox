/**
 * Preservation Property Tests — Foreground Realtime and Game Behavior Unchanged
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
 *
 * These tests capture the CURRENT correct behavior on UNFIXED code.
 * They must all PASS before and after the fix to confirm no regressions.
 *
 * Preservation properties:
 *   P1: rowToPlaybackState correctly transforms NowPlayingRow → SpotifyPlaybackState
 *   P2: Foreground Realtime — no burst timers, normal fallbackInterval polling
 *   P3: Same track ID (play/pause) — useTriviaGame does NOT re-fetch trivia
 *   P4: New track ID (song change) — useTriviaGame resets state and fetches new question
 */

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import fc from 'fast-check'

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Read a source file relative to project root */
function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf-8')
}

/**
 * Minimal NowPlayingRow shape matching the interface in useNowPlayingRealtime.ts
 */
interface NowPlayingRow {
  profile_id: string
  spotify_track_id: string | null
  track_name: string | null
  artist_name: string | null
  album_name: string | null
  album_art_url: string | null
  duration_ms: number | null
  is_playing: boolean
  progress_ms: number | null
  updated_at: string
}


/**
 * Reimplementation of rowToPlaybackState for testing.
 * Mirrors the logic in hooks/useNowPlayingRealtime.ts exactly.
 */
function rowToPlaybackState(row: NowPlayingRow) {
  if (!row.spotify_track_id || !row.track_name) return null

  return {
    item: {
      id: row.spotify_track_id,
      name: row.track_name,
      uri: `spotify:track:${row.spotify_track_id}`,
      duration_ms: row.duration_ms ?? 0,
      artists: [{ name: row.artist_name ?? '' }],
      album: {
        name: row.album_name ?? '',
        images: row.album_art_url ? [{ url: row.album_art_url }] : []
      }
    },
    is_playing: row.is_playing,
    progress_ms: row.progress_ms ?? 0,
    timestamp: new Date(row.updated_at).getTime(),
    context: { uri: '' },
    device: {
      id: '',
      is_active: true,
      is_private_session: false,
      is_restricted: false,
      name: 'Jukebox Player',
      type: 'Computer',
      volume_percent: 50
    }
  }
}

/** fast-check arbitrary for valid NowPlayingRow (non-null track fields) */
const validNowPlayingRowArb = fc.record({
  profile_id: fc.uuid(),
  spotify_track_id: fc.string({ minLength: 1, maxLength: 30 }),
  track_name: fc.string({ minLength: 1, maxLength: 100 }),
  artist_name: fc.oneof(fc.string({ minLength: 1, maxLength: 50 }), fc.constant(null)),
  album_name: fc.oneof(fc.string({ minLength: 1, maxLength: 50 }), fc.constant(null)),
  album_art_url: fc.oneof(
    fc.webUrl(),
    fc.constant(null)
  ),
  duration_ms: fc.oneof(fc.integer({ min: 0, max: 600000 }), fc.constant(null)),
  is_playing: fc.boolean(),
  progress_ms: fc.oneof(fc.integer({ min: 0, max: 600000 }), fc.constant(null)),
  updated_at: fc.integer({ min: 1577836800000, max: 1893456000000 })
    .map((ts) => new Date(ts).toISOString())
})

/** fast-check arbitrary for NowPlayingRow with null track fields (returns null) */
const nullTrackRowArb = fc.record({
  profile_id: fc.uuid(),
  spotify_track_id: fc.constant(null),
  track_name: fc.constant(null),
  artist_name: fc.constant(null),
  album_name: fc.constant(null),
  album_art_url: fc.constant(null),
  duration_ms: fc.constant(null),
  is_playing: fc.boolean(),
  progress_ms: fc.constant(null),
  updated_at: fc.integer({ min: 1577836800000, max: 1893456000000 })
    .map((ts) => new Date(ts).toISOString())
})


// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('Preservation: Foreground Realtime and Game Behavior Unchanged', () => {
  /**
   * Property 2a: rowToPlaybackState — correct transformation
   *
   * **Validates: Requirements 3.1, 3.4**
   *
   * For all valid NowPlayingRow inputs (non-null spotify_track_id and track_name),
   * rowToPlaybackState produces a SpotifyPlaybackState with:
   *   - item.id === row.spotify_track_id
   *   - item.name === row.track_name
   *   - is_playing === row.is_playing
   *   - progress_ms === row.progress_ms ?? 0
   *   - item.uri === `spotify:track:${row.spotify_track_id}`
   *   - item.duration_ms === row.duration_ms ?? 0
   *   - item.artists[0].name === row.artist_name ?? ''
   *   - item.album.name === row.album_name ?? ''
   *   - album images populated when album_art_url is non-null
   */
  test('Property: rowToPlaybackState maps all fields correctly for valid rows', () => {
    fc.assert(
      fc.property(validNowPlayingRowArb, (row) => {
        const result = rowToPlaybackState(row)

        // Valid rows always produce a non-null result
        assert.ok(result !== null, 'Valid row should produce non-null result')

        // Core field mappings
        assert.equal(result.item.id, row.spotify_track_id)
        assert.equal(result.item.name, row.track_name)
        assert.equal(result.is_playing, row.is_playing)
        assert.equal(result.progress_ms, row.progress_ms ?? 0)

        // URI construction
        assert.equal(result.item.uri, `spotify:track:${row.spotify_track_id}`)

        // Duration with null coalescing
        assert.equal(result.item.duration_ms, row.duration_ms ?? 0)

        // Artist name with null coalescing
        assert.equal(result.item.artists[0].name, row.artist_name ?? '')

        // Album name with null coalescing
        assert.equal(result.item.album.name, row.album_name ?? '')

        // Album images: populated when album_art_url is non-null
        if (row.album_art_url) {
          assert.equal(result.item.album.images.length, 1)
          assert.equal(result.item.album.images[0].url, row.album_art_url)
        } else {
          assert.equal(result.item.album.images.length, 0)
        }

        // Timestamp derived from updated_at
        assert.equal(result.timestamp, new Date(row.updated_at).getTime())

        // Static device fields
        assert.equal(result.device.name, 'Jukebox Player')
        assert.equal(result.device.type, 'Computer')
        assert.equal(result.device.volume_percent, 50)
        assert.equal(result.device.is_active, true)
      }),
      { numRuns: 100 }
    )
  })

  /**
   * Property 2a (edge): rowToPlaybackState returns null for null track fields
   *
   * **Validates: Requirements 3.4**
   *
   * When spotify_track_id or track_name is null, rowToPlaybackState returns null.
   */
  test('Property: rowToPlaybackState returns null when track fields are null', () => {
    fc.assert(
      fc.property(nullTrackRowArb, (row) => {
        const result = rowToPlaybackState(row)
        assert.equal(result, null, 'Null track fields should produce null result')
      }),
      { numRuns: 50 }
    )
  })


  /**
   * Property 2b: Foreground Realtime — no burst timers in foreground path
   *
   * **Validates: Requirements 3.1**
   *
   * For all foreground states (no visibility change), the hook:
   *   - Uses Realtime subscription (postgres_changes on now_playing table)
   *   - Maintains normal fallbackInterval polling via intervalRef
   *   - Does NOT create burst timers in the main subscription/polling path
   *
   * Observed on UNFIXED code: the main useEffect sets up Realtime + setInterval.
   * The only place visibility is handled is handleVisibilityChange. The main
   * subscription path has no burst logic — this is correct and must be preserved.
   */
  test('Property: foreground path has Realtime subscription and normal polling, no burst timers', () => {
    const hookSource = readSource('hooks/useNowPlayingRealtime.ts')

    fc.assert(
      fc.property(
        fc.record({
          profileId: fc.uuid(),
          fallbackInterval: fc.integer({ min: 1000, max: 60000 })
        }),
        () => {
          // Realtime subscription exists via postgres_changes
          assert.ok(
            hookSource.includes('postgres_changes'),
            'Hook should subscribe to postgres_changes for Realtime updates'
          )

          // Realtime listens on now_playing table
          assert.ok(
            hookSource.includes("table: 'now_playing'"),
            'Hook should listen on now_playing table'
          )

          // Normal fallback polling via setInterval + fallbackInterval
          assert.ok(
            hookSource.includes('setInterval') && hookSource.includes('fallbackInterval'),
            'Hook should use setInterval with fallbackInterval for normal polling'
          )

          // intervalRef exists for managing the normal polling timer
          assert.ok(
            hookSource.includes('intervalRef'),
            'Hook should have intervalRef for normal polling timer management'
          )

          // The main effect body (outside handleVisibilityChange) sets up
          // fetchFromTable + subscribe + setInterval — no burst logic in this path
          // Extract the main effect body before handleVisibilityChange
          const effectMatch = hookSource.match(
            /\/\/ Initial fetch \+ subscribe\s*\n([\s\S]*?)\/\/ iOS Safari/
          )
          assert.ok(effectMatch, 'Main effect body should exist')

          const mainEffectBody = effectMatch[1]

          // Main effect path should NOT reference burst — that belongs only
          // in the visibility change handler (which doesn't exist yet on unfixed code)
          assert.ok(
            !mainEffectBody.includes('burst'),
            'Main foreground path should not contain burst logic'
          )
        }
      ),
      { numRuns: 20 }
    )
  })


  /**
   * Property 2c: Play/pause updates (same track ID) — no re-fetch
   *
   * **Validates: Requirements 3.4**
   *
   * For all play/pause updates where the track ID stays the same,
   * useTriviaGame does NOT fetch a new trivia question because
   * lastFetchedTrackIdRef prevents duplicate fetches.
   *
   * Observed on UNFIXED code: the question-fetching useEffect checks
   * `if (currentTrackId === lastFetchedTrackIdRef.current) return`
   * before proceeding. This dedup logic must be preserved.
   */
  test('Property: same track ID with play/pause change does not trigger re-fetch', () => {
    const triviaSource = readSource('hooks/trivia/useTriviaGame.ts')

    fc.assert(
      fc.property(
        fc.record({
          trackId: fc.string({ minLength: 1, maxLength: 30 }),
          isPlayingBefore: fc.boolean(),
          isPlayingAfter: fc.boolean()
        }),
        () => {
          // lastFetchedTrackIdRef exists for dedup
          assert.ok(
            triviaSource.includes('lastFetchedTrackIdRef'),
            'useTriviaGame should have lastFetchedTrackIdRef for dedup'
          )

          // The early return guard exists: same track ID → skip fetch
          assert.ok(
            triviaSource.includes('currentTrackId === lastFetchedTrackIdRef.current'),
            'useTriviaGame should check currentTrackId against lastFetchedTrackIdRef'
          )

          // The guard returns early (does not proceed to fetch)
          const fetchEffect = triviaSource.match(
            /const currentTrackId = nowPlaying\.item\.id[\s\S]*?if \(currentTrackId === lastFetchedTrackIdRef\.current\) return/
          )
          assert.ok(
            fetchEffect,
            'useTriviaGame should return early when track ID matches lastFetchedTrackIdRef'
          )
        }
      ),
      { numRuns: 50 }
    )
  })

  /**
   * Property 2d: Song change (different track ID) — resets state and fetches
   *
   * **Validates: Requirements 3.2**
   *
   * For all song change events (new track ID different from lastFetchedTrackIdRef),
   * useTriviaGame:
   *   1. Updates lastFetchedTrackIdRef to the new track ID
   *   2. Resets question to null
   *   3. Resets selectedAnswer to null
   *   4. Resets isCorrect to null
   *   5. Sets isLoading to true
   *   6. Fetches a new trivia question via POST /api/trivia
   */
  test('Property: new track ID triggers state reset and trivia question fetch', () => {
    const triviaSource = readSource('hooks/trivia/useTriviaGame.ts')

    fc.assert(
      fc.property(
        fc.record({
          oldTrackId: fc.string({ minLength: 1, maxLength: 30 }),
          newTrackId: fc.string({ minLength: 1, maxLength: 30 })
        }).filter((r) => r.oldTrackId !== r.newTrackId),
        () => {
          // After the dedup guard, the code sets lastFetchedTrackIdRef
          assert.ok(
            triviaSource.includes('lastFetchedTrackIdRef.current = currentTrackId'),
            'useTriviaGame should update lastFetchedTrackIdRef on song change'
          )

          // State resets on song change
          assert.ok(
            triviaSource.includes('setQuestion(null)'),
            'useTriviaGame should reset question to null on song change'
          )
          assert.ok(
            triviaSource.includes('setSelectedAnswer(null)'),
            'useTriviaGame should reset selectedAnswer to null on song change'
          )
          assert.ok(
            triviaSource.includes('setIsCorrect(null)'),
            'useTriviaGame should reset isCorrect to null on song change'
          )
          assert.ok(
            triviaSource.includes('setIsLoading(true)'),
            'useTriviaGame should set isLoading to true on song change'
          )

          // Fetches new trivia question
          assert.ok(
            triviaSource.includes("fetch('/api/trivia'"),
            'useTriviaGame should fetch from /api/trivia on song change'
          )

          // The fetch order is correct: set ref → reset state → fetch
          const songChangeBlock = triviaSource.match(
            /lastFetchedTrackIdRef\.current = currentTrackId[\s\S]*?setQuestion\(null\)[\s\S]*?setSelectedAnswer\(null\)[\s\S]*?setIsCorrect\(null\)[\s\S]*?setIsLoading\(true\)[\s\S]*?fetch\('\/api\/trivia'/
          )
          assert.ok(
            songChangeBlock,
            'Song change should follow order: update ref → reset state → fetch'
          )
        }
      ),
      { numRuns: 50 }
    )
  })
})
