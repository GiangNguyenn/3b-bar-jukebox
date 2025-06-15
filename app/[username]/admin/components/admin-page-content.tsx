/* eslint-disable @typescript-eslint/no-unsafe-assignment */
'use client'

import { useEffect, useRef, useCallback, useMemo } from 'react'
import { useGetPlaylist } from '@/hooks/useGetPlaylist'
import useNowPlayingTrack from '@/hooks/useNowPlayingTrack'
import useSWR from 'swr'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { Dashboard } from './dashboard/dashboard'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'

interface PlaylistResponse {
  fixedPlaylistId: string | null
}

interface ErrorResponse {
  error: string
}

export function AdminPageContent(): JSX.Element {
  const { addLog } = useConsoleLogsContext()
  const supabase = createClientComponentClient()

  // Get the fixed playlist
  const { data: playlistData, error: playlistError, isLoading: isPlaylistLoading } = useSWR<PlaylistResponse, Error>(
    '/api/fixed-playlist',
    async (): Promise<PlaylistResponse> => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        throw new Error('No authenticated session')
      }

      // Get a fresh token before making the request
      const tokenResponse = await fetch('/api/token')
      if (!tokenResponse.ok) {
        throw new Error('Failed to get valid token')
      }

      const response = await fetch('/api/fixed-playlist', {
        credentials: 'include'
      })
      
      if (!response.ok) {
        const errorData = await response.json() as ErrorResponse
        throw new Error(errorData.error ?? 'Failed to fetch playlist')
      }
      return response.json() as Promise<PlaylistResponse>
    }
  )

  // Initialize hooks with proper dependencies
  const { data: playlist, error: spotifyPlaylistError } = useGetPlaylist(
    playlistData?.fixedPlaylistId ?? null
  )
  
  // Use selectors to prevent unnecessary re-renders
  const { error: nowPlayingError } = useNowPlayingTrack()

  // Log errors using ConsoleLogsProvider
  useEffect(() => {
    if (playlistError) {
      addLog(
        'ERROR',
        `[Playlist] Error loading playlist: ${playlistError.message}`,
        'Playlist',
        playlistError
      )
    }
    if (spotifyPlaylistError) {
      addLog(
        'ERROR',
        `[Spotify] Error loading playlist: ${spotifyPlaylistError.message}`,
        'Spotify',
        spotifyPlaylistError
      )
    }
    if (nowPlayingError) {
      addLog(
        'ERROR',
        `[Now Playing] Error: ${nowPlayingError.message}`,
        'Now Playing',
        nowPlayingError
      )
    }
  }, [playlistError, spotifyPlaylistError, nowPlayingError, addLog])

  // Memoize loading state
  const isLoading = useMemo((): boolean => {
    return isPlaylistLoading
  }, [isPlaylistLoading])

  // Memoize content to prevent unnecessary re-renders
  const content = useMemo((): JSX.Element => {
    if (isLoading) {
      return (
        <div className="flex h-[50vh] items-center justify-center">
          <div className="text-center">
            <div className="mb-4 text-lg text-white">Loading...</div>
            <div className="border-white mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-t-2"></div>
          </div>
        </div>
      )
    }

    if (playlistError?.message === 'No authenticated session') {
      return (
        <div className="flex h-[50vh] items-center justify-center">
          <div className="text-center text-red-500">
            Please sign in to access the admin page.
          </div>
        </div>
      )
    }

    if (playlistError?.message === 'Failed to get valid token') {
      return (
        <div className="flex h-[50vh] items-center justify-center">
          <div className="text-center text-red-500">
            Unable to authenticate with Spotify. Please try again later.
          </div>
        </div>
      )
    }

    return (
      <div className="space-y-6">
        {playlistError && (
          <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
            <p className="text-sm text-destructive">Error loading playlist: {playlistError.message}</p>
          </div>
        )}
        <Dashboard />
      </div>
    )
  }, [playlist, playlistError, isLoading])

  return content
} 