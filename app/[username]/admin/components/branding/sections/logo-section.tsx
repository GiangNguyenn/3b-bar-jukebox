'use client'

import { Card } from '@/components/ui/card'
import { useImageToBase64 } from '../hooks/useImageToBase64'
import type { BrandingSettings } from '../types'

interface LogoSectionProps {
  settings: BrandingSettings
  onUpdate: (updates: Partial<BrandingSettings>) => void
}

export function LogoSection({
  settings,
  onUpdate
}: LogoSectionProps): JSX.Element {
  const { uploadFile, uploading } = useImageToBase64()

  const handleLogoFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> => {
    const file = e.target.files?.[0] ?? null

    // Auto-convert when file is selected
    if (file) {
      try {
        const base64 = await uploadFile(file, 'logo')
        onUpdate({ logo_url: base64 })
      } catch {
        // Error handling is done in the uploadFile function
      }
    }
  }

  const handleFaviconFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> => {
    const file = e.target.files?.[0] ?? null

    // Auto-convert when file is selected
    if (file) {
      try {
        const base64 = await uploadFile(file, 'favicon')
        onUpdate({ favicon_url: base64 })
      } catch {
        // Error handling is done in the uploadFile function
      }
    }
  }

  return (
    <div className='space-y-6'>
      <Card className='p-6'>
        <h3 className='mb-4 text-lg font-semibold'>Logo</h3>
        <div className='space-y-4'>
          <div>
            <label
              htmlFor='logo'
              className='mb-2 block text-sm font-medium text-gray-700'
            >
              Logo Image
            </label>
            <input
              id='logo'
              type='file'
              accept='image/png,image/jpeg,image/svg+xml'
              onChange={(e) => {
                void handleLogoFileChange(e)
              }}
              className='w-full rounded-md border border-gray-300 px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500'
            />
            <p className='mt-1 text-sm text-gray-500'>
              PNG, JPG, or SVG. Max 5MB. Recommended: 200x200px to 500x500px.
              Displayed above the venue name on the playlist page with accent
              color 2 border.
            </p>
            {uploading && (
              <p className='mt-1 text-sm text-blue-600'>Converting logo...</p>
            )}
          </div>

          {settings.logo_url && (
            <div className='flex items-center space-x-4'>
              <img
                src={settings.logo_url}
                alt='Current logo'
                className='h-16 w-16 rounded border object-contain'
              />
              <div className='text-sm text-gray-600'>
                Logo converted successfully
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card className='p-6'>
        <h3 className='mb-4 text-lg font-semibold'>Favicon</h3>
        <div className='space-y-4'>
          <div>
            <label
              htmlFor='favicon'
              className='mb-2 block text-sm font-medium text-gray-700'
            >
              Favicon
            </label>
            <input
              id='favicon'
              type='file'
              accept='image/x-icon,image/png,image/svg+xml'
              onChange={(e) => {
                void handleFaviconFileChange(e)
              }}
              className='w-full rounded-md border border-gray-300 px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500'
            />
            <p className='mt-1 text-sm text-gray-500'>
              ICO, PNG, or SVG. Max 1MB. Will be auto-resized to 16x16px,
              32x32px, 48x48px. Automatically updates the browser tab icon on
              the playlist page.
            </p>
            {uploading && (
              <p className='mt-1 text-sm text-blue-600'>
                Converting favicon...
              </p>
            )}
          </div>

          {settings.favicon_url && (
            <div className='flex items-center space-x-4'>
              <img
                src={settings.favicon_url}
                alt='Current favicon'
                className='h-8 w-8 rounded border object-contain'
              />
              <div className='text-sm text-gray-600'>
                Favicon converted successfully
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
