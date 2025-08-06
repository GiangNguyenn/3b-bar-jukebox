/**
 * Utility functions for handling dynamic domains in different environments
 */

/**
 * Get the base URL for the current environment
 * Handles Vercel preview deployments, production, and local development
 */
export function getBaseUrl(request?: Request): string {
  // Client-side: use window.location.origin
  if (typeof window !== 'undefined') {
    return window.location.origin
  }

  // Server-side: use environment variables
  if (process.env.VERCEL_URL) {
    // Vercel provides the deployment URL (e.g., "my-app-git-feature-branch-username.vercel.app")
    return `https://${process.env.VERCEL_URL}`
  }

  if (process.env.NEXT_PUBLIC_BASE_URL) {
    // Custom base URL for production
    return process.env.NEXT_PUBLIC_BASE_URL
  }

  // Try to get URL from request headers (for server-side rendering)
  if (request) {
    const host = request.headers.get('host')
    const protocol = request.headers.get('x-forwarded-proto') || 'http'
    
    if (host) {
      // Remove port if it's the default port
      const cleanHost = host.replace(':3000', '').replace(':80', '').replace(':443', '')
      return `${protocol}://${cleanHost}`
    }
  }

  // Fallback for local development
  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:3000'
  }

  // Production fallback - this should be overridden by environment variables
  console.warn('No VERCEL_URL or NEXT_PUBLIC_BASE_URL set in production. Please set one of these environment variables.')
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
