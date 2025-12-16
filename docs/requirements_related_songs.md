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

1.  **Stage 1 (Init):** Context resolution & Seed ID determination.
2.  **Stage 2 (Fetch):** Bulk retrieval of candidate metadata.
3.  **Stage 3 (Score & Select):** Diversity injection, heavy scoring, and final selection.

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

**Objective:** Build a candidate pool of **at least 100 tracks** to ensure sufficient diversity for the 3-3-3 selection process.

**Process Overview:**
1. Select a minimum of 100 artists from various sources (as described below)
2. For each artist, fetch their top 10 tracks
3. From each artist's top 10 tracks, randomly select 1 track (excluding currently playing track and played tracks)
4. This yields a minimum of 100 tracks in the candidate pool

The candidate pool is populated from four primary sources, prioritized as follows:

#### 3.2.1 Primary Source: Currently Playing Artist Related Songs

- **Always included** - This should be the majority of the candidate pool
- Fetch related artists from the currently playing song's artist
- Uses pre-computed artist relationship graph (database) with genre similarity fallback
- Returns up to 50 related artists per seed
- Fetches top tracks from each related artist

#### 3.2.2 Conditional Source: Current Player's Target Artist Related Songs

- **Included when:**
  - Player's influence < 20% (Desperation Mode), OR
  - Player's influence > 50% (Good Influence)
- **NOT included** in Dead Zone (20-39% influence)
- Populates the pool with songs related to the current player's target artist
- Helps guide players toward their target when they're struggling or doing well

#### 3.2.3 Conditional Source: Target Artist Direct Injection

- **Injected when:**
  - Round >= 10, OR
  - Player's influence > 80% (gravity > 0.59)
- Explicitly adds the target artist itself to the pool
- Ensures target artist tracks are available for selection when player is close to winning or game is in late rounds

#### 3.2.4 Always Included: Random Database Artists

- **Minimum of 100 random artists** from the artists table
- **Critical Requirement:** Only include artists where **all columns are populated** to avoid additional API calls for missing metadata
- Serves dual purpose:
  1. **Size guarantee:** Ensures we have enough artists to reach minimum 100 tracks in candidate pool
  2. **Quality diversity:** Provides bad and neutral tracks for the 3-3-3 distribution
- Part of initial pool building, not just a fallback mechanism

#### 3.2.5 Three-Stage Pipeline Execution

The system generates the candidate pool through a three-stage pipeline:

#### Stage 1: Artist Seeding (Init)

**Purpose:** Identify which artists' tracks should be fetched based on the pool building rules above.

**Process:**

1. **Seed Artist Selection:** Uses the currently playing song's artist as the primary seed
2. **Related Artist Discovery:** Calls `getSeedRelatedArtists` which:
   - Checks pre-computed artist relationship graph (database)
   - Falls back to genre similarity queries if graph is empty
   - Returns up to 50 related artists per seed
3. **Target Artist Related Seeding (Conditional):** Based on player influence:
   - **< 20%:** Desperation Mode - fetch target-related artists
   - **20-39%:** Dead Zone - SKIP target-related artists
   - **> 50%:** Good Influence - fetch target-related artists
4. **Target Artist Direct Injection (Conditional):** Explicitly adds the target artist itself to the pool when:
   - Round >= 10, OR
   - Player's influence > 80% (gravity > 0.59)
5. **Random Artist Selection:** Identifies artists from fully-populated artists in database for random inclusion
6. **Output:** Combined list of unique artist IDs (deduplicated) representing all pool sources

#### Stage 2: Track Fetching (Candidates)

**Purpose:** Fetch actual tracks from all pool sources.

**Process:**

1. **Top Tracks Retrieval:** Calls `fetchTopTracksForArtists` for all seeded artist IDs
   - Fetches top 10 tracks per artist (database-first, Spotify API fallback)
   - Uses tiered caching: Memory → Database → Spotify API
2. **Artist Profile Enrichment:** Calls `enrichCandidatesWithArtistProfiles`
   - Fetches full artist metadata (genres, popularity, followers)
   - Required for attraction scoring in Stage 3
3. **Output:** Minimum 100 candidate tracks with enriched metadata (typically 100-500 tracks)

#### Stage 3: Scoring & Selection (Score)

**Purpose:** Score candidates and select final 9 options.

**Process:**

1. **Attraction Scoring:** Calculate artist-to-artist similarity for each candidate
2. **Diversity Constraints:** Apply 3-3-3 distribution (Good/Neutral/Bad)
3. **Final Selection:** Return exactly 9 tracks meeting all requirements

#### Minimum Pool Requirements

- **REQ-FUN-01:** The system must ensure the candidate pool contains at least 100 tracks before scoring and selection.
- **REQ-FUN-01a:** Random database artists must be included as part of initial pool building (Stage 2), not as a fallback.
- **REQ-FUN-01b:** Only fully-populated tracks (all columns present) should be included from random database selection to avoid additional API calls.
- **Fallback Strategy:** If Stage 2 yields insufficient candidates despite random track inclusion:
  - Stage 3 may trigger additional database fallback via `fetchRandomTracksFromDb`
  - Fetches additional tracks from profiled artists in database
  - Ensures minimum 9 unique artists for final selection

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
