# Step 1 Implementation Plan: Add NextAuth.js with Spotify Provider

## Objective

Implement proper Spotify OAuth login using NextAuth.js, replacing in-memory token handling. Secure the admin page behind authentication and enable login/logout flow. Refactor routing so the playlist page is under `/[username]/playlist` and the root page (`/`) becomes a landing page with authentication.

---

## High-Level Changes Required

### 1. Install and Configure NextAuth.js

- Add `next-auth` and required dependencies to the project.
- Create or update the Next.js API route at `/api/auth/[...nextauth].ts` to initialize NextAuth with the Spotify provider.
- Configure Spotify OAuth credentials (client ID, client secret) using environment variables.
  **Validation:**
- Visit `/api/auth/signin` and confirm the NextAuth sign-in page appears with Spotify as an option.
- Check for errors in the terminal and browser console related to NextAuth configuration.

### 2. Implement Spotify Provider

- Set up the Spotify provider in NextAuth configuration.
- Define required scopes for playlist management and playback.
- Handle the OAuth callback to receive access and refresh tokens.
  **Validation:**
- Click the Spotify login button and confirm redirection to Spotify's OAuth consent screen.
- After authorizing, confirm redirection back to the app and that a session cookie is set.

### 3. JWT Session Handling

- Configure NextAuth to use JWT sessions.
- Implement custom `jwt()` and `session()` callbacks to store and expose access/refresh tokens in the session object.
  **Validation:**
- Inspect the session using `useSession` or `/api/auth/session` and confirm it contains a valid Spotify access token and refresh token.
- Log out and log in again; the session should update accordingly.

### 4. Refactor Routing: Move Playlist Page

- Move the current playlist/search/add page from `/` to a new dynamic route: `/[username]/playlist`.
- Refactor logic and UI to work under the new route.
- Update all internal links and navigation to use the new dynamic route.
  **Validation:**
- After login, confirm redirection to `/[username]/playlist` (e.g., `/alice/playlist`).
- Playlist/search/add UI appears at this route, not at `/`.
- Navigating directly to `/[username]/playlist` works for authenticated users.

### 5. Create Landing Page at Root

- Implement a new landing page at `/` (`pages/index.tsx` or `app/page.tsx`).
- Add a login button and a brief app description.
- Use NextAuth's `useSession` to check authentication and redirect authenticated users to their `/[username]/playlist` page.
  **Validation:**
- Visit `/` as a logged-out user: see a landing page with login button and app description.
- Visit `/` as a logged-in user: redirected to `/[username]/playlist`.

### 6. Login/Logout Flow

- Add login and logout UI components/buttons to the frontend (e.g., in the header or admin page).
- Use NextAuth client methods (`signIn`, `signOut`, `useSession`) to manage authentication state in the app.
  **Validation:**
- Click login on the landing page and complete the Spotify OAuth flow; after login, land on your playlist page.
- Click logout; return to the landing page and session data is cleared.

### 7. Secure the Admin Page

- Protect `/[username]/admin` route by requiring authentication.
- Redirect unauthenticated users to the login page or show an appropriate message.
- Ensure the admin page only loads for authenticated users with a valid session.
  **Validation:**
- Access `/[username]/admin` as a logged-out user: redirected to login or see unauthorized message.
- Log in and access your own `/[username]/admin`: see the admin interface.
- Try to access another user's `/[otheruser]/admin`: denied access or redirected.

### 8. Access Token Availability

- Ensure the Spotify access token is available in the session object for authenticated API requests and playback.
- Update any server-side or client-side code that previously relied on in-memory tokens to use the session token instead.
  **Validation:**
- Use the session object to confirm the Spotify access token is present.
- Make an authenticated API call using the token from the session.
- Confirm token refresh works if the token expires.

### 9. Environment Variables

- Add Spotify client credentials and NextAuth secret to the environment configuration.
- Document required environment variables in the project README or `.env.example`.
  **Validation:**
- Remove or misconfigure a required environment variable and restart the app; the app should fail gracefully and provide a clear error message.

### 10. Update Navigation and Redirects

- Ensure that after login, users are redirected to their personalized playlist page.
- Update any deep links or bookmarks to use the new route structure.
  **Validation:**
- After login, confirm redirection to `/[username]/playlist`.
- All links to the playlist page use the new dynamic route.
- Bookmarks and direct navigation to `/[username]/playlist` work.

### 11. Testing

- Test the login flow from the landing page.
- Test that `/[username]/playlist` is only accessible after login and shows the correct playlist.
- Test that unauthenticated users see only the landing page.
- Test that `/[username]/admin` is protected and only accessible by the correct user.
  **Validation:**
- Automated: Write integration tests for login, logout, protected routes, and redirects using Cypress or Playwright. Write unit tests for session handling and token management.
- Manual: Go through each user flow as described above. Test with multiple Spotify accounts to ensure user isolation.

---

## Legacy Code Cleanup & Investigation

After implementing Step 1, review and remove or refactor obsolete code and patterns:

### 1. Legacy Authentication & Token Handling

- **Remove:**
  - Custom/in-memory Spotify OAuth flows (manual `/authorize` and `/token` calls)
  - Local storage/session storage of tokens
  - Custom hooks or context for managing user authentication state
  - Old login/logout UI and handlers not using NextAuth
  - Any hardcoded or fake user/session logic

### 2. Session/Token Contexts or Providers

- **Remove:**
  - Custom React Contexts, Providers, or hooks for user session/token data
  - Manual token injection in API calls (if now handled by NextAuth)

### 3. Root Page Logic

- **Refactor:**
  - Move all playlist/search/add logic from the root page to `/[username]/playlist`
  - Remove playlist-related state, hooks, or UI from the root page

### 4. API Route Security

- **Refactor:**
  - Update API routes to use session/token from NextAuth
  - Remove custom token validation or session checks

### 5. Environment Variables

- **Remove:**
  - Obsolete environment variables related to custom auth flows

### 6. Testing & Mocks

- **Update/Remove:**
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

- User can log in via Spotify.
- Admin page is accessible only when logged in.
- Access token is available in `session.token`.
- Playlist page is available at `/[username]/playlist` and only accessible after login.
- Root page (`/`) is a landing page with authentication.
