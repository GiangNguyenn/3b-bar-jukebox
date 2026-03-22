'use client'

import { useState, useEffect } from 'react'
import { DJService } from '@/services/djService'

export type DJLanguage = 'english' | 'vietnamese'

const OPTIONS: { value: DJLanguage; label: string }[] = [
  { value: 'english', label: 'English' },
  { value: 'vietnamese', label: 'Vietnamese' }
]

export function DJLanguageSelect(): JSX.Element {
  const [djEnabled, setDjEnabled] = useState(false)
  const [language, setLanguage] = useState<DJLanguage>('english')

  useEffect(() => {
    const sync = (): void => {
      setDjEnabled(localStorage.getItem('djMode') === 'true')
      const stored = localStorage.getItem('djLanguage') as DJLanguage | null
      setLanguage(stored === 'vietnamese' ? 'vietnamese' : 'english')
    }
    sync()
    window.addEventListener('storage', sync)
    window.addEventListener('djmode-changed', sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener('djmode-changed', sync)
    }
  }, [])

  if (!djEnabled) return null as unknown as JSX.Element

  const handleSelect = (value: DJLanguage): void => {
    setLanguage(value)
    localStorage.setItem('djLanguage', value)
    window.dispatchEvent(new Event('djlanguage-changed'))
    DJService.getInstance().invalidatePrefetch()
  }

  return (
    <div className='py-1'>
      <span className='text-white text-sm font-semibold'>DJ Language</span>
      <div className='mt-1 flex flex-wrap gap-1'>
        {OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            type='button'
            onClick={() => handleSelect(value)}
            className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
              language === value
                ? 'text-white bg-green-600'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
