import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { Database } from '@/types/supabase'

interface ProfileData {
  id: string
  spotify_user_id: string
  display_name: string
  avatar_url?: string
  spotify_access_token?: string
  spotify_refresh_token?: string
  spotify_token_expires_at?: number
}

interface UserResponse {
  data: {
    user: {
      id: string
      email?: string
      user_metadata: {
        provider_id: string
        name: string
        avatar_url?: string
        provider_token?: string
        provider_refresh_token?: string
        provider_token_expires_at?: number
      }
    } | null
  }
  error: Error | null
}

interface ProfileResponse {
  data: ProfileData | null
  error: {
    code: string
    message: string
  } | null
}

export async function POST(): Promise<NextResponse> {
  try {
    console.log('[Profile] Starting profile creation/update')
    const supabase = createRouteHandlerClient<Database>({ cookies })

    // Get the current user
    console.log('[Profile] Getting user from session')
    const response = (await supabase.auth.getUser()) as UserResponse
    const {
      data: { user },
      error: userError
    } = response

    if (userError || !user) {
      console.error('[Profile] Auth error:', userError)
      return NextResponse.json(
        { 
          error: 'Not authenticated',
          details: userError
        }, 
        { status: 401 }
      )
    }

    console.log('[Profile] User data:', {
      id: user.id,
      metadata: user.user_metadata,
      email: user.email
    })

    // Check if profile already exists
    console.log('[Profile] Checking for existing profile')
    const profileResponse = (await supabase
      .from('profiles')
      .select()
      .eq('id', user.id)
      .single()) as ProfileResponse

    const { data: existingProfile, error: selectError } = profileResponse

    if (selectError && selectError.code !== 'PGRST116') {
      // PGRST116 is "no rows returned"
      console.error('[Profile] Error checking existing profile:', selectError)
      return NextResponse.json(
        { 
          error: 'Failed to check existing profile',
          details: selectError
        },
        { status: 500 }
      )
    }

    if (existingProfile) {
      console.log('[Profile] Updating existing profile')
      // Update existing profile with new tokens
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          spotify_access_token: user.user_metadata.provider_token,
          spotify_refresh_token: user.user_metadata.provider_refresh_token,
          spotify_token_expires_at: user.user_metadata.provider_token_expires_at
        })
        .eq('id', user.id)

      if (updateError) {
        console.error('[Profile] Error updating profile:', updateError)
        return NextResponse.json(
          { 
            error: 'Failed to update profile',
            details: updateError
          },
          { status: 500 }
        )
      }

      console.log('[Profile] Profile updated with new tokens')
      return NextResponse.json({ message: 'Profile updated' })
    }

    // Create new profile
    console.log('[Profile] Creating new profile')
    const metadata = user.user_metadata
    const profileData: ProfileData = {
      id: user.id,
      spotify_user_id: metadata.provider_id,
      display_name: metadata.name,
      avatar_url: metadata.avatar_url,
      spotify_access_token: metadata.provider_token,
      spotify_refresh_token: metadata.provider_refresh_token,
      spotify_token_expires_at: metadata.provider_token_expires_at
    }

    console.log('[Profile] Profile data:', {
      ...profileData,
      spotify_access_token: '***',
      spotify_refresh_token: '***'
    })

    const { error: insertError } = await supabase
      .from('profiles')
      .insert(profileData)

    if (insertError) {
      console.error('[Profile] Error creating profile:', insertError)
      return NextResponse.json(
        {
          error: 'Failed to create profile',
          details: insertError
        },
        { status: 500 }
      )
    }

    console.log('[Profile] Profile created successfully')
    return NextResponse.json({ message: 'Profile created successfully' })
  } catch (error) {
    console.error('[Profile] Error in profile creation:', error)
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    )
  }
}
