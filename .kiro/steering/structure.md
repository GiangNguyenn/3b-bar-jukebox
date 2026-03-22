---
inclusion: always
---

# Project Structure

```
app/                          # Next.js App Router
  [username]/                 # Dynamic route per venue owner
    admin/components/         # Admin UI organized by tab (analytics, branding, dashboard, playlist, subscription, track-suggestions)
    display/                  # Public now-playing display
    game/                     # Music trivia game
    playlist/                 # Public queue view
  api/                        # API routes — one folder per endpoint, each with route.ts
    auth/, playback/, queue/, search/, dj-script/, dj-tts/, branding/, subscriptions/, game/, ...
  auth/                       # Auth pages (signin, error)
  components/                 # App-level shared components (SEO, structured data)

components/                   # Top-level shared components
  Display/                    # Display page components
  Playlist/                   # Playlist components
  ui/                         # Generic UI primitives

services/                     # Business logic (singleton pattern via getInstance())
  player/                     # Spotify player, recovery, playback
  playerLifecycle/            # Player events, queue sync
  deviceManagement/           # Device API, transfer, validation
  game/                       # Game engine, scoring, genre similarity, caching
  spotify/                    # Spotify auth utilities
  __tests__/                  # Service-level tests

hooks/                        # React hooks
  spotifyPlayerStore.ts       # Zustand store for player state
  game/                       # Game-specific hooks

stores/                       # Zustand stores (playlistStore, brandingStore)
contexts/                     # React contexts (Toast)
lib/                          # Utility libraries (Supabase clients, toast, utils)
shared/                       # Shared client/server code
  constants/, types/, utils/, validations/
types/                        # Global type declarations (Supabase DB types, SDK types)
utils/                        # Supabase client helpers, subscription queries
middleware/                   # Custom middleware utilities
supabase/                     # Supabase project config and migrations
recovery/                     # Playback recovery utilities
```

## Key Conventions

- API routes: `app/api/{feature}/route.ts` exporting HTTP method handlers
- Services use singleton pattern: `ServiceName.getInstance()`
- Admin components organized by dashboard tab under `app/[username]/admin/components/`
- Zustand stores named `*Store.ts`; React hooks named `use*.ts`
- Shared Spotify types in `shared/types/`; Supabase DB types in `types/supabase.ts`
- Logging via `createModuleLogger` from `@/shared/utils/logger` — never raw `console.log`
