import { create } from 'zustand'
import type { Database } from '@/types/supabase'

type BrandingSettings = Database['public']['Tables']['branding_settings']['Row']

interface BrandingState {
  // Current settings (including unsaved changes)
  settings: BrandingSettings | null
  // Original settings from the server (for comparison)
  originalSettings: BrandingSettings | null
  // Loading and error states
  loading: boolean
  error: string | null
  // Whether this is a new user
  isNewUser: boolean
  // Active sub-tab
  activeSubTab: string
  // Whether there are unsaved changes
  hasUnsavedChanges: boolean

  // Actions
  setSettings: (settings: BrandingSettings | null) => void
  setOriginalSettings: (settings: BrandingSettings | null) => void
  updateSettings: (updates: Partial<BrandingSettings>) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setIsNewUser: (isNewUser: boolean) => void
  setActiveSubTab: (tab: string) => void
  resetState: () => void
  clearSettings: () => void
  updateHasUnsavedChanges: () => void
}

export const useBrandingStore = create<BrandingState>()((set, get) => ({
  settings: null,
  originalSettings: null,
  loading: false,
  error: null,
  isNewUser: false,
  activeSubTab: 'logo',
  hasUnsavedChanges: false,

  setSettings: (settings) => {
    const { originalSettings } = get()
    const hasUnsavedChanges = Boolean(
      settings &&
        originalSettings &&
        JSON.stringify(settings) !== JSON.stringify(originalSettings)
    )
    set({ settings, hasUnsavedChanges })
  },
  setOriginalSettings: (originalSettings) => {
    const { settings } = get()
    const hasUnsavedChanges = Boolean(
      settings &&
        originalSettings &&
        JSON.stringify(settings) !== JSON.stringify(originalSettings)
    )
    set({ originalSettings, hasUnsavedChanges })
  },
  updateSettings: (updates) => {
    const { settings, originalSettings } = get()
    if (settings) {
      const newSettings = { ...settings, ...updates }
      const hasUnsavedChanges = Boolean(
        originalSettings &&
          JSON.stringify(newSettings) !== JSON.stringify(originalSettings)
      )
      set({ settings: newSettings, hasUnsavedChanges })
    } else {
      console.warn(
        'BrandingStore: Cannot update settings - no current settings'
      )
    }
  },
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setIsNewUser: (isNewUser) => set({ isNewUser }),
  setActiveSubTab: (activeSubTab) => set({ activeSubTab }),
  resetState: () =>
    set({
      settings: null,
      originalSettings: null,
      loading: false,
      error: null,
      isNewUser: false,
      activeSubTab: 'logo',
      hasUnsavedChanges: false
    }),
  clearSettings: () =>
    set({
      settings: null,
      originalSettings: null,
      hasUnsavedChanges: false
    }),
  updateHasUnsavedChanges: () => {
    const { settings, originalSettings } = get()
    const hasUnsavedChanges = Boolean(
      settings &&
        originalSettings &&
        JSON.stringify(settings) !== JSON.stringify(originalSettings)
    )
    set({ hasUnsavedChanges })
  }
}))
