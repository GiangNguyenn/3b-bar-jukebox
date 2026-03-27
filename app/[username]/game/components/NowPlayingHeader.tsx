'use client'

import React from 'react'

export interface NowPlayingHeaderProps {
  trackName: string | null
  artistName: string | null
  albumArtUrl: string | null
}

export function NowPlayingHeader({
  trackName,
  artistName,
  albumArtUrl
}: NowPlayingHeaderProps): React.ReactElement {
  if (!trackName || !artistName) {
    return (
      <div className='my-4 flex flex-col items-center justify-center rounded-xl bg-zinc-900/50 p-8 text-center'>
        <h2 className='text-xl font-bold text-zinc-300'>
          Waiting for music...
        </h2>
        <p className='mt-2 text-sm text-zinc-500'>
          The game will begin when the next song starts playing.
        </p>
      </div>
    )
  }

  return (
    <div className='mb-6 flex flex-col items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 shadow-inner sm:flex-row sm:items-start md:p-6'>
      {albumArtUrl ? (
        <img
          src={albumArtUrl}
          alt={`Album art for ${trackName}`}
          className='h-32 w-32 rounded-lg object-cover shadow-xl sm:h-24 sm:w-24'
        />
      ) : (
        <div className='flex h-32 w-32 items-center justify-center rounded-lg bg-zinc-800 shadow-xl sm:h-24 sm:w-24'>
          <span className='text-zinc-500'>No Art</span>
        </div>
      )}
      <div className='mt-2 flex-1 overflow-hidden text-center sm:mt-0 sm:text-left'>
        <h2
          className='text-white w-full truncate text-2xl font-black'
          title={trackName}
        >
          {trackName}
        </h2>
        <p
          className='mt-1 w-full truncate text-lg text-zinc-400'
          title={artistName}
        >
          {artistName}
        </p>
      </div>
    </div>
  )
}
