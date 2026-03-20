'use client'

import { useState, useEffect } from 'react'
import { DJService } from '@/services/djService'

export function DuckOverlayToggle(): JSX.Element {
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    setChecked(localStorage.getItem('duckOverlayMode') === 'true')
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const enabled = e.target.checked
    setChecked(enabled)
    localStorage.setItem('duckOverlayMode', String(enabled))
    DJService.getInstance().setDuckOverlay(enabled)
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
        <span className='text-white text-sm font-semibold'>
          Duck &amp; Overlay
        </span>
      </label>
    </div>
  )
}
