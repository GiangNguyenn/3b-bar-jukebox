/**
 * Utility functions for handling dynamic domains in different environments
 */

/**
 * Get the base URL for the current environment
 * Handles Vercel preview deployments, production, and local development
 */
export function getBaseUrl(): string {
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

  // Fallback for local development
  return 'http://localhost:3000'
}

/**
 * Get the OAuth redirect URL for the current environment
 */
export function getOAuthRedirectUrl(): string {
  const baseUrl = getBaseUrl()
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
