import { NextRequest, NextResponse } from 'next/server'
import { fetchTopTracksForArtists } from '@/services/game/dgsEngine'
import { ApiStatisticsTracker } from '@/services/game/apiStatisticsTracker'
import { createModuleLogger } from '@/shared/utils/logger'
import {
  DgsOptionTrack,
  PlayerId,
  ScoringComponents,
  TargetProfile,
  PipelineLogEntry
} from '@/services/game/dgsTypes'
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
  backupArtists?: SelectedArtist[]
  currentTrack: TrackDetails | null
  playedTrackIds: string[]
  targetProfiles: Record<PlayerId, TargetProfile | null>
  playerGravities: Record<PlayerId, number>
  currentPlayerId: PlayerId
  roundNumber: number
  hardConvergenceActive?: boolean
  ogDrift?: number
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const startTime = Date.now()
  const statisticsTracker = new ApiStatisticsTracker()
  const TARGET_OPTIONS = 9

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
      backupArtists = [],
      currentTrack,
      playedTrackIds = [],
      targetProfiles
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
      `Stage 3: Fetching tracks for ${selectedArtists.length} selected artists (Backup pool: ${backupArtists.length})`,
      'POST'
    )

    // 1. Build initial exclude set for tracks
    const excludeTrackIds = new Set<string>()
    if (currentTrack?.id) excludeTrackIds.add(currentTrack.id)
    playedTrackIds.forEach((id) => excludeTrackIds.add(id))

    // Track which artists we have successfully used
    const usedArtistIds = new Set<string>()
    const finalOptions: DgsOptionTrack[] = []
    const allPipelineLogs: PipelineLogEntry[] = [] // Aggregate logs from all attempts

    // Track all artists we have attempted (success or failure) to avoid retrying
    const attemptedArtistIds = new Set<string>(
      selectedArtists.map((a) => a.artistId)
    )

    let candidatesToTry = [...selectedArtists]

    // Retry loop
    let attempts = 0
    const MAX_ATTEMPTS = 3 // Increased slightly to allow for better distribution filling if needed

    while (finalOptions.length < TARGET_OPTIONS && attempts < MAX_ATTEMPTS) {
      // If no candidates left to try, grab from backups intelligently
      if (candidatesToTry.length === 0) {
        // 1. Calculate current distribution
        const currentCounts = { CLOSER: 0, NEUTRAL: 0, FURTHER: 0 }
        finalOptions.forEach((opt) => {
          const cat = (
            opt.metrics.selectionCategory ?? 'neutral'
          ).toUpperCase() as keyof typeof currentCounts
          if (currentCounts[cat] !== undefined) currentCounts[cat]++
        })

        // 2. Determine shortfalls (Target 3-3-3)
        const shortfall = {
          CLOSER: Math.max(0, 3 - currentCounts.CLOSER),
          NEUTRAL: Math.max(0, 3 - currentCounts.NEUTRAL),
          FURTHER: Math.max(0, 3 - currentCounts.FURTHER)
        }

        const neededTotal = TARGET_OPTIONS - finalOptions.length

        // We want a batch size that covers the immediate need but provides some buffer
        // If we have specific category needs, we prioritize those.
        const BATCH_SIZE = Math.max(neededTotal * 2, 6)

        const nextBatch: SelectedArtist[] = []

        // Local tracker for this selection pass to ensure we don't pick duplicates internally
        // (though attemptedArtistIds handles the global state)

        // Pass 1: Prioritize filling specific shortfalls
        for (const backup of backupArtists) {
          if (nextBatch.length >= BATCH_SIZE) break
          if (attemptedArtistIds.has(backup.artistId)) continue

          // If this backup matces a needed category
          if (shortfall[backup.category] > 0) {
            nextBatch.push(backup)
            attemptedArtistIds.add(backup.artistId)
            shortfall[backup.category]--
          }
        }

        // Pass 2: Fill remaining batch space with any available valid backups
        // (Only if we haven't filled the batch size yet)
        if (nextBatch.length < BATCH_SIZE) {
          for (const backup of backupArtists) {
            if (nextBatch.length >= BATCH_SIZE) break
            if (attemptedArtistIds.has(backup.artistId)) continue

            // Add to batch
            nextBatch.push(backup)
            attemptedArtistIds.add(backup.artistId)
          }
        }

        if (nextBatch.length === 0) {
          logger(
            'WARN',
            'No more candidates available (backups exhausted).',
            'POST'
          )
          break
        }

        candidatesToTry = nextBatch
        logger(
          'INFO',
          `Attempt ${attempts + 1}: Fallback to ${candidatesToTry.length} artists. Shortfall: ${JSON.stringify(shortfall)}`,
          'POST'
        )
      }

      const batchArtists = candidatesToTry
      candidatesToTry = [] // Clear for next iteration

      const artistIds = batchArtists.map((a) => a.artistId)

      // Fetch tracks
      const { seeds, failedArtists, logs } = await fetchTopTracksForArtists(
        artistIds,
        token,
        statisticsTracker,
        excludeTrackIds
      )

      // Collect logs
      if (logs) allPipelineLogs.push(...logs)

      if (failedArtists.length > 0) {
        logger(
          'WARN',
          `Attempt ${attempts + 1}: ${failedArtists.length} artists failed to yield tracks`,
          'POST'
        )
      }

      // Process seeds onto options
      const artistToTracksMap = new Map<string, TrackDetails[]>()
      seeds.forEach((seed) => {
        const artistId = seed.seedArtistId || seed.track.artists?.[0]?.id
        if (artistId) {
          if (!artistToTracksMap.has(artistId))
            artistToTracksMap.set(artistId, [])
          artistToTracksMap.get(artistId)!.push(seed.track)
        }
      })

      // Convert batch artists to options if they have tracks
      batchArtists.forEach((artist) => {
        if (finalOptions.length >= TARGET_OPTIONS) return

        const tracks = artistToTracksMap.get(artist.artistId) || []
        if (tracks.length === 0) {
          // This artist failed, will attempt replacements in next loop if needed
          return
        }

        // Pick random track
        const randomIndex = Math.floor(Math.random() * tracks.length)
        const selectedTrack = tracks[randomIndex]

        // Check target
        const artistId = selectedTrack.artists?.[0]?.id ?? artist.artistId
        const isTargetArtist = Object.values(targetProfiles).some((target) => {
          if (!target) return false
          if (target.spotifyId && artistId && target.spotifyId === artistId)
            return true
          const artistName =
            selectedTrack.artists?.[0]?.name ?? artist.artistName
          return (
            target.artist.name.toLowerCase().trim() ===
            artistName.toLowerCase().trim()
          )
        })

        const option: DgsOptionTrack = {
          track: selectedTrack,
          artist: {
            id: artistId,
            name: selectedTrack.artists?.[0]?.name || artist.artistName
          },
          metrics: {
            simScore: artist.attractionScore,
            aAttraction: artist.attractionScore,
            bAttraction: artist.attractionScore,
            currentSongAttraction: 0,
            delta: artist.delta,
            selectionCategory:
              artist.category === 'CLOSER'
                ? 'closer'
                : artist.category === 'NEUTRAL'
                  ? 'neutral'
                  : 'further',
            isTargetArtist,
            gravityScore: 0,
            stabilizedScore: 0,
            finalScore: artist.attractionScore,
            scoreComponents: artist.scoreComponents ?? DUMMY_COMPONENTS,
            popularityBand: 'mid',
            source: 'related_top_tracks',
            vicinityDistances: {}
          }
        }

        finalOptions.push(option)
        usedArtistIds.add(artist.artistId)
        // Add selected track to exclude list for next batch to prevent duplicates
        excludeTrackIds.add(selectedTrack.id)
      })

      attempts++
    }

    if (finalOptions.length < TARGET_OPTIONS) {
      logger(
        'WARN',
        `Final options count ${finalOptions.length} is less than target ${TARGET_OPTIONS}`,
        'POST'
      )
    }

    logger(
      'INFO',
      `Successfully built ${finalOptions.length} final options`,
      'POST'
    )

    const executionTime = Date.now() - startTime

    // Build debug info
    const debugInfo = {
      executionTimeMs: executionTime,
      caching: statisticsTracker.getStatistics(),
      performanceDiagnostics: statisticsTracker.getPerformanceDiagnostics(),
      pipelineLogs: allPipelineLogs,
      scoring: {
        totalCandidates: finalOptions.length,
        fallbackFetches: attempts - 1,
        p1NonZeroAttraction: finalOptions.length,
        p2NonZeroAttraction: finalOptions.length,
        zeroAttractionReasons: {
          missingArtistProfile: 0,
          nullTargetProfile: 0,
          zeroSimilarity: 0
        }
      },
      candidates: finalOptions.map((option) => ({
        artistName: option.artist.name,
        trackName: option.track.name,
        source: 'related_top_tracks',
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
      options: finalOptions,
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
