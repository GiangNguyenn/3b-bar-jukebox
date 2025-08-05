import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { subscriptionService } from '@/services/subscriptionService'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('SubscriptionReactivate')

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
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
        'SubscriptionReactivate',
        authError as Error
      )
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    const subscriptionId = params.id

    // Reactivate the subscription
    const success =
      await subscriptionService.reactivateSubscription(subscriptionId)

    if (!success) {
      logger(
        'ERROR',
        'Failed to reactivate subscription',
        'SubscriptionReactivate'
      )
      return NextResponse.json(
        { error: 'Failed to reactivate subscription' },
        { status: 500 }
      )
    }

    logger('INFO', `Subscription ${subscriptionId} reactivated successfully`)
    return NextResponse.json({ success: true })
  } catch (error) {
    logger(
      'ERROR',
      'Error reactivating subscription',
      'SubscriptionReactivate',
      error as Error
    )
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
