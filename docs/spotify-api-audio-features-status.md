# Spotify Audio Features API Status

## Migration to Metadata-Based Similarity

**Status**: The DGS system has been migrated away from the audio-features endpoint (as of January 2025).

Due to potential API access restrictions and to improve reliability, the system now uses metadata-based similarity scoring instead of audio features. This approach uses data that is readily available from Spotify's track, artist, and album endpoints.

## Previous Implementation (Deprecated)

Previously, the DGS system relied on audio features for similarity scoring:

## API Endpoints Used

We're using the standard Spotify Web API v1 endpoints:

- `/v1/audio-features/{id}` - Single track audio features
- `/v1/audio-features?ids={ids}` - Multiple tracks audio features (batch)

These endpoints are correctly formatted according to Spotify's official documentation.

## Potential Issues

### 1. API Access Restrictions (November 2024)

Web research suggests that Spotify may have restricted third-party developer access to audio features endpoints in November 2024. This could result in:

- 403 Forbidden errors
- Reduced availability of audio features
- Access limited to certain application types or partners

### 2. Current Error Behavior

The application is experiencing failures when fetching audio features. The error shows:

```
Failed to fetch audio features for current track. Track ID: {trackId}.
This may indicate the track is unavailable or the Spotify API is having issues.
```

## Next Steps

1. **Verify API Status**: Check your Spotify Developer Dashboard to confirm:

   - Application status and permissions
   - Any API access restrictions or deprecation notices
   - Quota/rate limits

2. **Check Error Status Codes**: Review server logs to determine:

   - 401: Authentication/token issues
   - 403: Access forbidden/restricted
   - 404: Track not found or unavailable
   - 500: Server error

3. **Alternative Approaches** (if access is restricted):
   - Contact Spotify Developer Support for clarification
   - Consider using alternative similarity metrics (genre, artist relationships, etc.)
   - Implement fallback scoring mechanisms based on available data

## Code Locations

- Audio features fetching: `services/game/dgsEngine.ts`
  - `fetchAudioFeatures()` - Batch fetching
  - `fetchSingleAudioFeature()` - Single track fetching
- Similarity scoring: `services/game/dgsEngine.ts`
  - `computeSimilarity()` - Uses audio features for scoring

## Current Implementation

The DGS system now uses metadata-based similarity scoring implemented in:

- Similarity computation: `services/game/dgsEngine.ts`
  - `computeSimilarity()` - Uses metadata (genres, popularity, duration, artist relationships, release dates)
  - `extractTrackMetadata()` - Extracts metadata from track objects
  - `getPopularityBand()` - Categorizes tracks by popularity (replaces energy bands)

### Metadata Sources

- **Track metadata**: Popularity, duration, album release dates (from track objects)
- **Artist metadata**: Genres, IDs (from artist profiles)
- **Relationship data**: Artist connections via related artists API

### Benefits

- No dependency on audio-features endpoint
- More reliable (uses standard endpoints)
- Faster (fewer API calls needed)
- Similar functionality with metadata-based metrics

## Related Files

- DGS Engine: `services/game/dgsEngine.ts`
- Type definitions: `services/game/dgsTypes.ts`
- Documentation: `docs/gameplay.md`
