import { NextRequest, NextResponse } from 'next/server'

// Type-guard for MusicBrainz Artist Search API response
interface MusicBrainzArtist {
  id: string
  name: string
  'life-span': {
    ended: boolean | null
  }
}

interface MusicBrainzSearchResponse {
  artists: MusicBrainzArtist[]
}

function isMusicBrainzSearchResponse(
  data: unknown
): data is MusicBrainzSearchResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'artists' in data &&
    Array.isArray((data as MusicBrainzSearchResponse).artists)
  )
}

// Type-guard for MusicBrainz Relations API response
interface WikipediaRelation {
  type: string
  url: {
    resource: string
  }
}

interface MusicBrainzRelationsResponse {
  relations: WikipediaRelation[]
}

function isMusicBrainzRelationsResponse(
  data: unknown
): data is MusicBrainzRelationsResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'relations' in data &&
    Array.isArray((data as MusicBrainzRelationsResponse).relations)
  )
}

// Type-guard for Wikipedia Summary API response
interface WikipediaSummaryResponse {
  extract: string
}

// Type-guard for Wikidata API response
interface WikidataEntity {
  sitelinks?: {
    enwiki?: {
      title: string
    }
  }
}

interface WikidataResponse {
  entities: {
    [key: string]: WikidataEntity
  }
}

function isWikipediaSummaryResponse(
  data: unknown
): data is WikipediaSummaryResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'extract' in data &&
    typeof (data as WikipediaSummaryResponse).extract === 'string'
  )
}

function isWikidataResponse(data: unknown): data is WikidataResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'entities' in data &&
    typeof (data as WikidataResponse).entities === 'object'
  )
}

// Simple in-memory cache for Wikidata responses
interface CacheEntry {
  data: WikidataResponse
  timestamp: number
}

const wikidataCache = new Map<string, CacheEntry>()
const CACHE_TTL = 60 * 60 * 1000 // 1 hour

function getCachedWikidata(wikidataId: string): WikidataResponse | null {
  const cached = wikidataCache.get(wikidataId)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data
  }
  if (cached) {
    wikidataCache.delete(wikidataId) // Remove stale entry
  }
  return null
}

function cacheWikidata(wikidataId: string, data: WikidataResponse): void {
  wikidataCache.set(wikidataId, {
    data,
    timestamp: Date.now()
  })
}

