import React, { useState } from 'react'
import Image from 'next/image'

export const FALLBACK_ALBUM_COVER = '/album-fallback.svg'

interface IVinylSpinningAnimationProps {
  is_playing: boolean
  albumCover?: string
}

const VinylSpinningAnimation: React.FC<IVinylSpinningAnimationProps> = ({
  is_playing,
  albumCover
}) => {
  // The cover URL that failed to load, so a new track's cover gets a fresh try
  const [failedCover, setFailedCover] = useState<string | null>(null)
  const coverSrc =
    albumCover && albumCover !== failedCover ? albumCover : FALLBACK_ALBUM_COVER

  return (
    <div className='relative flex items-center justify-center p-2'>
      <div
        className={`relative h-32 w-32 rounded-full border-8 border-gray-800 bg-black shadow-lg ${
          is_playing ? 'animate-spinSlow' : ''
        }`}
      >
        <div className='absolute inset-0 flex items-center justify-center'>
          <div className='h-20 w-20 rounded-full border-4 border-gray-900 bg-black'></div>
        </div>

        <div className='absolute inset-0 flex items-center justify-center'>
          <Image
            key={coverSrc}
            src={coverSrc}
            alt='Album Cover'
            width={80}
            height={80}
            className='h-20 w-20 rounded-full border-2 border-gray-800 object-cover'
            unoptimized
            onError={() => {
              if (albumCover) setFailedCover(albumCover)
            }}
          />
        </div>

        <div className='absolute inset-0 flex items-center justify-center'>
          <div className='h-3 w-3 rounded-full bg-gray-600'></div>
        </div>
      </div>
    </div>
  )
}

export default VinylSpinningAnimation
