import React, { useState } from 'react'
import VinylSpinningAnimation from './VinylSpinningAnimation'

interface INowPlayingBannerProps {
  trackName: string
  artistName: string
  albumCover?: string
  isPlaying: boolean
}

/**
 * Full-width now playing banner: the spinning vinyl with the album cover on
 * the left, the track title and artist on the right, over a blurred, darkened
 * copy of the cover. Falls back to a dark gradient when the artwork is
 * missing or fails to load (the vinyl shows its own placeholder cover).
 */
const NowPlayingBanner: React.FC<INowPlayingBannerProps> = ({
  trackName,
  artistName,
  albumCover,
  isPlaying
}) => {
  // The cover URL that failed to load, so a new track's cover gets a fresh try
  const [failedCover, setFailedCover] = useState<string | null>(null)
  const hasCover = Boolean(albumCover) && albumCover !== failedCover

  return (
    <div className='relative flex h-[150px] w-full items-center overflow-hidden rounded-md bg-gradient-to-br from-gray-800 to-black'>
      {hasCover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={albumCover}
          alt=''
          aria-hidden='true'
          className='absolute inset-0 h-full w-full scale-125 object-cover blur-2xl'
          onError={() => {
            if (albumCover) setFailedCover(albumCover)
          }}
        />
      )}
      <div className='absolute inset-0 bg-black/60' />

      <div className='relative shrink-0'>
        <VinylSpinningAnimation
          is_playing={isPlaying}
          albumCover={albumCover}
        />
      </div>

      <div className='relative flex min-w-0 flex-col pr-4 text-left [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]'>
        <div
          className='text-white line-clamp-2 text-lg font-bold leading-tight sm:text-2xl'
          title={trackName}
        >
          {trackName}
        </div>
        <div
          className='mt-1 truncate text-base text-gray-200'
          title={artistName}
        >
          {artistName}
        </div>
      </div>
    </div>
  )
}

export default NowPlayingBanner
