/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { stripeService } from '@/services/stripeService'
import type { Database } from '@/types/supabase'
import type Stripe from 'stripe'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('SubscriptionCheckout')

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
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

    const body = await request.json()
    const { planType, successUrl, cancelUrl } = body as {
      planType: string
      successUrl?: string
      cancelUrl?: string
    }

    if (!planType) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      )
    }

    // Set default URLs if not provided
    const defaultSuccessUrl = `${request.nextUrl.origin}/admin`
    const defaultCancelUrl = `${request.nextUrl.origin}/admin`
    const finalSuccessUrl = successUrl || defaultSuccessUrl
    const finalCancelUrl = cancelUrl || defaultCancelUrl

    // Get user profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Get or create Stripe customer
    let customerId = profile.stripe_customer_id

    if (!customerId) {
      const customer = await stripeService.createCustomer(
        user.email!,
        profile.display_name
      )
      customerId = customer.id

      // Update profile with Stripe customer ID
      await supabase
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id)
    }

    let session: Stripe.Checkout.Session

    if (planType === 'monthly') {
      session = await stripeService.createMonthlyCheckoutSession(
        customerId as string,
        user.id,
        finalSuccessUrl,
        finalCancelUrl
      )
    } else if (planType === 'lifetime') {
      session = await stripeService.createLifetimeCheckoutSession(
        customerId as string,
        user.id,
        finalSuccessUrl,
        finalCancelUrl
      )
    } else {
      return NextResponse.json(
        { error: 'Invalid subscription type' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      sessionId: session.id,
      url: session.url
    })
  } catch (error) {
    logger(
      'ERROR',
      'Error creating checkout session',
      'SubscriptionCheckout',
      error as Error
    )
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    )
  }
}
