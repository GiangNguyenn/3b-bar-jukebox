import { supabase } from '@/lib/supabase'
import { createModuleLogger } from '@/shared/utils/logger'
import { resolveProfileId } from '@/services/aiSuggestion'

const logger = createModuleLogger('VenueTasteProfile')

export interface VenueTasteProfile {
  topGenres: string[]
  topArtists: string[]
  topDecades: string[]
  popularityDescriptor: string | null
}

interface SuggestedTrackRow {
  count: number
  tracks: { genre: string | null; artist: string | null } | null
}

interface PopularityHistogramRow {
  popularity_range: string
  track_count: number
}

interface DecadeHistogramRow {
  decade: string | null
  track_count: number
}

const TOP_N = 5
const TOP_DECADES = 3
const SUGGESTED_TRACKS_SAMPLE_SIZE = 50
const CACHE_TTL_MS = 5 * 60 * 1000

const POPULARITY_DESCRIPTORS: Record<string, string> = {
  '80-100': 'mostly mainstream hits',
  '60-79': 'well-known, radio-friendly tracks',
  '40-59': 'a mix of familiar and lesser-known tracks',
  '20-39': 'more niche, lesser-known tracks',
  '0-19': 'deep cuts and lesser-known tracks'
}

const cache = new Map<
  string,
  { profile: VenueTasteProfile; expiresAt: number }
>()

const EMPTY_PROFILE: VenueTasteProfile = {
  topGenres: [],
  topArtists: [],
  topDecades: [],
  popularityDescriptor: null
}

export async function getVenueTasteProfile(
  profileId: string
): Promise<VenueTasteProfile> {
  // profileId may be a raw username rather than a resolved UUID (e.g. when
  // the caller's own display_name lookup missed) — resolve it the same way
  // getRecentlyPlayed does, so this doesn't silently no-op in that case.
  const resolvedId = await resolveProfileId(profileId)
  if (!resolvedId) {
    logger('WARN', `Could not resolve profile ID for: ${profileId}`)
    return EMPTY_PROFILE
  }

  const cached = cache.get(resolvedId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.profile
  }

  const profile = await computeVenueTasteProfile(resolvedId)
  cache.set(resolvedId, { profile, expiresAt: Date.now() + CACHE_TTL_MS })
  return profile
}

async function computeVenueTasteProfile(
  profileId: string
): Promise<VenueTasteProfile> {
  try {
    const [suggestedResult, popularityResult, decadeResult] = await Promise.all(
      [
        supabase
          .from('suggested_tracks')
          .select('count, tracks(genre, artist)')
          .eq('profile_id', profileId)
          .order('count', { ascending: false })
          .limit(SUGGESTED_TRACKS_SAMPLE_SIZE),
        supabase.rpc('get_track_popularity_histogram', {
          p_user_id: profileId
        }),
        supabase.rpc('get_track_release_year_histogram', {
          p_user_id: profileId
        })
      ]
    )

    if (suggestedResult.error) {
      logger(
        'WARN',
        `Failed to fetch suggested_tracks for taste profile: ${suggestedResult.error.message}`
      )
    }

    const genreCounts = new Map<string, number>()
    const artistCounts = new Map<string, number>()
    const rows = (suggestedResult.data ?? []) as unknown as SuggestedTrackRow[]
    for (const row of rows) {
      const genre = row.tracks?.genre
      const artist = row.tracks?.artist
      if (genre) {
        genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + row.count)
      }
      if (artist) {
        artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + row.count)
      }
    }

    const topGenres = Array.from(genreCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
      .map(([genre]) => genre)

    const topArtists = Array.from(artistCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
      .map(([artist]) => artist)

    if (decadeResult.error) {
      logger(
        'WARN',
        `Failed to fetch release-year histogram for taste profile: ${decadeResult.error.message}`
      )
    }
    const decadeRows = (decadeResult.data ?? []) as DecadeHistogramRow[]
    const topDecades = decadeRows
      // Tracks with a null release_year produce a null decade bucket in the
      // histogram RPC — exclude it rather than let "null" leak into the prompt.
      .filter(
        (d): d is { decade: string; track_count: number } => d.decade !== null
      )
      .sort((a, b) => b.track_count - a.track_count)
      .slice(0, TOP_DECADES)
      .map((d) => d.decade)

    if (popularityResult.error) {
      logger(
        'WARN',
        `Failed to fetch popularity histogram for taste profile: ${popularityResult.error.message}`
      )
    }
    const popularityRows = (popularityResult.data ??
      []) as PopularityHistogramRow[]
    const dominantBucket = [...popularityRows].sort(
      (a, b) => b.track_count - a.track_count
    )[0]
    const popularityDescriptor = dominantBucket
      ? (POPULARITY_DESCRIPTORS[dominantBucket.popularity_range] ?? null)
      : null

    return { topGenres, topArtists, topDecades, popularityDescriptor }
  } catch (error) {
    logger(
      'WARN',
      'Unexpected error computing venue taste profile',
      undefined,
      error instanceof Error ? error : undefined
    )
    return EMPTY_PROFILE
  }
}

/**
 * Formats a taste profile into a short block of prompt context. Returns an
 * empty string when there's not enough history to say anything useful —
 * the caller should omit it entirely rather than inject empty lines.
 */
export function formatTasteProfile(profile: VenueTasteProfile): string {
  const lines: string[] = []

  if (profile.topGenres.length > 0 || profile.topArtists.length > 0) {
    const genrePart =
      profile.topGenres.length > 0
        ? `${profile.topGenres.join(', ')}`
        : 'a mix of genres'
    const artistPart =
      profile.topArtists.length > 0
        ? `, especially artists like ${profile.topArtists.join(', ')}`
        : ''
    lines.push(
      `This venue's crowd typically requests: ${genrePart}${artistPart}.`
    )
  }

  if (profile.topDecades.length > 0) {
    lines.push(
      `Historically popular decades here: ${profile.topDecades.join(', ')}.`
    )
  }

  if (profile.popularityDescriptor) {
    lines.push(
      `This crowd tends to respond to ${profile.popularityDescriptor}.`
    )
  }

  return lines.join('\n')
}
