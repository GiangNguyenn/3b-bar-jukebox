'use client'

import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LogoSection } from './sections/logo-section'
import { TextSection } from './sections/text-section'
import { TypographySection } from './sections/typography-section'
import { ColorsSection } from './sections/colors-section'
import { SeoSection } from './sections/seo-section'
import { useBrandingSettings } from './hooks/useBrandingSettings'
import { useBrandingStore } from '@/stores/brandingStore'
import { BrandingErrorBoundary } from './error-boundary'
import { BrandingSettingsSkeleton } from './loading-states'
import type { BrandingSettings } from './types'

export function BrandingTab(): JSX.Element {
  const {
    settings,
    loading,
    error,
    updateSettings,
    updateLocalSettings, // Use this for form updates
    resetSettings,
    originalSettings, // Add this to fix the ReferenceError
    isNewUser
  } = useBrandingSettings()
  const { activeSubTab, setActiveSubTab, hasUnsavedChanges } =
    useBrandingStore()
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)

  if (loading) {
    return <BrandingSettingsSkeleton />
  }

  if (error) {
    return (
      <div className='p-6 text-center'>
        <div className='mb-4 text-red-600'>
          <h3 className='text-lg font-semibold'>
            Error loading branding settings
          </h3>
          <p className='text-sm'>{error}</p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className='text-white rounded-md bg-blue-600 px-4 py-2 hover:bg-blue-700'
        >
          Try Again
        </button>
      </div>
    )
  }

  if (!settings) {
    return (
      <div className='p-6 text-center'>
        <div className='mb-4 text-gray-600'>
          <h3 className='text-lg font-semibold'>No branding settings found</h3>
          <p className='text-sm'>
            Branding settings will be created automatically when you save your
            first changes.
          </p>
        </div>
      </div>
    )
  }

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    try {
      // Only send the fields that have changed and should be sent to API
      const changes: Partial<BrandingSettings> = {}
      const fieldsToSend = [
        'logo_url',
        'favicon_url',
        'venue_name',
        'subtitle',
        'welcome_message',
        'footer_text',
        'font_family',
        'font_size',
        'font_weight',
        'text_color',
        'primary_color',
        'secondary_color',
        'background_color',
        'accent_color_1',
        'accent_color_2',
        'accent_color_3',
        'gradient_type',
        'gradient_direction',
        'gradient_stops',
        'page_title',
        'meta_description',
        'open_graph_title'
      ]

      if (settings && originalSettings) {
        fieldsToSend.forEach((key) => {
          const k = key as keyof BrandingSettings
          if (settings[k] !== originalSettings[k]) {
            // Send the value as-is, including null values
            ;(changes as Record<string, unknown>)[k] = settings[k]
          }
        })
      }

      await updateSettings(changes)
    } catch {
      // Error handling is done in the hook
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = (): void => {
    // Reset to last saved state by refetching
    window.location.reload()
  }

  const handleReset = async (): Promise<void> => {
    setResetting(true)
    try {
      await resetSettings()
    } catch {
      // Error handling is done in the hook
    } finally {
      setResetting(false)
    }
  }

  return (
    <BrandingErrorBoundary>
      <div className='space-y-6'>
        {/* Welcome message for new users */}
        {isNewUser && (
          <div className='rounded-lg border border-blue-200 bg-blue-50 p-4'>
            <h3 className='mb-2 text-lg font-semibold text-blue-800'>
              Welcome to Branding Settings! 🎨
            </h3>
            <p className='text-sm text-blue-700'>
              Customize your jukebox&apos;s appearance and branding. Your
              changes will be saved automatically when you click &quot;Save
              Changes&quot;.
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className='flex items-center justify-between'>
          {/* Restore Defaults button - always visible */}
          <button
            onClick={() => {
              void handleReset()
            }}
            disabled={resetting}
            className='rounded-md border border-red-300 px-4 py-2 text-red-600 hover:bg-red-50 disabled:opacity-50'
          >
            {resetting ? 'Resetting...' : 'Restore Defaults'}
          </button>

          {/* Save/Cancel buttons - only visible when there are unsaved changes */}
          {hasUnsavedChanges && (
            <div className='flex space-x-4'>
              <button
                onClick={handleCancel}
                className='rounded-md border border-gray-300 px-4 py-2 text-gray-600 hover:bg-gray-50'
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void handleSave()
                }}
                disabled={saving}
                className='text-white rounded-md bg-blue-600 px-4 py-2 hover:bg-blue-700 disabled:opacity-50'
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          )}
        </div>

        <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
          <TabsList className='grid w-full grid-cols-5'>
            <TabsTrigger
              value='logo'
              className='data-[state=active]:text-white data-[state=active]:bg-gray-700 data-[state=active]:font-semibold'
            >
              Logo & Images
            </TabsTrigger>
            <TabsTrigger
              value='text'
              className='data-[state=active]:text-white data-[state=active]:bg-gray-700 data-[state=active]:font-semibold'
            >
              Text & Content
            </TabsTrigger>
            <TabsTrigger
              value='typography'
              className='data-[state=active]:text-white data-[state=active]:bg-gray-700 data-[state=active]:font-semibold'
            >
              Typography
            </TabsTrigger>
            <TabsTrigger
              value='colors'
              className='data-[state=active]:text-white data-[state=active]:bg-gray-700 data-[state=active]:font-semibold'
            >
              Colors & Theme
            </TabsTrigger>
            <TabsTrigger
              value='seo'
              className='data-[state=active]:text-white data-[state=active]:bg-gray-700 data-[state=active]:font-semibold'
            >
              SEO & Metadata
            </TabsTrigger>
          </TabsList>

          <TabsContent value='logo' className='space-y-4'>
            <LogoSection settings={settings} onUpdate={updateLocalSettings} />
          </TabsContent>

          <TabsContent value='text' className='space-y-4'>
            <TextSection settings={settings} onUpdate={updateLocalSettings} />
          </TabsContent>

          <TabsContent value='typography' className='space-y-4'>
            <TypographySection
              settings={settings}
              onUpdate={updateLocalSettings}
            />
          </TabsContent>

          <TabsContent value='colors' className='space-y-4'>
            <ColorsSection settings={settings} onUpdate={updateLocalSettings} />
          </TabsContent>

          <TabsContent value='seo' className='space-y-4'>
            <SeoSection settings={settings} onUpdate={updateLocalSettings} />
          </TabsContent>
        </Tabs>
      </div>
    </BrandingErrorBoundary>
  )
}
