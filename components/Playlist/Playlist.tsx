'use client'

import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { JukeboxQueueItem } from '@/shared/types/queue'
import QueueItem from './QueueItem'
import NowPlaying from './NowPlaying'

interface PlaylistProps {
  tracks: JukeboxQueueItem[]
  currentlyPlaying?: SpotifyPlaybackState | null
  artistExtract: string | null
  isExtractLoading: boolean
  extractError: Error | null
  onVote: (queueId: string, direction: 'up' | 'down') => void
  isRefreshing?: boolean
  pendingVotes?: Record<string, boolean>
  highlightSpotifyTrackId?: string | null
  primaryColor?: string
  textColor?: string
  secondaryColor?: string
  accentColor2?: string
  accentColor1?: string
  accentColor3?: string
  username?: string
}

export default function Playlist({
  tracks,
  currentlyPlaying,
  artistExtract,
  isExtractLoading,
  extractError,
  onVote,
  isRefreshing = false,
  pendingVotes,
  highlightSpotifyTrackId,
  primaryColor,
  textColor,
  secondaryColor,
  accentColor2,
  accentColor1,
  accentColor3,
  username
}: PlaylistProps): JSX.Element {
  const tracksToShow = tracks.filter((item) => {
    if (!currentlyPlaying) return true
    return item.tracks.spotify_track_id !== currentlyPlaying?.item?.id
  })

  return (
    <div className='w-full'>
      <div
        className='mx-auto flex w-full overflow-hidden rounded-lg shadow-md sm:w-10/12 md:w-8/12 lg:w-9/12'
        style={{ backgroundColor: primaryColor ?? '#C09A5E' }}
      >
        <div className='flex w-full flex-col'>
          <NowPlaying
            nowPlaying={currentlyPlaying ?? undefined}
            artistExtract={artistExtract}
            isExtractLoading={isExtractLoading}
            extractError={extractError}
            textColor={textColor}
            secondaryColor={secondaryColor}
            username={username}
          />
          <div className='flex flex-col p-5'>
            <div
              className='mb-2 flex items-center justify-between border-b pb-1'
              style={{ borderBottomColor: accentColor1 }}
            >
              <span className='text-base font-semibold uppercase text-gray-700'>
                Playlist Queue
              </span>
              {isRefreshing && (
                <div className='flex items-center gap-2 text-xs text-gray-500'>
                  <div className='h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600'></div>
                  <span>Updating...</span>
                </div>
              )}
            </div>
            <div className='flex max-h-[calc(100vh-16rem)] flex-col space-y-2 overflow-y-auto'>
              {tracksToShow.map((item) => (
                <QueueItem
                  key={item.id}
                  track={item}
                  votes={item.votes}
                  queueId={item.id}
                  onVote={onVote}
                  isVoting={pendingVotes ? !!pendingVotes[item.id] : false}
                  isHighlighted={
                    !!(
                      highlightSpotifyTrackId &&
                      item.tracks.spotify_track_id === highlightSpotifyTrackId
                    )
                  }
                  isPlaying={
                    !!(
                      currentlyPlaying?.item?.id &&
                      item.tracks.spotify_track_id === currentlyPlaying.item.id
                    )
                  }
                  textColor={textColor}
                  secondaryColor={secondaryColor}
                  accentColor2={accentColor2}
                  accentColor3={accentColor3}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
