import React, { useState } from 'react'
import { FALLBACK_ALBUM_COVER } from './VinylSpinningAnimation'

interface INowPlayingBannerProps {
  trackName: string
  artistName: string
  albumCover?: string
}

/**
 * Full-width now playing banner: the square cover on the left, the track
 * title and artist on the right, over a blurred, darkened copy of the cover.
 * Falls back to a placeholder cover and a dark gradient when the artwork is
 * missing or fails to load.
 */
const NowPlayingBanner: React.FC<INowPlayingBannerProps> = ({
  trackName,
  artistName,
  albumCover
}) => {
  // The cover URL that failed to load, so a new track's cover gets a fresh try
  const [failedCover, setFailedCover] = useState<string | null>(null)
  const hasCover = Boolean(albumCover) && albumCover !== failedCover
  const coverSrc = hasCover ? albumCover! : FALLBACK_ALBUM_COVER

  return (
    <div className='relative flex h-[150px] w-full items-center overflow-hidden rounded-md bg-gradient-to-br from-gray-800 to-black'>
      {hasCover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={coverSrc}
          alt=''
          aria-hidden='true'
          className='absolute inset-0 h-full w-full scale-125 object-cover blur-2xl'
        />
      )}
      <div className='absolute inset-0 bg-black/60' />

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={coverSrc}
        src={coverSrc}
        alt={hasCover ? `${trackName} album cover` : 'No album cover available'}
        className='relative h-[110px] w-[110px] shrink-0 rounded-md object-cover shadow-lg sm:h-[150px] sm:w-[150px]'
        onError={() => {
          if (albumCover) setFailedCover(albumCover)
        }}
      />

      <div className='relative flex min-w-0 flex-col px-4 text-left [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]'>
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
