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
      const upsertData = {
        profile_id: profileId,
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
          error
        )
        throw error
      }

      return data
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
