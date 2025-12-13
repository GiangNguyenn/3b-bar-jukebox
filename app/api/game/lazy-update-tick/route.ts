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
          const trackIds = extractTrackIdsFromPayload(item.payload)
          if (trackIds.length) {
            await upsertTopTracks(item.spotifyId, trackIds)
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
  const timeLeft = DEADLINE_MS - (Date.now() - startTime)
  let genreBackfillCount = 0
  let healingResults = { processed: 0, succeeded: 0, failed: 0 }

  if (timeLeft > 1000) {
    // Require at least 1s buffer
    // Process a small batch (e.g. 5) to incrementally improve coverage
    // Pass token so batch processor can make Spotify API calls if needed
    logger('INFO', 'Starting genre backfill batch (5 tracks)...')
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
      `Genre backfill completed: ${genreBackfillCount} tracks processed, ${genresUpdated} genres updated, ${genresFailed} failed/not found`
    )
  } else {
    logger(
      'INFO',
      `Skipping genre backfill - insufficient time (${timeLeft}ms remaining)`
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
