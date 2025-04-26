# Playlist Refresh Service Restructuring Plan

## Objective

Restructure the playlist refresh service to only trigger during natural pauses in playback (e.g., near the end of a track) to provide a smoother user experience while leveraging existing monitoring systems. This implementation will work for both the admin page and regular playlist view.

## Current Implementation Analysis

The current system has several components for track progress monitoring:

1. **SpotifyPlayer Component**

   - Implements dynamic polling intervals based on playback state
   - Uses custom events for state updates
   - Dispatches `playbackUpdate` events with track progress
   - Used by both admin page and regular playlist view

2. **Admin Page Implementation**

   - Listens to `playbackUpdate` events
   - Manages refresh timing and state
   - Handles health monitoring and recovery

3. **useSpotifyPlayerState Hook**
   - Manages player state and device status
   - Handles playback state changes
   - Implements playlist state refresh logic

## Proposed Changes

### 1. Enhance SpotifyPlayer Component

Add track progress monitoring to the existing component:

```typescript
interface EnhancedPlaybackUpdate {
  isPlaying: boolean
  currentTrack: string
  progress: number
  duration_ms?: number
  timeUntilEnd?: number
}

// In SpotifyPlayer.tsx
const updatePlaybackState = async (): Promise<void> => {
  try {
    const state = await sendApiRequest<SpotifyPlaybackState>({
      path: 'me/player',
      method: 'GET'
    })

    if (state?.item) {
      const timeUntilEnd = state.item.duration_ms - (state.progress_ms ?? 0)
      window.dispatchEvent(
        new CustomEvent('playbackUpdate', {
          detail: {
            isPlaying: state.is_playing,
            currentTrack: state.item.name,
            progress: state.progress_ms ?? 0,
            duration_ms: state.item.duration_ms,
            timeUntilEnd
          }
        })
      )
    }
  } catch (error) {
    console.error('[SpotifyPlayer] Error updating playback state:', error)
  }
}
```

### 2. Update Admin Page Refresh Logic

Enhance the admin page to use track progress for refresh timing:

```typescript
// In admin/page.tsx
const handlePlaybackUpdate = (event: CustomEvent<EnhancedPlaybackUpdate>) => {
  setPlaybackInfo(event.detail)

  // Check if we're near the end of the track
  const isNearEnd =
    event.detail.timeUntilEnd && event.detail.timeUntilEnd < 5000 // 5 seconds before end

  if (isNearEnd && !isRefreshing.current) {
    void handleRefresh()
  }
}
```

### 3. Optimize Refresh Timing

Add smart refresh timing to the existing refresh mechanism:

```typescript
interface RefreshTimingConfig {
  // Time before track end to consider for refresh
  refreshThreshold: number // e.g., 5000ms
  // Minimum time between refresh attempts
  cooldownPeriod: number // e.g., 30000ms
  // Maximum time to wait for natural pause
  maxWaitTime: number // e.g., 180000ms
}

const REFRESH_CONFIG: RefreshTimingConfig = {
  refreshThreshold: 5000,
  cooldownPeriod: 30000,
  maxWaitTime: 180000
}
```

## Implementation Steps

1. **Enhance SpotifyPlayer Component**

   - Add track duration and progress tracking
   - Update event payload with timing information
   - Optimize polling intervals

2. **Update Admin Page**

   - Add refresh timing logic
   - Implement cooldown mechanism
   - Add progress-based refresh triggers
   - Enhance error handling

3. **Optimize State Management**

   - Use existing event system
   - Implement local progress tracking
   - Add state prediction
   - Optimize event handling

4. **Add Error Handling and Recovery**
   - Enhance existing error handling
   - Add fallback mechanisms
   - Improve logging
   - Add state recovery

## Technical Considerations

### Performance Optimizations

- **State Management**

  - Use existing event system
  - Implement local progress tracking
  - Add state prediction
  - Optimize event handling

- **Polling Strategy**
  - Use existing dynamic intervals
  - Add smart refresh timing
  - Implement progress prediction
  - Optimize API calls

### Reliability

- Enhance existing error handling
- Add circuit breaker for API calls
- Improve recovery mechanisms
- Add health checks

### User Experience

- Ensure smooth transitions
- Minimize visible updates
- Provide feedback
- Handle edge cases

## Migration Strategy

1. **Phase 1: Component Updates**

   - Update `SpotifyPlayer`
   - Add progress tracking
   - Implement smart timing
   - Add local prediction

2. **Phase 2: Admin Page Updates**

   - Enhance refresh logic
   - Add scheduling logic
   - Update error handling
   - Optimize state management

3. **Phase 3: Testing**

   - Validate existing tests
   - Add new test cases
   - Monitor performance
   - Gather feedback

4. **Phase 4: Production Rollout**
   - Gradual rollout
   - Monitor metrics
   - Adjust as needed
   - Optimize further

## Success Metrics

- Reduced API calls (target: 50% reduction)
- Improved response times
- Decreased error rates
- Better user experience
- Reduced server load

## Timeline

1. Component Updates: 1 week
2. Admin Page Updates: 1 week
3. Testing: 1 week
4. Production Rollout: 1 week

Total estimated time: 4 weeks

## Monitoring and Analytics

- Track API call frequency
- Monitor cache hit rates
- Measure prediction accuracy
- Track user experience
- Monitor error rates
