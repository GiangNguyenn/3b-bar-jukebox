import React, { memo } from 'react'
import VinylSpinningAnimation from './VinylSpinningAnimation'
import { SpotifyPlaybackState } from '@/shared/types'

interface INowPlayingProps {
  nowPlaying?: SpotifyPlaybackState
}

const NowPlaying: React.FC<INowPlayingProps> = memo(({ nowPlaying }) => {
  if (!nowPlaying?.item) {
    return (
      <div className="bg-white flex flex-col items-center justify-start rounded-lg p-2 shadow-lg sm:flex-row">
        <VinylSpinningAnimation is_playing={nowPlaying?.is_playing ?? false} />
        <div className="flex w-full flex-col px-3 text-center sm:text-left">
          <span className="text-sm font-medium text-gray-500">
            🎵 Nothing is playing right now, you can still add your track
          </span>
        </div>
      </div>
    )
  }

  const { item: nowPlayingTrack, is_playing } = nowPlaying
  const { name, artists, album } = nowPlayingTrack

  return (
    <div className="bg-white flex flex-col items-center justify-start rounded-lg p-2 shadow-lg sm:flex-row">
      <VinylSpinningAnimation
        is_playing={is_playing}
        albumCover={album.images[0].url}
      />
      <div className="flex w-full flex-col px-3 text-center sm:text-left">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-600">
          Now Playing
        </span>
        <span className="truncate pt-1 text-sm font-semibold capitalize text-secondary-500">
          {name}
        </span>
        <span className="truncate text-xs font-medium uppercase text-gray-500">
          - {artists.map((artist) => artist.name).join(', ')}
        </span>
      </div>
    </div>
  )
})

NowPlaying.displayName = 'NowPlaying'

export default NowPlaying
