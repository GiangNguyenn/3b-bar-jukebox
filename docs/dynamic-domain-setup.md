# Dynamic Domain Setup for OAuth

This guide explains how to handle dynamic domains (like Vercel preview deployments) for OAuth authentication.

## Overview

The application now supports dynamic domains through the `shared/utils/domain.ts` utility, which automatically detects the current environment and provides the correct base URL for OAuth redirects.

## Environment Variables

### Required Variables

1. **`NEXT_PUBLIC_SUPABASE_URL`** - Your Supabase project URL
2. **`NEXT_PUBLIC_SUPABASE_ANON_KEY`** - Your Supabase anon key

### Optional Variables

3. **`NEXT_PUBLIC_BASE_URL`** - Custom base URL for production (e.g., `https://yourdomain.com`)
4. **`NEXT_PUBLIC_SITE_URL`** - Stable site URL for metadata (e.g., `https://yourdomain.com`)
5. **`VERCEL_URL`** - Automatically provided by Vercel (no manual setup needed)

## Domain Resolution Logic

The `getBaseUrl()` function resolves domains in this order:

1. **Client-side**: Uses `window.location.origin`
2. **Vercel deployments**: Uses `https://${process.env.VERCEL_URL}`
3. **Custom production**: Uses `process.env.NEXT_PUBLIC_BASE_URL`
4. **Fallback**: Uses `http://localhost:3000`

## OAuth Configuration

### Supabase OAuth Settings

In your Supabase Dashboard → Authentication → URL Configuration, add these redirect URLs:

```
# Development
http://localhost:3000/api/auth/callback/supabase

# Production (your main domain)
https://yourdomain.com/api/auth/callback/supabase

# Vercel preview deployments (optional - for testing)
https://*.vercel.app/api/auth/callback/supabase
```

### Spotify App Configuration

In your Spotify Developer Dashboard → App Settings → Redirect URIs, add:

```
# Development
http://localhost:3000/api/auth/callback/supabase

# Production (your main domain)
https://yourdomain.com/api/auth/callback/supabase

# Vercel preview deployments (optional - for testing)
https://*.vercel.app/api/auth/callback/supabase
```

## Vercel Environment Variables

Set these in your Vercel project settings:

### Production Environment
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_BASE_URL=https://yourdomain.com
NEXT_PUBLIC_SITE_URL=https://yourdomain.com
```

### Preview Environment (optional)
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
# VERCEL_URL is automatically provided
```

## How It Works

1. **User clicks "Sign in with Spotify"**
2. **`getOAuthRedirectUrl()`** determines the correct callback URL:
   - Local: `http://localhost:3000/api/auth/callback/supabase`
   - Vercel preview: `https://preview-branch.vercel.app/api/auth/callback/supabase`
   - Production: `https://yourdomain.com/api/auth/callback/supabase`

3. **Spotify redirects back** to the correct callback URL
4. **Callback handler** uses `getBaseUrl()` to redirect to the admin page on the same domain

## Testing

### Local Development
```bash
npm run dev
# OAuth will redirect to http://localhost:3000/api/auth/callback/supabase
```

### Vercel Preview Deployments
- Create a pull request
- Vercel creates a preview deployment
- OAuth will automatically use the preview domain
- No additional configuration needed

### Production
- Deploy to main branch
- OAuth will use your configured production domain

## Troubleshooting

### Issue: Still redirecting to localhost
1. Check that `NEXT_PUBLIC_SUPABASE_URL` points to your production Supabase instance
2. Verify Supabase OAuth redirect URLs include your production domain
3. Check Spotify app redirect URIs include your production domain

### Issue: OAuth callback fails
1. Ensure the callback URL in Supabase matches exactly what's being generated
2. Check browser console for the actual redirect URL being used
3. Verify all environment variables are set correctly

### Issue: Preview deployments not working
1. Make sure `VERCEL_URL` is available (should be automatic)
2. Add `https://*.vercel.app/api/auth/callback/supabase` to your OAuth redirect URLs
3. Check that your Supabase project allows the preview domain

## Security Notes

- The `VERCEL_URL` environment variable is automatically provided by Vercel
- Preview deployments use HTTPS by default
- All OAuth redirects should use HTTPS in production
- The domain utility prioritizes security by using the most specific URL available 