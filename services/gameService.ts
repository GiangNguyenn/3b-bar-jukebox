import {
  getRelatedArtistsServer,
  getArtistTopTracksServer
} from './spotifyApiServer'
import type {
  SpotifyArtist,
  TrackDetails,
  SpotifyPlaybackState
} from '@/shared/types/spotify'

export interface TargetArtist {
  id?: string // Optional - not used for matching, only for display if needed
  name: string
}

export interface GameOptionTrack {
  track: TrackDetails
  artist: SpotifyArtist
}

const MAX_GAME_OPTIONS = 12

/**
 * Curated list of 100 popular, widely-known artists for target assignment
 * Spans multiple genres and represents top artists from the last 50 years
 * Genres include: Pop, Rock, Hip-Hop, R&B, Country, Electronic, Metal, Alternative, Latin, K-Pop, Indie
 */
export const POPULAR_TARGET_ARTISTS: TargetArtist[] = [
  // Contemporary Pop
  { name: 'Taylor Swift' },
  { name: 'Ariana Grande' },
  { name: 'Ed Sheeran' },
  { name: 'Justin Bieber' },
  { name: 'Adele' },
  { name: 'Dua Lipa' },
  { name: 'Billie Eilish' },
  { name: 'Olivia Rodrigo' },
  { name: 'Lady Gaga' },
  { name: 'Britney Spears' },

  // Hip-Hop & Rap
  { name: 'Drake' },
  { name: 'Eminem' },
  { name: 'Kendrick Lamar' },
  { name: 'Kanye West' },
  { name: 'Nicki Minaj' },
  { name: 'Megan Thee Stallion' },
  { name: 'Future' },
  { name: 'Travis Scott' },
  { name: 'Lil Wayne' },
  { name: 'J. Cole' },

  // R&B & Soul
  { name: 'The Weeknd' },
  { name: 'Bruno Mars' },
  { name: 'Beyoncé' },
  { name: 'Rihanna' },
  { name: 'Usher' },
  { name: 'Alicia Keys' },
  { name: 'Madonna' },
  { name: 'Michael Jackson' },
  { name: 'Lil Nas X' },
  { name: 'Childish Gambino' },
  { name: 'John Legend' },
  { name: 'SZA' },
  { name: 'Frank Ocean' },
  { name: 'Daniel Caesar' },
  { name: 'H.E.R.' },
  { name: 'Summer Walker' },
  { name: 'Giveon' },
  { name: 'Lauryn Hill' },
  { name: 'D\'Angelo' },

  // Rock & Classic Rock
  { name: 'The Beatles' },
  { name: 'The Rolling Stones' },
  { name: 'Queen' },
  { name: 'AC/DC' },
  { name: 'Led Zeppelin' },
  { name: 'Pink Floyd' },
  { name: 'Guns N\' Roses' },
  { name: 'David Bowie' },
  { name: 'Coldplay' },
  { name: 'Foo Fighters' },
  { name: 'The Who' },
  { name: 'The Eagles' },
  { name: 'Fleetwood Mac' },
  { name: 'The Doors' },
  { name: 'Jimi Hendrix' },
  { name: 'The Clash' },
  { name: 'Bruce Springsteen' },
  { name: 'Tom Petty' },
  { name: 'Bob Dylan' },
  { name: 'Elton John' },

  // Alternative & Indie Rock
  { name: 'Nirvana' },
  { name: 'Radiohead' },
  { name: 'Arctic Monkeys' },
  { name: 'Linkin Park' },
  { name: 'Imagine Dragons' },
  { name: 'Red Hot Chili Peppers' },
  { name: 'Green Day' },
  { name: 'Fall Out Boy' },
  { name: 'Maroon 5' },
  { name: 'U2' },

  // Metal
  { name: 'Metallica' },
  { name: 'Iron Maiden' },
  { name: 'Black Sabbath' },
  { name: 'System Of A Down' },
  { name: 'Korn' },
  { name: 'Slipknot' },
  { name: 'Megadeth' },
  { name: 'Avenged Sevenfold' },
  { name: 'Bring Me The Horizon' },
  { name: 'Tool' },

  // Country
  { name: 'Morgan Wallen' },
  { name: 'Luke Combs' },
  { name: 'Blake Shelton' },
  { name: 'Carrie Underwood' },
  { name: 'Shania Twain' },
  { name: 'Garth Brooks' },
  { name: 'Kacey Musgraves' },
  { name: 'Keith Urban' },
  { name: 'Tim McGraw' },
  { name: 'Chris Stapleton' },

  // Electronic & Dance
  { name: 'Avicii' },
  { name: 'Calvin Harris' },
  { name: 'The Chainsmokers' },
  { name: 'Zedd' },
  { name: 'Skrillex' },
  { name: 'Daft Punk' },
  { name: 'Marshmello' },
  { name: 'Kygo' },
  { name: 'deadmau5' },
  { name: 'David Guetta' },

  // Latin & Reggaeton
  { name: 'Daddy Yankee' },
  { name: 'J Balvin' },
  { name: 'Ozuna' },
  { name: 'Selena Gomez' },
  { name: 'Shakira' },
  { name: 'Enrique Iglesias' },
  { name: 'Maluma' },
  { name: 'KAROL G' },
  { name: 'Luis Fonsi' },

  // K-Pop
  { name: 'BTS' },
  { name: 'BLACKPINK' },
  { name: 'TWICE' },
  { name: 'EXO' },
  { name: 'PSY' },

  // Additional Contemporary Pop Artists
  { name: 'Miley Cyrus' },
  { name: 'Katy Perry' },
  { name: 'Demi Lovato' },
  { name: 'Camila Cabello' },
  { name: 'Shawn Mendes' },
  { name: 'Charlie Puth' },
  { name: 'Post Malone' },
  { name: 'Doja Cat' },
  { name: 'Lizzo' },
  { name: 'Harry Styles' },
  { name: 'Sam Smith' },
  { name: 'Lewis Capaldi' },
  { name: 'Conan Gray' },
  { name: 'Tate McRae' },
  { name: 'GAYLE' },

  // Additional Hip-Hop & Rap Artists
  { name: '21 Savage' },
  { name: 'Lil Baby' },
  { name: 'DaBaby' },
  { name: 'Roddy Ricch' },
  { name: 'Lil Uzi Vert' },
  { name: 'Playboi Carti' },
  { name: 'Tyler, The Creator' },
  { name: 'Mac Miller' },

  // Additional Rock & Alternative Artists
  { name: 'Pearl Jam' },
  { name: 'Soundgarden' },
  { name: 'Alice In Chains' },
  { name: 'Rage Against The Machine' },
  { name: 'Weezer' },
  { name: 'Blink-182' },
  { name: 'My Chemical Romance' },

  // Additional Country Artists
  { name: 'Jason Aldean' },
  { name: 'Florida Georgia Line' },
  { name: 'Thomas Rhett' },
  { name: 'Dan + Shay' },
  { name: 'Zac Brown Band' },
  { name: 'Miranda Lambert' },
  { name: 'Maren Morris' },
  { name: 'Kane Brown' },
]

