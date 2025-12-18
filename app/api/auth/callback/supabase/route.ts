import { NextResponse } from 'next/server'
import { AuthService } from '@/services/authService'
import { getBaseUrl } from '@/shared/utils/domain'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const error = requestUrl.searchParams.get('error')
  const errorDescription = requestUrl.searchParams.get('error_description')

  if (error) {
    const premiumMessage = 'Spotify Premium account required for this jukebox'
    return NextResponse.redirect(
      `${getBaseUrl(request)}/auth/error?error=${encodeURIComponent(
        `${premiumMessage}. ${errorDescription ?? error}`
      )}`
    )
  }

  if (!code) {
    return NextResponse.redirect(
      `${getBaseUrl(request)}/auth/error?error=Spotify%20Premium%20account%20required.%20Authorization%20code%20not%20found.`
    )
  }

  try {
    const authService = new AuthService()
    const session = await authService.exchangeCodeForSession(code)

    // Type guard for session properties
    const accessToken =
      typeof session.provider_token === 'string' ? session.provider_token : null
    if (!accessToken) {
      return NextResponse.redirect(
        `${getBaseUrl(request)}/auth/error?error=Spotify%20Premium%20account%20required.%20Access%20token%20not%20found.`
      )
    }

    const userProfile = await authService.getSpotifyUserProfile(accessToken)
    const isPremium = authService.isPremiumUser(userProfile)

    // Create profile data object with proper type guards
    const profileData = {
      id: typeof session.user?.id === 'string' ? session.user.id : '',
      spotify_user_id: userProfile.id,
      display_name: userProfile.display_name,
      avatar_url: userProfile.images?.[0]?.url ?? null,
      is_premium: isPremium,
      spotify_product_type: userProfile.product,
      spotify_access_token: accessToken,
      spotify_refresh_token:
        typeof session.provider_refresh_token === 'string'
          ? session.provider_refresh_token
          : null,
      spotify_token_expires_at:
        typeof session.expires_at === 'number'
          ? session.expires_at
          : Math.floor(Date.now() / 1000) + 3600,
      premium_verified_at: new Date().toISOString()
    }

    // Upsert profile - this may modify the display_name if there's a conflict
    await authService.upsertUserProfile(profileData)

    // Use the potentially modified display_name for redirect
    const redirectUrl = isPremium
      ? `/${encodeURIComponent(profileData.display_name)}/admin`
      : '/premium-required'

    return NextResponse.redirect(`${getBaseUrl(request)}${redirectUrl}`)
  } catch (e) {
    const errorMessage =
      e instanceof Error ? e.message : 'An unknown error occurred.'
    return NextResponse.redirect(
      `${getBaseUrl(request)}/auth/error?error=${encodeURIComponent(errorMessage)}`
    )
  }
}
