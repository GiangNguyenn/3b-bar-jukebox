# Step 1 Implementation Plan: Add NextAuth.js with Spotify Provider

## Objective

Implement proper Spotify OAuth login using NextAuth.js, replacing in-memory token handling. Secure the admin page behind authentication and enable login/logout flow. Refactor routing so the playlist page is under `/[username]/playlist` and the root page (`/`) becomes a landing page with authentication.

---

## High-Level Changes Required

### 1. Install and Configure NextAuth.js

- [x] Add `next-auth` and required dependencies to the project.
- [x] Create or update the Next.js API route at `/api/auth/[...nextauth].ts` to initialize NextAuth with the Spotify provider.
- [x] Configure Spotify OAuth credentials (client ID, client secret) using environment variables.
  **Validation:**
- [x] Visit `/api/auth/signin` and confirm the NextAuth sign-in page appears with Spotify as an option.
- [x] Check for errors in the terminal and browser console related to NextAuth configuration.

### 2. Implement Spotify Provider

- [x] Set up the Spotify provider in NextAuth configuration.
- [x] Define required scopes for playlist management and playback.
- [x] Handle the OAuth callback to receive access and refresh tokens.
  **Validation:**
- [x] Click the Spotify login button and confirm redirection to Spotify's OAuth consent screen.
- [x] After authorizing, confirm redirection back to the app and that a session cookie is set.

### 3. JWT Session Handling

- [x] Configure NextAuth to use JWT sessions.
- [x] Implement custom `jwt()` and `session()` callbacks to store and expose access/refresh tokens in the session object.
  **Validation:**
- [x] Inspect the session using `useSession` or `/api/auth/session` and confirm it contains a valid Spotify access token and refresh token.
- [x] Log out and log in again; the session should update accordingly.

### 4. Supabase Setup and Integration

- [x] Create Supabase project:
  - [x] Sign up for Supabase account
  - [x] Create new project
  - [x] Configure project settings:
    - [x] General Settings:
      - [x] Set project name to "3B Saigon Jukebox"
      - [x] Choose a region closest to your target users (e.g., Singapore for Asia)
      - [x] Enable database backups (daily)
    - [x] Authentication Settings:
      - [x] Configure Spotify OAuth:
        - [x] Add Spotify Client ID and Secret
        - [x] Set redirect URL to `https://[YOUR_PROJECT_REF].supabase.co/auth/v1/callback`
        - [x] Enable "Auto-confirm" for Spotify users
      - [x] JWT Settings:
        - [x] Set JWT expiry to 1 hour
        - [x] Enable refresh token rotation
    - [x] Database Settings:
      - [x] Enable Row Level Security (RLS)
      - [x] Set up connection pooling (default settings)
      - [x] Configure database password policy
    - [x] API Settings:
      - [x] Enable REST API
      - [x] Enable Realtime API for playlist updates
      - [x] Set up API rate limiting (default settings)
  - [x] Note down project URL and anon key

- [x] Set up Vercel environment variables:
  - [x] Add Spotify credentials:
    - [x] `SPOTIFY_CLIENT_ID`
    - [x] `SPOTIFY_CLIENT_SECRET`
  - [x] Add Supabase credentials:
    - [x] `NEXT_PUBLIC_SUPABASE_URL`
    - [x] `NEXT_PUBLIC_SUPABASE_ANON_KEY`
    - [x] `SUPABASE_SERVICE_ROLE_KEY` (for admin operations)

Next steps:
1. Set the redirect URL in Supabase:
   - Go to Authentication > URL Configuration
   - Add your project's callback URL: `https://[YOUR_PROJECT_REF].supabase.co/auth/v1/callback`
   - Replace `[YOUR_PROJECT_REF]` with your actual project reference

2. Enable "Auto-confirm" for Spotify users:
   - Go to Authentication > Providers > Spotify
   - Enable "Auto-confirm" option
   - This will automatically create user accounts when they authenticate with Spotify

3. Configure JWT Settings:
   - Go to Authentication > JWT Settings
   - Set JWT expiry to 1 hour
   - Enable refresh token rotation

Would you like me to:
1. Help you set up the Vercel environment variables?
2. Explain how these credentials will be used in the application?
3. Add any additional environment variables we might need?

### 5. Data Persistence and User Management

- [ ] Set up Supabase database schema for:
  - [ ] User profiles (Spotify user ID, display name)
  - [ ] User's "3B Saigon" playlist ID
- [ ] Implement Row Level Security (RLS) policies for:
  - [ ] Users can only read/write their own profile
  - [ ] Users can only read/write their own playlist ID
- [ ] Create API endpoints for:
  - [ ] User profile management
  - [ ] Playlist ID storage and retrieval
  **Validation:**
- [ ] Database schema correctly enforces access control
- [ ] Each user has their own "3B Saigon" playlist
- [ ] Only playlist owner can access admin features
- [ ] Playlist ID persists correctly between sessions

