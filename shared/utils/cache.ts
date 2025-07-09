interface CacheEntry<T> {
  data: T
  timestamp: number
}

class Cache {
  private static instance: Cache
  private cache: Map<string, CacheEntry<any>>
  private readonly TTL = 30000 // 30 seconds in milliseconds

  private constructor() {
    this.cache = new Map()
  }

  static getInstance(): Cache {
    if (!Cache.instance) {
      Cache.instance = new Cache()
    }
    return Cache.instance
  }

  set<T>(key: string, data: T, ttl: number = this.TTL): void {
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
}

export const cache = Cache.getInstance()
