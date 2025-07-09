import { SpotifyPlaylistItem } from '@/shared/types/spotify'
import { sendApiRequest } from '../shared/api'
import { useMyPlaylists } from './useMyPlaylists'
import { useEffect, useState, useRef } from 'react'
import { ERROR_MESSAGES, ErrorMessage } from '@/shared/constants/errors'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/supabase'
import { useParams, usePathname, useRouter } from 'next/navigation'

const MAX_RETRIES = 3
const RETRY_DELAY = 1000 // 1 second

export function useFixedPlaylist() {
  const router = useRouter()
  const params = useParams()
  const pathname = usePathname()
  const displayName = params?.username as string | undefined
  const [fixedPlaylistId, setFixedPlaylistId] = useState<string | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isInitialFetchComplete, setIsInitialFetchComplete] = useState(false)
  const isFetchingRef = useRef(false)

  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    console.log(
      '[FixedPlaylist] Effect triggered with displayName:',
      displayName,
      'pathname:',
      pathname
    )

    const fetchPlaylistId = async () => {
      if (isFetchingRef.current) {
        return
      }
      isFetchingRef.current = true
      setIsLoading(true)

      try {
        console.log(
          '[FixedPlaylist] Fetching profile for display name:',
          displayName
        )
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('id, spotify_access_token')
          .ilike('display_name', displayName)
          .single()

        if (profileError) {
          console.error('[FixedPlaylist] Error fetching profile:', profileError)
          throw new Error('Failed to fetch user profile')
        }

        if (!profile) {
          console.error(
            '[FixedPlaylist] Profile not found for display name:',
            displayName
          )
          throw new Error('User profile not found')
        }

        console.log('[FixedPlaylist] Found profile:', profile.id)

        const { data: playlist, error: playlistError } = await supabase
          .from('playlists')
          .select('spotify_playlist_id')
          .eq('user_id', profile.id)
          .single()

        if (playlistError) {
          console.error(
            '[FixedPlaylist] Error fetching playlist:',
            playlistError
          )
          throw new Error('Failed to fetch playlist')
        }

        if (!playlist) {
          console.error(
            '[FixedPlaylist] Required playlist not found for user:',
            profile.id
          )
          throw new Error('Required playlist not found')
        }

        console.log(
          '[FixedPlaylist] Found playlist:',
          playlist.spotify_playlist_id
        )
        setFixedPlaylistId(playlist.spotify_playlist_id)
      } catch (err) {
        console.error('[FixedPlaylist] Error:', err)
        setError(
          err instanceof Error ? err : new Error('An unknown error occurred')
        )
      } finally {
        setIsLoading(false)
        setIsInitialFetchComplete(true)
        isFetchingRef.current = false
      }
    }

    if (pathname === '/') {
      console.log('[FixedPlaylist] On home page, skipping playlist fetch')
      setIsLoading(false)
      setIsInitialFetchComplete(true)
      return
    }

    if (displayName) {
      void fetchPlaylistId()
    } else {
      console.log('[FixedPlaylist] No display name provided')
      setError(new Error('Display name is required'))
      setIsLoading(false)
      setIsInitialFetchComplete(true)
    }
  }, [displayName, pathname, supabase])

  return {
    fixedPlaylistId,
    error,
    isLoading,
    isInitialFetchComplete
  }
}
