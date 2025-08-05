import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { stripeService } from './stripeService'
import { createModuleLogger } from '@/shared/utils/logger'

type Subscription = Database['public']['Tables']['subscriptions']['Row']
type SubscriptionInsert =
  Database['public']['Tables']['subscriptions']['Insert']
type SubscriptionUpdate =
  Database['public']['Tables']['subscriptions']['Update']

const logger = createModuleLogger('SubscriptionService')

export class SubscriptionService {
  private supabase

  constructor() {
    this.supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }

  /**
   * Create a new subscription record
   */
  async createSubscription(
    subscriptionData: SubscriptionInsert
  ): Promise<Subscription | null> {
    try {
      const { data, error } = await this.supabase
        .from('subscriptions')
        .insert(subscriptionData)
        .select()
        .single()

      if (error) {
        logger(
          'ERROR',
          'Failed to create subscription',
          'SubscriptionService',
          error as Error
        )
        return null
      }

      logger('INFO', `Created subscription: ${data.id}`)
      return data
    } catch (error) {
      logger(
        'ERROR',
        'Error creating subscription',
        'SubscriptionService',
        error as Error
      )
      return null
    }
  }

  /**
   * Get subscription by ID
   */
  async getSubscriptionById(id: string): Promise<Subscription | null> {
    try {
      const { data, error } = await this.supabase
        .from('subscriptions')
        .select('*')
        .eq('id', id)
        .single()

      if (error) {
        logger(
          'ERROR',
          'Failed to get subscription by ID',
          'SubscriptionService',
          error as Error
        )
        return null
      }

      return data
    } catch (error) {
      logger(
        'ERROR',
        'Error getting subscription by ID',
        'SubscriptionService',
        error as Error
      )
      return null
    }
  }

  /**
   * Get subscription by profile ID
   */
  async getSubscriptionByProfileId(
    profileId: string
  ): Promise<Subscription | null> {
    try {
      const { data, error } = await this.supabase
        .from('subscriptions')
        .select('*')
        .eq('profile_id', profileId)
        .single()

      if (error) {
        logger(
          'ERROR',
          'Failed to get subscription by profile ID',
          'SubscriptionService',
          error as Error
        )
        return null
      }

      return data
    } catch (error) {
      logger(
        'ERROR',
        'Error getting subscription by profile ID',
        'SubscriptionService',
        error as Error
      )
      return null
    }
  }

