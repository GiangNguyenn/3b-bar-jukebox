'use client'

import { FaCrown } from 'react-icons/fa'

interface PremiumNoticeProps {
  className?: string
}

export function PremiumNotice({
  className = ''
}: PremiumNoticeProps): JSX.Element {
  return (
    <div
      className={`rounded-lg border border-yellow-500/30 bg-gradient-to-r from-yellow-600/20 to-orange-600/20 p-4 ${className}`}
    >
      <div className='flex items-center gap-3'>
        <FaCrown className='h-5 w-5 text-yellow-400' />
        <div className='flex-1'>
          <h3 className='mb-1 text-lg font-semibold text-yellow-400'>
            Premium Feature
          </h3>
          <p className='text-sm text-gray-300'>
            Upgrade to Premium to enable these features and unlock the full
            potential of your jukebox.
          </p>
        </div>
      </div>
    </div>
  )
}
