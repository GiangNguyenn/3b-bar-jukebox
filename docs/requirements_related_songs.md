# Software Requirements Specification for Related Songs selection

## 1. Introduction

### 1.1 Purpose

The purpose of this module is to generate a list of 9 selectable songs for a player's turn in the music pathfinding game. The system must **build a candidate pool of at least 100 tracks**, calculate their strategic value relative to the player's Target Artist, and return a balanced set of options (Good/Neutral/Bad) while aggressively minimizing external Spotify API calls.

**Primary Objective:** The candidate pool must contain at least 100 tracks to ensure sufficient diversity for the 3-3-3 selection process.

### 1.2 Scope

- Retrieving song/artist metadata from a tiered data architecture (Cache -> DB -> External API).
- Generating a candidate pool based on Current Song's Artist and Current Player's Target Artist.
- Filtering and selecting the final 9 options based on the "3-3-3" variance model.

## 2. Data Strategy & Architecture

**Objective:** Minimize external API usage to prevent rate limiting.

### 2.1 Staged Execution Architecture

To respect the 10-second serverless timeout, the generation process must be split into distinct API Stages:

1.  **Stage 1 (Artists):** Build list of 100 unique artists from multiple sources (related to current, related to target, random).
2.  **Stage 2 (Score Artists):** Score all 100 artists using artist-to-artist similarity, apply filtering rules, and select 9 artists (3-3-3 distribution).
3.  **Stage 3 (Fetch Tracks):** Fetch top tracks for the 9 selected artists and randomly select 1 track per artist.

### 2.2 Tiered Data Retrieval

The system must retrieve song/artist data using the following priority order (Waterfall logic):

1.  **Tier 1 (Hot Cache):** Check in-memory cache for existing metadata or relation graphs.
2.  **Tier 2 (Persistent DB):** If not in cache, query the internal database.
3.  **Tier 3 (External API):** If not in DB, call the Spotify API.

### 2.3 Lazy Write-Back

- **REQ-DAT-01:** If data is retrieved via Tier 3 (External API), the system must asynchronously write this data to Tier 2 (Database) and Tier 1 (Cache) for future use.
- **REQ-DAT-02:** Use a "Read-Through" strategy; the user should not wait for the write-back to complete before receiving the game response.
- **REQ-DAT-03:** The system must maintain a 'Self-Healing Queue'. Metadata gaps identified during live gameplay (e.g., missing genres, incomplete profiles) must be queued for asynchronous resolution to improve data quality for subsequent turns.

## 3. Functional Requirements

### 3.1 Input Parameters

The system accepts the following inputs from the Game State Manager:

- The Spotify ID of the song currently playing artist.
- The Spotify ID of the active player's target artist.
- **Play history:** A list of IDs previously played in this round (to prevent duplicates).

### 3.2 Candidate Pool Generation

**Objective:** Build a candidate pool of **at least 100 artists** to ensure sufficient diversity for the 3-3-3 selection process.

**Process Overview:**

1. **Stage 1:** Select exactly 100 unique artists from various sources (related to current, related to target, random)
2. **Stage 2:** Score all 100 artists using artist-to-artist similarity, apply filtering, and select 9 artists (3-3-3 distribution)
3. **Stage 3:** For each of the 9 selected artists, fetch their top 10 tracks and randomly select 1 track (excluding currently playing track and played tracks)
4. This yields exactly 9 tracks in the final candidate pool (one per selected artist)

The candidate pool is populated from four primary sources, prioritized as follows:

#### 3.2.1 Primary Source: Currently Playing Artist Related Artists

- **Always included** - This should be the majority of the artist pool
- Fetch related artists from the currently playing song's artist
- Uses pre-computed artist relationship graph (database) with genre similarity fallback
- Returns up to 50 related unique artists
- Part of Stage 1 sub-call 1.1 (executed in parallel with target-related artists)

#### 3.2.2 Conditional Source: Current Player's Target Artist Related Artists

- **Included when:**
  - Player's influence < 20% (Desperation Mode), OR
  - Player's influence > 50% (Good Influence)
- **NOT included** in Dead Zone (20-39% influence)
- Populates the pool with artists related to the current player's target artist
- Part of Stage 1 sub-call 1.2 (executed in parallel with current-related artists)
- Helps guide players toward their target when they're struggling or doing well

#### 3.2.3 Conditional Source: Target Artist Direct Injection

- **Injected when:**
  - Round >= 10, OR
  - Player's influence > 80% (gravity > 0.59)
