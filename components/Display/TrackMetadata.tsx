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

      {/* Track Info - Same size as album art */}
      <div className='relative h-80 w-80 flex-shrink-0 overflow-hidden px-4 py-6 sm:h-96 sm:w-96 sm:px-6 sm:py-8 md:h-[448px] md:w-[448px] md:px-8 md:py-10 lg:h-[512px] lg:w-[512px] lg:px-10 lg:py-12'>
        <div className='flex h-full flex-col justify-center gap-1 text-left sm:gap-2'>
          {/* Track Name */}
          <div
            className='line-clamp-3 font-bold leading-tight transition-colors duration-500'
            style={{
              color: colors.foreground,
              fontSize: 'clamp(1.5rem, 8vw, 4rem)'
            }}
          >
            {trackName}
          </div>

          {/* Artist */}
          <div
            className='line-clamp-2 leading-tight transition-colors duration-500'
            style={{
              color: colors.accent1,
              fontSize: 'clamp(1.25rem, 6vw, 3rem)',
              textShadow: `2px 2px 4px rgba(0, 0, 0, 0.8), 
                          -1px -1px 2px rgba(0, 0, 0, 0.8), 
                          1px -1px 2px rgba(0, 0, 0, 0.8), 
                          -1px 1px 2px rgba(0, 0, 0, 0.8),
                          1px 1px 2px rgba(0, 0, 0, 0.8)`
            }}
          >
            {artistName}
          </div>

          {/* Album */}
          <div
            className='line-clamp-2 leading-tight transition-colors duration-500'
            style={{
              color: colors.accent2,
              fontSize: 'clamp(1rem, 4vw, 2rem)',
              textShadow: `2px 2px 4px rgba(0, 0, 0, 0.8), 
                          -1px -1px 2px rgba(0, 0, 0, 0.8), 
                          1px -1px 2px rgba(0, 0, 0, 0.8), 
                          -1px 1px 2px rgba(0, 0, 0, 0.8),
                          1px 1px 2px rgba(0, 0, 0, 0.8)`
            }}
          >
            {albumName}
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(TrackMetadata)
