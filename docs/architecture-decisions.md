# Architecture Decisions

## 1. Frontend
- **Framework:** Next.js (React-based, serverless-ready)
- **Routing:**
  - `/[username]/playlist` – Public-facing, allows song search and add
  - `/[username]/admin` – Private, authenticated admin playback
- **Data Fetching:**
  - SWR for client-side
  - `getServerSideProps` where needed

## 2. Authentication
- **Tool:** NextAuth.js
- **Provider:** Spotify OAuth (Authorization Code Flow)
- **Session Handling:** JWT-based with access & refresh token management in custom callbacks

## 3. Database
- **Platform:** Supabase (PostgreSQL with Row-Level Security)
- **Stored Data:**
  - Users and their Spotify account info
  - Playlist metadata linked to each user
  - (Optional) Tracks added to playlists via your app
- **Why Supabase:**
  - Free tier
  - RLS for per-user data isolation
  - No self-hosting needed
  - REST/Realtime/WebSocket support

## 4. Spotify Integration
- **Spotify Web API:** For playlist creation, track search, and track addition
- **Spotify Web Playback SDK:** For playing music in the admin page only
- **Token Usage:** Tokens are refreshed via NextAuth and used in serverless API routes

## 5. API Backend
- **Environment:** Node.js (provided by Vercel's serverless functions)
- **Endpoints:**
  - `/api/add-track` – Server-side track addition using Spotify API
  - `/api/create-playlist` – Server-side setup for new users
  - `/api/auth/[...nextauth].ts` – NextAuth handler

## 6. Deployment
- **Hosting:** Vercel (serverless, no manual backend setup)
- **Supabase:** Used as a hosted backend service (DB + Auth + API)
- **Environment Variables:**
  - Spotify client credentials (needed for token exchange)
  - Supabase keys
  - NextAuth secret and base URL

## 7. Security & Access Control
- Public read-only access to user playlists
- Authenticated access to admin playback interface
- RLS on Supabase to isolate user data

## 8. Scalability
- One playlist per user for now, but schema allows future extension
- Potential support for:
  - Voting/queue system
  - QR-based access
  - Rate limiting to prevent abuse 