'use client'

import { Card } from '@/components/ui/card'
import type { BrandingSettings } from '../types'

interface ColorsSectionProps {
  settings: BrandingSettings
  onUpdate: (updates: Partial<BrandingSettings>) => void
}

const gradientTypes = [
  { value: 'none', label: 'No Gradient' },
  { value: 'linear', label: 'Linear Gradient' },
  { value: 'radial', label: 'Radial Gradient' }
]

const gradientDirections = [
  { value: 'to-b', label: 'Top to Bottom' },
  { value: 'to-r', label: 'Left to Right' },
  { value: 'to-br', label: 'Top-Left to Bottom-Right' },
  { value: 'to-bl', label: 'Top-Right to Bottom-Left' },
  { value: 'to-t', label: 'Bottom to Top' },
  { value: 'to-l', label: 'Right to Left' }
]

export function ColorsSection({
  settings,
  onUpdate
}: ColorsSectionProps): JSX.Element {
  return (
    <div className='space-y-6'>
      <Card className='p-6'>
        <h3 className='mb-4 text-lg font-semibold'>Primary Colors</h3>
        <div className='space-y-4'>
          <div>
            <label
              htmlFor='primary-color'
              className='mb-2 block text-sm font-medium text-gray-700'
            >
              Primary Brand Color
            </label>
            <input
              id='primary-color'
              type='color'
              value={settings.primary_color ?? '#C09A5E'}
              onChange={(e) => onUpdate({ primary_color: e.target.value })}
              className='h-10 w-20 cursor-pointer rounded border border-gray-300'
            />
            <p className='mt-1 text-sm text-gray-500'>
              Background color for the search input container on the playlist
              page.
            </p>
          </div>

          <div>
            <label
              htmlFor='background-color'
              className='mb-2 block text-sm font-medium text-gray-700'
            >
              Background Color
            </label>
            <input
              id='background-color'
              type='color'
              value={settings.background_color ?? '#000000'}
              onChange={(e) => onUpdate({ background_color: e.target.value })}
              className='h-10 w-20 cursor-pointer rounded border border-gray-300'
            />
            <p className='mt-1 text-sm text-gray-500'>
              Main page background color applied to the entire playlist page.
            </p>
          </div>
        </div>
      </Card>

      <Card className='p-6'>
        <h3 className='mb-4 text-lg font-semibold'>Text Colors</h3>
        <div className='space-y-4'>
          <div>
            <label
              htmlFor='secondary-color'
              className='mb-2 block text-sm font-medium text-gray-700'
            >
              Secondary Color
            </label>
            <input
              id='secondary-color'
              type='color'
              value={settings.secondary_color ?? '#191414'}
              onChange={(e) => onUpdate({ secondary_color: e.target.value })}
              className='h-10 w-20 cursor-pointer rounded border border-gray-300'
            />
            <p className='mt-1 text-sm text-gray-500'>
              Color used for subtitle and footer text on the playlist page.
            </p>
          </div>

          <div>
            <label
              htmlFor='text-color'
              className='mb-2 block text-sm font-medium text-gray-700'
            >
              Text Color
            </label>
            <input
              id='text-color'
              type='color'
              value={settings.text_color ?? '#ffffff'}
              onChange={(e) => onUpdate({ text_color: e.target.value })}
              className='h-10 w-20 cursor-pointer rounded border border-gray-300'
            />
            <p className='mt-1 text-sm text-gray-500'>
              Color applied to the venue name on the playlist page.
            </p>
          </div>
        </div>
      </Card>

      <Card className='p-6'>
        <h3 className='mb-4 text-lg font-semibold'>Accent Colors</h3>
        <div className='space-y-4'>
          <div>
            <label
              htmlFor='accent-color-1'
              className='mb-2 block text-sm font-medium text-gray-700'
            >
              Accent Color 1
            </label>
            <input
              id='accent-color-1'
              type='color'
              value={settings.accent_color_1 ?? ''}
              onChange={(e) => onUpdate({ accent_color_1: e.target.value })}
              className='h-10 w-20 cursor-pointer rounded border border-gray-300'
            />
            <p className='mt-1 text-sm text-gray-500'>
              Border color applied to all borders throughout the playlist page
              (search input, search results container, playlist queue header,
              footer) except the logo.
            </p>
          </div>

          <div>
            <label
              htmlFor='accent-color-2'
              className='mb-2 block text-sm font-medium text-gray-700'
            >
              Accent Color 2
            </label>
            <input
              id='accent-color-2'
              type='color'
              value={settings.accent_color_2 ?? ''}
              onChange={(e) => onUpdate({ accent_color_2: e.target.value })}
              className='h-10 w-20 cursor-pointer rounded border border-gray-300'
            />
            <p className='mt-1 text-sm text-gray-500'>
              Color applied to the voting arrow icons (upvote and downvote
              buttons) in the playlist queue.
            </p>
          </div>

          <div>
            <label
              htmlFor='accent-color-3'
              className='mb-2 block text-sm font-medium text-gray-700'
            >
              Accent Color 3
            </label>
            <input
              id='accent-color-3'
              type='color'
              value={settings.accent_color_3 ?? ''}
              onChange={(e) => onUpdate({ accent_color_3: e.target.value })}
              className='h-10 w-20 cursor-pointer rounded border border-gray-300'
            />
            <p className='mt-1 text-sm text-gray-500'>
              Background color applied to hover effects on search results in the
              playlist page.
            </p>
          </div>
        </div>
      </Card>

      <Card className='p-6'>
        <h3 className='mb-4 text-lg font-semibold'>Gradient Options</h3>
        <div className='space-y-4'>
          <div>
            <label
              htmlFor='gradient-type'
              className='mb-2 block text-sm font-medium text-gray-700'
            >
              Gradient Type
            </label>
            <select
              id='gradient-type'
              value={settings.gradient_type ?? 'none'}
              onChange={(e) => onUpdate({ gradient_type: e.target.value })}
              className='w-full rounded-md border border-gray-300 px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500'
            >
              {gradientTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
            <p className='mt-1 text-sm text-gray-500'>
              Type of background gradient applied to the entire playlist page
              background. Linear gradients transition from primary color to
              accent color 3, while radial gradients create a circular pattern.
            </p>
          </div>

          {settings.gradient_type &&
            settings.gradient_type !== 'none' &&
            settings.gradient_type === 'linear' && (
              <div>
                <label
                  htmlFor='gradient-direction'
                  className='mb-2 block text-sm font-medium text-gray-700'
                >
                  Gradient Direction
                </label>
                <select
                  id='gradient-direction'
                  value={settings.gradient_direction ?? 'to-b'}
                  onChange={(e) =>
                    onUpdate({ gradient_direction: e.target.value })
                  }
                  className='w-full rounded-md border border-gray-300 px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500'
                >
                  {gradientDirections.map((direction) => (
                    <option key={direction.value} value={direction.value}>
                      {direction.label}
                    </option>
                  ))}
                </select>
                <p className='mt-1 text-sm text-gray-500'>
                  Direction of the linear gradient applied to the playlist page
                  background.
                </p>
              </div>
            )}
        </div>
      </Card>
    </div>
  )
}
