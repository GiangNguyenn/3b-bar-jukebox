import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/supabase'

type Subscription = Database['public']['Tables']['subscriptions']['Row']
type SubscriptionInsert =
  Database['public']['Tables']['subscriptions']['Insert']
type SubscriptionUpdate =
  Database['public']['Tables']['subscriptions']['Update']

export class SubscriptionService {
  private supabase

  constructor() {
    const cookieStore = cookies()
    this.supabase = createServerClient<Database>(
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
  }

  /**
   * Get user's current plan type
   * Uses the database function get_user_plan_type for efficient querying
   */
  async getUserPlanType(profileId: string): Promise<'free' | 'premium'> {
    const { data, error } = await this.supabase.rpc('get_user_plan_type', {
      user_profile_id: profileId
    })

    if (error) {
      console.error('Error getting user plan type:', error)
      return 'free' // Default to free on error
    }

    return (data as 'free' | 'premium') || 'free'
  }

  /**
   * Check if user has premium access
   * Uses the database function has_premium_access for efficient querying
   */
  async hasPremiumAccess(profileId: string): Promise<boolean> {
    const { data, error } = await this.supabase.rpc('has_premium_access', {
      user_profile_id: profileId
    })

    if (error) {
      console.error('Error checking premium access:', error)
      return false // Default to false on error
    }

    return (data as boolean) || false
  }

  /**
   * Get user's subscription details
   * Uses the database function get_user_subscription_details for efficient querying
   */
  async getUserSubscriptionDetails(profileId: string) {
    const { data, error } = await this.supabase.rpc(
      'get_user_subscription_details',
      { user_profile_id: profileId }
    )

    if (error) {
      console.error('Error getting subscription details:', error)
      return null
    }

    return data?.[0] || null
  }

  /**
   * Get user's active subscription
   */
  async getActiveSubscription(profileId: string): Promise<Subscription | null> {
    const { data, error } = await this.supabase
      .from('subscriptions')
      .select('*')
      .eq('profile_id', profileId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (error) {
      console.error('Error getting active subscription:', error)
      return null
    }

    return data
  }

  /**
   * Create a new subscription
   */
  async createSubscription(
    subscription: SubscriptionInsert
  ): Promise<Subscription | null> {
    const { data, error } = await this.supabase
      .from('subscriptions')
      .insert(subscription)
      .select()
      .single()

    if (error) {
      console.error('Error creating subscription:', error)
      return null
    }

    return data
  }

  /**
   * Update an existing subscription
   */
  async updateSubscription(
    id: string,
    updates: SubscriptionUpdate
  ): Promise<Subscription | null> {
    const { data, error } = await this.supabase
      .from('subscriptions')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating subscription:', error)
      return null
    }

    return data
  }

  /**
   * Cancel a subscription
   */
  async cancelSubscription(id: string): Promise<Subscription | null> {
    return this.updateSubscription(id, { status: 'canceled' })
  }

  /**
   * Reactivate a subscription
   */
  async reactivateSubscription(id: string): Promise<Subscription | null> {
    return this.updateSubscription(id, { status: 'active' })
  }

  /**
   * Get all subscriptions for a user
   */
  async getUserSubscriptions(profileId: string): Promise<Subscription[]> {
    const { data, error } = await this.supabase
      .from('subscriptions')
      .select('*')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error getting user subscriptions:', error)
      return []
    }

    return data || []
  }

  /**
   * Create a free subscription for a user
   */
  async createFreeSubscription(
    profileId: string
  ): Promise<Subscription | null> {
    return this.createSubscription({
      profile_id: profileId,
      plan_type: 'free',
      payment_type: 'monthly', // Default for free users
      status: 'active',
      stripe_subscription_id: null,
      stripe_customer_id: null
    })
  }

  /**
   * Check if user has any active subscription
   */
  async hasActiveSubscription(profileId: string): Promise<boolean> {
    const subscription = await this.getActiveSubscription(profileId)
    return subscription !== null
  }

  /**
   * Get subscription by Stripe subscription ID
   */
  async getSubscriptionByStripeId(
    stripeSubscriptionId: string
  ): Promise<Subscription | null> {
    const { data, error } = await this.supabase
      .from('subscriptions')
      .select('*')
      .eq('stripe_subscription_id', stripeSubscriptionId)
      .single()

    if (error) {
      console.error('Error getting subscription by Stripe ID:', error)
      return null
    }

    return data
  }

  /**
   * Get subscription by Stripe customer ID
   */
  async getSubscriptionsByStripeCustomerId(
    stripeCustomerId: string
  ): Promise<Subscription[]> {
    const { data, error } = await this.supabase
      .from('subscriptions')
      .select('*')
      .eq('stripe_customer_id', stripeCustomerId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error getting subscriptions by Stripe customer ID:', error)
      return []
    }

    return data || []
  }
}

// Export a singleton instance
export const subscriptionService = new SubscriptionService()
