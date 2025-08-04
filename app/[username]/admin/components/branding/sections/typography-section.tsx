'use client'

import { Card } from '@/components/ui/card'
import type { BrandingSettings } from '../types'

interface TypographySectionProps {
  settings: BrandingSettings
  onUpdate: (updates: Partial<BrandingSettings>) => void
}

const fontFamilies = [
  { value: 'Belgrano', label: 'Belgrano' },
  { value: 'Inter', label: 'Inter' },
  { value: 'Roboto', label: 'Roboto' },
  { value: 'Open Sans', label: 'Open Sans' },
  { value: 'Lato', label: 'Lato' },
  { value: 'Poppins', label: 'Poppins' },
  { value: 'Montserrat', label: 'Montserrat' },
  { value: 'Raleway', label: 'Raleway' }
]

const fontWeights = [
  { value: 'light', label: 'Light' },
  { value: 'normal', label: 'Normal' },
  { value: 'medium', label: 'Medium' },
  { value: 'bold', label: 'Bold' },
  { value: 'extrabold', label: 'Extra Bold' }
]

const fontSizes = [
  { value: 'text-xs', label: 'Extra Small (12px)' },
  { value: 'text-sm', label: 'Small (14px)' },
  { value: 'text-base', label: 'Base (16px)' },
  { value: 'text-lg', label: 'Large (18px)' },
  { value: 'text-xl', label: 'Extra Large (20px)' },
  { value: 'text-2xl', label: '2XL (24px)' },
  { value: 'text-3xl', label: '3XL (30px)' },
  { value: 'text-4xl', label: '4XL (36px)' },
  { value: 'text-5xl', label: '5XL (48px)' }
]

export function TypographySection({
  settings,
  onUpdate
}: TypographySectionProps): JSX.Element {
  return (
    <div className='space-y-6'>
      <Card className='p-6'>
        <h3 className='mb-4 text-lg font-semibold'>Typography Settings</h3>
        <div className='space-y-4'>
          <div>
            <label
              htmlFor='font-family'
              className='mb-2 block text-sm font-medium text-gray-700'
            >
              Font Family
            </label>
            <select
              id='font-family'
              value={settings.font_family ?? 'Belgrano'}
              onChange={(e) => onUpdate({ font_family: e.target.value })}
              className='w-full rounded-md border border-gray-300 px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500'
            >
              {fontFamilies.map((font) => (
                <option key={font.value} value={font.value}>
                  {font.label}
                </option>
              ))}
            </select>
            <p className='mt-1 text-sm text-gray-500'>
              Font family applied to the venue name on the playlist page.
            </p>
          </div>

          <div>
            <label
              htmlFor='font-size'
              className='mb-2 block text-sm font-medium text-gray-700'
            >
              Font Size
            </label>
            <select
              id='font-size'
              value={settings.font_size ?? 'text-4xl'}
              onChange={(e) => onUpdate({ font_size: e.target.value })}
              className='w-full rounded-md border border-gray-300 px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500'
            >
              {fontSizes.map((size) => (
                <option key={size.value} value={size.value}>
                  {size.label}
                </option>
              ))}
            </select>
            <p className='mt-1 text-sm text-gray-500'>
              Font size applied to the venue name on the playlist page.
            </p>
          </div>

          <div>
            <label
              htmlFor='font-weight'
              className='mb-2 block text-sm font-medium text-gray-700'
            >
              Font Weight
            </label>
            <select
              id='font-weight'
              value={settings.font_weight ?? 'normal'}
              onChange={(e) => onUpdate({ font_weight: e.target.value })}
              className='w-full rounded-md border border-gray-300 px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500'
            >
              {fontWeights.map((weight) => (
                <option key={weight.value} value={weight.value}>
                  {weight.label}
                </option>
              ))}
            </select>
            <p className='mt-1 text-sm text-gray-500'>
              Font weight applied to the venue name on the playlist page.
            </p>
          </div>
        </div>
      </Card>
    </div>
  )
}
