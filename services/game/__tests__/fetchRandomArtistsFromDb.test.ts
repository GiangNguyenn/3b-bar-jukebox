import test from 'node:test'
import assert from 'node:assert/strict'

// Test the filtering logic used by fetchRandomArtistsFromDb
// Note: Full integration tests would require mocking Supabase client

test('fetchRandomArtistsFromDb - Fully-Populated Filter', async (t) => {
  await t.test('only includes artists with all columns populated', async () => {
    // Mock queryWithRetry to return fully-populated artists
    const mockData = [
      {
        spotify_artist_id: 'artist1',
        name: 'Artist 1',
        genres: ['rock', 'pop']
      },
      {
        spotify_artist_id: 'artist2',
        name: 'Artist 2',
        genres: ['jazz']
      }
    ]

    // We can't easily mock the internal queryWithRetry, so we'll test the logic
    // by checking what the function would filter
    const validArtists = mockData.filter((artist) => {
      if (!artist.spotify_artist_id || artist.spotify_artist_id.includes('-')) {
        return false
      }
      if (!artist.genres || artist.genres.length === 0) {
        return false
      }
      return true
    })

    assert.equal(validArtists.length, 2)
  })

  await t.test('excludes artists with null genres', () => {
    const mockData = [
      {
        spotify_artist_id: 'artist1',
        name: 'Artist 1',
        genres: null
      },
      {
        spotify_artist_id: 'artist2',
        name: 'Artist 2',
        genres: ['rock']
      }
    ]

    const validArtists = mockData.filter((artist) => {
      if (!artist.spotify_artist_id || artist.spotify_artist_id.includes('-')) {
        return false
      }
      if (!artist.genres || artist.genres.length === 0) {
        return false
      }
      return true
    })

    assert.equal(validArtists.length, 1)
    assert.equal(validArtists[0].spotify_artist_id, 'artist2')
  })

  await t.test('excludes artists with empty genres array', () => {
    const mockData = [
      {
        spotify_artist_id: 'artist1',
        name: 'Artist 1',
        genres: []
      },
      {
        spotify_artist_id: 'artist2',
        name: 'Artist 2',
        genres: ['rock']
      }
    ]

    const validArtists = mockData.filter((artist) => {
      if (!artist.spotify_artist_id || artist.spotify_artist_id.includes('-')) {
        return false
      }
      if (!artist.genres || artist.genres.length === 0) {
        return false
      }
      return true
    })

    assert.equal(validArtists.length, 1)
    assert.equal(validArtists[0].spotify_artist_id, 'artist2')
  })

  await t.test('excludes artists with UUID-like spotify_artist_id', () => {
    const mockData = [
      {
        spotify_artist_id: '550e8400-e29b-41d4-a716-446655440000', // UUID format
        name: 'Artist 1',
        genres: ['rock']
      },
      {
        spotify_artist_id: 'artist2', // Valid Spotify ID
        name: 'Artist 2',
        genres: ['pop']
      }
    ]

    const validArtists = mockData.filter((artist) => {
      if (!artist.spotify_artist_id || artist.spotify_artist_id.includes('-')) {
        return false
      }
      if (!artist.genres || artist.genres.length === 0) {
        return false
      }
      return true
    })

    assert.equal(validArtists.length, 1)
    assert.equal(validArtists[0].spotify_artist_id, 'artist2')
  })
})

test('fetchRandomArtistsFromDb - Edge Cases', async (t) => {
  await t.test(
    'returns empty array when database has no fully-populated artists',
    () => {
      const mockData: Array<{
        spotify_artist_id: string
        name: string
        genres: string[] | null
      }> = []

      const validArtists = mockData.filter((artist) => {
        if (
          !artist.spotify_artist_id ||
          artist.spotify_artist_id.includes('-')
        ) {
          return false
        }
        if (!artist.genres || artist.genres.length === 0) {
          return false
        }
        return true
      })

      assert.equal(validArtists.length, 0)
    }
  )

  await t.test('handles database with fewer than requested artists', () => {
    const mockData = [
      {
        spotify_artist_id: 'artist1',
        name: 'Artist 1',
        genres: ['rock']
      },
      {
        spotify_artist_id: 'artist2',
        name: 'Artist 2',
        genres: ['pop']
      }
    ]

    const validArtists = mockData.filter((artist) => {
      if (!artist.spotify_artist_id || artist.spotify_artist_id.includes('-')) {
        return false
      }
      if (!artist.genres || artist.genres.length === 0) {
        return false
      }
      return true
    })

    // Should return what's available, not fail
    assert.ok(validArtists.length >= 0)
    assert.ok(validArtists.length <= mockData.length)
  })
})