### 6. Basic Route Structure

- [ ] Move the current playlist/search/add page from `/` to a new dynamic route: `/[username]/playlist`.
- [ ] Implement playlist creation flow:
  - [ ] Check if user has a "3B Saigon" playlist
  - [ ] Create playlist if it doesn't exist using Spotify API
  - [ ] Store only the playlist ID in database
- [ ] Refactor logic and UI to work under the new route:
  - [ ] Update playlist hooks to use Spotify API for all playlist operations
  - [ ] Ensure search and add functionality works without authentication
  - [ ] Handle cases where playlist doesn't exist yet
- [ ] Update all internal links and navigation to use the new dynamic route.
- [ ] Ensure the playlist page remains public and accessible without authentication.
  **Validation:**
- [ ] Visit `/[username]/playlist` as an unauthenticated user: see the playlist and search interface.
- [ ] New users get their own "3B Saigon" playlist created automatically via Spotify API.
- [ ] Anyone can search and add songs without logging in.
- [ ] Playlist owner can access admin features.
- [ ] Navigating directly to `/[username]/playlist` works for all users.

### 7. Public Features Implementation

- [ ] Implement public playlist viewing:
  - [ ] Track listing (via Spotify API)
  - [ ] Search functionality (via Spotify API)
  - [ ] Add to playlist (via Spotify API, no auth required)
- [ ] Add playlist discovery features:
  - [ ] Browse public playlists
  - [ ] Search by username
  - [ ] Featured playlists section
- [ ] Implement rate limiting for public endpoints:
  - [ ] Limit song additions per IP
  - [ ] Limit search requests
  - [ ] Handle Spotify API rate limits
  **Validation:**
- [ ] Public features work without authentication
- [ ] Search and add functions are performant
- [ ] Rate limiting prevents abuse
- [ ] Spotify API integration works correctly

### 8. Create Landing Page at Root

- [ ] Implement a new landing page at `/` (`pages/index.tsx` or `app/page.tsx`).
- [ ] Add a login button for playlist owners.
- [ ] Add a brief app description explaining the public song addition feature.
- [ ] Use NextAuth's `useSession` to check authentication and redirect authenticated users to their `/[username]/admin` page.
- [ ] Add a search or browse feature to discover public playlists.
  **Validation:**
- [ ] Visit `/` as a logged-out user: see a landing page with login button and app description.
- [ ] Visit `/` as a logged-in user: redirected to `/[username]/admin`.
- [ ] Users can discover and access public playlists from the landing page.

### 9. Secure the Admin Page

- [ ] Move admin page to dynamic route `/[username]/admin`:
  - [ ] Migrate existing admin page components and features
  - [ ] Update all internal links and navigation
  - [ ] Maintain existing functionality:
    - [ ] Playback controls
    - [ ] Status monitoring
    - [ ] Track suggestions system
    - [ ] Health monitoring
    - [ ] Error handling
- [ ] Implement access control:
  - [ ] Verify authenticated user owns the playlist
  - [ ] Redirect unauthenticated users to login
  - [ ] Show appropriate error messages for unauthorized access
- [ ] Update Spotify player initialization:
  - [ ] Create separate Spotify player instance per admin user
  - [ ] Initialize player with user-specific context
  - [ ] Maintain existing health checks and monitoring
  - [ ] Update recovery system to handle multiple player instances
- [ ] Migrate track suggestions system:
  - [ ] Keep settings in localStorage per user
  - [ ] Implement default settings for first-time users
  - [ ] Maintain existing filtering and suggestion logic
- [ ] Update recovery system:
  - [ ] Modify recovery utilities to handle multiple player instances
  - [ ] Update device management for user-specific devices
  - [ ] Maintain existing error handling and monitoring
  - [ ] Add playlist creation if not found
- [ ] Implement playlist creation:
  - [ ] Check for existing "3B Saigon" playlist
  - [ ] Create empty playlist if not found
  - [ ] Store playlist ID in database
  - [ ] Initialize player with new playlist
  **Validation:**
- [ ] Access `/[username]/admin` as playlist owner: see full admin interface
- [ ] Access `/[username]/admin` as non-owner: see access denied message
- [ ] Access `/[username]/admin` as unauthenticated user: redirected to login
- [ ] All existing admin features work correctly under new route
- [ ] Playback controls function properly for playlist owner
- [ ] Track suggestions system maintains all existing functionality
- [ ] Health monitoring and error handling work as expected
- [ ] New users get empty playlist created automatically
- [ ] Recovery system handles multiple player instances correctly

### 10. Update Navigation and Redirects

- [ ] Ensure that after login, users are redirected to their personalized playlist page.
- [ ] Update any deep links or bookmarks to use the new route structure.
  **Validation:**
