# Track Suggestions Product Requirements Document

## 1. Overview

The Spotify Suggestion Engine enables users to discover tracks by searching Spotify's catalog via the Search API, with the ability to filter and refine the results based on metadata and audio attributes. Since the official Spotify Recommendations API is deprecated, this tool offers a customizable music discovery experience by combining query-level search parameters with client-side filtering.

## 2. Goals

- Let users input flexible search queries across tracks, artists, and albums
- Allow user-defined filters on search results, including:
  - Genre (indirect)
  - Release date
  - Popularity
  - Explicit content
  - Track duration
  - Mood/energy (via optional audio features)
- Simulate a personalized recommendation flow using deterministic rules

## 3. Non-Goals

- No machine learning-based personalization
- No server-side user history or behavioral learning
- No full playlist curation or social sharing features (MVP scope)

## 4. Target Users

- Music fans looking for fine-grained control over discovery
- Users disillusioned by opaque Spotify algorithms

## 5. Features

### 5.1. Search Input (Pre-filtering)

Users will define an initial search query using:

- Text query (e.g., "lofi sunset" or "summer vibes")
- Entity types (select one or multiple):
  - track
  - artist
  - album
- Advanced query operators (composed by the interface):
  - year:[start-end]
  - genre:"genre name" (artist-only)
  - tag:new
  - artist:"Artist Name" or album:"Album Name"

Example UI fields:

- Keyword input
- Year range selector
- Genre dropdown (for artist search)
- Checkbox for "New Releases Only"

### 5.2. Post-search Filters (Client-side)

After the initial search, results can be narrowed using:

| Filter         | UI Control                   | Notes                          |
| -------------- | ---------------------------- | ------------------------------ |
| Popularity     | Slider or range (0–100)      | Based on Spotify's score       |
| Release Date   | Year range filter            | Pulled from album.release_date |
| Explicit       | Toggle (Include/Exclude)     | From explicit field            |
| Track Length   | Duration slider (min-max)    | Convert from duration_ms       |
| Markets        | Optional region selector     | Use available_markets          |
| Audio Features | Optional advanced filter tab | See below                      |

### 5.3. Optional Audio Features (Advanced Mode)

For more granular control, users can opt-in to a second pass of filtering using the audio-features endpoint:

- Danceability
- Energy
- Valence (mood)
- Tempo
- Acousticness
- Instrumentalness

> These require additional API calls per track or batch.

### 5.4. Results Display

Display includes:

- Track name
- Artist
- Album artwork
- Popularity score
- Preview link (if available)
- URI or link to open in Spotify

## 6. API Usage

### Primary API

```
GET https://api.spotify.com/v1/search
```

Params: q, type, limit, offset

### Optional APIs

```
GET /v1/audio-features
```

For post-filtering by musical attributes

## 7. UI/UX Requirements

- Tab on the Admin page for the suggestions engine parameters
- Filter panel (sliders, toggles, dropdowns)
- Tabs or toggle between simple and advanced mode
- Result list with hover previews, save buttons

## 8. Technical Requirements

- Frontend: React (Next.js), Tailwind CSS for layout
- Rate Limiting: Handle 429 errors gracefully, with retry strategy
- Track batching: For audio feature enrichment, batch requests efficiently (limit = 100)

## 9. Future Enhancements

- Enable user login and playlist saving
- "Surprise Me" button for random query generation
- Prebuilt filter templates (e.g., "Chill Vibes", "Upbeat Running Tracks")

