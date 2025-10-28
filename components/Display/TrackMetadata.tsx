'use client'

import { memo } from 'react'
import type { ReactElement } from 'react'
import Image from 'next/image'
import type { ColorPalette } from '@/shared/utils/colorExtraction'

interface TrackMetadataProps {
  trackName: string
  artistName: string
  albumName: string
  albumArtUrl: string
  explicit: boolean
  colors: ColorPalette
}

function TrackMetadata({
  trackName,
  artistName,
  albumName,
  albumArtUrl,
  explicit,
  colors
}: TrackMetadataProps): ReactElement {
  return (
    <div className='flex items-center justify-center gap-4 text-center sm:gap-6 md:gap-8'>
      {/* Album Artwork */}
      <div className='relative h-24 w-24 flex-shrink-0 overflow-hidden rounded-lg shadow-2xl sm:h-32 sm:w-32 md:h-40 md:w-40'>
        <Image
          src={albumArtUrl}
          alt={albumName}
          fill
          className='animate-float object-cover transition-transform duration-500'
          sizes='(max-width: 640px) 96px, (max-width: 768px) 128px, 160px'
        />
        {explicit && (
          <div className='text-white absolute right-2 top-2 rounded bg-black/80 px-2 py-1 text-xs font-bold'>
            E
          </div>
        )}
      </div>

      {/* Track Info */}
      <div className='flex flex-col items-start gap-1 text-left sm:gap-2'>
        {/* Track Name */}
        <div
          className='max-w-md text-lg font-bold transition-colors duration-500 sm:text-xl md:text-2xl lg:text-3xl'
          style={{ color: colors.foreground }}
        >
          {trackName}
        </div>

        {/* Artist */}
        <div
          className='text-sm opacity-80 transition-colors duration-500 sm:text-base md:text-lg lg:text-xl'
          style={{ color: colors.accent1 }}
        >
          {artistName}
        </div>

        {/* Album */}
        <div
          className='text-xs opacity-60 transition-colors duration-500 sm:text-sm md:text-base'
          style={{ color: colors.accent2 }}
        >
          {albumName}
        </div>
      </div>
    </div>
  )
}

export default memo(TrackMetadata)
