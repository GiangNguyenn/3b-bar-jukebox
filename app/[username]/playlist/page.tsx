'use client'

import { Suspense } from 'react'
import { useGetProfile } from '@/hooks/useGetProfile'
import { useGetPlaylist } from '@/hooks/useGetPlaylist'
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'
import { useAddTrackToPlaylist } from '@/hooks/useAddTrackToPlaylist'
import { TrackDetails, TrackItem } from '@/shared/types'
import SearchInput from '@/components/SearchInput'
import Playlist from '@/components/Playlist/Playlist'
import { handleApiError } from '@/shared/utils/errorHandling'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'

interface PlaylistPageProps {
  params: {
    username: string
  }
}

export default function PlaylistPage({ params }: PlaylistPageProps) {
  const { username } = params
  const supabase = createClientComponentClient()
  const { data: profile, error: profileError, isLoading: isProfileLoading } = useGetProfile(username)
  const { fixedPlaylistId, isLoading: isPlaylistIdLoading } = useFixedPlaylist()
  const { data: playlist, error: playlistError, isLoading: isPlaylistLoading } = useGetPlaylist(fixedPlaylistId)
  const { addTrack, optimisticTrack } = useAddTrackToPlaylist({ playlistId: fixedPlaylistId ?? '' })

  const handleAddTrack = async (track: TrackDetails): Promise<void> => {
    try {
      const trackItem: TrackItem = {
        added_at: new Date().toISOString(),
        added_by: {
          id: 'user',
          type: 'user',
          uri: 'spotify:user:user',
          href: 'https://api.spotify.com/v1/users/user',
          external_urls: {
            spotify: 'https://open.spotify.com/user/user'
          }
        },
        is_local: false,
        track
      }
      await addTrack(trackItem)
    } catch (error) {
      console.error('[PlaylistPage] Error adding track:', error)
      const appError = handleApiError(error, 'PlaylistPage')
      // You might want to show this error to the user
    }
  }

  if (profileError) {
    return <div>Error loading profile: {profileError.message}</div>
  }

  if (playlistError) {
    return <div>Error loading playlist: {playlistError.message}</div>
  }

  if (isProfileLoading || isPlaylistIdLoading || isPlaylistLoading) {
    return <div>Loading...</div>
  }

  if (!profile) {
    return <div>Profile not found</div>
  }

  if (!playlist) {
    return <div>Playlist not found</div>
  }

  return (
    <div className="w-full">
      <div className="mx-auto flex w-full flex-col space-y-6 sm:w-10/12 md:w-8/12 lg:w-9/12">
        <div className="w-full">
          <SearchInput onAddTrack={handleAddTrack} />
        </div>
        <Suspense fallback={<div>Loading playlist...</div>}>
          <Playlist tracks={playlist.tracks.items} optimisticTrack={optimisticTrack} />
        </Suspense>
      </div>
    </div>
  )
}
