'use client'

import React from 'react'

export interface NowPlayingHeaderProps {
  trackName: string | null
  artistName: string | null
  albumArtUrl: string | null
}

export function NowPlayingHeader({ trackName, artistName, albumArtUrl }: NowPlayingHeaderProps): React.ReactElement {
  if (!trackName || !artistName) {
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-zinc-900/50 rounded-xl my-4 text-center">
        <h2 className="text-xl font-bold text-zinc-300">Waiting for music...</h2>
        <p className="text-sm text-zinc-500 mt-2">The game will begin when the next song starts playing.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 p-4 md:p-6 bg-zinc-900/40 rounded-xl mb-6 shadow-inner border border-zinc-800">
      {albumArtUrl ? (
        <img
          src={albumArtUrl}
          alt={`Album art for ${trackName}`}
          className="w-32 h-32 sm:w-24 sm:h-24 rounded-lg shadow-xl object-cover"
        />
      ) : (
        <div className="w-32 h-32 sm:w-24 sm:h-24 rounded-lg shadow-xl bg-zinc-800 flex items-center justify-center">
          <span className="text-zinc-500">No Art</span>
        </div>
      )}
      <div className="flex-1 text-center sm:text-left mt-2 sm:mt-0 overflow-hidden">
        <h2 className="text-2xl font-black text-white truncate w-full" title={trackName}>
          {trackName}
        </h2>
        <p className="text-lg text-zinc-400 mt-1 truncate w-full" title={artistName}>
          {artistName}
        </p>
      </div>
    </div>
  )
}
