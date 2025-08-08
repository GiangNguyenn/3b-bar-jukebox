import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/supabase'

/**
 * Completely clears all authentication state to ensure a fresh start
 */
export async function clearAuthenticationState(): Promise<void> {
  try {
    const supabase = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    // Get current user before signing out to clean up their profile data
    const {
      data: { user }
    } = await supabase.auth.getUser()

    // Clear profile data from database if user exists
    if (user) {
      try {
        await supabase.from('profiles').delete().eq('id', user.id)
      } catch (error) {
        console.warn('Failed to clear profile data:', error)
        // Continue with sign out even if profile cleanup fails
      }
    }

    // Sign out from Supabase (this clears the session)
    await supabase.auth.signOut()

    // Clear any cached tokens or localStorage items
    if (typeof window !== 'undefined') {
      // Clear localStorage items that might contain auth data
      const authKeys = Object.keys(localStorage).filter(
        (key) =>
          key.includes('supabase') ||
          key.includes('auth') ||
          key.includes('token') ||
          key.includes('spotify')
      )

      authKeys.forEach((key) => {
        localStorage.removeItem(key)
      })

      // Clear sessionStorage as well
      const sessionAuthKeys = Object.keys(sessionStorage).filter(
        (key) =>
          key.includes('supabase') ||
          key.includes('auth') ||
          key.includes('token') ||
          key.includes('spotify')
      )

      sessionAuthKeys.forEach((key) => {
        sessionStorage.removeItem(key)
      })

      // Clear any auth-related cookies by setting them to expire
      document.cookie.split(';').forEach((cookie) => {
        const eqPos = cookie.indexOf('=')
        const name = eqPos > -1 ? cookie.substr(0, eqPos).trim() : cookie.trim()
        if (
          name.includes('supabase') ||
          name.includes('auth') ||
          name.includes('spotify')
        ) {
          document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`
        }
      })
    }
  } catch (error) {
    console.error('Error clearing authentication state:', error)
    throw error
  }
}

/**
 * Forces a complete fresh authentication flow by clearing all state and redirecting
 */
export async function startFreshAuthentication(): Promise<void> {
  try {
    await clearAuthenticationState()

    // Add a small delay to ensure cleanup is complete
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Force Spotify logout by navigating to their logout endpoint first
    if (typeof window !== 'undefined') {
      // First, try to logout from Spotify to clear their session
      const spotifyLogoutUrl = 'https://accounts.spotify.com/en/logout'

      // Create a hidden iframe to logout from Spotify silently
      const logoutFrame = document.createElement('iframe')
      logoutFrame.style.display = 'none'
      logoutFrame.src = spotifyLogoutUrl
      document.body.appendChild(logoutFrame)

      // Wait a moment for the logout, then clean up and redirect
      setTimeout(() => {
        document.body.removeChild(logoutFrame)
        window.location.href = '/auth/signin?fresh=true'
      }, 1000)
    }
  } catch (error) {
    console.error('Error starting fresh authentication:', error)
    // Fallback: still redirect to sign-in even if cleanup fails
    if (typeof window !== 'undefined') {
      window.location.href = '/auth/signin'
    }
  }
}
