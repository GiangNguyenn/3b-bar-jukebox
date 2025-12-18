/**
 * Utility functions for handling dynamic domains in different environments
 */

/**
 * Get the base URL for the current environment
 * Handles Vercel preview deployments, production, and local development
 */
export function getBaseUrl(request?: Request): string {
  // Client-side: use window.location.origin (always respects current URL)
  if (typeof window !== 'undefined') {
    return window.location.origin
  }

  // In development mode, always use localhost on server side
  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:3000'
  }

  // 1. Explicit override (e.g., for production custom domains)
  if (process.env.NEXT_PUBLIC_BASE_URL) {
    return process.env.NEXT_PUBLIC_BASE_URL
  }

  // 2. Try to get URL from request headers (most accurate for server-side rendering behind proxies/Vercel)
  if (request) {
    const host = request.headers.get('host')
    const protocol = request.headers.get('x-forwarded-proto') || 'http'

    if (host) {
      // If it's localhost, keep the port
      if (host.includes('localhost')) {
        return `${protocol}://${host}`
      }

      // Remove port if it's the default port for production
      const cleanHost = host.replace(':80', '').replace(':443', '')
      return `${protocol}://${cleanHost}`
    }
  }

  // 3. Vercel fallback (last resort for server-side if headers missing)
  if (process.env.VERCEL_URL) {
    // Vercel provides the deployment URL (e.g., "my-app-git-feature-branch-username.vercel.app")
    return `https://${process.env.VERCEL_URL}`
  }

  // Production fallback - this should be overridden by environment variables
  console.warn(
    'No VERCEL_URL or NEXT_PUBLIC_BASE_URL set in production. Please set one of these environment variables.'
  )
  return 'http://localhost:3000' // Keep localhost as fallback but log warning
}

/**
 * Get the OAuth redirect URL for the current environment
 */
export function getOAuthRedirectUrl(request?: Request): string {
  const baseUrl = getBaseUrl(request)
  return `${baseUrl}/api/auth/callback/supabase`
}

/**
 * Get the site URL for metadata and other purposes
 * Uses a more stable URL for production metadata
 */
export function getSiteUrl(): string {
  // For metadata and SEO, prefer a stable production URL
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL
  }

  // Fallback to dynamic URL
  return getBaseUrl()
}
