import { NextRequest, NextResponse } from 'next/server'
import {
  fetchTopTracksForArtists,
  enrichCandidatesWithArtistProfiles
} from '@/services/game/dgsEngine'
import { ApiStatisticsTracker } from '@/services/game/apiStatisticsTracker'
import { createModuleLogger } from '@/shared/utils/logger'
import { ArtistProfile } from '@/services/game/dgsTypes'
import { fetchAbsoluteRandomTracks } from '@/services/game/dgsDb'
import { MIN_CANDIDATE_POOL } from '@/services/game/gameRules'

const logger = createModuleLogger('Stage2Candidates')

export async function POST(req: NextRequest): Promise<NextResponse> {
  const startTime = Date.now()
  const statisticsTracker = new ApiStatisticsTracker()

  try {
    const body = (await req.json()) as unknown
    const {
      artistIds,
      playedTrackIds = [],
      currentTrackId
    } = body as {
      artistIds: string[]
      playedTrackIds?: string[]
      currentTrackId?: string
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return NextResponse.json(
        { error: 'Missing Authorization header' },
        { status: 401 }
      )
    }
    const token = authHeader.split(' ')[1]

    if (!artistIds || !Array.isArray(artistIds)) {
      return NextResponse.json({ error: 'Invalid artistIds' }, { status: 400 })
    }

    // Cast to string array safely
    const safeArtistIds = artistIds.map(String)

    // Build exclude set for tracks
    const excludeTrackIds = new Set<string>()
    if (currentTrackId) excludeTrackIds.add(currentTrackId)
    playedTrackIds.forEach((id) => excludeTrackIds.add(id))

    logger(
      'INFO',
      `Stage 2: Fetching candidates for ${safeArtistIds.length} artists (excluding ${excludeTrackIds.size} tracks)`,
      'POST'
    )

    // 1. Fetch Candidates (Tracks) - randomly select 1 from top 10 per artist
    const seeds = await fetchTopTracksForArtists(
      safeArtistIds,
      token,
      statisticsTracker,
      excludeTrackIds
    )

    // 2. Enrich with Artist Profiles
    // We need existing profiles? Client doesn't pass them.
    // We start with empty map for this chunk.
    const initialProfiles = new Map<string, ArtistProfile>()
    const enrichedProfilesMap = await enrichCandidatesWithArtistProfiles(
      seeds,
      initialProfiles,
      token,
      statisticsTracker
    )

    // Convert Map to Array for JSON response
    const profiles = Array.from(enrichedProfilesMap.values())

    // 3. Final Fallback: If we don't have minimum 100 tracks, add random tracks from TRACKS table
    if (seeds.length < MIN_CANDIDATE_POOL) {
      const neededTracks = MIN_CANDIDATE_POOL - seeds.length
      logger(
        'WARN',
        `Candidate pool has only ${seeds.length} tracks, adding ${neededTracks} random tracks from database`,
        'POST'
      )

      try {
        const existingTrackIds = new Set(seeds.map((s) => s.track.id))
        excludeTrackIds.forEach((id) => existingTrackIds.add(id))

        const randomTracks = await fetchAbsoluteRandomTracks(
          neededTracks,
          existingTrackIds
        )

        // Convert random tracks to CandidateSeed format
        const randomSeeds = randomTracks.map((track) => ({
          track,
          source: 'embedding' as const,
          seedArtistId: track.artists?.[0]?.id || ''
        }))

        seeds.push(...randomSeeds)

        logger(
          'INFO',
          `Added ${randomSeeds.length} random tracks from database. New pool size: ${seeds.length}`,
          'POST'
        )
      } catch (error) {
        logger(
          'ERROR',
          `Failed to fetch random tracks for fallback: ${error instanceof Error ? error.message : String(error)}`,
          'POST'
        )
        // Continue with what we have
      }
    }

    const executionTime = Date.now() - startTime

    logger(
      'INFO',
      `Stage 2 Complete: ${seeds.length} seeds, ${profiles.length} profiles | Time=${executionTime}ms`,
      'POST'
    )

    return NextResponse.json({
      seeds,
      profiles,
      debug: {
        executionTime,
        stats: statisticsTracker.getStatistics()
      }
    })
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    logger('ERROR', `Stage 2 Failed: ${errorMsg}`, 'POST')
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