  /**
   * Update subscription
   */
  async updateSubscription(
    id: string,
    updates: SubscriptionUpdate
  ): Promise<Subscription | null> {
    try {
      const { data, error } = await this.supabase
        .from('subscriptions')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) {
        logger(
          'ERROR',
          'Failed to update subscription',
          'SubscriptionService',
          error as Error
        )
        return null
      }

      logger('INFO', `Updated subscription: ${id}`)
      return data
    } catch (error) {
      logger(
        'ERROR',
        'Error updating subscription',
        'SubscriptionService',
        error as Error
      )
      return null
    }
  }

  /**
   * Delete subscription
   */
  async deleteSubscription(id: string): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('subscriptions')
        .delete()
        .eq('id', id)

      if (error) {
        logger(
          'ERROR',
          'Failed to delete subscription',
          'SubscriptionService',
          error as Error
        )
        return false
      }

      logger('INFO', `Deleted subscription: ${id}`)
      return true
    } catch (error) {
      logger(
        'ERROR',
        'Error deleting subscription',
        'SubscriptionService',
        error as Error
      )
      return false
    }
  }

  /**
   * Create a free subscription for a user
   */
  async createFreeSubscription(
    profileId: string
  ): Promise<Subscription | null> {
    const subscriptionData: SubscriptionInsert = {
      profile_id: profileId,
      plan_type: 'free',
      payment_type: 'monthly',
      status: 'active',
      stripe_subscription_id: null,
      stripe_customer_id: null,
      current_period_start: null,
      current_period_end: null
    }

    return this.createSubscription(subscriptionData)
  }

  /**
   * Create a premium subscription via Stripe
   */
  async createPremiumSubscription(
    profileId: string,
    customerId: string,
    stripeSubscriptionId: string,
    paymentType: 'monthly' | 'lifetime'
  ): Promise<Subscription | null> {
    const subscriptionData: SubscriptionInsert = {
      profile_id: profileId,
      plan_type: 'premium',
      payment_type: paymentType,
      status: 'active',
      stripe_subscription_id: stripeSubscriptionId,
      stripe_customer_id: customerId,
      current_period_start: new Date().toISOString(),
      current_period_end:
        paymentType === 'lifetime'
          ? null
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days from now
    }

    return this.createSubscription(subscriptionData)
  }

  /**
   * Cancel a subscription
   */
  async cancelSubscription(subscriptionId: string): Promise<boolean> {
    try {
      // Update local subscription status
      const updated = await this.updateSubscription(subscriptionId, {
        status: 'canceled'
      })

      if (!updated) {
        return false
      }

      // Cancel in Stripe if it's a premium subscription
      const subscription = await this.getSubscriptionById(subscriptionId)
      if (subscription?.stripe_subscription_id) {
        await stripeService.cancelSubscription(
          subscription.stripe_subscription_id
        )
      }

      logger('INFO', `Canceled subscription: ${subscriptionId}`)
      return true
    } catch (error) {
      logger(
        'ERROR',
        'Error canceling subscription',
        'SubscriptionService',
        error as Error
      )
      return false
    }
  }

  /**
   * Reactivate a subscription
   */
  async reactivateSubscription(subscriptionId: string): Promise<boolean> {
    try {
      // Update local subscription status
      const updated = await this.updateSubscription(subscriptionId, {
        status: 'active'
      })

      if (!updated) {
        return false
      }

      // Reactivate in Stripe if it's a premium subscription
      const subscription = await this.getSubscriptionById(subscriptionId)
      if (subscription?.stripe_subscription_id) {
        await stripeService.reactivateSubscription(
          subscription.stripe_subscription_id
        )
      }

      logger('INFO', `Reactivated subscription: ${subscriptionId}`)
      return true
    } catch (error) {
      logger(
        'ERROR',
        'Error reactivating subscription',
        'SubscriptionService',
        error as Error
      )
      return false
    }
  }

  /**
   * Get user's current plan type
   */
  async getUserPlanType(profileId: string): Promise<'free' | 'premium'> {
    try {
      const subscription = await this.getSubscriptionByProfileId(profileId)
      return subscription?.plan_type || 'free'
    } catch (error) {
      logger(
        'ERROR',
        'Error getting user plan type',
        'SubscriptionService',
        error as Error
      )
      return 'free'
    }
  }

  /**
   * Check if user has premium access
   */
  async hasPremiumAccess(profileId: string): Promise<boolean> {
    try {
      const subscription = await this.getSubscriptionByProfileId(profileId)
      return (
        subscription?.plan_type === 'premium' &&
        subscription?.status === 'active'
      )
    } catch (error) {
      logger(
        'ERROR',
        'Error checking premium access',
        'SubscriptionService',
        error as Error
      )
      return false
    }
  }

  /**
   * Get all subscriptions for a user
   */
  async getUserSubscriptions(profileId: string): Promise<Subscription[]> {
    try {
      const { data, error } = await this.supabase
        .from('subscriptions')
        .select('*')
        .eq('profile_id', profileId)
        .order('created_at', { ascending: false })

      if (error) {
        logger(
          'ERROR',
          'Failed to get user subscriptions',
          'SubscriptionService',
          error as Error
        )
        return []
      }

      return data || []
    } catch (error) {
      logger(
        'ERROR',
        'Error getting user subscriptions',
        'SubscriptionService',
        error as Error
      )
      return []
    }
  }

  /**
   * Get active subscription for a user
   */
  async getActiveSubscription(profileId: string): Promise<Subscription | null> {
    try {
      const { data, error } = await this.supabase
        .from('subscriptions')
        .select('*')
        .eq('profile_id', profileId)
        .eq('status', 'active')
        .single()

      if (error) {
        logger(
          'ERROR',
          'Failed to get active subscription',
          'SubscriptionService',
          error as Error
        )
        return null
      }

      return data
    } catch (error) {
      logger(
        'ERROR',
        'Error getting active subscription',
        'SubscriptionService',
        error as Error
      )
      return null
    }
  }

  /**
   * Process webhook events
   */
  async processWebhookEvent(event: any): Promise<void> {
    try {
      switch (event.type) {
        case 'customer.subscription.created':
          await stripeService.handleSubscriptionCreated(event)
          break
        case 'customer.subscription.updated':
          await stripeService.handleSubscriptionUpdated(event)
          break
        case 'customer.subscription.deleted':
          await stripeService.handleSubscriptionDeleted(event)
          break
        case 'invoice.payment_succeeded':
          await stripeService.handlePaymentSucceeded(event)
          break
        case 'invoice.payment_failed':
          await stripeService.handlePaymentFailed(event)
          break
        default:
          logger('INFO', `Unhandled webhook event type: ${event.type}`)
      }
    } catch (error) {
      logger(
        'ERROR',
        'Error processing webhook event',
        'SubscriptionService',
        error as Error
      )
    }
  }
}

// Export a singleton instance
export const subscriptionService = new SubscriptionService()