/**
 * Derives the primary artist ID from the current playback state.
 * Falls back to the first artist in the item if available.
 */
export function getCurrentArtistId(
  playbackState: SpotifyPlaybackState | null
): string | null {
  const itemArtist = playbackState?.item?.artists?.[0]
  return (itemArtist && itemArtist.id) || null
}

/**
 * Fetches up to MAX_GAME_OPTIONS artists related to the given artist.
 * Results are lightly shuffled to introduce variety between turns.
 * Server-side only - uses server-side Spotify API utilities.
 * @param artistId - The Spotify artist ID
 * @param token - Optional user token for authentication
 */
export async function getRelatedArtistsForGame(
  artistId: string,
  token?: string
): Promise<SpotifyArtist[]> {
  const related = await getRelatedArtistsServer(artistId, token)

  if (!related.length) return []

  // Keep the original relevance ordering from getRelatedArtistsServer
  // but request a larger buffer so we have enough candidates even if
  // some artists don't yield usable tracks.
  const desiredArtistCount = Math.max(MAX_GAME_OPTIONS * 2, 24)
  return related.slice(0, desiredArtistCount)
}

/**
 * Chooses 2 distinct target artists from the curated popular artists list.
 * These become the targets that players need to reach by selecting related songs.
 */
export function chooseTargetArtists(): TargetArtist[] {
  // Shuffle the popular artists list and take 2 distinct artists
  const shuffled = [...POPULAR_TARGET_ARTISTS].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, 2)
}

/**
 * Builds up to MAX_GAME_OPTIONS candidate tracks for the game.
 * Each option comes from a different related artist's top tracks.
 * Server-side only - uses server-side Spotify API utilities.
 * @param relatedArtists - Array of related artists
 * @param token - Optional user token for authentication
 */
export async function getGameOptionTracks(
  relatedArtists: SpotifyArtist[],
  token?: string
): Promise<GameOptionTrack[]> {
  if (!relatedArtists.length) return []

  const options: GameOptionTrack[] = []
  const seenTrackIds = new Set<string>() // Track duplicate track IDs
  const seenArtistIds = new Set<string>() // Ensure one option per artist

  // Single pass: at most one unique track per artist, in order of relevance.
  // This guarantees that options come from distinct artists.
  for (const artist of relatedArtists) {
    if (options.length >= MAX_GAME_OPTIONS) {
      break
    }

    if (!artist.id || seenArtistIds.has(artist.id)) {
      continue
    }

    const topTracks = await getArtistTopTracksServer(artist.id, token)

    // Pick the first top track that isn't a duplicate
    const uniqueTrack = topTracks.find(
      (track) => track && !seenTrackIds.has(track.id)
    )

    if (!uniqueTrack) {
      continue
    }

    seenTrackIds.add(uniqueTrack.id)
    seenArtistIds.add(artist.id)
    options.push({
      track: uniqueTrack,
      artist
    })

    if (options.length >= MAX_GAME_OPTIONS) {
      break
    }
  }

  return options
}


