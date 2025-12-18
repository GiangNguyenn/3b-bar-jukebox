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

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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

    // Get user profile
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Set default URLs if not provided
    const defaultSuccessUrl = `${request.nextUrl.origin}/api/subscriptions/payment-success?session_id={CHECKOUT_SESSION_ID}`
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const displayName =
      profile.display_name ?? user.email?.split('@')[0] ?? 'user'
    const defaultCancelUrl = `${request.nextUrl.origin}/${encodeURIComponent(displayName)}/admin?payment=cancelled`
    const finalSuccessUrl = successUrl ?? defaultSuccessUrl
    const finalCancelUrl = cancelUrl ?? defaultCancelUrl

    let session: Stripe.Checkout.Session

    if (planType === 'monthly') {
      logger(
        'INFO',
        `Creating monthly checkout session with auto customer creation`,
        'SubscriptionCheckout'
      )

      if (!process.env.STRIPE_MONTHLY_PRICE_ID) {
        logger(
          'ERROR',
          'STRIPE_MONTHLY_PRICE_ID environment variable is not set',
          'SubscriptionCheckout'
        )
        return NextResponse.json(
          { error: 'Stripe configuration error' },
          { status: 500 }
        )
      }

      try {
        session = await stripeService.createMonthlyCheckoutSessionAuto(
          user.id,
          finalSuccessUrl,
          finalCancelUrl
        )
      } catch (stripeError) {
        logger(
          'ERROR',
          `Stripe API error creating monthly checkout session: ${stripeError instanceof Error ? stripeError.message : 'Unknown error'}`,
          'SubscriptionCheckout',
          stripeError as Error
        )
        return NextResponse.json(
          {
            error: `Stripe API error: ${stripeError instanceof Error ? stripeError.message : 'Unknown error'}`
          },
          { status: 500 }
        )
      }
    } else if (planType === 'lifetime') {
      logger(
        'INFO',
        `Creating lifetime checkout session with auto customer creation`,
        'SubscriptionCheckout'
      )

      if (!process.env.STRIPE_LIFETIME_PRODUCT_ID) {
        logger(
          'ERROR',
          'STRIPE_LIFETIME_PRODUCT_ID environment variable is not set',
          'SubscriptionCheckout'
        )
        return NextResponse.json(
          { error: 'Stripe configuration error' },
          { status: 500 }
        )
      }

      try {
        session = await stripeService.createLifetimeCheckoutSessionAuto(
          user.id,
          finalSuccessUrl,
          finalCancelUrl
        )
      } catch (stripeError) {
        logger(
          'ERROR',
          `Stripe API error creating lifetime checkout session: ${stripeError instanceof Error ? stripeError.message : 'Unknown error'}`,
          'SubscriptionCheckout',
          stripeError as Error
        )
        return NextResponse.json(
          {
            error: `Stripe API error: ${stripeError instanceof Error ? stripeError.message : 'Unknown error'}`
          },
          { status: 500 }
        )
      }
    } else {
      logger('ERROR', `Invalid plan type: ${planType}`, 'SubscriptionCheckout')
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
      `Error creating checkout session: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'SubscriptionCheckout',
      error as Error
    )
    return NextResponse.json(
      {
        error: `Failed to create checkout session: ${error instanceof Error ? error.message : 'Unknown error'}`
      },
      { status: 500 }
    )
  }
}
