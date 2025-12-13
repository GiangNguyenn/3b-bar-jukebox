# Software Requirements Specification for Related Songs selection

## 1. Introduction

### 1.1 Purpose

The purpose of this module is to generate a list of 9 selectable songs for a player's turn in the music pathfinding game. The system must retrieve a candidate pool of approximately 100 songs, calculate their strategic value relative to the player's Target Artist, and return a balanced set of options (Good/Neutral/Bad) while aggressively minimizing external Spotify API calls.

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

### 2.2 Lazy Write-Back

- **REQ-DAT-01:** If data is retrieved via Tier 3 (External API), the system must asynchronously write this data to Tier 2 (Database) and Tier 1 (Cache) for future use.
- **REQ-DAT-02:** Use a "Read-Through" strategy; the user should not wait for the write-back to complete before receiving the game response.
- **REQ-DAT-03:** The system must maintain a 'Self-Healing Queue'. Metadata gaps identified during live gameplay (e.g., missing genres, incomplete profiles) must be queued for asynchronous resolution to improve data quality for subsequent turns.

## 3. Functional Requirements

### 3.1 Input Parameters

The system accepts the following inputs from the Game State Manager:

- The Spotify ID of the song currently playing artist.
- The Spotify ID of the active player's target artist.
- **Play history:** A list of IDs previously played in this round (to prevent duplicates).

### 3.2 Candidate Pool Generation (Three-Stage Process)

The system generates a candidate pool of approximately 100-200 tracks through a three-stage pipeline:

#### Stage 1: Artist Seeding (Init)

**Purpose:** Identify which artists' tracks should be fetched.

**Process:**

1. **Seed Artist Selection:** Uses the currently playing song's artist as the primary seed
2. **Related Artist Discovery:** Calls `getSeedRelatedArtists` which:
   - Checks pre-computed artist relationship graph (database)
   - Falls back to genre similarity queries if graph is empty
   - Returns up to 50 related artists per seed
3. **Target Artist Seeding (Conditional):** Based on player gravity:
   - **< 20%:** Desperation Mode - fetch target-related artists
   - **20-39%:** Dead Zone - SKIP target-related artists
   - **40-79%:** Good Influence - fetch target-related artists
   - **≥ 80%:** High Influence - fetch target-related artists (target tracks injected later)
4. **Target Artist Injection:** Explicitly adds the target artist itself to the pool
5. **Output:** Combined list of 20-100 artist IDs (deduplicated)

#### Stage 2: Track Fetching (Candidates)

**Purpose:** Fetch actual tracks from the seeded artists.

**Process:**

1. **Top Tracks Retrieval:** Calls `fetchTopTracksForArtists` for all seeded artist IDs
   - Fetches top 10 tracks per artist (database-first, Spotify API fallback)
   - Uses tiered caching: Memory → Database → Spotify API
2. **Artist Profile Enrichment:** Calls `enrichCandidatesWithArtistProfiles`
   - Fetches full artist metadata (genres, popularity, followers)
   - Required for attraction scoring in Stage 3
3. **Output:** 100-500 candidate tracks with enriched metadata

#### Stage 3: Scoring & Selection (Score)

**Purpose:** Score candidates and select final 9 options.

**Process:**

1. **Attraction Scoring:** Calculate artist-to-artist similarity for each candidate
2. **Diversity Constraints:** Apply 3-3-3 distribution (Good/Neutral/Bad)
3. **Database Fallback:** If insufficient unique artists, fetch random tracks from database
4. **Final Selection:** Return exactly 9 tracks meeting all requirements

#### Minimum Pool Requirements

- **REQ-FUN-01:** The system must ensure the final pre-selection pool contains at least 30-50 unique tracks before diversity filtering.
- **Fallback Strategy:** If Stage 2 yields insufficient candidates:
  - Stage 3 triggers database fallback via `fetchRandomTracksFromDb`
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

#### 3.4.2 Player Influence (Gravity) Mechanics

Player Influence acts as a probability gate that determines whether high-value tracks (specifically the Target Artist) are permitted to enter the candidate pool:

- **Low Influence (< 20%):** **"Desperation Mode"** is active. Related Artist tracks are forcibly injected to assist struggling players.
- **Mid Influence (20% - 39%):** **"The Dead Zone."** Related Artist tracks are **NOT** forcibly injected. They will only appear if:
  1.  They appear naturally as a related artist (luck).
  2.  The 'Diversity Injection' fallback (see 3.2) triggers because fewer than 5 "Good" candidates were found.
- **Good Influence (40% - 79%):** **"Threshold Met."** Related Artist tracks are forcibly injected, guaranteeing their availability as a selectable option.
- **High Influence (≥ 80%):** **"Threshold Met."** Target Artist tracks are forcibly injected, guaranteeing their availability as a selectable option.

#### 3.4.3 Round Influence (Convergence)

The game round overrides standard scoring logic to force game conclusion:

- **Rounds 1-7:** Standard scoring applies.
- **Round 8+:** **"Target Boost"** becomes active, behaving like High Influence to force Target Artist insertion.
- **Round 10+:** **"Hard Convergence"** is active. The system bypasses all similarity filters (REQ-FUN-07) for Target Artists, ensuring they are always selectable regardless of their calculated mathematical distance from the current track.

#### 3.4.4 Fallback Priority

If the candidate pool cannot satisfy the 3-3-3 distribution (e.g., not enough "Bad" songs found):

1.  **Percentile Expansion:** The system expands the definition of "Good/Bad" to include a wider range of attraction scores.
2.  **Category Filling:** The system fills empty slots starting with the most under-represented category to ensure 9 selectable options are always returned.

### 3.5 Filtering

- **REQ-FUN-04:** The result set must exclude the currently playing song.
- **REQ-FUN-05:** The result set must exclude any song previously played since the last player score. This list only resets when a player successfully scores (reaches their Target Artist).
- **REQ-FUN-06:** The result set must not contain duplicate artist entries.
- **REQ-FUN-07:** Target Artists must NOT appear in the candidate list during early gameplay levels (Rounds 1-9) unless their similarity score > 0.4. From Round 10 onwards (Level 10 influence), the system enters 'Hard Convergence' and Target Artists are allowed regardless of similarity.

## 5. Non-Functional Requirements

### 5.1 Performance

- We are hosted on Vercel using a hobby plan. No serverless function can take more than 10 seconds.
