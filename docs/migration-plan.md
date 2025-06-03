# Migration Plan

## Step 1: Add NextAuth.js with Spotify Provider
✅ **Goal:** Add proper Spotify OAuth login (replacing in-memory token handling)
- Install & configure next-auth
- Store access/refresh tokens via JWT
- Enable login/logout flow
- Secure the admin page behind a session

**Validation:**
- ✅ You can log in via Spotify
- ✅ Admin page is accessible only when logged in
- ✅ Access token available in session.token

---

## Step 2: Store Playlist ID in Session or Token
✅ **Goal:** Maintain per-user playlist in memory (session only)
- After login, check if a playlist exists (use Spotify API)
- If not, create it
- Store the playlist ID in the token via jwt() and session() callbacks

**Validation:**
- ✅ Admin and public pages use the logged-in user's playlist
- ✅ You can log in with a second Spotify account and see a different playlist

---

## Step 3: Add Supabase and Create users Table
✅ **Goal:** Introduce persistent user data layer
- Create Supabase project
- Create users table with spotify_id, username, playlist_id
- On login, upsert user data into Supabase
- Fetch from Supabase to get the correct playlist

**Validation:**
- ✅ User data persists between sessions
- ✅ Playlist ID is stored in the database
- ✅ No longer relying only on session memory

---

## Step 4: Update Routing to Use /[username]/playlist
✅ **Goal:** Dynamic public pages based on user
- Add dynamic route file: pages/[username]/playlist.tsx
- Fetch correct user's playlist from Supabase by username
- Modify links/UI to use usernames

**Validation:**
- ✅ /alice/playlist and /bob/playlist show different playlists
- ✅ Still works if user is logged out

---

## Step 5: Move Track Addition to Server-side API Route
✅ **Goal:** Secure add-track logic & prevent abuse
- Create /api/add-track API route
- Validate track URI + target playlist via DB
- Use server-side token (from DB) to add the track

**Validation:**
- ✅ Track adding works from public page
- ✅ No Spotify token in client
- ✅ User-specific playlist enforced

---

## Step 6: Enable Admin Page at /[username]/admin
✅ **Goal:** Dynamic, user-specific private admin interface
- Create pages/[username]/admin.tsx
- Require session and match session.username === router.query.username
- Load Spotify Web Playback SDK
- Play that user's playlist

**Validation:**
- ✅ /alice/admin only accessible by Alice
- ✅ Playback works for logged-in owner

---

## Step 7: Enable Row-Level Security in Supabase
✅ **Goal:** Restrict access to only authorized rows
- Enable RLS on users and playlists tables
- Use request.jwt.claims.spotify_id in Supabase policies
- Supply Supabase JWT via server API routes

**Validation:**
- ✅ Only the owner can update their playlist
- ✅ Public read access behaves safely

---

## Step 8: (Optional) Add Playlist Tracking or Queueing
✅ **Goal:** Extend functionality for voting, tracking usage
- Create playlist_tracks table
- Store metadata (IP, timestamp) of added tracks
- Display recently added tracks

**Validation:**
- ✅ Track log updates in real-time
- ✅ You can build leaderboard, moderation, etc.

---

### 🔄 Bonus: Realtime Support
Once core functionality is solid, you can enable Supabase Realtime to update playlists live when others add songs. 