import { NextRequest, NextResponse } from 'next/server'
import { createModuleLogger } from '@/shared/utils/logger'
import {
  extractTrackDetailsFromPayload,
  extractTrackIdsFromPayload,
  fetchPendingLazyUpdates,
  markLazyUpdateProcessing,
  markLazyUpdateResult
} from '@/services/game/lazyUpdateQueue'
import type { TrackDetails } from '@/shared/types/spotify'
import { upsertArtistProfile, upsertTopTracks } from '@/services/game/dgsCache'
import { upsertTrackDetails } from '@/services/game/dgsDb'
import { getArtistTopTracksServer } from '@/services/spotifyApiServer'
import {
  getBackfillMetrics,
  processGenreBackfillBatch
} from '@/services/game/genreBackfill'

const logger = createModuleLogger('ApiLazyUpdateTick')

const BATCH_LIMIT = 3
const DEADLINE_MS = 4500

function isValidTrackDetails(
  track: TrackDetails | undefined
): track is TrackDetails {
  return Boolean(
    track?.id && typeof track.id === 'string' && track.id.trim() !== ''
  )
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const startTime = Date.now()

  // Extract token from request body (optional)
  let token: string | undefined
  try {
    const body = (await req.json()) as { token?: string }
    token = body.token
  } catch {
    // No body or invalid JSON - continue without token
  }

  const pending = await fetchPendingLazyUpdates(BATCH_LIMIT)

  let processed = 0
  let failed = 0

  // Only process lazy updates if there are any pending
  if (pending.length > 0) {
    await markLazyUpdateProcessing(pending.map((item) => item.id))

    const processedIds = new Set<string>()
    for (const item of pending) {
      if (Date.now() - startTime > DEADLINE_MS) {
        break
      }

      try {
        if (item.type === 'artist_profile') {
          const payload = item.payload ?? {}
          await upsertArtistProfile({
            spotify_artist_id: item.spotifyId,
            name: (payload.name as string) ?? '',
            genres: (payload.genres as string[]) ?? [],
            popularity: payload.popularity as number | undefined,
            follower_count: payload.follower_count as number | undefined
          })
        } else if (item.type === 'artist_top_tracks') {
          const payload = item.payload ?? {}
          const trackIds = extractTrackIdsFromPayload(payload)
          const needsRefresh = payload.needsRefresh === true

          if (needsRefresh && token) {
            // REQ-DAT-03: Self-Healing - Fetch top tracks from Spotify and store in DB
            try {
              const tracks = await getArtistTopTracksServer(
                item.spotifyId,
                token
              )
              if (tracks.length > 0) {
                // Store track IDs
                await upsertTopTracks(
                  item.spotifyId,
                  tracks.map((t) => t.id)
                )
                // Store track details
                await upsertTrackDetails(tracks)
                logger(
                  'INFO',
                  `Healed artist ${item.spotifyId}: Fetched and stored ${tracks.length} top tracks`,
                  'lazy-update-tick'
                )
              } else {
                logger(
                  'WARN',
                  `Artist ${item.spotifyId} has no top tracks available from Spotify`,
                  'lazy-update-tick'
                )
              }
            } catch (error) {
              logger(
                'WARN',
                `Failed to heal artist ${item.spotifyId}: ${error instanceof Error ? error.message : String(error)}`,
                'lazy-update-tick',
                error instanceof Error ? error : undefined
              )
              throw error // Re-throw to mark as failed
            }
          } else if (trackIds.length) {
            // Existing track IDs provided - just store them
            await upsertTopTracks(item.spotifyId, trackIds)
          } else if (needsRefresh && !token) {
            logger(
              'WARN',
              `Cannot heal artist ${item.spotifyId}: No token provided`,
              'lazy-update-tick'
            )
            throw new Error('No token provided for healing')
          }
        } else if (item.type === 'track_details') {
          const tracks = extractTrackDetailsFromPayload(item.payload).filter(
            isValidTrackDetails
          )
          if (tracks.length) {
            await upsertTrackDetails(tracks)
          }
        }

        processed += 1
        processedIds.add(item.id)
        await markLazyUpdateResult(item.id, 'completed', item.attempts + 1)
      } catch (error) {
        failed += 1
        processedIds.add(item.id)
        logger(
          'WARN',
          `Failed processing lazy update ${item.id} (${item.type})`,
          'lazy-update-tick',
          error instanceof Error ? error : undefined
        )
        await markLazyUpdateResult(
          item.id,
          'failed',
          item.attempts + 1,
          error instanceof Error ? error.message : String(error)
        )
      }
    }

    // Re-queue any items we marked as processing but did not attempt
    const skipped = pending.filter((item) => !processedIds.has(item.id))
    for (const item of skipped) {
      await markLazyUpdateResult(item.id, 'pending', item.attempts)
    }
  }

  // Genre Backfill (Background Crawler)
  // If we have time left, process some tracks missing genres
  const now = Date.now()
  const elapsed = now - startTime
  const timeLeft = DEADLINE_MS - elapsed

  logger(
    'INFO',
    `[LazyTick] Status: Pending=${pending.length}, Processed=${processed}, Failed=${failed}`
  )
  logger(
    'INFO',
    `[LazyTick] Timing: Elapsed=${elapsed}ms, Deadline=${DEADLINE_MS}ms, TimeLeft=${timeLeft}ms`
  )

  let genreBackfillCount = 0
  let healingResults = { processed: 0, succeeded: 0, failed: 0 }

  // Force at least one check if we have cleared the queue, even if time is tight (unless completely exhausted)
  const shouldBackfill =
    timeLeft > 1000 || (pending.length === 0 && timeLeft > -2000)

  if (shouldBackfill) {
    // Require at least 1s buffer OR if queue is empty (and we aren't ridiculously over time)
    // Process a small batch (e.g. 5) to incrementally improve coverage
    // Pass token so batch processor can make Spotify API calls if needed
    logger('INFO', '[LazyTick] Starting genre backfill batch (5 tracks)...')
    const beforeMetrics = getBackfillMetrics()
    genreBackfillCount = await processGenreBackfillBatch(5, token)
    const afterMetrics = getBackfillMetrics()
    const genresUpdated = Math.max(
      0,
      afterMetrics.trackSuccesses - beforeMetrics.trackSuccesses
    )
    const genresFailed = Math.max(
      0,
      afterMetrics.trackFailures - beforeMetrics.trackFailures
    )
    logger(
      'INFO',
      `[LazyTick] Genre backfill completed: ${genreBackfillCount} tracks processed, ${genresUpdated} genres updated, ${genresFailed} failed/not found`
    )
  } else {
    logger(
      'INFO',
      `[LazyTick] Skipping genre backfill - insufficient time (${timeLeft}ms remaining)`
    )
  }

  // Self-Healing (Background Processor)
  // Process healing queue to fix stale/invalid data
  const healingTimeLeft = DEADLINE_MS - (Date.now() - startTime)
  if (healingTimeLeft > 500 && token) {
    // Require at least 500ms buffer and valid token
    const { processHealingQueue } = await import('@/services/game/selfHealing')
    healingResults = await processHealingQueue(token, 2) // Process 2 healing actions
    logger(
      'INFO',
      `Healing: processed=${healingResults.processed}, succeeded=${healingResults.succeeded}, failed=${healingResults.failed}`
    )
  } else if (healingTimeLeft > 500 && !token) {
    logger('INFO', 'Skipping healing - no token provided')
  }

  const durationMs = Date.now() - startTime
  const remaining = Math.max(pending.length - processed - failed, 0)

  return NextResponse.json({
    processed,
    failed,
    remaining,
    durationMs,
    genreBackfill: genreBackfillCount,
    healing: healingResults
  })
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return POST(req)
}
