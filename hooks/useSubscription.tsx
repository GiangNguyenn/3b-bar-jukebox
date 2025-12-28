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
  // Always return mocked premium status
  return {
    planType: 'premium',
    hasPremiumAccess: true,
    subscription: {
      id: 'mock-sub-id',
      profile_id: profileId ?? 'mock-profile-id',
      status: 'active',
      current_period_end: new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000
      ).toISOString(),
      current_period_start: new Date().toISOString(),
      cancel_at_period_end: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      stripe_customer_id: 'mock_cust_123',
      stripe_subscription_id: 'mock_sub_123',
      plan_id: 'price_premium_mock',
      trial_start: null,
      trial_end: null,
      payment_type: 'stripe',
      plan_type: 'premium'
    } as Subscription,
    isLoading: false,
    error: null,
    refetch: async () => {
      /* No-op */
    }
  }
}

// Hook for checking if a specific feature is available based on subscription
export function useFeatureAccess(
  profileId?: string,
  requiredPlan: 'free' | 'premium' = 'free'
) {
  // Always return true access for everything
  return {
    hasAccess: true,
    isLoading: false,
    planType: 'premium' as const
  }
}

// Hook for premium-only features
export function usePremiumFeature(profileId?: string) {
  return useFeatureAccess(profileId, 'premium')
}
