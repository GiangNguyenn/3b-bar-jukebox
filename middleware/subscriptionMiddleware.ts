import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { subscriptionCache } from '@/services/subscriptionCache'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('SubscriptionMiddleware')

/**
 * Middleware to check if user has premium access
 */
export async function checkPremiumAccess(
  request: NextRequest
): Promise<boolean> {
  return true
}

/**
 * Middleware to get user's plan type
 */
export async function getUserPlanType(
  request: NextRequest
): Promise<'free' | 'premium'> {
  return 'premium'
}

/**
 * Middleware to require premium access
 */
export async function requirePremiumAccess(
  request: NextRequest
): Promise<NextResponse | null> {
  return null // Continue with request
}

/**
 * Middleware to check feature access based on plan type
 */
export async function checkFeatureAccess(
  request: NextRequest,
  requiredPlan: 'free' | 'premium'
): Promise<NextResponse | null> {
  return null // Continue with request
}

/**
 * Helper function to get user profile ID from request
 */
export async function getUserProfileId(
  request: NextRequest
): Promise<string | null> {
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

    const {
      data: { user },
      error
    } = await supabase.auth.getUser()

    if (error || !user) {
      return null
    }

    return user.id
  } catch (error) {
    logger(
      'ERROR',
      'Error getting user profile ID',
      'SubscriptionMiddleware',
      error as Error
    )
    return null
  }
}

/**
 * Middleware to add subscription info to request headers
 */
export async function addSubscriptionHeaders(
  request: NextRequest
): Promise<NextRequest> {
  try {
    const profileId = await getUserProfileId(request)

    if (!profileId) {
      return request
    }

    const planType = await subscriptionCache.getUserPlanType(profileId)
    const hasPremium = await subscriptionCache.hasPremiumAccess(profileId)

    // Create a new NextRequest with the same properties
    const newRequest = new NextRequest(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      cache: request.cache,
      credentials: request.credentials,
      integrity: request.integrity,
      keepalive: request.keepalive,
      mode: request.mode,
      redirect: request.redirect,
      referrer: request.referrer,
      referrerPolicy: request.referrerPolicy,
      signal: request.signal
    })

    // Add subscription headers
    newRequest.headers.set('x-user-plan', planType)
    newRequest.headers.set('x-has-premium', hasPremium.toString())

    return newRequest
  } catch (error) {
    logger(
      'ERROR',
      'Error adding subscription headers',
      'SubscriptionMiddleware',
      error as Error
    )
    return request
  }
}
