import Stripe from 'stripe'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { createModuleLogger } from '@/shared/utils/logger'

type Subscription = Database['public']['Tables']['subscriptions']['Row']

const logger = createModuleLogger('StripeService')

export class StripeService {
  private stripe: Stripe
  private supabase

  constructor() {
    if (!process.env.STRIPE_SECRET_KEY) {
      logger('ERROR', 'STRIPE_SECRET_KEY is not set', 'StripeService')
      throw new Error('STRIPE_SECRET_KEY is not set')
    }

    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-07-30.basil'
    })

    logger('INFO', 'Stripe client initialized successfully', 'StripeService')

    // Use direct Supabase client for webhook operations (no cookies needed)
    this.supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }

  /**
   * Create a Stripe customer
   */
  async createCustomer(email: string, name?: string): Promise<Stripe.Customer> {
    const customer = await this.stripe.customers.create({
      email,
      name,
      metadata: {
        source: 'jm-bar-jukebox'
      }
    })

    return customer
  }

  /**
   * Create a monthly subscription
   */
  async createMonthlySubscription(
    customerId: string,
    profileId: string
  ): Promise<Stripe.Subscription> {
    const subscription = await this.stripe.subscriptions.create({
      customer: customerId,
      items: [
        {
          price: process.env.STRIPE_MONTHLY_PRICE_ID! // prod_SnoBfgAjHYN9dM
        }
      ],
      metadata: {
        profile_id: profileId
      },
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent']
    })

    return subscription
  }

  /**
   * Create a lifetime payment
   */
  async createLifetimePayment(
    customerId: string,
    profileId: string
  ): Promise<Stripe.PaymentIntent> {
    const paymentIntent = await this.stripe.paymentIntents.create({
      amount: 9900, // $99.00 in cents
      currency: 'usd',
      customer: customerId,
      metadata: {
        profile_id: profileId,
        payment_type: 'lifetime'
      },
      automatic_payment_methods: {
        enabled: true
      }
    })

    return paymentIntent
  }

  /**
   * Cancel a subscription
   */
  async cancelSubscription(
    stripeSubscriptionId: string
  ): Promise<Stripe.Subscription> {
    const subscription = await this.stripe.subscriptions.update(
      stripeSubscriptionId,
      {
        cancel_at_period_end: true
      }
    )

    return subscription
  }

  /**
   * Reactivate a subscription
   */
  async reactivateSubscription(
    stripeSubscriptionId: string
  ): Promise<Stripe.Subscription> {
    const subscription = await this.stripe.subscriptions.update(
      stripeSubscriptionId,
      {
        cancel_at_period_end: false
      }
    )

    return subscription
  }

  /**
   * Get customer by ID
   */
  async getCustomer(customerId: string): Promise<Stripe.Customer> {
    const customer = await this.stripe.customers.retrieve(customerId)
    return customer as Stripe.Customer
  }

  /**
   * Get subscription by ID
   */
  async getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    const subscription =
      await this.stripe.subscriptions.retrieve(subscriptionId)
    return subscription
  }

  /**
   * Update customer payment method
   */
  async updateCustomerPaymentMethod(
    customerId: string,
    paymentMethodId: string
  ): Promise<Stripe.Customer> {
    const customer = await this.stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId
      }
    })

    return customer
  }

  /**
   * Create checkout session for monthly subscription
   */
  async createMonthlyCheckoutSession(
    customerId: string,
    profileId: string,
    successUrl: string,
    cancelUrl: string
  ): Promise<Stripe.Checkout.Session> {
    try {
      const session = await this.stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        line_items: [
          {
            price: process.env.STRIPE_MONTHLY_PRICE_ID!,
            quantity: 1
          }
        ],
        mode: 'subscription',
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          profile_id: profileId,
          subscription_type: 'monthly'
        }
      })

      return session
    } catch (error) {
      logger(
        'ERROR',
        'Failed to create monthly checkout session',
        'StripeService',
        error as Error
      )
      throw error
    }
  }

  /**
   * Create checkout session for lifetime payment
   */
  async createLifetimeCheckoutSession(
    customerId: string,
    profileId: string,
    successUrl: string,
    cancelUrl: string
  ): Promise<Stripe.Checkout.Session> {
    try {
      const session = await this.stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product: process.env.STRIPE_LIFETIME_PRODUCT_ID!,
              unit_amount: 9900 // $99.00 in cents
            },
            quantity: 1
          }
        ],
        mode: 'payment',
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          profile_id: profileId,
          subscription_type: 'lifetime'
        }
      })

      return session
    } catch (error) {
      logger(
        'ERROR',
        'Failed to create lifetime checkout session',
        'StripeService',
        error as Error
      )
      throw error
    }
  }

  /**
   * Create checkout session for monthly subscription (auto-create customer)
   */
  async createMonthlyCheckoutSessionAuto(
    profileId: string,
    successUrl: string,
    cancelUrl: string
  ): Promise<Stripe.Checkout.Session> {
    try {
      logger(
        'INFO',
        `Creating monthly checkout session with price ID: ${process.env.STRIPE_MONTHLY_PRICE_ID}`,
        'StripeService'
      )

      const session = await this.stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price: process.env.STRIPE_MONTHLY_PRICE_ID!,
            quantity: 1
          }
        ],
        mode: 'subscription',
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          profile_id: profileId,
          subscription_type: 'monthly'
        }
        // Note: customer_creation is not supported in subscription mode
        // Stripe will automatically create customers for subscriptions
      })

      logger(
        'INFO',
        `Successfully created monthly checkout session: ${session.id}`,
        'StripeService'
      )

      return session
    } catch (error) {
      logger(
        'ERROR',
        `Failed to create monthly checkout session: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'StripeService',
        error as Error
      )
      throw error
    }
  }

  /**
   * Create checkout session for lifetime payment (auto-create customer)
   */
  async createLifetimeCheckoutSessionAuto(
    profileId: string,
    successUrl: string,
    cancelUrl: string
  ): Promise<Stripe.Checkout.Session> {
    try {
      logger(
        'INFO',
        `Creating lifetime checkout session with product ID: ${process.env.STRIPE_LIFETIME_PRODUCT_ID}`,
        'StripeService'
      )

      const session = await this.stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product: process.env.STRIPE_LIFETIME_PRODUCT_ID!,
              unit_amount: 9900 // $99.00 in cents
            },
            quantity: 1
          }
        ],
        mode: 'payment',
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          profile_id: profileId,
          subscription_type: 'lifetime'
        },
        // Let Stripe collect customer email automatically (supported in payment mode)
        customer_creation: 'always'
      })

      logger(
        'INFO',
        `Successfully created lifetime checkout session: ${session.id}`,
        'StripeService'
      )

      return session
    } catch (error) {
      logger(
        'ERROR',
        `Failed to create lifetime checkout session: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'StripeService',
        error as Error
      )
      throw error
    }
  }

  /**
   * Get a checkout session
   */
  async getCheckoutSession(
    sessionId: string
  ): Promise<Stripe.Checkout.Session> {
    const session = await this.stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription', 'payment_intent']
    })

    return session
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(
    payload: string | Buffer,
    signature: string
  ): Stripe.Event {
    const event = this.stripe.webhooks.constructEvent(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )

    return event
  }

  /**
   * Handle subscription created event
   */
  async handleSubscriptionCreated(event: Stripe.Event): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription
    const profileId = subscription.metadata?.profile_id

    if (!profileId) {
      logger('ERROR', 'No profile_id in subscription metadata')
      return
    }

    // Update subscription in database
    await this.supabase
      .from('subscriptions')
      .update({
        stripe_subscription_id: subscription.id,
        stripe_customer_id: subscription.customer as string,
        status: subscription.status,
        current_period_start: (subscription as any).current_period_start
          ? new Date(
              (subscription as any).current_period_start * 1000
            ).toISOString()
          : null,
        current_period_end: (subscription as any).current_period_end
          ? new Date(
              (subscription as any).current_period_end * 1000
            ).toISOString()
          : null
      })
      .eq('profile_id', profileId)
  }

  /**
   * Handle subscription updated event
   */
  async handleSubscriptionUpdated(event: Stripe.Event): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription
    const profileId = subscription.metadata?.profile_id

    if (!profileId) {
      logger('ERROR', 'No profile_id in subscription metadata')
      return
    }

    // Update subscription in database
    await this.supabase
      .from('subscriptions')
      .update({
        status: subscription.status,
        current_period_start: (subscription as any).current_period_start
          ? new Date(
              (subscription as any).current_period_start * 1000
            ).toISOString()
          : null,
        current_period_end: (subscription as any).current_period_end
          ? new Date(
              (subscription as any).current_period_end * 1000
            ).toISOString()
          : null
      })
      .eq('stripe_subscription_id', subscription.id)
  }

  /**
   * Handle subscription deleted event
   */
  async handleSubscriptionDeleted(event: Stripe.Event): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription

    // Update subscription status in database
    await this.supabase
      .from('subscriptions')
      .update({
        status: 'canceled'
      })
      .eq('stripe_subscription_id', subscription.id)
  }

  /**
   * Handle payment succeeded event
   */
  async handlePaymentSucceeded(event: Stripe.Event): Promise<void> {
    const invoice = event.data.object as Stripe.Invoice
    const subscriptionId = (invoice as any).subscription as string

    if (subscriptionId) {
      // Update subscription status to active
      await this.supabase
        .from('subscriptions')
        .update({
          status: 'active'
        })
        .eq('stripe_subscription_id', subscriptionId)
    }
  }

  /**
   * Handle payment failed event
   */
  async handlePaymentFailed(event: Stripe.Event): Promise<void> {
    const invoice = event.data.object as Stripe.Invoice
    const subscriptionId = (invoice as any).subscription as string

    if (subscriptionId) {
      // Update subscription status to past_due
      await this.supabase
        .from('subscriptions')
        .update({
          status: 'past_due'
        })
        .eq('stripe_subscription_id', subscriptionId)
    }
  }
}

// Export a singleton instance
export const stripeService = new StripeService()
