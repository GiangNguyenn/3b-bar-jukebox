/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { findSuggestedTrack } from '@/services/trackSuggestion'
import { type Genre, DEFAULT_MARKET } from '@/shared/constants/trackSuggestion'
import { createModuleLogger } from '@/shared/utils/logger'
import { sendApiRequest } from '@/shared/api'

const logger = createModuleLogger('API Track Suggestions')

export const runtime = 'nodejs'
export const maxDuration = 60 // 60 seconds

// Define the type for the last suggested track
interface LastSuggestedTrack {
  name: string
  artist: string
  album: string
  uri: string
  popularity: number
  duration_ms: number
  preview_url: string | null
  genres: string[]
}

// Server-side cache for the last suggested track
let serverCache: LastSuggestedTrack | null = null

const refreshRequestSchema = z.object({
  genres: z
    .array(z.string() as z.ZodType<Genre>)
    .min(1)
    .max(10),
  yearRange: z.tuple([
    z.number().min(1900),
    z.number().max(new Date().getFullYear())
  ]),
  popularity: z.number().min(0).max(100),
  allowExplicit: z.boolean(),
  maxSongLength: z.number().min(3).max(20), // In minutes
  maxOffset: z.number().min(1).max(10000),
  excludedTrackIds: z.array(z.string()).optional() // Optional array of track IDs to exclude
})

interface RefreshResponse {
  success: boolean
  message?: string
  tracks?: Array<{ id: string }>
  searchDetails?: {
    attempts: number
    totalTracksFound: number
    excludedTrackIds?: string[]
    minPopularity: number
    genresTried: string[]
    trackDetails?: Array<{
      name: string
      popularity: number
      isExcluded: boolean
      isPlayable: boolean
      duration_ms: number
      explicit: boolean
    }>
    suggestions?: string[]
  }
}

export function GET(request: NextRequest): NextResponse {
  const { searchParams } = new URL(request.url)
  const latest = searchParams.get('latest')

  if (latest === 'true') {
    try {
      // If we have a cached track, return it immediately
      if (serverCache) {
        return NextResponse.json({
          success: true,
          track: serverCache,
          hasServerCache: true,
          timestamp: Date.now()
        })
      }

      // Otherwise, get the track from the service
      // For now, return null since we're not using the service anymore
      const track = null

      // Update server cache if we got a track
      if (track) {
        serverCache = track
      }

      return NextResponse.json({
        success: true,
        track: track ?? null,
        hasServerCache: !!serverCache,
        timestamp: Date.now()
      })
    } catch (error) {
      logger('ERROR', `[Last Suggested Track] Error: ${JSON.stringify(error)}`)
      return NextResponse.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: Date.now()
        },
        { status: 500 }
      )
    }
  }

  // Default health check
  return NextResponse.json({ message: 'Track suggestions endpoint is active' })
}

