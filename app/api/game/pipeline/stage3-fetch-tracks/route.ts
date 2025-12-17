import { NextRequest, NextResponse } from 'next/server'
import { fetchTopTracksForArtists } from '@/services/game/dgsEngine'
import { ApiStatisticsTracker } from '@/services/game/apiStatisticsTracker'
import { createModuleLogger } from '@/shared/utils/logger'
import { DgsOptionTrack, PlayerId, ScoringComponents } from '@/services/game/dgsTypes'
import { DUMMY_COMPONENTS } from '@/services/game/dgsScoring'
import { TrackDetails } from '@/shared/types/spotify'

const logger = createModuleLogger('Stage3FetchTracks')

interface SelectedArtist {
  artistId: string
  artistName: string
  category: 'CLOSER' | 'NEUTRAL' | 'FURTHER'
  attractionScore: number
  delta: number
  scoreComponents?: ScoringComponents
}

interface Stage3FetchTracksRequest {
  selectedArtists: SelectedArtist[]
  currentTrack: TrackDetails | null
  playedTrackIds: string[]
  targetProfiles: Record<PlayerId, any>
  playerGravities: Record<PlayerId, number>
  currentPlayerId: PlayerId
  roundNumber: number
  hardConvergenceActive?: boolean
  ogDrift?: number
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const startTime = Date.now()
  const statisticsTracker = new ApiStatisticsTracker()

  try {
    const body = (await req.json()) as unknown
    const request = body as Stage3FetchTracksRequest

    if (!Array.isArray(request.selectedArtists)) {
      return NextResponse.json(
        { error: 'Invalid request body: selectedArtists must be an array' },
        { status: 400 }
      )
    }

    const {
      selectedArtists,
      currentTrack,
      playedTrackIds = [],
      targetProfiles,
      playerGravities,
      currentPlayerId,
      roundNumber,
      hardConvergenceActive = false,
      ogDrift = 0
    } = request

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return NextResponse.json(
        { error: 'Missing Authorization header' },
        { status: 401 }
      )
    }
    const token = authHeader.split(' ')[1]

    logger(
      'INFO',
      `Stage 3: Fetching tracks for ${selectedArtists.length} selected artists`,
      'POST'
    )

    // 1. Build exclude set for tracks
    const excludeTrackIds = new Set<string>()
    if (currentTrack?.id) excludeTrackIds.add(currentTrack.id)
    playedTrackIds.forEach((id) => excludeTrackIds.add(id))

    // 2. Extract artist IDs from selected artists
    const selectedArtistIds = selectedArtists.map((a) => a.artistId)

    // 3. Fetch top tracks for all 9 artists
    // Data Strategy: Tier 1 (Cache) → Tier 2 (DB) → Tier 3 (Spotify API)
    // fetchTopTracksForArtists already handles lazy write-back and self-healing
    const { seeds, failedArtists, logs } = await fetchTopTracksForArtists(
      selectedArtistIds,
      token,
      statisticsTracker,
      excludeTrackIds
    )

    if (failedArtists.length > 0) {
      logger(
        'WARN',
        `${failedArtists.length} artists yielded 0 valid tracks (already queued for healing)`,
        'POST'
      )
    }

    // 4. Map tracks to selected artists and build final options
    const artistToTracksMap = new Map<string, TrackDetails[]>()
    seeds.forEach((seed) => {
      // Use the seed's explicitly requested artist ID
      // This ensures we map the track back to the correct artist even if:
      // 1. The track data is from DB and lacks artist IDs (common in our partial cache)
      // 2. The track's primary artist is different (e.g. "feat." or various artists)
      const artistId = seed.seedArtistId || seed.track.artists?.[0]?.id
      if (artistId) {
        if (!artistToTracksMap.has(artistId)) {
          artistToTracksMap.set(artistId, [])
        }
        artistToTracksMap.get(artistId)!.push(seed.track)
      }
    })

