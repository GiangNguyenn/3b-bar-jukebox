import type { Database } from '@/types/supabase'

type BrandingSettings = Database['public']['Tables']['branding_settings']['Row']

export function getDefaultBrandingSettings(
  profileId: string
): Omit<BrandingSettings, 'id' | 'created_at' | 'updated_at'> {
  return {
    profile_id: profileId,
    logo_url: null,
    favicon_url: null,
    venue_name: '3B Jukebox',
    subtitle: null,
    welcome_message: null,
    footer_text: null,
    font_family: 'Belgrano',
    font_size: 'text-4xl',
    font_weight: 'normal',
    text_color: '#ffffff',
    primary_color: '#C09A5E',
    secondary_color: '#191414',
    background_color: '#000000',
    accent_color_1: null,
    accent_color_2: null,
    accent_color_3: null,
    gradient_type: 'none',
    gradient_direction: null,
    gradient_stops: null,
    page_title: '3B Jukebox',
    meta_description: 'The Ultimate Shared Music Experience',
    open_graph_title: '3B Jukebox'
  }
}
