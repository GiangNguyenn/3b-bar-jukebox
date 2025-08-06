/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/supabase'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('API Auth Profile')

interface Subscription {
  id: string
  profile_id: string
  stripe_subscription_id: string | null
  stripe_customer_id: string | null
  plan_type: 'free' | 'premium'
  payment_type: 'monthly' | 'lifetime'
  status: 'active' | 'canceled' | 'canceling' | 'past_due' | 'trialing' | 'incomplete'
  current_period_start: string | null
  current_period_end: string | null
  created_at: string
  updated_at: string
}

export async function POST(): Promise<NextResponse> {
  const cookieStore = cookies()

  const supabase = createServerClient<Database>(
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

  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Check if profile already exists
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (existingProfile) {
    return NextResponse.json({ message: 'Profile already exists' })
  }

  // Create a free subscription for the new user
  const { data: subscription, error: subscriptionError } = await supabase
    .from('subscriptions')
    .insert([
      {
        profile_id: user.id,
        plan_type: 'free',
        payment_type: 'monthly',
        status: 'active',
        stripe_subscription_id: null,
        stripe_customer_id: null
      }
    ])
    .select()
    .single()

  if (subscriptionError) {
    logger('ERROR', 'Error creating subscription', 'AuthProfile', subscriptionError)
    return NextResponse.json(
      { error: 'Failed to create subscription' },
      { status: 500 }
    )
  }

  if (!subscription) {
    logger('ERROR', 'No subscription data returned', 'AuthProfile')
    return NextResponse.json(
      { error: 'Failed to create subscription' },
      { status: 500 }
    )
  }

  // Create profile with subscription link - handle display_name conflicts
  const initialDisplayName = user.user_metadata?.full_name ?? user.email?.split('@')[0] ?? 'user'
  
  let profileData = {
    id: user.id,
    spotify_user_id: user.id, // Use user ID as spotify_user_id for now
    display_name: initialDisplayName,
    avatar_url: user.user_metadata?.avatar_url ?? null,
    is_premium: false, // Default to false, will be updated by premium verification
    premium_verified_at: null,
    subscription_id: (subscription as Subscription).id
  }

  // Try to insert with initial display_name
  const { error } = await supabase.from('profiles').insert([profileData])

  // If there's a unique constraint violation, use spotify_user_id as fallback
  if (error && error.code === '23505' && error.message?.includes('display_name')) {
    logger('INFO', `Display name "${initialDisplayName}" is already taken, using spotify_user_id as fallback`, 'AuthProfile')
    
    profileData = {
      ...profileData,
      display_name: user.id // Use user ID as display_name
    }
    
    const { error: fallbackError } = await supabase.from('profiles').insert([profileData])
    
    if (fallbackError) {
      logger('ERROR', 'Error creating profile with fallback display_name', 'AuthProfile', fallbackError)
      return NextResponse.json(
        { error: 'Failed to create profile' },
        { status: 500 }
      )
    }
  } else if (error) {
    logger('ERROR', 'Error creating profile', 'AuthProfile', error)
    return NextResponse.json(
      { error: 'Failed to create profile' },
      { status: 500 }
    )
  }

  return NextResponse.json({ message: 'Profile created successfully' })
}