    // 5. For each selected artist, randomly select 1 track from their top tracks
    const options: DgsOptionTrack[] = []
    const missingTracks: string[] = []

    selectedArtists.forEach((selectedArtist) => {
      const tracks = artistToTracksMap.get(selectedArtist.artistId) || []

      if (tracks.length === 0) {
        missingTracks.push(selectedArtist.artistName)
        logger(
          'WARN',
          `No valid tracks found for artist ${selectedArtist.artistName} (${selectedArtist.artistId})`,
          'POST'
        )
        return
      }

      // Randomly select 1 track from available tracks
      const randomIndex = Math.floor(Math.random() * tracks.length)
      const selectedTrack = tracks[randomIndex]

      // Check if this is a target artist
      const artistId = selectedTrack.artists?.[0]?.id || selectedArtist.artistId
      const isTargetArtist = Object.values(targetProfiles).some((target) => {
        if (!target) return false
        if (target.spotifyId && artistId && target.spotifyId === artistId) {
          return true
        }
        // Fallback to name match
        const artistName = selectedTrack.artists?.[0]?.name || selectedArtist.artistName
        return (
          target.artist.name.toLowerCase().trim() ===
          artistName.toLowerCase().trim()
        )
      })

      // Build option track with metadata from Stage 2
      const option: DgsOptionTrack = {
        track: selectedTrack,
        artist: {
          id: artistId,
          name: selectedTrack.artists?.[0]?.name || selectedArtist.artistName
        },
        metrics: {
          simScore: selectedArtist.attractionScore,
          aAttraction: selectedArtist.attractionScore,
          bAttraction: selectedArtist.attractionScore,
          currentSongAttraction: 0, // Will be calculated if needed
          delta: selectedArtist.delta,
          selectionCategory:
            selectedArtist.category === 'CLOSER'
              ? 'closer'
              : selectedArtist.category === 'NEUTRAL'
                ? 'neutral'
                : 'further',
          isTargetArtist,
          gravityScore: 0,
          stabilizedScore: 0,
          finalScore: selectedArtist.attractionScore,
          scoreComponents: selectedArtist.scoreComponents || DUMMY_COMPONENTS,
          popularityBand: 'mid' as const,
          source: 'related_top_tracks',
          vicinityDistances: {}
        }
      }

      options.push(option)
    })

    if (missingTracks.length > 0) {
      logger(
        'WARN',
        `Missing tracks for ${missingTracks.length} artists: ${missingTracks.join(', ')}`,
        'POST'
      )
    }

    logger(
      'INFO',
      `Successfully built ${options.length} final options from ${selectedArtists.length} selected artists`,
      'POST'
    )

    const executionTime = Date.now() - startTime

    // Build debug info
    const debugInfo = {
      executionTimeMs: executionTime,
      caching: statisticsTracker.getStatistics(),
      performanceDiagnostics: statisticsTracker.getPerformanceDiagnostics(),
      pipelineLogs: logs, // Pass the captured logs
      scoring: {
        totalCandidates: options.length,
        fallbackFetches: 0,
        p1NonZeroAttraction: options.length,
        p2NonZeroAttraction: options.length,
        zeroAttractionReasons: {
          missingArtistProfile: 0,
          nullTargetProfile: 0,
          zeroSimilarity: 0
        }
      },
      candidates: options.map((option) => ({
        artistName: option.artist.name,
        trackName: option.track.name,
        source: 'related_top_tracks', // Simplified - could track actual source
        simScore: option.metrics.simScore,
        category:
          option.metrics.selectionCategory === 'closer'
            ? 'closer'
            : option.metrics.selectionCategory === 'neutral'
              ? 'neutral'
              : 'further',
        isTargetArtist: option.metrics.isTargetArtist,
        filtered: false
      }))
    }

    return NextResponse.json({
      options,
      debugInfo
    })
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    logger('ERROR', `Stage 3 Fetch Tracks Failed: ${errorMsg}`, 'POST')
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