export async function POST(
  request: Request
): Promise<NextResponse<RefreshResponse>> {
  try {
    const body = (await request.json()) as unknown

    const validatedData = refreshRequestSchema.parse(body)

    // Use findSuggestedTrack with app tokens for server-side operation
    const result = await findSuggestedTrack(
      validatedData.excludedTrackIds ?? [], // Use validated excludedTrackIds
      null, // No current track ID
      DEFAULT_MARKET, // Use default market from constants
      {
        genres: validatedData.genres,
        yearRange: validatedData.yearRange,
        popularity: validatedData.popularity,
        allowExplicit: validatedData.allowExplicit,
        maxSongLength: validatedData.maxSongLength,
        maxOffset: validatedData.maxOffset
      },
      true // Use app token for server-side operations
    )

    if (!result.track) {
      logger(
        'ERROR',
        `[Track Suggestions API] No suitable track found after ${result.searchDetails.attempts} attempts`
      )
      logger(
        'ERROR',
        `[Track Suggestions API] Search details: ${JSON.stringify(result.searchDetails)}`
      )

      // Analyze the search details to provide helpful feedback
      const searchDetails = result.searchDetails
      const totalTracksFound = searchDetails.totalTracksFound
      const genresTried = searchDetails.genresTried
      const minPopularity = searchDetails.minPopularity

      let errorMessage = 'No suitable track found'
      const suggestions = []

      if (totalTracksFound === 0) {
        errorMessage = `No tracks found for the specified genres: ${genresTried.join(', ')}`
        suggestions.push('Try different genres or broader genre categories')
      } else {
        // Analyze why tracks were filtered out
        const trackDetails = searchDetails.trackDetails
        const lowPopularityCount = trackDetails.filter(
          (t) => t.popularity < minPopularity
        ).length
        const excludedCount = trackDetails.filter((t) => t.isExcluded).length
        const unplayableCount = trackDetails.filter((t) => !t.isPlayable).length

        if (lowPopularityCount > 0) {
          suggestions.push(
            `Lower the minimum popularity (currently ${minPopularity})`
          )
        }
        if (excludedCount > 0) {
          suggestions.push('Some tracks were already in the queue')
        }
        if (unplayableCount > 0) {
          suggestions.push('Some tracks are not playable in your region')
        }
      }

      return NextResponse.json(
        {
          success: false,
          message: errorMessage,
          searchDetails: {
            attempts: searchDetails.attempts,
            totalTracksFound,
            excludedTrackIds: searchDetails.excludedTrackIds,
            minPopularity,
            genresTried,
            trackDetails: searchDetails.trackDetails,
            suggestions
          }
        },
        { status: 400 }
      )
    }

    // Store the successful track in server cache for the "Last Suggested Track" feature
    // Fetch artist genres for the track
    let artistGenres: string[] = []
    try {
      if (result.track.artists && result.track.artists.length > 0) {
        const artistId = result.track.artists[0].id
        const artistResponse = await sendApiRequest<{ genres: string[] }>({
          path: `artists/${artistId}`,
          method: 'GET'
        })
        artistGenres = artistResponse.genres || []
      }
    } catch (error) {
      logger(
        'WARN',
        `[Track Suggestions API] Failed to fetch artist genres: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
      // Continue with empty genres array if fetch fails
    }

    // Note: We no longer log track suggestions to the database from this API
    // The suggested_tracks table should only be updated when users directly add tracks to their playlist

    const track = result.track as {
      id: string
      name: string
      artists: Array<{ name: string }>
      album: { name: string }
      uri: string
      popularity: number
      duration_ms: number
      preview_url: string | null
    }

    serverCache = {
      name: track.name,
      artist: track.artists.map((a) => a.name).join(', '),
      album: track.album.name,
      uri: track.uri,
      popularity: track.popularity,
      duration_ms: track.duration_ms,
      preview_url: track.preview_url,
      genres: artistGenres
    } satisfies LastSuggestedTrack

    return NextResponse.json({
      success: true,
      message: 'Track suggestion found successfully',
      tracks: [
        {
          id: track.id
        }
      ],
      searchDetails: result.searchDetails as RefreshResponse['searchDetails']
    })
  } catch (error) {
    logger('ERROR', `[Track Suggestions API] Error: ${JSON.stringify(error)}`)

    if (error instanceof z.ZodError) {
      logger(
        'ERROR',
        `[Track Suggestions API] Validation error: ${JSON.stringify(error.errors)}`
      )
      return NextResponse.json(
        {
          success: false,
          errors: error.errors.map((err) => ({
            field: err.path.join('.'),
            message: err.message
          }))
        },
        { status: 400 }
      )
    }

    const errorMessage =
      error instanceof Error ? error.message : 'An error occurred'

    logger(
      'ERROR',
      `[Track Suggestions API] Final error response: ${errorMessage}`
    )

    return NextResponse.json(
      {
        success: false,
        message: errorMessage
      },
      {
        status:
          error instanceof Error && error.message.includes('timeout')
            ? 504
            : 500,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    )
  }
}

// PUT endpoint to update the server cache for the last suggested track
export async function PUT(request: Request): Promise<NextResponse> {
  try {
    const track = (await request.json()) as LastSuggestedTrack
    serverCache = track

    return NextResponse.json({
      success: true,
      track,
      hasServerCache: true,
      timestamp: Date.now()
    })
  } catch (error) {
    logger(
      'ERROR',
      `[Last Suggested Track] Error updating cache: ${JSON.stringify(error)}`
    )
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      },
      { status: 500 }
    )
  }
}
