import { NextRequest, NextResponse } from 'next/server'
import { stripeService } from '@/services/stripeService'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('SubscriptionWebhook')

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    logger('ERROR', 'No Stripe signature found')
    return NextResponse.json(
      { error: 'No signature provided' },
      { status: 400 }
    )
  }

  let event

  try {
    event = stripeService.verifyWebhookSignature(body, signature)
  } catch (err) {
    logger(
      'ERROR',
      'Webhook signature verification failed',
      'SubscriptionWebhook',
      err as Error
    )
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

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
        logger('INFO', `Unhandled event type: ${event.type}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    logger(
      'ERROR',
      'Error processing webhook',
      'SubscriptionWebhook',
      error as Error
    )
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    )
  }
}
