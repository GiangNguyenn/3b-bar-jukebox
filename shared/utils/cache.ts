interface CacheEntry<T> {
  data: T
  timestamp: number
}

class Cache {
  private static instance: Cache
  private cache: Map<string, CacheEntry<any>>
  private readonly DEFAULT_TTL = 300000 // 5 minutes in milliseconds (more appropriate for API tokens)

  private constructor() {
    this.cache = new Map()
  }

  static getInstance(): Cache {
    if (!Cache.instance) {
      Cache.instance = new Cache()
    }
    return Cache.instance
  }

  set<T>(key: string, data: T, ttl: number = this.DEFAULT_TTL): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now() + ttl
    })
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key)
    if (!entry) return null

    const now = Date.now()
    if (now > entry.timestamp) {
      this.cache.delete(key)
      return null
    }

    return entry.data as T
  }

  delete(key: string): void {
    this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  // Add method to check if a key exists and is not expired
  has(key: string): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false

    const now = Date.now()
    if (now > entry.timestamp) {
      this.cache.delete(key)
      return false
    }

    return true
  }
}

export const cache = Cache.getInstance()
