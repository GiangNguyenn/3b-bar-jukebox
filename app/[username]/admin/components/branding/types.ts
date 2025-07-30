import type { Database } from '@/types/supabase'

export type BrandingSettings =
  Database['public']['Tables']['branding_settings']['Row']

export interface BrandingSectionProps {
  settings: BrandingSettings
  onUpdate: (updates: Partial<BrandingSettings>) => void
}
