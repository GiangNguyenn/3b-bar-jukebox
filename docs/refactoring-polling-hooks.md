# Refactoring Polling Hooks to Prevent Rate-Limiting

## 1. Problem Summary

The current implementation of the `useNowPlayingTrack` and `useGetPlaylist` hooks utilizes aggressive, hardcoded polling intervals to fetch data from the Spotify API.

- **`useNowPlayingTrack`**: Polls every 10 seconds.
- **`useGetPlaylist`**: Polls every 60 seconds.

This frequent, non-configurable polling is causing the application to hit API rate limits, leading to service disruptions and a poor user experience. The issue is exacerbated because these hooks are used on publicly accessible pages, meaning that every user visiting the page initiates their own polling cycle.

## 2. Proposed Solution

To address this, we will make the polling intervals configurable and set more conservative default values. This will be achieved by introducing a `refetchInterval` prop to both the `useNowPlayingTrack` and `useGetPlaylist` hooks.

### New Prop: `refetchInterval`

- **Type**: `number | null`
- **Description**: The interval in milliseconds at which to refetch data. If set to `null`, polling will be disabled.

### New Default Values

- **`useNowPlayingTrack`**: The default `refetchInterval` will be changed from `10000` (10 seconds) to `30000` (30 seconds).
  - **Justification**: The currently playing track does not need to be updated in real-time. A 30-second interval is sufficient to keep the UI reasonably up-to-date without overwhelming the API.
- **`useGetPlaylist`**: The default `refetchInterval` will be changed from `60000` (1 minute) to `180000` (3 minutes).
  - **Justification**: Playlists, especially for a jukebox, do not change frequently enough to warrant a 1-minute refresh. A 3-minute interval provides a good balance between data freshness and API conservation.

## 3. Implementation Steps

### File: `hooks/useNowPlayingTrack.tsx`

1.  **Update `UseNowPlayingTrackProps` Interface:**

    - Add a `refetchInterval` prop of type `number | null`.

    ```typescript
    interface UseNowPlayingTrackProps {
      token?: string | null
      enabled?: boolean
      refetchInterval?: number | null
    }
    ```

2.  **Update Hook Signature:**

    - Destructure `refetchInterval` from the props, setting a new default of `30000`.

    ```typescript
    export function useNowPlayingTrack({
      token,
      enabled = true,
      refetchInterval = 30000
    }: UseNowPlayingTrackProps = {}) {
      // ...
    }
    ```

3.  **Modify `useEffect` for Polling:**

    - Use the `refetchInterval` prop to set the interval.
    - Ensure that polling is only set up if `refetchInterval` is a positive number.

    ```typescript
    useEffect(() => {
      // ... (clear interval logic)

      if (!enabled) {
        // ...
        return
      }

      void fetchCurrentlyPlaying()

      if (refetchInterval && refetchInterval > 0) {
        intervalRef.current = setInterval(() => {
          void fetchCurrentlyPlaying()
        }, refetchInterval)
      }

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
      }
    }, [token, enabled, refetchInterval])
    ```

### File: `hooks/useGetPlaylist.tsx`

1.  **Update `UseGetPlaylistProps` Interface:**

    - Add a `refetchInterval` prop of type `number | null`.

    ```typescript
    interface UseGetPlaylistProps {
      playlistId: string | null
      token?: string | null
      enabled?: boolean
      refetchInterval?: number | null
    }
    ```

2.  **Update Hook Signature:**

    - Destructure `refetchInterval` from the props, setting a new default of `180000`.

    ```typescript
    export function useGetPlaylist({
      playlistId,
      token,
      enabled = true,
      refetchInterval = 180000
    }: UseGetPlaylistProps) {
      // ...
    }
    ```

3.  **Modify `useEffect` for Polling:**

    - Use the `refetchInterval` prop to set the interval.
    - Ensure that polling is only set up if `refetchInterval` is a positive number.

    ```typescript
    useEffect(() => {
      if (!enabled) {
        return
      }

      void fetchPlaylist()

      if (refetchInterval && refetchInterval > 0) {
        intervalRef.current = setInterval(() => {
          void fetchPlaylist(true, true)
        }, refetchInterval)
      }

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
      }
    }, [enabled, fetchPlaylist, refetchInterval])
    ```

## 4. Usage Update (Optional)

### File: `app/[username]/playlist/page.tsx`

The `PlaylistPage` component currently calls `useNowPlayingTrack` and `useGetPlaylist` without any props, relying on the defaults.

```typescript
// Current implementation
const { data: currentlyPlaying } = useNowPlayingTrack({
  token,
  enabled: !isTokenLoading && !!token
})

const {
  data: playlist
  // ...
} = useGetPlaylist({
  playlistId: fixedPlaylistId,
  token,
  enabled: shouldEnablePlaylist
})
```

**Recommendation:** No immediate changes are required in this file. The new, more conservative default refetch intervals will automatically apply once the hooks are updated. This will immediately alleviate the API rate-limiting issues.

If, in the future, a specific page requires more frequent updates, the `refetchInterval` prop can be passed explicitly:

```typescript
// Example of overriding the default
const { data: currentlyPlaying } = useNowPlayingTrack({
  token,
  enabled: !isTokenLoading && !!token,
  refetchInterval: 15000 // Fetch every 15 seconds
})
```

This approach provides the flexibility needed for different use cases while ensuring the default behavior is safe and efficient.
