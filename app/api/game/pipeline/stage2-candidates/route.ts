import { NextRequest, NextResponse } from 'next/server'
import {
  fetchTopTracksForArtists,
  enrichCandidatesWithArtistProfiles
} from '@/services/game/dgsEngine'
import { ApiStatisticsTracker } from '@/services/game/apiStatisticsTracker'
import { createModuleLogger } from '@/shared/utils/logger'
import { ArtistProfile } from '@/services/game/dgsTypes'

const logger = createModuleLogger('Stage2Candidates')

export async function POST(req: NextRequest) {
  const startTime = Date.now()
  const statisticsTracker = new ApiStatisticsTracker()

  try {
    const body = await req.json()
    const { artistIds, playedTrackIds, currentArtistId } = body

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

    logger(
      'INFO',
      `Stage 2: Fetching candidates for ${artistIds.length} artists`,
      'POST'
    )

    // 1. Fetch Candidates (Tracks)
    const seeds = await fetchTopTracksForArtists(
      artistIds,
      token,
      statisticsTracker // We assume this function uses the tracker we pass? (Need to check strict type match)
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
    logger('ERROR', `Stage 2 Failed: ${error}`, 'POST')
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
