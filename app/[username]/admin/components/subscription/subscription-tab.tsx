'use client'

import { useState, useEffect } from 'react'
import { useSubscription } from '@/hooks/useSubscription'
import { useGetProfile } from '@/hooks/useGetProfile'
import { createModuleLogger } from '@/shared/utils/logger'
import { Loading } from '@/components/ui'

const logger = createModuleLogger('SubscriptionTab')

interface SubscriptionStatus {
  planType: 'free' | 'premium'
  hasPremiumAccess: boolean
  subscription?: {
    id: string
    plan_type: 'free' | 'premium'
    payment_type: 'monthly' | 'lifetime'
    status: 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete'
    current_period_end?: string | null
    stripe_subscription_id?: string | null
    stripe_customer_id?: string | null
  }
}

export function SubscriptionTab(): JSX.Element {
  const [subscriptionStatus, setSubscriptionStatus] =
    useState<SubscriptionStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isUpgrading, setIsUpgrading] = useState(false)

  // Get current user's profile
  const {
    profile,
    loading: profileLoading,
    error: profileError
  } = useGetProfile()

  // Get subscription data using the profile ID
  const {
    planType,
    hasPremiumAccess,
    subscription,
    isLoading: subscriptionLoading,
    error: subscriptionError
  } = useSubscription(profile?.id)

  useEffect(() => {
    if (
      !profileLoading &&
      !subscriptionLoading &&
      planType &&
      hasPremiumAccess !== undefined
    ) {
      setSubscriptionStatus({
        planType,
        hasPremiumAccess,
        subscription: subscription ?? undefined
      })
      setIsLoading(false)
    }
  }, [
    profileLoading,
    subscriptionLoading,
    planType,
    hasPremiumAccess,
    subscription
  ])

  // Handle profile or subscription errors
  useEffect(() => {
    if (profileError || subscriptionError) {
      setError(
        profileError || subscriptionError || 'Failed to load subscription data'
      )
      setIsLoading(false)
    }
  }, [profileError, subscriptionError])

  const handleUpgradeToMonthly = async (): Promise<void> => {
    try {
      setIsUpgrading(true)
      setError(null)

      const response = await fetch('/api/subscriptions/create-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          planType: 'monthly'
        })
      })

      if (!response.ok) {
        throw new Error('Failed to create checkout session')
      }

      const { url } = (await response.json()) as { url: string }
      window.location.href = url
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown error occurred'
      setError(errorMessage)
      logger(
        'ERROR',
        'Failed to create checkout session',
        'SubscriptionTab',
        err as Error
      )
    } finally {
      setIsUpgrading(false)
    }
  }

  const handleUpgradeToLifetime = async (): Promise<void> => {
    try {
      setIsUpgrading(true)
      setError(null)

      const response = await fetch('/api/subscriptions/create-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          planType: 'lifetime'
        })
      })

      if (!response.ok) {
        throw new Error('Failed to create checkout session')
      }

      const { url } = (await response.json()) as { url: string }
      window.location.href = url
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown error occurred'
      setError(errorMessage)
      logger(
        'ERROR',
        'Failed to create checkout session',
        'SubscriptionTab',
        err as Error
      )
    } finally {
      setIsUpgrading(false)
    }
  }

  const handleCancelSubscription = async (): Promise<void> => {
    try {
      setIsUpgrading(true)
      setError(null)

      if (!subscriptionStatus?.subscription?.id) {
        throw new Error('No active subscription to cancel')
      }

      const response = await fetch(
        `/api/subscriptions/${subscriptionStatus.subscription.id}/cancel`,
        {
          method: 'POST'
        }
      )

      if (!response.ok) {
        throw new Error('Failed to cancel subscription')
      }

      // Refresh subscription status
      window.location.reload()
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown error occurred'
      setError(errorMessage)
      logger(
        'ERROR',
        'Failed to cancel subscription',
        'SubscriptionTab',
        err as Error
      )
    } finally {
      setIsUpgrading(false)
    }
  }

  const handleReactivateSubscription = async (): Promise<void> => {
    try {
      setIsUpgrading(true)
      setError(null)

      if (!subscriptionStatus?.subscription?.id) {
        throw new Error('No subscription to reactivate')
      }

      const response = await fetch(
        `/api/subscriptions/${subscriptionStatus.subscription.id}/reactivate`,
        {
          method: 'POST'
        }
      )

      if (!response.ok) {
        throw new Error('Failed to reactivate subscription')
      }

      // Refresh subscription status
      window.location.reload()
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown error occurred'
      setError(errorMessage)
      logger(
        'ERROR',
        'Failed to reactivate subscription',
        'SubscriptionTab',
        err as Error
      )
    } finally {
      setIsUpgrading(false)
    }
  }

  if (profileLoading || subscriptionLoading || isLoading) {
    return (
      <div className='flex items-center justify-center p-8'>
        <Loading className='h-8 w-8' />
        <span className='ml-3 text-lg'>Loading subscription status...</span>
      </div>
    )
  }

  if (!subscriptionStatus) {
    return (
      <div className='p-4 text-red-500'>
        <p>Error loading subscription status</p>
      </div>
    )
  }

  const formatDate = (dateString?: string): string => {
    if (!dateString) return 'N/A'
    return new Date(dateString).toLocaleDateString()
  }

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'active':
        return 'text-green-500'
      case 'canceled':
        return 'text-red-500'
      case 'past_due':
        return 'text-yellow-500'
      default:
        return 'text-gray-500'
    }
  }

  return (
    <div className='space-y-6'>
      <h2 className='text-xl font-semibold'>Subscription Management</h2>

      {error && (
        <div className='rounded-lg border border-red-500 bg-red-900/20 p-4 text-red-300'>
          <p>{error}</p>
        </div>
      )}

      {/* Current Subscription Status */}
      <div className='rounded-lg bg-gray-800/50 p-6'>
        <h3 className='mb-4 text-lg font-medium'>Current Status</h3>
        <div className='grid grid-cols-2 gap-4'>
          <div>
            <p className='text-sm text-gray-400'>Plan Type</p>
            <p className='text-lg font-medium capitalize'>
              {subscriptionStatus.planType}
            </p>
          </div>
          <div>
            <p className='text-sm text-gray-400'>Premium Access</p>
            <p
              className={`text-lg font-medium ${subscriptionStatus.hasPremiumAccess ? 'text-green-500' : 'text-red-500'}`}
            >
              {subscriptionStatus.hasPremiumAccess ? 'Active' : 'Inactive'}
            </p>
          </div>
          {subscriptionStatus.subscription &&
            subscriptionStatus.planType !== 'free' && (
              <>
                <div>
                  <p className='text-sm text-gray-400'>Payment Type</p>
                  <p className='text-lg font-medium capitalize'>
                    {subscriptionStatus.subscription.payment_type}
                  </p>
                </div>
                {subscriptionStatus.subscription.current_period_end && (
                  <div>
                    <p className='text-sm text-gray-400'>Next Billing Date</p>
                    <p className='text-lg font-medium'>
                      {formatDate(
                        subscriptionStatus.subscription.current_period_end
                      )}
                    </p>
                  </div>
                )}
              </>
            )}
        </div>
      </div>

      {/* Plan Comparison */}
      <div className='rounded-lg bg-gray-800/50 p-6'>
        <h3 className='mb-4 text-lg font-medium'>Plan Comparison</h3>
        <div className='grid grid-cols-3 gap-4'>
          {/* Free Plan */}
          <div className='rounded-lg border border-gray-600 p-4'>
            <h4 className='mb-2 text-lg font-semibold'>Free Plan</h4>
            <p className='mb-4 text-2xl font-bold'>$0/month</p>
            <ul className='space-y-2 text-sm'>
              <li className='flex items-center'>
                <span className='mr-2 text-green-500'>✓</span>
                Basic jukebox functionality
              </li>
              <li className='flex items-center'>
                <span className='mr-2 text-green-500'>✓</span>
                Queue management
              </li>
              <li className='flex items-center'>
                <span className='mr-2 text-green-500'>✓</span>
                10 device limit
              </li>
              <li className='flex items-center'>
                <span className='mr-2 text-red-500'>✗</span>
                Track suggestions
              </li>
              <li className='flex items-center'>
                <span className='mr-2 text-red-500'>✗</span>
                Branding customization
              </li>
              <li className='flex items-center'>
                <span className='mr-2 text-red-500'>✗</span>
                Analytics
              </li>
            </ul>
          </div>

          {/* Monthly Plan */}
          <div className='rounded-lg border border-blue-500 bg-blue-500/10 p-4'>
            <h4 className='mb-2 text-lg font-semibold'>Monthly Plan</h4>
            <p className='mb-4 text-2xl font-bold'>$5/month</p>
            <ul className='space-y-2 text-sm'>
              <li className='flex items-center'>
                <span className='mr-2 text-green-500'>✓</span>
                Everything in Free
              </li>
              <li className='flex items-center'>
                <span className='mr-2 text-green-500'>✓</span>
                Track suggestions
              </li>
              <li className='flex items-center'>
                <span className='mr-2 text-green-500'>✓</span>
                Branding customization
              </li>
              <li className='flex items-center'>
                <span className='mr-2 text-green-500'>✓</span>
                Advanced analytics
              </li>
              <li className='flex items-center'>
                <span className='mr-2 text-green-500'>✓</span>
                Unlimited devices
              </li>
              <li className='flex items-center'>
                <span className='mr-2 text-green-500'>✓</span>
                Priority support
              </li>
            </ul>
          </div>

          {/* Lifetime Plan */}
          <div className='rounded-lg border border-purple-500 bg-purple-500/10 p-4'>
            <h4 className='mb-2 text-lg font-semibold'>Lifetime Plan</h4>
            <p className='mb-4 text-2xl font-bold'>$99</p>
            <p className='mb-4 text-sm text-gray-400'>One-time payment</p>
            <ul className='space-y-2 text-sm'>
              <li className='flex items-center'>
                <span className='mr-2 text-green-500'>✓</span>
                Everything in Monthly
              </li>
              <li className='flex items-center'>
                <span className='mr-2 text-green-500'>✓</span>
                No recurring payments
              </li>
              <li className='flex items-center'>
                <span className='mr-2 text-green-500'>✓</span>
                Lifetime access
              </li>
              <li className='flex items-center'>
                <span className='mr-2 text-green-500'>✓</span>
                Early access to new features
              </li>
              <li className='flex items-center'>
                <span className='mr-2 text-green-500'>✓</span>
                Premium support
              </li>
              <li className='flex items-center'>
                <span className='mr-2 text-green-500'>✓</span>
                Beta testing access
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Subscription Actions */}
      <div className='rounded-lg bg-gray-800/50 p-6'>
        <h3 className='mb-4 text-lg font-medium'>Subscription Actions</h3>

        {subscriptionStatus.planType === 'free' ? (
          <div className='space-y-4'>
            <p className='text-gray-300'>Upgrade to unlock premium features</p>
            <div className='grid grid-cols-2 gap-4'>
              <button
                onClick={(): void => {
                  void handleUpgradeToMonthly()
                }}
                disabled={isUpgrading}
                className='text-white rounded-lg bg-blue-600 px-6 py-3 font-medium transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50'
              >
                {isUpgrading ? (
                  <div className='flex items-center justify-center gap-2'>
                    <Loading className='h-4 w-4' />
                    <span>Processing...</span>
                  </div>
                ) : (
                  'Upgrade to Monthly ($5/month)'
                )}
              </button>
              <button
                onClick={(): void => {
                  void handleUpgradeToLifetime()
                }}
                disabled={isUpgrading}
                className='text-white rounded-lg bg-purple-600 px-6 py-3 font-medium transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50'
              >
                {isUpgrading ? (
                  <div className='flex items-center justify-center gap-2'>
                    <Loading className='h-4 w-4' />
                    <span>Processing...</span>
                  </div>
                ) : (
                  'Upgrade to Lifetime ($99)'
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className='space-y-4'>
            {subscriptionStatus.subscription?.status === 'active' && (
              <button
                onClick={(): void => {
                  void handleCancelSubscription()
                }}
                disabled={isUpgrading}
                className='text-white w-full rounded-lg bg-red-600 px-6 py-3 font-medium transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50'
              >
                {isUpgrading ? (
                  <div className='flex items-center justify-center gap-2'>
                    <Loading className='h-4 w-4' />
                    <span>Processing...</span>
                  </div>
                ) : (
                  'Cancel Subscription'
                )}
              </button>
            )}

            {subscriptionStatus.subscription?.status === 'canceled' && (
              <button
                onClick={(): void => {
                  void handleReactivateSubscription()
                }}
                disabled={isUpgrading}
                className='text-white w-full rounded-lg bg-green-600 px-6 py-3 font-medium transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50'
              >
                {isUpgrading ? (
                  <div className='flex items-center justify-center gap-2'>
                    <Loading className='h-4 w-4' />
                    <span>Processing...</span>
                  </div>
                ) : (
                  'Reactivate Subscription'
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
