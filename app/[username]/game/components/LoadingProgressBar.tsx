'use client'

import { useState, useEffect } from 'react'

export function LoadingProgressBar(): JSX.Element {
  const [progress, setProgress] = useState(0)
  const [stage, setStage] = useState('Analyzing track energy...')

  useEffect(() => {
    // Total expected duration ~12s
    const intervals = [
      { p: 10, t: 500, label: 'Analyzing track metadata...' },
      { p: 30, t: 2000, label: 'Finding related artists...' },
      { p: 60, t: 5000, label: 'Scoring candidates...' },
      { p: 85, t: 9000, label: 'Finalizing recommendations...' },
      { p: 95, t: 12000, label: 'Almost ready...' }
    ]

    const timers = intervals.map(({ p, t, label }) => {
      return setTimeout(() => {
        setProgress(p)
        setStage(label)
      }, t)
    })

    return () => {
      timers.forEach(clearTimeout)
    }
  }, [])

  return (
    <div className='mx-auto flex w-full max-w-lg items-center justify-center gap-4 rounded-lg border border-blue-500/30 bg-blue-950/20 px-6 py-4'>
      <div className='flex w-full flex-col gap-2'>
        <div className='flex items-center justify-between text-xs'>
          <span className='font-medium text-blue-300'>{stage}</span>
          <span className='text-blue-400/70'>{progress}%</span>
        </div>
        <div className='h-2 w-full overflow-hidden rounded-full bg-blue-950/50'>
          <div
            className='h-full rounded-full bg-blue-500 transition-all duration-1000 ease-out'
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  )
}