- Explicitly adds the target artist itself to the artist pool
- Part of Stage 1 sub-call 1.2 (included in relatedToTarget array)
- Ensures target artist is available for selection when player is close to winning or game is in late rounds

#### 3.2.4 Always Included: Random Database Artists

- **Fills remaining slots to reach 100 total artists** from the artists table
- **Critical Requirement:** Only include artists where **all columns are populated** to avoid additional API calls for missing metadata
- Part of Stage 1 sub-call 1.3 (executed sequentially after 1.1 and 1.2 complete)
- Serves dual purpose:
  1. **Size guarantee:** Ensures we have exactly 100 artists in the candidate pool
  2. **Quality diversity:** Provides bad and neutral artists for the 3-3-3 distribution
- Database-only (no API calls) - uses `fetchRandomArtistsFromDb`

#### 3.2.5 Three-Stage Pipeline Execution

The system generates the candidate pool through a three-stage pipeline:

#### Stage 1: Artist Selection (Artists)

**Purpose:** Build a list of exactly 100 unique artists from multiple sources.

**Process:**

1. **Execute Sub-calls 1.1 and 1.2 in Parallel:**
   - **Sub-call 1.1:** Get artists related to currently playing artist
     - Uses `getSeedRelatedArtists` (checks pre-computed graph → genre similarity → Spotify API)
     - Returns up to 50 related artists
   - **Sub-call 1.2:** Get artists related to target artist + target itself (conditional)
     - Based on player influence:
       - **< 20%:** Desperation Mode - fetch target-related artists
       - **20-39%:** Dead Zone - SKIP target-related artists
       - **> 50%:** Good Influence - fetch target-related artists
     - Adds target artist itself if: Round >= 10 OR Player's influence > 80% (gravity > 0.59)
     - Returns up to 20 related artists
2. **After 1.1 and 1.2 Complete, Execute Sub-call 1.3 Sequentially:**
   - **Sub-call 1.3:** Random artists to reach 100 total
     - Calculates: `needed = 100 - (relatedToCurrent.length + relatedToTarget.length)`
     - Uses `fetchRandomArtistsFromDb` with exclusion set
     - Only includes fully-populated artists (all columns present) to avoid API calls
     - Database-only (no API calls for random artists)
3. **Output:** Exactly 100 unique artist IDs grouped by source (relatedToCurrent, relatedToTarget, randomArtists)

#### Stage 2: Artist Scoring & Selection (Score Artists)

**Purpose:** Score all 100 artists and select 9 artists using 3-3-3 distribution.

**Process:**

1. **Fetch Artist Profiles:**
   - Batch fetch `ArtistProfile` for all 100 artist IDs
   - Uses tiered caching: Memory → Database → Spotify API
   - Queues missing profiles for self-healing (REQ-DAT-03)
2. **Score Artists:**
   - For each artist, calculate attraction score (artist-to-artist similarity to target)
   - Uses `computeAttraction` function
   - Calculate baseline: current song's artist to target artist
   - Calculate delta: candidate attraction - baseline
3. **Apply Filtering Rules:**
   - Exclude current artist
   - Apply REQ-FUN-07 (target artist filtering based on round/influence)
4. **Apply 3-3-3 Distribution:**
   - Categorize artists: CLOSER (delta > tolerance), NEUTRAL (|delta| <= tolerance), FURTHER (delta < -tolerance)
   - Select 3 from each category using `applyDiversityConstraints`
5. **Output:** Exactly 9 selected artists with categories, attraction scores, and deltas

#### Stage 3: Track Fetching (Fetch Tracks)

**Purpose:** Fetch tracks only for the 9 selected artists.

**Process:**

1. **For each of 9 selected artists:**
   - Fetch top 10 tracks using `fetchTopTracksForArtists`
   - Uses tiered caching: Memory → Database → Spotify API
   - Filters out: currently playing track, played tracks
   - Randomly selects 1 track from valid tracks
   - Queues artists with 0 valid tracks for self-healing (REQ-DAT-03)
2. **Build Final Options:**
   - Maps to `DgsOptionTrack` format
   - Includes all scoring metadata from Stage 2
   - Preserves source information for debug panel
3. **Output:** Exactly 9 tracks (one per selected artist)

#### Minimum Pool Requirements

- **REQ-FUN-01:** The system must ensure the candidate pool contains at least 100 artists before scoring and selection.
- **REQ-FUN-01a:** Random database artists must be included as part of initial pool building (Stage 1), not as a fallback.
- **REQ-FUN-01b:** Only fully-populated artists (all columns present) should be included from random database selection to avoid additional API calls.
- **Architecture Benefits:**
  - Stage 1 ensures exactly 100 artists (or as close as possible)
  - Stage 2 scores artists (lightweight) before fetching tracks (heavy)
  - Stage 3 only fetches tracks for 9 artists (90 tracks total) instead of 1000+ tracks
  - Eliminates need for complex replacement logic
  - Architecture matches scoring logic (artist-based, not track-based)

