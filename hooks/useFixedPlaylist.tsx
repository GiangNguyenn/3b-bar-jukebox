import { SpotifyPlaylistItem, SpotifyPlaylists } from '@/shared/types'
import { sendApiRequest } from '../shared/api'
import { useMyPlaylists } from './useMyPlaylists'
import { useEffect, useState } from 'react'
import { ERROR_MESSAGES, ErrorMessage } from '@/shared/constants/errors'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { useParams, usePathname } from 'next/navigation'

const MAX_RETRIES = 3
const RETRY_DELAY = 1000 // 1 second

export function useFixedPlaylist() {
  const params = useParams()
  const pathname = usePathname()
  const displayName = params?.username as string | undefined
  const supabase = createClientComponentClient()
  const [fixedPlaylistId, setFixedPlaylistId] = useState<string | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isInitialFetchComplete, setIsInitialFetchComplete] = useState(false)

  useEffect(() => {
    // Reset state when displayName changes
    setFixedPlaylistId(null)
    setError(null)
    setIsLoading(true)
    setIsInitialFetchComplete(false)

    // If we're on the home page, we don't need to fetch a playlist
    if (pathname === '/') {
      setIsLoading(false)
      setIsInitialFetchComplete(true)
      return
    }

    // If no displayName, we're done loading
    if (!displayName) {
      setError(new Error('Display name is required'))
      setIsLoading(false)
      setIsInitialFetchComplete(true)
      return
    }

    const fetchPlaylistId = async () => {
      try {
        // Get the user's profile ID using their display_name
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('id')
          .eq('display_name', displayName)
          .single()

        if (profileError) {
          console.error(
            '[Fixed Playlist] Error fetching profile:',
            profileError
          )
          throw new Error('Failed to fetch user profile')
        }

        if (!profile) {
          console.error(
            '[Fixed Playlist] Profile not found for display name:',
            displayName
          )
          throw new Error('User profile not found')
        }

        // Get their playlist ID
        const { data: playlist, error: playlistError } = await supabase
          .from('playlists')
          .select('spotify_playlist_id')
          .eq('user_id', profile.id)
          .single()

        if (playlistError) {
          console.error(
            '[Fixed Playlist] Error fetching playlist:',
            playlistError
          )
          throw new Error('Failed to fetch playlist')
        }

        if (!playlist) {
          console.error(
            '[Fixed Playlist] Required playlist not found: 3B Saigon'
          )
          throw new Error('Required playlist not found')
        }

        setFixedPlaylistId(playlist.spotify_playlist_id)
      } catch (err) {
        console.error('[Fixed Playlist] Error:', err)
        setError(
          err instanceof Error ? err : new Error('An unknown error occurred')
        )
      } finally {
        setIsLoading(false)
        setIsInitialFetchComplete(true)
      }
    }

    void fetchPlaylistId()
  }, [displayName, supabase, pathname])

  return {
    fixedPlaylistId,
    error,
    isLoading,
    isInitialFetchComplete
  }
}