// Helper for retrying fetches with special handling for rate limits
async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = 3,
  baseDelay = 1000
): Promise<Response> {
  let lastError: unknown
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options)
      // If we get a 429 (Too Many Requests) or 5xx (Server Error), throw to trigger retry
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`Request failed with status ${response.status}`)
      }
      return response
    } catch (error) {
      lastError = error
      // Don't wait on the last attempt
      if (i < retries - 1) {
        // Use longer delays for 429 rate limit errors
        const is429 = error instanceof Error && error.message.includes('429')
        const delay = is429
          ? 5000 * (i + 1) // 5s, 10s, 15s for rate limits
          : baseDelay * Math.pow(2, i) // 1s, 2s, 4s for other errors
        console.warn(
          `Fetch to ${url} failed (attempt ${i + 1}/${retries}). Retrying in ${delay}ms...`,
          error
        )
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }
  throw lastError
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url)
  const artistName = searchParams.get('artistName')

  if (!artistName) {
    return NextResponse.json(
      { error: 'artistName query parameter is required' },
      { status: 400 }
    )
  }

  try {
    // 1. MusicBrainz Search to find MBID
    const searchResponse = await fetchWithRetry(
      `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(
        artistName
      )}&fmt=json`,
      {
        headers: {
          'User-Agent': 'JM-Bar-Jukebox/1.0.0 ( a.j.maxwell@bigpond.com )'
        }
      }
    )

    if (!searchResponse.ok) {
      console.error(
        'MusicBrainz API search error:',
        searchResponse.status,
        await searchResponse.text()
      )
      return NextResponse.json(
        { error: 'Failed to fetch data from MusicBrainz' },
        { status: 500 }
      )
    }

    const searchData: unknown = await searchResponse.json()

    if (
      !isMusicBrainzSearchResponse(searchData) ||
      searchData.artists.length === 0
    ) {
      return NextResponse.json({ error: 'Artist not found' }, { status: 404 })
    }

    let wikipediaUrl: string | undefined

    // Enforce exact match
    const exactMatch = searchData.artists.find(
      (artist) => artist.name.toLowerCase() === artistName.toLowerCase()
    )

    if (!exactMatch) {
      return NextResponse.json(
        { error: 'Exact artist match not found' },
        { status: 404 }
      )
    }

    const artistsToSearch = [exactMatch]

    for (const artist of artistsToSearch) {
      const mbid = artist.id
      let relationsResponse: Response | null = null

      try {
        relationsResponse = await fetchWithRetry(
          `https://musicbrainz.org/ws/2/artist/${mbid}?inc=url-rels&fmt=json`,
          {
            headers: {
              'User-Agent': 'JM-Bar-Jukebox/1.0.0 ( a.j.maxwell@bigpond.com )'
            }
          }
        )
      } catch (err) {
        console.warn(
          `Failed to fetch relations for MBID ${mbid} after retries:`,
          err
        )
        continue
      }

      if (!relationsResponse?.ok) {
        console.warn(`Could not fetch relations for MBID ${mbid}, skipping.`)
        continue
      }

      const relationsData: unknown = await relationsResponse.json()
      if (!isMusicBrainzRelationsResponse(relationsData)) {
        console.warn(`Could not parse relations for MBID ${mbid}, skipping.`)
        continue
      }

      const wikipediaRelation = relationsData.relations.find(
        (relation) =>
          relation.type === 'wikipedia' || relation.type === 'wikidata'
      )

      if (wikipediaRelation) {
        if (wikipediaRelation.type === 'wikidata') {
          const wikidataId = wikipediaRelation.url.resource.split('/').pop()
          if (wikidataId) {
            try {
              // Check cache first
              let wikidataData = getCachedWikidata(wikidataId)

              if (!wikidataData) {
                // Cache miss - fetch from API
                const wikidataResponse = await fetchWithRetry(
                  `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wikidataId}&format=json&props=sitelinks`
                )
                if (wikidataResponse.ok) {
                  const fetchedData: unknown = await wikidataResponse.json()
                  if (isWikidataResponse(fetchedData)) {
                    wikidataData = fetchedData
                    // Cache the successful response
                    cacheWikidata(wikidataId, fetchedData)
                  }
                }
              }

              if (wikidataData) {
                const sitelink =
                  wikidataData.entities[wikidataId]?.sitelinks?.enwiki
                if (sitelink) {
                  // Construct the URL from the sitelink title
                  wikipediaUrl = `https://en.wikipedia.org/wiki/${sitelink.title.replace(
                    / /g,
                    '_'
                  )}`
                }
              }
            } catch (err) {
              console.warn(`Failed to fetch Wikidata for ${wikidataId}:`, err)
            }
          }
        } else {
          wikipediaUrl = wikipediaRelation.url.resource
        }

        if (wikipediaUrl) {
          break
        }
      }
    }

    if (!wikipediaUrl) {
      return NextResponse.json(
        { error: 'Wikipedia page not found for this artist' },
        { status: 404 }
      )
    }

    const pageTitle = wikipediaUrl.split('/').pop()

    if (!pageTitle) {
      return NextResponse.json(
        { error: 'Could not extract page title from Wikipedia URL' },
        { status: 500 }
      )
    }

    // 3. Wikipedia Extract
    const summaryResponse = await fetchWithRetry(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
        pageTitle
      )}`,
      { redirect: 'follow' }
    )

    if (!summaryResponse.ok) {
      console.error(
        'Wikipedia API error:',
        summaryResponse.status,
        await summaryResponse.text()
      )
      return NextResponse.json(
        { error: 'Failed to fetch data from Wikipedia' },
        { status: 500 }
      )
    }

    const summaryData: unknown = await summaryResponse.json()

    if (!isWikipediaSummaryResponse(summaryData)) {
      return NextResponse.json(
        { error: 'Could not parse summary from Wikipedia' },
        { status: 500 }
      )
    }

    return NextResponse.json({ extract: summaryData.extract })
  } catch (error) {
    // Type for Node.js system errors
    interface SystemError {
      code?: string
      syscall?: string
      errno?: number
    }

    // Detailed error logging for diagnostics
    const errorCause = error instanceof Error ? error.cause : undefined
    const systemError = errorCause as SystemError | undefined

    const errorDetails = {
      timestamp: new Date().toISOString(),
      artistName,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      cause: errorCause
    }

    // Classify error type for better diagnostics
    if (error instanceof Error) {
      const errorMessage = error.message.toLowerCase()

      // Network/connectivity errors
      if (
        systemError?.code === 'ECONNRESET' ||
        systemError?.code === 'ETIMEDOUT' ||
        systemError?.code === 'ENOTFOUND' ||
        systemError?.code === 'ECONNREFUSED' ||
        errorMessage.includes('fetch failed') ||
        errorMessage.includes('network')
      ) {
        console.error('[ARTIST-EXTRACT] Network connectivity error:', {
          ...errorDetails,
          errorType: 'NETWORK_ERROR',
          errorCode: systemError?.code,
          syscall: systemError?.syscall
        })
      }
      // Rate limiting errors
      else if (
        errorMessage.includes('429') ||
        errorMessage.includes('rate limit')
      ) {
        console.error('[ARTIST-EXTRACT] Rate limit exceeded:', {
          ...errorDetails,
          errorType: 'RATE_LIMIT_ERROR'
        })
      }
      // Service unavailable errors
      else if (errorMessage.includes('500') || errorMessage.includes('503')) {
        console.error('[ARTIST-EXTRACT] External service error:', {
          ...errorDetails,
          errorType: 'SERVICE_ERROR'
        })
      }
      // All other errors
      else {
        console.error('[ARTIST-EXTRACT] Unexpected error:', {
          ...errorDetails,
          errorType: 'UNKNOWN_ERROR'
        })
      }
    } else {
      console.error('[ARTIST-EXTRACT] Non-standard error:', errorDetails)
    }

    // Generic user-facing error message
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
