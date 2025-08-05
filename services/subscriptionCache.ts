import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { createModuleLogger } from '@/shared/utils/logger'

type Subscription = Database['public']['Tables']['subscriptions']['Row']

const logger = createModuleLogger('SubscriptionCache')

interface CacheEntry<T> {
  data: T
  timestamp: number
  ttl: number
}

interface SubscriptionCache {
  [key: string]: CacheEntry<any>
}

export class SubscriptionCacheService {
  private cache: SubscriptionCache = {}
  private readonly DEFAULT_TTL = 5 * 60 * 1000 // 5 minutes
  private readonly PREMIUM_CHECK_TTL = 2 * 60 * 1000 // 2 minutes
  private supabase

  constructor() {
    this.supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }

  /**
   * Get cached value or fetch from database
   */
  private async getCachedOrFetch<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttl: number = this.DEFAULT_TTL
  ): Promise<T> {
    const now = Date.now()
    const cached = this.cache[key]

    // Check if cache entry exists and is still valid
    if (cached && now - cached.timestamp < cached.ttl) {
      logger('INFO', `Cache hit for key: ${key}`)
      return cached.data
    }

    // Fetch fresh data
    try {
      const data = await fetchFn()

      // Cache the result
      this.cache[key] = {
        data,
        timestamp: now,
        ttl
      }

      logger('INFO', `Cache miss for key: ${key}, cached new data`)
      return data
    } catch (error) {
      logger(
        'ERROR',
        `Error fetching data for key: ${key}`,
        'SubscriptionCache',
        error as Error
      )

      // Return cached data if available, even if expired
      if (cached) {
        logger('INFO', `Returning expired cache for key: ${key}`)
        return cached.data
      }

      throw error
    }
  }

  /**
   * Invalidate cache for a specific key
   */
  invalidateCache(key: string): void {
    delete this.cache[key]
    logger('INFO', `Invalidated cache for key: ${key}`)
  }

  /**
   * Invalidate all cache entries for a user
   */
  invalidateUserCache(profileId: string): void {
    const keysToDelete = Object.keys(this.cache).filter((key) =>
      key.includes(profileId)
    )

    keysToDelete.forEach((key) => {
      delete this.cache[key]
    })

    logger(
      'INFO',
      `Invalidated ${keysToDelete.length} cache entries for user: ${profileId}`
    )
  }

  /**
   * Clear all cache
   */
  clearCache(): void {
    this.cache = {}
    logger('INFO', 'Cleared all cache entries')
  }

  /**
   * Get user's plan type with caching
   */
  async getUserPlanType(profileId: string): Promise<'free' | 'premium'> {
    const key = `plan_type:${profileId}`

    return this.getCachedOrFetch(
      key,
      async () => {
        const { data, error } = await this.supabase.rpc(
          'get_user_plan_type_optimized',
          {
            user_profile_id: profileId
          }
        )

        if (error) {
          logger(
            'ERROR',
            'Error getting user plan type',
            'SubscriptionCache',
            error as Error
          )
          return 'free'
        }

        return (data as 'free' | 'premium') || 'free'
      },
      this.PREMIUM_CHECK_TTL
    )
  }

  /**
   * Check if user has premium access with caching
   */
  async hasPremiumAccess(profileId: string): Promise<boolean> {
    const key = `premium_access:${profileId}`

    return this.getCachedOrFetch(
      key,
      async () => {
        const { data, error } = await this.supabase.rpc(
          'check_premium_access',
          {
            user_profile_id: profileId
          }
        )

        if (error) {
          logger(
            'ERROR',
            'Error checking premium access',
            'SubscriptionCache',
            error as Error
          )
          return false
        }

        return (data as boolean) || false
      },
      this.PREMIUM_CHECK_TTL
    )
  }

  /**
   * Get user subscription status with caching
   */
  async getUserSubscriptionStatus(profileId: string) {
    const key = `subscription_status:${profileId}`

    return this.getCachedOrFetch(key, async () => {
      const { data, error } = await this.supabase.rpc(
        'get_user_subscription_status',
        {
          user_profile_id: profileId
        }
      )

      if (error) {
        logger(
          'ERROR',
          'Error getting subscription status',
          'SubscriptionCache',
          error as Error
        )
        return null
      }

      return data?.[0] || null
    })
  }

  /**
   * Get active subscription with caching
   */
  async getActiveSubscription(profileId: string): Promise<Subscription | null> {
    const key = `active_subscription:${profileId}`

    return this.getCachedOrFetch(key, async () => {
      const { data, error } = await this.supabase
        .from('subscriptions')
        .select('*')
        .eq('profile_id', profileId)
        .eq('status', 'active')
        .single()

      if (error) {
        logger(
          'ERROR',
          'Error getting active subscription',
          'SubscriptionCache',
          error as Error
        )
        return null
      }

      return data
    })
  }

  /**
   * Get subscription by ID with caching
   */
  async getSubscriptionById(id: string): Promise<Subscription | null> {
    const key = `subscription:${id}`

    return this.getCachedOrFetch(key, async () => {
      const { data, error } = await this.supabase
        .from('subscriptions')
        .select('*')
        .eq('id', id)
        .single()

      if (error) {
        logger(
          'ERROR',
          'Error getting subscription by ID',
          'SubscriptionCache',
          error as Error
        )
        return null
      }

      return data
    })
  }

  /**
   * Get user subscription summary from materialized view
   */
  async getUserSubscriptionSummary(profileId: string) {
    const key = `subscription_summary:${profileId}`

    return this.getCachedOrFetch(key, async () => {
      const { data, error } = await this.supabase
        .from('user_subscription_summary')
        .select('*')
        .eq('profile_id', profileId)
        .single()

      if (error) {
        logger(
          'ERROR',
          'Error getting subscription summary',
          'SubscriptionCache',
          error as Error
        )
        return null
      }

      return data
    })
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    const now = Date.now()
    const totalEntries = Object.keys(this.cache).length
    const validEntries = Object.values(this.cache).filter(
      (entry) => now - entry.timestamp < entry.ttl
    ).length
    const expiredEntries = totalEntries - validEntries

    return {
      totalEntries,
      validEntries,
      expiredEntries,
      cacheSize: JSON.stringify(this.cache).length
    }
  }
}

// Export a singleton instance
export const subscriptionCache = new SubscriptionCacheService()
