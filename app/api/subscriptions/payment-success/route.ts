/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { subscriptionService } from '@/services/subscriptionService'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('PaymentSuccess')

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value
          }
        }
      }
    )

    // Get the current user
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser()

    if (authError || !user) {
      logger(
        'ERROR',
        'Authentication failed',
        'PaymentSuccess',
        authError as Error
      )
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    // Get session_id from query parameters
    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get('session_id')

    if (!sessionId) {
      logger('ERROR', 'No session_id provided', 'PaymentSuccess')
      return NextResponse.json({ error: 'Missing session_id' }, { status: 400 })
    }

    // Verify the payment was successful by checking the session
    const { stripeService } = await import('@/services/stripeService')
    const session = await stripeService.getCheckoutSession(sessionId)

    if (!session || session.payment_status !== 'paid') {
      logger('ERROR', 'Payment not completed', 'PaymentSuccess')
      return NextResponse.json(
        { error: 'Payment not completed' },
        { status: 400 }
      )
    }

    // Get user profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()

    if (!profile) {
      logger('ERROR', 'Profile not found', 'PaymentSuccess')
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Update subscription status immediately
    const success =
      await subscriptionService.updateSubscriptionFromStripeSession(
        sessionId,
        profile.id,
        supabase
      )

    if (!success) {
      logger('ERROR', 'Failed to update subscription status', 'PaymentSuccess')
      return NextResponse.json(
        { error: 'Failed to update subscription' },
        { status: 500 }
      )
    }

    logger(
      'INFO',
      `Payment success processed for user ${user.id}, session ${sessionId}`
    )

    // Redirect to admin page with success message
    const adminUrl = `${request.nextUrl.origin}/${profile.display_name ?? user.email?.split('@')[0] ?? 'user'}/admin?payment=success`
    return NextResponse.redirect(adminUrl)
  } catch (error) {
    logger(
      'ERROR',
      'Error processing payment success',
      'PaymentSuccess',
      error as Error
    )
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
