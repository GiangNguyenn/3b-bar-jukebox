import { NextResponse } from 'next/server'
import { getBaseUrl } from '@/shared/utils/domain'
import { AuthService } from '@/services/authService'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const error = requestUrl.searchParams.get('error')
  const errorDescription = requestUrl.searchParams.get('error_description')

  if (error) {
    return NextResponse.redirect(
      `${getBaseUrl()}/auth/error?error=${encodeURIComponent(
        errorDescription ?? error
      )}`
    )
  }

  if (!code) {
    return NextResponse.redirect(
      `${getBaseUrl()}/auth/error?error=Authorization%20code%20not%20found.`
    )
  }

  try {
    const authService = new AuthService()
    const session = await authService.exchangeCodeForSession(code)

    const accessToken = session.provider_token
    if (!accessToken) {
      return NextResponse.redirect(
        `${getBaseUrl()}/auth/error?error=Spotify%20access%20token%20not%20found.`
      )
    }

    const userProfile = await authService.getSpotifyUserProfile(accessToken)
    const isPremium = authService.isPremiumUser(userProfile)

    await authService.upsertUserProfile({
      id: session.user.id,
      spotify_user_id: userProfile.id,
      display_name: userProfile.display_name,
      avatar_url: userProfile.images?.[0]?.url || null,
      is_premium: isPremium,
      spotify_product_type: userProfile.product,
      spotify_access_token: accessToken,
      spotify_refresh_token: session.provider_refresh_token,
      spotify_token_expires_at: session.expires_at,
      premium_verified_at: new Date().toISOString()
    })

    const redirectUrl = isPremium
      ? `/${userProfile.display_name}/admin`
      : '/premium-required'

    return NextResponse.redirect(`${getBaseUrl()}${redirectUrl}`)
  } catch (e) {
    const errorMessage =
      e instanceof Error ? e.message : 'An unknown error occurred.'
    return NextResponse.redirect(
      `${getBaseUrl()}/auth/error?error=${encodeURIComponent(errorMessage)}`
    )
  }
}
