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
      <div className='relative h-80 w-80 flex-shrink-0 overflow-hidden rounded-lg shadow-2xl sm:h-96 sm:w-96 md:h-[448px] md:w-[448px] lg:h-[512px] lg:w-[512px]'>
        <Image
          src={albumArtUrl}
          alt={albumName}
          fill
          className='animate-float object-cover transition-transform duration-500'
          sizes='(max-width: 640px) 320px, (max-width: 768px) 384px, (max-width: 1024px) 448px, 512px'
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
          className='max-w-md text-4xl font-bold transition-colors duration-500 sm:text-6xl md:text-8xl lg:text-9xl xl:text-[144px]'
          style={{ color: colors.foreground }}
        >
          {trackName}
        </div>

        {/* Artist */}
        <div
          className='text-4xl opacity-80 transition-colors duration-500 sm:text-6xl md:text-7xl lg:text-8xl'
          style={{ color: colors.accent1 }}
        >
          {artistName}
        </div>

        {/* Album */}
        <div
          className='text-2xl opacity-60 transition-colors duration-500 sm:text-3xl md:text-4xl'
          style={{ color: colors.accent2 }}
        >
          {albumName}
        </div>
      </div>
    </div>
  )
}

export default memo(TrackMetadata)
