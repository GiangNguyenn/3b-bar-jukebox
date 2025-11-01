'use client'

import { memo, useState, useCallback, useEffect } from 'react'
import type { ReactElement } from 'react'
import Image from 'next/image'
import type { ColorPalette } from '@/shared/utils/colorExtraction'
import VinylRecordPlaceholder from './VinylRecordPlaceholder'

interface TrackMetadataProps {
  trackName: string
  artistName: string
  albumName: string
  albumArtUrl: string | undefined
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
  const [imageError, setImageError] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const [imageKey, setImageKey] = useState(0)
  const [imageLoaded, setImageLoaded] = useState(false)

  const handleImageError = useCallback(() => {
    if (retryCount < 2) {
      // Retry up to 2 times
      setRetryCount((prev) => prev + 1)
      setImageKey((prev) => prev + 1)
    } else if (retryCount === 2 && albumArtUrl) {
      // Final attempt: try cache-busting by adding timestamp
      setRetryCount((prev) => prev + 1)
      setImageKey((prev) => prev + 1)
    } else {
      // After all retries, show placeholder
      setImageError(true)
    }
  }, [retryCount, albumArtUrl])

  // Reset error state when albumArtUrl changes
  useEffect(() => {
    setImageError(false)
    setRetryCount(0)
    setImageKey(0)
    setImageLoaded(false)
  }, [albumArtUrl])

  // Use cache-busting URL on final retry attempt
  const imageSrc: string | undefined =
    retryCount === 3 && albumArtUrl
      ? `${albumArtUrl}${albumArtUrl.includes('?') ? '&' : '?'}_cb=${Date.now()}`
      : albumArtUrl

  const showPlaceholder = !albumArtUrl || imageError

  return (
    <div className='flex items-center justify-center gap-4 text-center sm:gap-6 md:gap-8'>
      {/* Album Artwork */}
      <div className='relative h-80 w-80 flex-shrink-0 overflow-hidden rounded-lg shadow-2xl sm:h-96 sm:w-96 md:h-[448px] md:w-[448px] lg:h-[512px] lg:w-[512px]'>
        {showPlaceholder ? (
          <VinylRecordPlaceholder className='h-full w-full' size={512} />
        ) : (
          <>
            <Image
              key={imageKey}
              src={imageSrc!}
              alt={albumName}
              fill
              priority
              unoptimized
              crossOrigin='anonymous'
              fetchPriority='high'
              className='animate-float object-cover transition-opacity duration-300'
              sizes='(max-width: 640px) 320px, (max-width: 768px) 384px, (max-width: 1024px) 448px, 512px'
              onError={handleImageError}
              onLoadingComplete={() => setImageLoaded(true)}
            />
            {!imageLoaded && (
              <div className='absolute inset-0 animate-pulse bg-gray-800' />
            )}
          </>
        )}
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
