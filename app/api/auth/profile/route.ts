/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { Database } from '@/types/supabase'

type Subscription = Database['public']['Tables']['subscriptions']['Row']

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
    console.error('Error creating subscription:', subscriptionError)
    return NextResponse.json(
      { error: 'Failed to create subscription' },
      { status: 500 }
    )
  }

  if (!subscription) {
    console.error('No subscription data returned')
    return NextResponse.json(
      { error: 'Failed to create subscription' },
      { status: 500 }
    )
  }

  // Create profile with subscription link
  const { error } = await supabase.from('profiles').insert([
    {
      id: user.id,
      spotify_user_id: user.id, // Use user ID as spotify_user_id for now
      display_name:
        user.user_metadata?.full_name ?? user.email?.split('@')[0] ?? 'user',
      avatar_url: user.user_metadata?.avatar_url ?? null,
      is_premium: false, // Default to false, will be updated by premium verification
      premium_verified_at: null,
      subscription_id: (subscription as Subscription).id
    }
  ])

  if (error) {
    console.error('Error creating profile:', error)
    return NextResponse.json(
      { error: 'Failed to create profile' },
      { status: 500 }
    )
  }

  return NextResponse.json({ message: 'Profile created successfully' })
}
