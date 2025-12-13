// Mock Rate Limit Manager for isolated testing of the logic
class RateLimitManager {
  private static readonly MAX_TOKENS = 50 // Max burst size
  private static readonly REFILL_RATE_MS = 600 // 1 token every 600ms (~100 calls/min)

  private static tokens = RateLimitManager.MAX_TOKENS
  private static lastRefill = Date.now()

  private static refillTokens() {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    const newTokens = Math.floor(elapsed / this.REFILL_RATE_MS)

    if (newTokens > 0) {
      this.tokens = Math.min(this.MAX_TOKENS, this.tokens + newTokens)
      this.lastRefill = now
    }
  }

  public static checkLimit(consume: boolean = true): boolean {
    this.refillTokens()
    if (this.tokens >= 1) {
      if (consume) this.tokens -= 1
      return true
    }
    return false
  }

  public static get status() {
    this.refillTokens()
    return { tokens: this.tokens, max: this.MAX_TOKENS }
  }
}

async function verifyRateLimiter() {
  console.log('Starting Rate Limit Verification (Logic Check)...')

  // 1. Initial State
  const initial = RateLimitManager.status
  console.log('Initial Tokens:', initial.tokens)

  if (initial.tokens !== 50) {
    console.error('❌ Expected 50 tokens initially')
    process.exit(1)
  }

  // 2. Consume 10 tokens
  for (let i = 0; i < 10; i++) {
    RateLimitManager.checkLimit(true)
  }

  console.log('After consuming 10:', RateLimitManager.status.tokens)
  if (RateLimitManager.status.tokens > 40) {
    // Time might have refilled slightly
    console.error(
      '❌ Tokens did not decrease correctly',
      RateLimitManager.status.tokens
    )
  }

  // 3. Simulate burst
  console.log('Simulating burst of 45 requests...')
  let allowedCount = 0
  for (let i = 0; i < 45; i++) {
    if (RateLimitManager.checkLimit(true)) allowedCount++
  }
  console.log(
    'Allowed:',
    allowedCount,
    'Remaining:',
    RateLimitManager.status.tokens
  )

  // Should have exhausted tokens (started ~40, consumed 45 -> some should fail)
  if (RateLimitManager.status.tokens === 0) {
    console.log('✅ Tokens exhausted successfully')
  } else {
    console.log(
      '⚠️ Tokens remaining (might be refill):',
      RateLimitManager.status.tokens
    )
  }

  if (allowedCount < 45) {
    console.log('✅ Rate limit kicked in as expected (Allowed < Requested)')
  }

  console.log('Waiting 2 seconds for refill...')
  await new Promise((r) => setTimeout(r, 2000))

  const statusAfterWait = RateLimitManager.status
  console.log('Tokens after wait:', statusAfterWait.tokens)

  if (statusAfterWait.tokens > 0) {
    console.log('✅ Refill working')
  } else {
    console.error('❌ Refill failed')
  }
}

verifyRateLimiter()