- [ ] After login, confirm redirection to `/[username]/playlist`.
- [ ] All links to the playlist page use the new dynamic route.
- [ ] Bookmarks and direct navigation to `/[username]/playlist` work.

### 11. Error Handling and Edge Cases

- [ ] Implement proper error handling for:
  - [ ] Invalid usernames/playlists
  - [ ] Rate limiting exceeded
  - [ ] Database connection issues
  - [ ] API failures
- [ ] Add user-friendly error messages
- [ ] Implement fallback UI states
  **Validation:**
- [ ] Users see helpful error messages
- [ ] System gracefully handles edge cases
- [ ] Error states are properly logged
- [ ] Recovery flows work as expected

### 12. Environment Variables and Documentation

- [x] Add Spotify client credentials and NextAuth secret to the environment configuration.
- [x] Document required environment variables in the project README or `.env.example`.
  **Validation:**
- [x] Remove or misconfigure a required environment variable and restart the app; the app should fail gracefully and provide a clear error message.

### 13. Testing

- [x] Test the login flow from the landing page.
- [ ] Test that `/[username]/playlist` is accessible without login and shows the correct playlist.
- [ ] Test that unauthenticated users see the landing page.
- [ ] Test that `/[username]/admin` is protected and only accessible by the correct user.
  **Validation:**
- [ ] Automated: Write integration tests for login, logout, protected routes, and redirects using Cypress or Playwright. Write unit tests for session handling and token management.
- [x] Manual: Go through each user flow as described above. Test with multiple Spotify accounts to ensure user isolation.

### 14. Login/Logout Flow

- [x] Add login and logout UI components/buttons to the frontend (e.g., in the header or admin page).
- [x] Use NextAuth client methods (`signIn`, `signOut`, `useSession`) to manage authentication state in the app.
  **Validation:**
- [x] Click login on the landing page and complete the Spotify OAuth flow; after login, land on your admin page.
- [x] Click logout; return to the landing page and session data is cleared.

### 15. Access Token Availability

- [x] Ensure the Spotify access token is available in the session object for authenticated API requests and playback.
- [ ] Update any server-side or client-side code that previously relied on in-memory tokens to use the session token instead.
  **Validation:**
- [x] Use the session object to confirm the Spotify access token is present.
- [x] Make an authenticated API call using the token from the session.
- [x] Confirm token refresh works if the token expires.

---

## Legacy Code Cleanup & Investigation

After implementing Step 1, review and remove or refactor obsolete code and patterns:

### 1. Legacy Authentication & Token Handling

- [ ] **Remove:**
  - Custom/in-memory Spotify OAuth flows (manual `/authorize` and `/token` calls)
  - Local storage/session storage of tokens
  - Custom hooks or context for managing user authentication state
  - Old login/logout UI and handlers not using NextAuth
  - Any hardcoded or fake user/session logic

### 2. Session/Token Contexts or Providers

- [ ] **Remove:**
  - Custom React Contexts, Providers, or hooks for user session/token data
  - Manual token injection in API calls (if now handled by NextAuth)

### 3. Root Page Logic

- [ ] **Refactor:**
  - Move all playlist/search/add logic from the root page to `/[username]/playlist`
  - Remove playlist-related state, hooks, or UI from the root page

### 4. API Route Security

- [ ] **Refactor:**
  - Update API routes to use session/token from NextAuth
  - Remove custom token validation or session checks

### 5. Environment Variables

- [ ] **Remove:**
  - Obsolete environment variables related to custom auth flows

### 6. Testing & Mocks

- [ ] **Update/Remove:**
  - Test utilities or mocks for old authentication/session logic
  - Update tests to use NextAuth session mocks
  - Remove tests that only cover legacy flows

#### Checklist: What Old Code Can Likely Be Removed

- [ ] Custom Spotify OAuth logic (manual token exchange, redirects, etc.)
- [ ] In-memory or localStorage token/session management
- [ ] Custom authentication React Contexts or Providers
- [ ] Old login/logout UI and handlers
- [ ] Playlist/search/add logic from the root page
- [ ] Manual token injection in API calls (if now handled by NextAuth)
- [ ] Obsolete environment variables for old auth flows
- [ ] Tests and mocks for legacy authentication/session logic

**Recommendation:**

- Audit the codebase for any of the above patterns.
- Document what is being removed and why (in PRs or migration notes).
- Test thoroughly after removal to ensure no regressions.

---

## Validation (Summary)

- [x] User can log in via Spotify.
- [ ] Admin page is accessible only when logged in.
- [x] Access token is available in `session.token`.
- [ ] Playlist page is available at `/[username]/playlist` and accessible to all users without authentication.
- [ ] Root page (`/`) is a landing page with authentication.
- [ ] Playback controls are only available in the authenticated admin page.
- [ ] Data persistence is properly implemented with Supabase.
- [ ] Public features are accessible without authentication.
- [ ] Error handling and edge cases are properly managed.
