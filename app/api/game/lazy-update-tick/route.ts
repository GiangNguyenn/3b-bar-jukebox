import { NextResponse } from 'next/server'
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

export async function POST(): Promise<NextResponse> {
  const startTime = Date.now()

  const pending = await fetchPendingLazyUpdates(BATCH_LIMIT)
  if (!pending.length) {
    return NextResponse.json({ processed: 0, remaining: 0 })
  }

  await markLazyUpdateProcessing(pending.map((item) => item.id))

  let processed = 0
  let failed = 0
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

  const remaining = Math.max(
    pending.length - processed - failed + skipped.length,
    0
  )
  return NextResponse.json({
    processed,
    failed,
    remaining,
    durationMs: Date.now() - startTime
  })
}

export async function GET(): Promise<NextResponse> {
  return POST()
}
