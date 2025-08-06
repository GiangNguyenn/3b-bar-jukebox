import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { subscriptionCache } from '@/services/subscriptionCache'
import { createModuleLogger } from '@/shared/utils/logger'

type Subscription = Database['public']['Tables']['subscriptions']['Row']
type Profile = Database['public']['Tables']['profiles']['Row']

const logger = createModuleLogger('SubscriptionQueries')

export class SubscriptionQueryUtils {
  private supabase

  constructor() {
    this.supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }

  /**
   * Optimized query to get user with subscription info in one JOIN
   */
  async getUserWithSubscription(profileId: string): Promise<{
    profile: Profile | null
    subscription: Subscription | null
    planType: 'free' | 'premium'
    hasPremiumAccess: boolean
  }> {
    try {
      const { data, error } = await this.supabase
        .from('profiles')
        .select(
          `
          *,
          subscriptions!inner(*)
        `
        )
        .eq('id', profileId)
        .in('subscriptions.status', ['active', 'canceling'])
        .single()

      if (error) {
        // If no active subscription found, return free plan
        return {
          profile: null,
          subscription: null,
          planType: 'free',
          hasPremiumAccess: false
        }
      }

      const profile = data as Profile
      const subscription = (data as any).subscriptions as Subscription

      return {
        profile,
        subscription,
        planType: subscription?.plan_type || 'free',
        hasPremiumAccess:
          subscription?.plan_type === 'premium' &&
          subscription?.status === 'active'
      }
    } catch (error) {
      logger(
        'ERROR',
        'Error getting user with subscription',
        'SubscriptionQueries',
        error as Error
      )
      return {
        profile: null,
        subscription: null,
        planType: 'free',
        hasPremiumAccess: false
      }
    }
  }

  /**
   * Optimized query to get multiple users with subscription info
   */
  async getUsersWithSubscriptions(profileIds: string[]): Promise<{
    [profileId: string]: {
      profile: Profile | null
      subscription: Subscription | null
      planType: 'free' | 'premium'
      hasPremiumAccess: boolean
    }
  }> {
    try {
      const { data, error } = await this.supabase
        .from('profiles')
        .select(
          `
          *,
          subscriptions!inner(*)
        `
        )
        .in('id', profileIds)
        .in('subscriptions.status', ['active', 'canceling'])

      if (error) {
        logger(
          'ERROR',
          'Error getting users with subscriptions',
          'SubscriptionQueries',
          error as Error
        )
        return {}
      }

      const result: { [key: string]: any } = {}

      // Initialize all requested users with free plan
      profileIds.forEach((id) => {
        result[id] = {
          profile: null,
          subscription: null,
          planType: 'free',
          hasPremiumAccess: false
        }
      })

      // Update with actual data
      data?.forEach((item: any) => {
        const profile = item as Profile
        const subscription = item.subscriptions as Subscription

        result[profile.id] = {
          profile,
          subscription,
          planType: subscription?.plan_type || 'free',
          hasPremiumAccess:
            subscription?.plan_type === 'premium' &&
            subscription?.status === 'active'
        }
      })

      return result
    } catch (error) {
      logger(
        'ERROR',
        'Error getting users with subscriptions',
        'SubscriptionQueries',
        error as Error
      )
      return {}
    }
  }

  /**
   * Optimized query to get subscription statistics
   */
  async getSubscriptionStats(): Promise<{
    totalUsers: number
    freeUsers: number
    premiumUsers: number
    activeSubscriptions: number
    expiredSubscriptions: number
  }> {
    try {
      // Get total users
      const { count: totalUsers } = await this.supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })

      // Get active subscriptions count
      const { count: activeSubscriptions } = await this.supabase
        .from('subscriptions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active')

      // Get premium users count
      const { count: premiumUsers } = await this.supabase
        .from('subscriptions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active')
        .eq('plan_type', 'premium')

      // Get expired subscriptions count
      const { count: expiredSubscriptions } = await this.supabase
        .from('subscriptions')
        .select('*', { count: 'exact', head: true })
        .lt('current_period_end', new Date().toISOString())

      const freeUsers = (totalUsers || 0) - (premiumUsers || 0)

