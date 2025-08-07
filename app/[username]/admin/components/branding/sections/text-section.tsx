'use client'

import { Card } from '@/components/ui/card'
import type { BrandingSettings } from '../types'

interface TextSectionProps {
  settings: BrandingSettings
  onUpdate: (updates: Partial<BrandingSettings>) => void
}

export function TextSection({
  settings,
  onUpdate
}: TextSectionProps): JSX.Element {
  return (
    <div className='space-y-6'>
      <Card className='p-6'>
        <h3 className='mb-4 text-lg font-semibold'>Venue Information</h3>
        <div className='space-y-4'>
          <div>
            <label
              htmlFor='venue-name'
              className='mb-2 block text-sm font-medium text-gray-700'
            >
              Venue Name
            </label>
            <input
              id='venue-name'
              type='text'
              value={settings.venue_name ?? ''}
              onChange={(e) => onUpdate({ venue_name: e.target.value })}
              maxLength={50}
              placeholder='3B Jukebox'
              className='w-full rounded-md border border-gray-300 px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500'
            />
            <p className='mt-1 text-sm text-gray-500'>
              Main header title displayed prominently on the playlist page. Uses
              your typography settings (font, size, weight, color). Max 50
              characters.
            </p>
          </div>

          <div>
            <label
              htmlFor='subtitle'
              className='mb-2 block text-sm font-medium text-gray-700'
            >
              Subtitle/Tagline
            </label>
            <input
              id='subtitle'
              type='text'
              value={settings.subtitle ?? ''}
              onChange={(e) => onUpdate({ subtitle: e.target.value })}
              maxLength={100}
              placeholder='The Ultimate Shared Music Experience'
              className='w-full rounded-md border border-gray-300 px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500'
            />
            <p className='mt-1 text-sm text-gray-500'>
              Optional subtitle displayed below the venue name. Uses secondary
              color and typography settings. Max 100 characters.
            </p>
          </div>
        </div>
      </Card>

      <Card className='p-6'>
        <h3 className='mb-4 text-lg font-semibold'>Welcome Message</h3>
        <div className='space-y-4'>
          <div>
            <label
              htmlFor='welcome-message'
              className='mb-2 block text-sm font-medium text-gray-700'
            >
              Welcome Message
            </label>
            <textarea
              id='welcome-message'
              value={settings.welcome_message ?? ''}
              onChange={(e) => onUpdate({ welcome_message: e.target.value })}
              maxLength={500}
              rows={4}
              placeholder='Welcome to our jukebox! Select your favorite songs...'
              className='resize-vertical w-full rounded-md border border-gray-300 px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500'
            />
            <p className='mt-1 text-sm text-gray-500'>
              Personalized greeting text that replaces &quot;Loading...&quot;
              during page load. Uses text color setting. Max 500 characters.
            </p>
          </div>
        </div>
      </Card>

      <Card className='p-6'>
        <h3 className='mb-4 text-lg font-semibold'>Footer Text</h3>
        <div className='space-y-4'>
          <div>
            <label
              htmlFor='footer-text'
              className='mb-2 block text-sm font-medium text-gray-700'
            >
              Footer Information
            </label>
            <textarea
              id='footer-text'
              value={settings.footer_text ?? ''}
              onChange={(e) => onUpdate({ footer_text: e.target.value })}
              maxLength={200}
              rows={3}
              placeholder='© 2024 3B Saigon. All rights reserved.'
              className='resize-vertical w-full rounded-md border border-gray-300 px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500'
            />
            <p className='mt-1 text-sm text-gray-500'>
              Custom footer content displayed at the bottom of the playlist
              page. Uses secondary color, typography settings, and accent color
              3 border. Max 200 characters.
            </p>
          </div>
        </div>
      </Card>
    </div>
  )
}
