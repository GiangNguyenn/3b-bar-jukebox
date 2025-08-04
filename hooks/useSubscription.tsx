'use client'

import { useEffect, useState } from 'react'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import type { Database } from '@/types/supabase'

type Subscription = Database['public']['Tables']['subscriptions']['Row']

interface UseSubscriptionReturn {
  planType: 'free' | 'premium' | null
  hasPremiumAccess: boolean
  subscription: Subscription | null
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useSubscription(profileId?: string): UseSubscriptionReturn {
  const [planType, setPlanType] = useState<'free' | 'premium' | null>(null)
  const [hasPremiumAccess, setHasPremiumAccess] = useState(false)
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const supabase = createClientComponentClient<Database>()

  const fetchSubscriptionData = async () => {
    if (!profileId) {
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      // Get user's current plan type
      const { data: planTypeData, error: planTypeError } = await supabase.rpc(
        'get_user_plan_type',
        { user_profile_id: profileId }
      )

      if (planTypeError) {
        console.error('Error getting plan type:', planTypeError)
        setError('Failed to get subscription plan')
        setPlanType('free')
        setHasPremiumAccess(false)
      } else {
        const currentPlanType = (planTypeData as 'free' | 'premium') || 'free'
        setPlanType(currentPlanType)
        setHasPremiumAccess(currentPlanType === 'premium')
      }

      // Get active subscription details
      const { data: subscriptionData, error: subscriptionError } =
        await supabase
          .from('subscriptions')
          .select('*')
          .eq('profile_id', profileId)
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(1)
          .single()

      if (subscriptionError && subscriptionError.code !== 'PGRST116') {
        // PGRST116 is "no rows returned" which is expected for users without subscriptions
        console.error('Error getting subscription:', subscriptionError)
        setError('Failed to get subscription details')
      } else {
        setSubscription(subscriptionData)
      }
    } catch (err) {
      console.error('Error in fetchSubscriptionData:', err)
      setError('Failed to load subscription data')
      setPlanType('free')
      setHasPremiumAccess(false)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void fetchSubscriptionData()
  }, [profileId])

  const refetch = async () => {
    await fetchSubscriptionData()
  }

  return {
    planType,
    hasPremiumAccess,
    subscription,
    isLoading,
    error,
    refetch
  }
}

// Hook for checking if a specific feature is available based on subscription
export function useFeatureAccess(
  profileId?: string,
  requiredPlan: 'free' | 'premium' = 'free'
) {
  const { planType, hasPremiumAccess, isLoading } = useSubscription(profileId)

  const hasAccess = () => {
    if (isLoading || !planType) return false

    if (requiredPlan === 'free') return true
    if (requiredPlan === 'premium') return hasPremiumAccess

    return false
  }

  return {
    hasAccess: hasAccess(),
    isLoading,
    planType
  }
}

// Hook for premium-only features
export function usePremiumFeature(profileId?: string) {
  return useFeatureAccess(profileId, 'premium')
}