      return {
        totalUsers: totalUsers || 0,
        freeUsers,
        premiumUsers: premiumUsers || 0,
        activeSubscriptions: activeSubscriptions || 0,
        expiredSubscriptions: expiredSubscriptions || 0
      }
    } catch (error) {
      logger(
        'ERROR',
        'Error getting subscription stats',
        'SubscriptionQueries',
        error as Error
      )
      return {
        totalUsers: 0,
        freeUsers: 0,
        premiumUsers: 0,
        activeSubscriptions: 0,
        expiredSubscriptions: 0
      }
    }
  }

  /**
   * Optimized query to get users by plan type
   */
  async getUsersByPlanType(planType: 'free' | 'premium'): Promise<Profile[]> {
    try {
      if (planType === 'free') {
        // Get users without active premium subscriptions
        const { data, error } = await this.supabase
          .from('profiles')
          .select('*')
          .not('subscription_id', 'is', null)
          .not('subscriptions.plan_type', 'eq', 'premium')
          .in('subscriptions.status', ['active', 'canceling'])

        if (error) {
          logger(
            'ERROR',
            'Error getting free users',
            'SubscriptionQueries',
            error as Error
          )
          return []
        }

        return data || []
      } else {
        // Get users with active premium subscriptions
        const { data, error } = await this.supabase
          .from('profiles')
          .select(
            `
            *,
            subscriptions!inner(*)
          `
          )
          .eq('subscriptions.plan_type', 'premium')
          .in('subscriptions.status', ['active', 'canceling'])

        if (error) {
          logger(
            'ERROR',
            'Error getting premium users',
            'SubscriptionQueries',
            error as Error
          )
          return []
        }

        return data?.map((item: any) => item as Profile) || []
      }
    } catch (error) {
      logger(
        'ERROR',
        'Error getting users by plan type',
        'SubscriptionQueries',
        error as Error
      )
      return []
    }
  }

  /**
   * Optimized query to get expiring subscriptions
   */
  async getExpiringSubscriptions(
    daysAhead: number = 7
  ): Promise<Subscription[]> {
    try {
      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + daysAhead)

      const { data, error } = await this.supabase
        .from('subscriptions')
        .select('*')
        .in('status', ['active', 'canceling'])
        .lt('current_period_end', futureDate.toISOString())
        .gte('current_period_end', new Date().toISOString())

      if (error) {
        logger(
          'ERROR',
          'Error getting expiring subscriptions',
          'SubscriptionQueries',
          error as Error
        )
        return []
      }

      return data || []
    } catch (error) {
      logger(
        'ERROR',
        'Error getting expiring subscriptions',
        'SubscriptionQueries',
        error as Error
      )
      return []
    }
  }

  /**
   * Optimized query to get subscription history for a user
   */
  async getUserSubscriptionHistory(profileId: string): Promise<Subscription[]> {
    try {
      const { data, error } = await this.supabase
        .from('subscriptions')
        .select('*')
        .eq('profile_id', profileId)
        .order('created_at', { ascending: false })

      if (error) {
        logger(
          'ERROR',
          'Error getting subscription history',
          'SubscriptionQueries',
          error as Error
        )
        return []
      }

      return data || []
    } catch (error) {
      logger(
        'ERROR',
        'Error getting subscription history',
        'SubscriptionQueries',
        error as Error
      )
      return []
    }
  }

  /**
   * Batch query to check premium access for multiple users
   */
  async batchCheckPremiumAccess(
    profileIds: string[]
  ): Promise<{ [profileId: string]: boolean }> {
    try {
      const { data, error } = await this.supabase
        .from('subscriptions')
        .select('profile_id')
        .in('profile_id', profileIds)
        .eq('plan_type', 'premium')
        .eq('status', 'active')

      if (error) {
        logger(
          'ERROR',
          'Error batch checking premium access',
          'SubscriptionQueries',
          error as Error
        )
        return {}
      }

      const result: { [key: string]: boolean } = {}

      // Initialize all as false
      profileIds.forEach((id) => {
        result[id] = false
      })

      // Set premium users to true
      data?.forEach((subscription) => {
        result[subscription.profile_id] = true
      })

      return result
    } catch (error) {
      logger(
        'ERROR',
        'Error batch checking premium access',
        'SubscriptionQueries',
        error as Error
      )
      return {}
    }
  }
}

// Export a singleton instance
export const subscriptionQueries = new SubscriptionQueryUtils()
