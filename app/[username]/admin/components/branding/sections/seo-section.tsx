'use client'

import { Card } from '@/components/ui/card'
import type { BrandingSettings } from '../types'

interface SeoSectionProps {
  settings: BrandingSettings
  onUpdate: (updates: Partial<BrandingSettings>) => void
}

export function SeoSection({
  settings,
  onUpdate
}: SeoSectionProps): JSX.Element {
  return (
    <div className='space-y-6'>
      <Card className='p-6'>
        <h3 className='mb-4 text-lg font-semibold'>Page Title & Metadata</h3>
        <div className='space-y-4'>
          <div>
            <label
              htmlFor='page-title'
              className='mb-2 block text-sm font-medium text-gray-700'
            >
              Page Title
            </label>
            <input
              id='page-title'
              type='text'
              value={settings.page_title ?? ''}
              onChange={(e) => onUpdate({ page_title: e.target.value })}
              maxLength={60}
              placeholder='3B SAIGON JUKEBOX'
              className='w-full rounded-md border border-gray-300 px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500'
            />
            <p className='mt-1 text-sm text-gray-500'>
              Browser tab title automatically updated on the playlist page. Max
              60 characters.
            </p>
          </div>

          <div>
            <label
              htmlFor='meta-description'
              className='mb-2 block text-sm font-medium text-gray-700'
            >
              Meta Description
            </label>
            <textarea
              id='meta-description'
              value={settings.meta_description ?? ''}
              onChange={(e) => onUpdate({ meta_description: e.target.value })}
              maxLength={160}
              rows={3}
              placeholder='A boutique beer & music experience'
              className='resize-vertical w-full rounded-md border border-gray-300 px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500'
            />
            <p className='mt-1 text-sm text-gray-500'>
              SEO description automatically updated in the page&apos;s meta tags
              on the playlist page. Max 160 characters.
            </p>
          </div>

          <div>
            <label
              htmlFor='open-graph-title'
              className='mb-2 block text-sm font-medium text-gray-700'
            >
              Open Graph Title
            </label>
            <input
              id='open-graph-title'
              type='text'
              value={settings.open_graph_title ?? ''}
              onChange={(e) => onUpdate({ open_graph_title: e.target.value })}
              maxLength={60}
              placeholder='3B SAIGON JUKEBOX'
              className='w-full rounded-md border border-gray-300 px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500'
            />
            <p className='mt-1 text-sm text-gray-500'>
              Social media sharing title automatically updated in Open Graph
              meta tags on the playlist page. Max 60 characters.
            </p>
          </div>
        </div>
      </Card>
    </div>
  )
}
