# Software Requirements Specification for Scoring & Similarity Logic

## 1. Introduction

### 1.1 Purpose

The purpose of this document is to define the exact mathematical and logical rules used to score music tracks in the "Bar Jukebox" game. The system must quantitatively compare songs to determine how "close" or "far" they are from a player's hidden Target Artist, driving the "Hot/Cold" gameplay mechanic.

### 1.2 Scope

- **Track Similarity Calculation:** Comparison logic between two tracks (Track A vs. Track B) for diversity and selection purposes.
- **Artist Attraction Scoring:** Measuring how close a Candidate Artist is to a Target Artist (artist-to-artist comparison only).
- **Categorization:** Sorting tracks into "Closer", "Neutral", and "Further" bins based on their artist's attraction to the target.

## 2. Dual Scoring System

The game employs **two distinct scoring algorithms** for different purposes:

### 2.1 Track Similarity (Track-to-Track)

Used for **diversity constraints** and ensuring varied musical selections.

**Formula:**
`Score = (Genre * 50%) + (Relations * 10%) + (Era * 20%) + (TrackPop * 7.5%) + (ArtistPop * 7.5%) + (Followers * 5%)`

**Components:**

- Genre Similarity (50%)
- Artist Relationships (10%)
- Release Era Proximity (20%)
- Track Popularity (7.5%)
- Artist Popularity (7.5%)
- Follower Count (5%)

This score is used to prevent duplicate-feeling tracks in the selection pool.

### 2.2 Artist Attraction (Artist-to-Artist)

Used for **gameplay mechanics** - determining how "close" or "far" a candidate is from the target.

**Formula:**
`Attraction = (Genre * 40%) + (Relations * 30%) + (ArtistPop * 15%) + (Followers * 15%)`

**Components:**

- Genre Similarity (40%)
- Artist Relationships (30%)
- Artist Popularity (15%)
- Follower Count (15%)

**Critical Distinction:** Attraction scoring **ignores track-level metadata** (track popularity, release date). It compares only artist-level attributes to ensure that a target artist's tracks always achieve maximum attraction (1.0) when compared to themselves.

## 3. Component Logic Details

### 3.1 Genre Similarity

Primary driver of musical compatibility.

- **Logic:** Uses a weighted graph traversal or Jaccard Index overlap between the two artists' genre sets.
- **Goal:** Ensure tracks feel like they belong to the same musical world.

### 3.2 Artist Relationships

Determines social/industrial connection.

- **Logic:**
  - **Direct Link:** 1.0 score if Artist A and Artist B are found to be related in our pre-computed artist relationship graph.
  - **No Link:** Defaults to a neutral baseline or secondary genre proxy.
- **How Relationships are Computed:**
  - **Database-Driven:** The system builds its own artist relationship graph from database queries, NOT from Spotify's API.
  - **Genre Similarity:** Artists are considered related if they share significant genre overlap (using weighted genre graph).
  - **Pre-computed Graph:** Relationships are cached in a local graph database for instant O(1) lookup during gameplay.
  - **No External API Calls:** This approach avoids deprecated Spotify endpoints and rate limiting issues.
- **Goal:** Capture the "network effect" of similar artists without relying on external APIs.

### 3.3 Release Era Proximity (Track Similarity Only)

Ensures temporal relevance for track diversity.

- **Logic:** Calculates the absolute difference between release years.
  - **Max Difference:** 30 years (Score = 0.0).
  - **Perfect Match:** 0 years difference (Score = 1.0).
- **Goal:** Distinguish between "80s Pop" and "2020s Pop".
- **Note:** NOT used in attraction calculation.

### 3.4 Track Popularity (Track Similarity Only)

Ensures cultural relevance match for diversity.

- **Logic:** `1 - (AbsDiff / 100)`.
- **Goal:** Prevent duplicate-feeling tracks of vastly different popularity.
- **Note:** NOT used in attraction calculation.

### 3.5 Artist Popularity

Ensures cultural relevance match.

- **Logic:** `1 - (AbsDiff / 100)`.
- **Goal:** Prevent a global superstar (Taylor Swift) from being considered purely "similar" to an obscure indie band solely based on genre.
- **Used in:** Both track similarity and artist attraction.

### 3.6 Follower Count

Minor adjustment for fanbase size.

- **Logic:** Logarithmic comparison of total follower counts.
- **Goal:** Differentiate between "Niche" and "Mainstream" within the same genre.
- **Used in:** Both track similarity and artist attraction.

## 4. Attraction Mechanics

### 4.1 Definition of Attraction

"Attraction" is defined as the **artist-to-artist similarity** between a **Candidate Track's Artist** and the active player's **Target Artist**. This is calculated using only artist-level attributes.

`Attraction(Candidate) = ArtistSimilarity(Candidate.Artist, Target_Artist)`

**Key Principle:** A target artist's own tracks will always have an attraction of 1.0 (perfect match) because the artist is being compared to themselves.

### 4.2 The "Relative Move" Principle

In this game, "Good" and "Bad" are relative to the _Current Song_.

- **Baseline:** The Attraction of the _Currently Playing Song's Artist_ to the Target Artist.
- **Delta:** `Candidate_Attraction - Baseline`.

## 5. Categorization (Closer / Neutral / Further)

The system must sort candidates into three distinct buckets to facilitate the "3-3-3" selection requirement.

### 5.1 Binning Logic

Tracks are categorized based on their **Delta** (Difference from Baseline).

1.  **CLOSER:** `Delta > Neutral_Tolerance`
    - The track's artist is statistically closer to the target than the current song's artist.
2.  **FURTHER:** `Delta < -Neutral_Tolerance`
    - The track's artist is statistically farther from the target than the current song's artist.
3.  **NEUTRAL:** `|Delta| <= Neutral_Tolerance`
    - The track's artist is effectively a lateral move.

### 5.2 Adaptive Tolerance

- **Standard Tolerance:** 2% (0.02).
- **Adaptive:** If the range of all candidate scores is very tight (e.g., all songs are very similar), the tolerance shrinks (min 1.5%) to force differentiation.

### 5.3 Fallback Stratification

If the natural mathematical buckets are empty (e.g., _all_ candidates are technically "Closer"), the system employs fallback logic to enforce gameplay choices:

- **Forced Distribution:** Sorts all candidates by Delta and slices them into top 33% (Good), Middle 33% (Neutral), and Bottom 33% (Bad).
- **Skew correction:** If all candidates are "Good", the "Bad" bucket is re-labeled as "Neutral" to avoid telling the user a good option is "Further" when it is merely "Less Good".

## 6. Gravity System

### 6.1 Multi-player Weighting

To prevent the game from being purely about one player, a "Gravity" score is applied.

- **Active Player Weight:** 70%
- **Passive Player Weight:** 30%
- **Goal:** The path should generally favor the active player but avoid choices that are catastrophic for the passive player.
