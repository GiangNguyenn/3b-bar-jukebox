import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/supabase'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('BrandingService')

export class BrandingService {
  private supabase

  constructor() {
    const cookieStore = cookies()
    this.supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {
              // The `setAll` method was called from a Server Component.
              // This can be ignored if you have middleware refreshing
              // user sessions.
            }
          }
        }
      }
    )
  }

  async getBrandingSettings(profileId: string) {
    try {
      const { data, error } = await this.supabase
        .from('branding_settings')
        .select('*')
        .eq('profile_id', profileId)
        .single()

      if (error && error.code !== 'PGRST116') {
        logger(
          'ERROR',
          `Error fetching branding settings: ${error.message}`,
          'BrandingService',
          error
        )
        throw error
      }

      return data
    } catch (error) {
      // Don't throw error for PGRST116 (no rows found), just return null
      if (error instanceof Error && error.message.includes('PGRST116')) {
        return null
      }
      
      logger(
        'ERROR',
        `Error in getBrandingSettings: ${error}`,
        'BrandingService',
        error instanceof Error ? error : undefined
      )
      throw error
    }
  }

  async upsertBrandingSettings(
    profileId: string,
    settings: Partial<
      Database['public']['Tables']['branding_settings']['Insert']
    >
  ) {
    try {
      // Check if a record already exists
      const existingRecord = await this.getBrandingSettings(profileId)
      
      // Define default values (matching database defaults)
      const defaultValues = {
        venue_name: '3B SAIGON JUKEBOX',
        font_family: 'Belgrano',
        font_size: 'text-4xl',
        font_weight: 'normal',
        text_color: '#ffffff',
        primary_color: '#C09A5E',
        secondary_color: '#191414',
        background_color: '#000000',
        gradient_type: 'none',
        page_title: '3B SAIGON JUKEBOX',
        meta_description: 'A boutique beer & music experience',
        open_graph_title: '3B SAIGON JUKEBOX'
      }

      // If updating an existing record, apply defaults to missing fields
      if (existingRecord) {
        const upsertData = {
          profile_id: profileId,
          ...defaultValues,
          ...existingRecord,
          ...settings // User updates take precedence
        }
        
        const { data, error } = await this.supabase
          .from('branding_settings')
          .upsert(upsertData, {
            onConflict: 'profile_id'
          })
          .select()
          .single()

        if (error) {
          logger(
            'ERROR',
            `Error upserting branding settings: ${error.message}`,
            'BrandingService',
            error instanceof Error ? error : undefined
          )
          throw error
        }

        return data
      } else {
        // For new records, apply defaults to missing fields
        const upsertData = {
          profile_id: profileId,
          ...defaultValues,
          ...settings
        }
        
        const { data, error } = await this.supabase
          .from('branding_settings')
          .upsert(upsertData, {
            onConflict: 'profile_id'
          })
          .select()
          .single()

        if (error) {
          logger(
            'ERROR',
            `Error upserting branding settings: ${error.message}`,
            'BrandingService',
            error instanceof Error ? error : undefined
          )
          throw error
        }

        return data
      }


    } catch (error) {
      logger(
        'ERROR',
        `Error in upsertBrandingSettings: ${error}`,
        'BrandingService',
        error instanceof Error ? error : undefined
      )
      throw error
    }
  }
}
