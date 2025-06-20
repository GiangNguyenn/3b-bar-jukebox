# Architecture Decisions

## 1. Frontend

- **Framework:** Next.js (React-based, serverless-ready)
- **Routing:**
  - `/[username]/playlist` – Public-facing, allows song search and add
  - `/[username]/admin` – Private, authenticated admin playback
  - `/premium-required` – Premium account requirement explanation page
- **Data Fetching:**
  - SWR for client-side
  - Server-side API routes for authentication and premium verification

## 2. Authentication

- **Tool:** Supabase Auth (replacing NextAuth.js)
- **Provider:** Spotify OAuth (Authorization Code Flow)
- **Session Handling:** JWT-based with automatic token refresh
- **Premium Verification:** Server-side verification of Spotify account type
- **Credential Management:**
  - Admin user's Spotify credentials stored in database
  - Public features use stored admin credentials
  - No authentication required for public features
  - Automatic token refresh for stored credentials
- **OAuth Flow:**
  - User initiates login at `/auth/signin`
  - Redirected to Spotify OAuth consent screen
  - After authorization, redirected to `/api/auth/callback/supabase`
  - Callback verifies premium status and redirects accordingly:
    - Premium users → `/{username}/admin`
    - Non-premium users → `/premium-required`

## 3. Database

- **Platform:** Supabase (PostgreSQL with Row-Level Security)
- **Stored Data:**
  - Users and their Spotify account info
  - Admin user's Spotify credentials (access token, refresh token)
  - Premium status and account type (`spotify_product_type`, `is_premium`)
  - Playlist metadata linked to each user
  - (Optional) Tracks added to playlists via your app
- **Why Supabase:**
  - Free tier
  - RLS for per-user data isolation
  - No self-hosting needed
  - REST/Realtime/WebSocket support
  - Built-in authentication system

## 4. Spotify Integration

- **Spotify Web API:** For playlist creation, track search, and track addition
- **Spotify Web Playback SDK:** For playing music in the admin page only
- **Premium API Features:** All playback control APIs require premium accounts
- **Token Usage:**
  - Admin interface: Tokens refreshed via Supabase Auth
  - Public features: Uses stored admin credentials
  - Server-side API routes handle token refresh
- **Premium Verification:**
  - Calls `/me` endpoint to check `product` field
  - Supports: `premium`, `premium_duo`, `premium_family`, `premium_student`
  - Blocks access to premium-only features for free accounts

## 5. API Backend

- **Environment:** Node.js (provided by Vercel's serverless functions)
- **Authentication Endpoints:**
  - `/api/auth/callback/supabase` – OAuth callback with premium verification
  - `/api/auth/verify-premium` – Premium status verification
  - `/api/auth/profile` – Profile setup and management
- **Feature Endpoints:**
  - `/api/add-track` – Server-side track addition using Spotify API
  - `/api/create-playlist` – Server-side setup for new users
  - `/api/search` – Public search using admin credentials
- **Security:**
  - Admin routes require authentication and premium verification
  - Public routes use stored admin credentials
  - Rate limiting on public endpoints
  - Middleware protection for all admin routes

## 6. Middleware & Route Protection

- **Middleware:** Next.js middleware for route protection
- **Admin Route Protection:**
  - Checks for valid Supabase session
  - Verifies premium status via API call
  - Redirects non-premium users to `/premium-required`
  - Redirects unauthenticated users to `/auth/signin`
- **Premium Verification:**
  - Server-side verification in callback
  - Client-side verification via `/api/auth/verify-premium`
  - Automatic redirects for non-premium users

## 7. Deployment

- **Hosting:** Vercel (serverless, no manual backend setup)
- **Supabase:** Used as a hosted backend service (DB + Auth + API)
- **Environment Variables:**
  - Spotify client credentials (needed for token exchange)
  - Supabase keys (URL, anon key, service role key)
  - Database connection strings

## 8. Security & Access Control

- Public read-only access to user playlists
- Authenticated access to admin playback interface
- Premium account requirement for admin features
- RLS on Supabase to isolate user data
- Secure storage of admin credentials
- Rate limiting on public endpoints
- OAuth state validation and CSRF protection

## 9. User Experience Flow

- **Public Users:** Can search and add songs without authentication
- **Free Spotify Users:** Can log in but are redirected to premium explanation
- **Premium Spotify Users:** Full access to admin playback controls
- **Premium Upgrade Path:** Clear explanation and direct link to Spotify Premium

## 10. Scalability

- One playlist per user for now, but schema allows future extension
- Premium verification prevents abuse of premium API features
- Potential support for:
  - Voting/queue system
  - QR-based access
  - Rate limiting to prevent abuse
  - Multiple admin users with different permission levels
