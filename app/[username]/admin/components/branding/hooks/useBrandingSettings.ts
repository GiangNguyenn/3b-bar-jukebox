import { useEffect, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/supabase'
import { getDefaultBrandingSettings } from '../utils/default-settings'
import { useBrandingStore } from '@/stores/brandingStore'

type BrandingSettings = Database['public']['Tables']['branding_settings']['Row']

export function useBrandingSettings(): {
  settings: BrandingSettings | null
  loading: boolean
  error: string | null
  updateSettings: (updates: Partial<BrandingSettings>) => Promise<void>
  updateLocalSettings: (updates: Partial<BrandingSettings>) => void
  resetSettings: () => Promise<void>
  refreshSettings: () => Promise<void>
  hasUnsavedChanges: boolean
  originalSettings: BrandingSettings | null
  isNewUser: boolean
} {
  const {
    settings,
    originalSettings,
    loading,
    error,
    isNewUser,
    setSettings,
    setOriginalSettings,
    setLoading,
    setError,
    setIsNewUser,
    updateSettings: updateStoreSettings,
    hasUnsavedChanges
  } = useBrandingStore()

  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const fetchSettings = useCallback(async (): Promise<void> => {
    try {
      const {
        data: { user }
      } = await supabase.auth.getUser()
      if (!user) {
        setError('Not authenticated')
        setLoading(false)
        return
      }

      const response = await fetch('/api/branding/settings')
      if (!response.ok) {
        throw new Error('Failed to fetch branding settings')
      }

      const data = (await response.json()) as BrandingSettings | null

      // If no settings exist, use default settings
      if (!data) {
        const defaultSettings = getDefaultBrandingSettings(user.id)
        // Create a mock settings object for local state (without database fields)
        const mockSettings: BrandingSettings = {
          id: 'temp-id',
          ...defaultSettings,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
        setSettings(mockSettings)
        setOriginalSettings(mockSettings)
        setIsNewUser(true)
      } else {
        setSettings(data)
        setOriginalSettings(data)
        setIsNewUser(false)
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'An error occurred'
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }, [supabase.auth])

  const updateSettings = async (
    updates: Partial<BrandingSettings>
  ): Promise<void> => {
    try {
      const response = await fetch('/api/branding/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updates)
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(
          `Failed to update branding settings: ${response.status} ${errorText}`
        )
      }

      const data = (await response.json()) as BrandingSettings

      setSettings(data)
      setOriginalSettings(data)
      setIsNewUser(false) // User now has saved settings
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'An error occurred'
      setError(errorMessage)
    }
  }

  // Local update function for form fields (no API call)
  const updateLocalSettings = (updates: Partial<BrandingSettings>): void => {
    updateStoreSettings(updates)
  }

  const resetSettings = async (): Promise<void> => {
    try {
      const response = await fetch('/api/branding/reset', {
        method: 'DELETE'
      })

      if (!response.ok) {
        throw new Error('Failed to reset branding settings')
      }

      await fetchSettings()
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'An error occurred'
      setError(errorMessage)
    }
  }

  // Function to manually refresh settings (useful after saves)
  const refreshSettings = useCallback(async (): Promise<void> => {
    await fetchSettings()
  }, [fetchSettings])

  useEffect(() => {
    // Only fetch settings if we don't already have them in the store
    if (!settings && !loading && !error) {
      setLoading(true)
      // Small delay to ensure loading state is set before fetch
      setTimeout(() => {
        void fetchSettings()
      }, 0)
    }
  }, [fetchSettings, settings, loading, error])

  return {
    settings,
    loading,
    error,
    updateSettings,
    updateLocalSettings, // Add this to the return
    resetSettings,
    refreshSettings,
    hasUnsavedChanges,
    originalSettings,
    isNewUser
  }
}