### 3.3 Scoring & Sorting

- **REQ-FUN-02:** The system must iterate through the CandidatePool and assign an **Attraction Score** to every song.
- **Attraction Definition:** Attraction is calculated as the **artist-to-artist similarity** between the candidate track's artist and the active player's target artist. This uses only artist-level attributes (genres, relationships, artist popularity, followers) and ignores track-level metadata (track popularity, release date).
- **Reference:** See `docs/requirements_scoring_logic.md` Section 2.2 for the complete Artist Attraction formula and component weights.
- **Key Principle:** A target artist's own tracks will always have an attraction of 1.0 (perfect match) because the artist is being compared to themselves.

### 3.4 The "3-3-3" Selection Logic

The system must select exactly 9 unique songs from the sorted CandidatePool. This selection is governed by a dynamic set of rules influenced by the player's current game state.

#### 3.4.1 Distribution Goal (The 3-3-3 Variance)

The system aims to return:

- **Group A (Good/Steer):** 3 High-value songs (candidate artist is closer to target artist than current song's artist).
- **Group B (Neutral):** 3 Mid-value songs (candidate artist is approximately the same distance from target as current song's artist).
- **Group C (Bad/Adversarial):** 3 Low-value songs (candidate artist is farther from target artist than current song's artist).

**Categorization Logic:** Songs are categorized based on the **difference in artist attraction** between the candidate and the currently playing song. This is purely an artist-to-artist comparison and does not consider track-level attributes.

#### 3.4.2 Player Influence Mechanics

**Note:** "Influence" refers to the user-facing percentage (0-100%) displayed in the UI. Internally, the system uses "gravity" values (0.15-0.7). The conversion formula is: `influence% = ((gravity - 0.15) / (0.7 - 0.15)) * 100`. For example, 80% influence = gravity value of 0.59.

Player Influence determines how the candidate pool is populated with target-related content:

- **Low Influence (< 20%):** **"Desperation Mode"** is active. Target-related artist tracks are included in the candidate pool to assist struggling players.
- **Mid Influence (20% - 39%):** **"The Dead Zone."** Target-related artist tracks are **NOT** included in the candidate pool. They will only appear if:
  1.  They appear naturally as a related artist to the currently playing song (luck).
  2.  The diversity fallback triggers because insufficient "Good" candidates were found.
- **Good Influence (> 50%):** **"Threshold Met."** Target-related artist tracks are included in the candidate pool, guaranteeing their availability as selectable options.
- **High Influence (> 80%):** **"Threshold Met."** Target Artist tracks themselves are forcibly injected into the candidate pool, guaranteeing their availability as a selectable option.

#### 3.4.3 Round Influence (Convergence)

The game round overrides standard scoring logic to force game conclusion:

- **Rounds 1-9:** Standard scoring applies.
- **Round 10+:** **"Hard Convergence"** is active. The system bypasses all similarity filters (REQ-FUN-07) for Target Artists, ensuring they are always selectable regardless of their calculated mathematical distance from the current track. Target Artist tracks are also injected into the candidate pool at this point (if not already injected due to high influence).

#### 3.4.4 Fallback Priority

If the candidate pool cannot satisfy the 3-3-3 distribution (e.g., not enough "Bad" songs found):

1.  **Percentile Expansion:** The system expands the definition of "Good/Bad" to include a wider range of attraction scores.
2.  **Category Filling:** The system fills empty slots starting with the most under-represented category to ensure 9 selectable options are always returned.

### 3.5 Filtering

- **REQ-FUN-04:** The result set must exclude the currently playing song.
- **REQ-FUN-05:** The result set must exclude any song previously played since the last player score. This list only resets when a player successfully scores (reaches their Target Artist).
- **REQ-FUN-06:** The result set must not contain duplicate artist entries.
- **REQ-FUN-07:** Target Artists must NOT appear in the candidate list during early gameplay levels (Rounds 1-9) unless their similarity score > 0.4. From Round 10 onwards OR when player's influence > 80%, the system enters 'Hard Convergence' and Target Artists are allowed regardless of similarity.

## 5. Non-Functional Requirements

### 5.1 Performance

- We are hosted on Vercel using a hobby plan. No serverless function can take more than 10 seconds.
