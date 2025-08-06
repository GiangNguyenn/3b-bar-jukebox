import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { stripeService } from './stripeService'
import { subscriptionCache } from './subscriptionCache'
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
      // Get the subscription first
      const subscription = await this.getSubscriptionById(subscriptionId)
      if (!subscription) {
        logger('ERROR', `Subscription not found: ${subscriptionId}`)
        return false
      }

      // Cancel in Stripe if it's a premium subscription
      if (subscription.stripe_subscription_id) {
        await stripeService.cancelSubscription(
          subscription.stripe_subscription_id
        )

        // Update local status to 'canceling' - this keeps premium access active
        // until the end of the billing period, then webhook will change to 'canceled'
        const updated = await this.updateSubscription(subscriptionId, {
          status: 'canceling'
        })

        if (!updated) {
          return false
        }

        logger(
          'INFO',
          `Initiated cancellation for subscription: ${subscriptionId} - status set to canceling`
        )
        return true
      } else {
        // For non-Stripe subscriptions, update status immediately
        const updated = await this.updateSubscription(subscriptionId, {
          status: 'canceled'
        })

        if (!updated) {
          return false
        }

        logger('INFO', `Canceled non-Stripe subscription: ${subscriptionId}`)
        return true
      }
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
   * Get user's current plan type (optimized with caching)
   */
  async getUserPlanType(profileId: string): Promise<'free' | 'premium'> {
    try {
      return await subscriptionCache.getUserPlanType(profileId)
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
   * Check if user has premium access (optimized with caching)
   */
  async hasPremiumAccess(profileId: string): Promise<boolean> {
    try {
      return await subscriptionCache.hasPremiumAccess(profileId)
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
   * Get active subscription for a user (optimized with caching)
   */
  async getActiveSubscription(profileId: string): Promise<Subscription | null> {
    try {
      return await subscriptionCache.getActiveSubscription(profileId)
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
   * Process webhook event
   */
  async processWebhookEvent(event: any): Promise<void> {
    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await this.handleCheckoutSessionCompleted(event.data.object)
          break
        case 'customer.subscription.created':
          await this.handleSubscriptionCreated(event.data.object)
          break
        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event.data.object)
          break
        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object)
          break
        case 'invoice.payment_succeeded':
          await this.handlePaymentSucceeded(event.data.object)
          break
        case 'invoice.payment_failed':
          await this.handlePaymentFailed(event.data.object)
          break
        default:
          logger('INFO', `Unhandled event type: ${event.type}`)
      }
    } catch (error) {
      logger(
        'ERROR',
        'Error processing webhook event',
        'SubscriptionService',
        error as Error
      )
      throw error
    }
  }

  /**
   * Handle checkout session completed
   */
  async handleCheckoutSessionCompleted(session: any): Promise<void> {
    try {
      const profileId = session.metadata?.profile_id
      if (!profileId) {
        logger(
          'ERROR',
          'No profile_id in session metadata',
          'SubscriptionService'
        )
        return
      }

      // Update subscription status immediately
      await this.updateSubscriptionFromStripeSession(session.id, profileId)

      logger('INFO', `Checkout session completed for profile ${profileId}`)
    } catch (error) {
      logger(
        'ERROR',
        'Error handling checkout session completed',
        'SubscriptionService',
        error as Error
      )
    }
  }

  /**
   * Handle subscription created
   */
  async handleSubscriptionCreated(subscription: any): Promise<void> {
    try {
      const profileId = subscription.metadata?.profile_id
      if (!profileId) {
        logger(
          'ERROR',
          'No profile_id in subscription metadata',
          'SubscriptionService'
        )
        return
      }

      // Update subscription status
      const subscriptionRecord = await this.getSubscriptionByStripeId(
        subscription.id
      )
      if (subscriptionRecord) {
        await this.updateSubscription(subscriptionRecord.id, {
          status: 'active',
          current_period_start: new Date(
            subscription.current_period_start * 1000
          ).toISOString(),
          current_period_end: new Date(
            subscription.current_period_end * 1000
          ).toISOString()
        })
      }

      logger('INFO', `Subscription created for profile ${profileId}`)
    } catch (error) {
      logger(
        'ERROR',
        'Error handling subscription created',
        'SubscriptionService',
        error as Error
      )
    }
  }

  /**
   * Handle subscription updated
   */
  async handleSubscriptionUpdated(subscription: any): Promise<void> {
    try {
      const subscriptionRecord = await this.getSubscriptionByStripeId(
        subscription.id
      )
      if (subscriptionRecord) {
        // If the subscription is canceled and we have a 'canceling' status,
        // check if the current period has ended
        if (
          subscription.status === 'canceled' &&
          subscriptionRecord.status === 'canceling'
        ) {
          const currentPeriodEnd = new Date(
            subscription.current_period_end * 1000
          )
          const now = new Date()

          if (currentPeriodEnd <= now) {
            // Period has ended, change to 'canceled'
            await this.updateSubscription(subscriptionRecord.id, {
              status: 'canceled',
              current_period_start: new Date(
                subscription.current_period_start * 1000
              ).toISOString(),
              current_period_end: new Date(
                subscription.current_period_end * 1000
              ).toISOString()
            })
            logger(
              'INFO',
              `Subscription period ended, status changed to canceled: ${subscription.id}`
            )
          } else {
            // Period hasn't ended yet, keep as 'canceling'
            await this.updateSubscription(subscriptionRecord.id, {
              status: 'canceling',
              current_period_start: new Date(
                subscription.current_period_start * 1000
              ).toISOString(),
              current_period_end: new Date(
                subscription.current_period_end * 1000
              ).toISOString()
            })
            logger(
              'INFO',
              `Subscription still in canceling period: ${subscription.id}`
            )
          }
        } else {
          // Normal status update
          await this.updateSubscription(subscriptionRecord.id, {
            status: subscription.status,
            current_period_start: new Date(
              subscription.current_period_start * 1000
            ).toISOString(),
            current_period_end: new Date(
              subscription.current_period_end * 1000
            ).toISOString()
          })
        }
      }

      logger('INFO', `Subscription updated: ${subscription.id}`)
    } catch (error) {
      logger(
        'ERROR',
        'Error handling subscription updated',
        'SubscriptionService',
        error as Error
      )
    }
  }

  /**
   * Handle subscription deleted
   */
  async handleSubscriptionDeleted(subscription: any): Promise<void> {
    try {
      const subscriptionRecord = await this.getSubscriptionByStripeId(
        subscription.id
      )
      if (subscriptionRecord) {
        await this.updateSubscription(subscriptionRecord.id, {
          status: 'canceled'
        })
      }

      logger('INFO', `Subscription deleted: ${subscription.id}`)
    } catch (error) {
      logger(
        'ERROR',
        'Error handling subscription deleted',
        'SubscriptionService',
        error as Error
      )
    }
  }

  /**
   * Handle payment succeeded
   */
  async handlePaymentSucceeded(invoice: any): Promise<void> {
    try {
      const subscriptionId = (invoice as any).subscription
      if (subscriptionId) {
        const subscriptionRecord =
          await this.getSubscriptionByStripeId(subscriptionId)
        if (subscriptionRecord) {
          await this.updateSubscription(subscriptionRecord.id, {
            status: 'active'
          })
        }
      }

      logger('INFO', `Payment succeeded for invoice: ${invoice.id}`)
    } catch (error) {
      logger(
        'ERROR',
        'Error handling payment succeeded',
        'SubscriptionService',
        error as Error
      )
    }
  }

  /**
   * Handle payment failed
   */
  async handlePaymentFailed(invoice: any): Promise<void> {
    try {
      const subscriptionId = (invoice as any).subscription
      if (subscriptionId) {
        const subscriptionRecord =
          await this.getSubscriptionByStripeId(subscriptionId)
        if (subscriptionRecord) {
          await this.updateSubscription(subscriptionRecord.id, {
            status: 'past_due'
          })
        }
      }

      logger('INFO', `Payment failed for invoice: ${invoice.id}`)
    } catch (error) {
      logger(
        'ERROR',
        'Error handling payment failed',
        'SubscriptionService',
        error as Error
      )
    }
  }

  /**
   * Get user subscription status (optimized)
   */
  async getUserSubscriptionStatus(profileId: string) {
    try {
      return await subscriptionCache.getUserSubscriptionStatus(profileId)
    } catch (error) {
      logger(
        'ERROR',
        'Error getting subscription status',
        'SubscriptionService',
        error as Error
      )
      return null
    }
  }

  /**
   * Get user subscription summary (optimized)
   */
  async getUserSubscriptionSummary(profileId: string) {
    try {
      return await subscriptionCache.getUserSubscriptionSummary(profileId)
    } catch (error) {
      logger(
        'ERROR',
        'Error getting subscription summary',
        'SubscriptionService',
        error as Error
      )
      return null
    }
  }

  /**
   * Update subscription from Stripe checkout session
   */
  async updateSubscriptionFromStripeSession(
    sessionId: string,
    profileId: string
  ): Promise<boolean> {
    try {
      // Get the checkout session from Stripe
      const session = await stripeService.getCheckoutSession(sessionId)

      if (!session || session.payment_status !== 'paid') {
        logger('ERROR', 'Payment not completed', 'SubscriptionService')
        return false
      }

      // Determine payment type and plan type from session
      let paymentType: 'monthly' | 'lifetime'
      let planType: 'free' | 'premium'

      if (session.mode === 'subscription') {
        paymentType = 'monthly'
        planType = 'premium'
      } else if (session.mode === 'payment') {
        paymentType = 'lifetime'
        planType = 'premium'
      } else {
        logger('ERROR', 'Invalid session mode', 'SubscriptionService')
        return false
      }

      // Get or create subscription record
      let subscription: Subscription | null =
        await this.getActiveSubscription(profileId)

      if (!subscription) {
        // Create new subscription
        const subscriptionData = {
          profile_id: profileId,
          plan_type: planType,
          payment_type: paymentType,
          status: 'active' as const,
          stripe_subscription_id: (session.subscription as any)?.id ?? null,
          stripe_customer_id: session.customer as string,
          current_period_start: (session.subscription as any)
            ?.current_period_start
            ? new Date(
                (session.subscription as any).current_period_start * 1000
              ).toISOString()
            : new Date().toISOString(),
          current_period_end: (session.subscription as any)?.current_period_end
            ? new Date(
                (session.subscription as any).current_period_end * 1000
              ).toISOString()
            : null
        }

        const newSubscription = await this.createSubscription(subscriptionData)
        if (!newSubscription) {
          logger(
            'ERROR',
            'Failed to create subscription',
            'SubscriptionService'
          )
          return false
        }
        subscription = newSubscription
      } else {
        // Update existing subscription
        const updates = {
          plan_type: planType,
          payment_type: paymentType,
          status: 'active' as const,
          stripe_subscription_id:
            (session.subscription as any)?.id ??
            subscription.stripe_subscription_id,
          stripe_customer_id: session.customer as string,
          current_period_start: (session.subscription as any)
            ?.current_period_start
            ? new Date(
                (session.subscription as any).current_period_start * 1000
              ).toISOString()
            : subscription.current_period_start,
          current_period_end: (session.subscription as any)?.current_period_end
            ? new Date(
                (session.subscription as any).current_period_end * 1000
              ).toISOString()
            : subscription.current_period_end
        }

        const updatedSubscription = await this.updateSubscription(
          subscription.id,
          updates
        )
        if (!updatedSubscription) {
          logger(
            'ERROR',
            'Failed to update subscription',
            'SubscriptionService'
          )
          return false
        }
        subscription = updatedSubscription
      }

      // Update profile with subscription link
      await this.supabase
        .from('profiles')
        .update({ subscription_id: subscription.id })
        .eq('id', profileId)

      // Clear cache for this user
      subscriptionCache.invalidateUserCache(profileId)

      logger(
        'INFO',
        `Subscription updated from session ${sessionId} for profile ${profileId}`
      )
      return true
    } catch (error) {
      logger(
        'ERROR',
        'Error updating subscription from session',
        'SubscriptionService',
        error as Error
      )
      return false
    }
  }

  /**
   * Get subscription by Stripe ID
   */
  async getSubscriptionByStripeId(
    stripeSubscriptionId: string
  ): Promise<Subscription | null> {
    try {
      const { data, error } = await this.supabase
        .from('subscriptions')
        .select('*')
        .eq('stripe_subscription_id', stripeSubscriptionId)
        .single()

      if (error) {
        logger(
          'ERROR',
          'Failed to get subscription by Stripe ID',
          'SubscriptionService',
          error as Error
        )
        return null
      }

      return data
    } catch (error) {
      logger(
        'ERROR',
        'Error getting subscription by Stripe ID',
        'SubscriptionService',
        error as Error
      )
      return null
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return subscriptionCache.getCacheStats()
  }

  /**
   * Clear all cache
   */
  clearCache(): void {
    subscriptionCache.clearCache()
  }
}

// Export a singleton instance
export const subscriptionService = new SubscriptionService()
