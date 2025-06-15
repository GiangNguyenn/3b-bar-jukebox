'use client'

import { useState } from 'react'

export function TrackSuggestions(): JSX.Element {
  const [suggestions] = useState<string[]>([])

  return (
    <div className='space-y-4'>
      {suggestions.length > 0 ? (
        <div className='rounded-lg border border-gray-800 bg-gray-900/50 p-4'>
          <h3 className='mb-2 text-lg font-semibold text-white'>
            Recent Suggestions
          </h3>
          <ul className='space-y-2'>
            {suggestions.map((suggestion, index) => (
              <li
                key={index}
                className='rounded bg-gray-800 p-2 text-sm text-gray-300'
              >
                {suggestion}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className='rounded-lg border border-gray-800 bg-gray-900/50 p-4'>
          <p className='text-sm text-gray-400'>No track suggestions available</p>
        </div>
      )}
    </div>
  )
} 