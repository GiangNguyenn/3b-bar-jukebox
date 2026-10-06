import React, { memo } from 'react'
import VinylSpinningAnimation from './VinylSpinningAnimation'
import NowPlayingBanner from './NowPlayingBanner'
import { SpotifyPlaybackState } from '@/shared/types/spotify'

interface INowPlayingProps {
  nowPlaying?: SpotifyPlaybackState
  artistExtract: string | null
  isExtractLoading: boolean
  extractError: Error | null
  textColor?: string
  secondaryColor?: string
  username?: string
}

const NowPlaying: React.FC<INowPlayingProps> = memo(
  ({
    nowPlaying,
    artistExtract,
    isExtractLoading,
    extractError,
    textColor = '#000000',
    secondaryColor = '#6b7280',
    username
  }) => {
    if (!nowPlaying?.item) {
      return (
        <div className='bg-white flex flex-col items-center justify-start rounded-lg p-2 shadow-lg sm:flex-row'>
          <VinylSpinningAnimation
            is_playing={nowPlaying?.is_playing ?? false}
          />
          <div className='flex w-full flex-col px-3 text-center sm:text-left'>
            <span className='text-sm font-medium text-gray-500'>
              🎵 Nothing is playing right now, you can still add your track
            </span>
          </div>
        </div>
      )
    }

    const { item: nowPlayingTrack, is_playing } = nowPlaying
    const { name, artists, album } = nowPlayingTrack
    const is3B = username?.toLowerCase() === '3b'
    const albumCover = album?.images?.[0]?.url || undefined
    const artistNames = artists.map((artist) => artist.name).join(', ')

    return (
      <div className='bg-white flex flex-col items-center justify-start rounded-lg p-2 shadow-lg sm:flex-row'>
        <VinylSpinningAnimation
          is_playing={is_playing}
          albumCover={albumCover}
        />
        <div className='flex w-full flex-col px-3 text-center sm:text-left'>
          <span className='text-xs font-bold uppercase tracking-wide text-gray-600'>
            Now Playing
          </span>
          {is3B ? (
            <NowPlayingBanner
              trackName={name}
              artistName={artistNames}
              albumCover={albumCover}
            />
          ) : (
            <>
              <div
                className='truncate text-base font-semibold'
                style={{ color: textColor }}
              >
                {name}
              </div>
              <div
                className='truncate text-sm'
                style={{ color: secondaryColor }}
              >
                - {artistNames}
              </div>
            </>
          )}
          {isExtractLoading && (
            <span className='text-xs italic text-gray-500'>
              Loading artist info...
            </span>
          )}
          {extractError && (
            <span className='text-xs text-red-500'>
              Could not load artist info.
            </span>
          )}
          {artistExtract && (
            <p className='mt-2 text-xs text-gray-700'>{artistExtract}</p>
          )}
        </div>
      </div>
    )
  }
)

NowPlaying.displayName = 'NowPlaying'

export default NowPlaying
