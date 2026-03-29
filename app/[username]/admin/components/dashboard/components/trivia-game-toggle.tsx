'use client'

import { useState, useEffect } from 'react'

export const TRIVIA_ENABLED_KEY = 'triviaEnabled'

export function getTriviaEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(TRIVIA_ENABLED_KEY) === 'true'
}

export function TriviaGameToggle(): JSX.Element {
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    setChecked(localStorage.getItem(TRIVIA_ENABLED_KEY) === 'true')
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const enabled = e.target.checked
    setChecked(enabled)
    localStorage.setItem(TRIVIA_ENABLED_KEY, String(enabled))
    window.dispatchEvent(new Event('trivia-enabled-changed'))
  }

  return (
    <div className='flex items-center justify-between py-1'>
      <label className='flex cursor-pointer items-center gap-2'>
        <input
          type='checkbox'
          checked={checked}
          onChange={handleChange}
          className='h-4 w-4 cursor-pointer accent-green-500'
        />
        <span className='text-white text-sm font-semibold'>Trivia Game</span>
      </label>
    </div>
  )
}
