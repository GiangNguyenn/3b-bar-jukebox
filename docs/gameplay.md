# Dual-Gravity Steering (DGS) Overview

This document describes how the music game's recommendation engine uses Dual-Gravity Steering to bias track choices toward each player's target artist while keeping selections musically cohesive.

## Server API: `POST /api/game/init-round`

### Request Payload

| Field             | Type                                                                | Notes                                                                                                |
| ----------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `playbackState`   | `SpotifyPlaybackState`                                              | Snapshot of the currently playing track; must include track + primary artist IDs.                    |
| `roundNumber`     | `number (1-10)`                                                     | Current turn within the 10-step convergence window.                                                  |
| `turnNumber`      | `number`                                                            | Monotonic counter used for telemetry.                                                                |
| `currentPlayerId` | `'player1' \| 'player2'`                                            | Player taking the next action.                                                                       |
| `playerTargets`   | `{ player1: TargetArtist \| null; player2: TargetArtist \| null }`  | Optional. Omit or send `null` to ask the server to assign new targets.                               |
| `playerGravities` | `{ player1: number; player2: number }`                              | Current gravity values (defaults to `0.32`).                                                         |
| `playedTrackIds`  | `string[]`                                                          | Tracks already used this round; prevents repeats.                                                    |
| `lastSelection`   | `{ trackId: string; playerId: PlayerId; previousTrackId?: string }` | Optional metadata about the last confirmed player selection so the server can update gravity scores. |

### Response Payload

| Field                                            | Type                                                      | Notes                                                                                   |
| ------------------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `targetArtists`                                  | `TargetArtist[]`                                          | Ordered `[player1, player2]` list describing active targets.                            |
| `playerTargets`                                  | `PlayerTargetsMap`                                        | Explicit mapping for convenience.                                                       |
| `optionTracks`                                   | `DgsOptionTrack[]`                                        | Top 5 ranked options with scoring metrics + diversity constraints applied.              |
| `gravities`                                      | `PlayerGravityMap`                                        | Updated gravity values after applying selection deltas + underdog correction.           |
| `explorationPhase`                               | `{ level: 'high' \| 'medium' \| 'low'; ogDrift: number }` | Indicates how organic gravity is blended this round.                                    |
| `ogDrift`                                        | `number`                                                  | Stabilizer weight (0.0, 0.15, or 0.3 depending on round).                               |
| `candidatePoolSize`                              | `number`                                                  | Number of unique tracks considered before diversity + hard filters.                     |
| `hardConvergenceActive`                          | `boolean`                                                 | `true` when roundNumber is 10, forcing heavier gravity weighting and target insertions. |
| `vicinity`                                       | `{ triggered: boolean; playerId?: PlayerId }`             | Details whether a target vicinity auto-insertion was applied.                           |
| `roundNumber` / `turnNumber` / `currentPlayerId` | Mirror inputs for UI synchronization.                     |

`DgsOptionTrack` extends `GameOptionTrack` and adds a `metrics` object containing similarity, attraction, gravity, popularity band, and force reason metadata so the UI can explain why each suggestion surfaced.

## Candidate Pool & Scoring

1. **Candidate Sources** (target size 40–80):
   - Related artists' top tracks (multi-level traversal).
   - Spotify `recommendations` seeded by the current track.
   - Additional recommendations for extra variety.
2. Tracks already played or queued are removed up-front.
3. Track metadata & artist profiles are used to compute:
   - `SimScore` via metadata-based similarity using:
     - Genre overlap (40% weight) - Jaccard similarity on artist genres
     - Popularity proximity (20% weight) - Normalized difference in popularity (0-100)
     - Duration similarity (15% weight) - Normalized difference in track duration
     - Artist relationship depth (15% weight) - Based on genre overlap and artist IDs
     - Release era proximity (10% weight) - Based on album release dates
   - Attraction toward each player's target using genre overlap + name similarity.
   - Gravity contribution: `CurrentPlayerGravity * CurrentPlayerAttraction` (biased toward active player's target).
   - Organic gravity stabilization: `SimScore * (1 - ogDrift) + OG_CONSTANT`.
   - Final score: stabilized + (gravity \* multiplier) where multiplier scales with round number.
4. Strategic distribution & diversity:
   - Calculate baseline attraction: current song's artist → active player's target
   - Categorize each candidate by comparing its attraction to this baseline:
     - **Closer**: candidate attraction > baseline + 0.05
     - **Neutral**: candidate attraction ≈ baseline (within ±0.05)
     - **Further**: candidate attraction < baseline - 0.05
   - Select 3 tracks from each category for balanced 9-option distribution
   - ≤2 options per artist to ensure variety
5. Vicinity trigger:
   - If any candidate is within `0.05` distance of a target artist, the engine force-inserts that artist's top track in the next list.
6. Hard convergence (turn 10):
   - Gravity weight dominates.
   - Both targets are guaranteed to appear if resolvable.

## Gravity Updates

When the client reports a completed selection (`lastSelection`), the server adjusts gravity based on the selection quality:

The client determines the selection category by comparing the selected track's attraction to the player's target against the currently playing song's attraction to that same target:

- **Closer**: Selected track's attraction > current song's attraction + 0.05 margin
- **Neutral**: Selected track's attraction ≈ current song's attraction (within ±0.05 margin)
- **Further**: Selected track's attraction < current song's attraction - 0.05 margin

| Selection Category | Gravity Adjustment | Effect                                           |
| ------------------ | ------------------ | ------------------------------------------------ |
| Closer             | `+0.10`            | Rewards good choices that move toward target     |
| Neutral            | `+0.02`            | Small reward for maintaining position            |
| Further            | `-0.05`            | Penalizes bad choices that move away from target |

Values are clamped to `[0.15, 0.70]`. If one player exceeds `0.50` while the other dips below `0.25`, an underdog boost of `+0.05` is applied to the trailing player to avoid runaway effects.

## Client Responsibilities

- Track `roundNumber` (1–10), `turnNumber`, player gravities, and selection metadata locally.
- Send `playerTargets` even after the first round so the server can keep targets stable until a round resets or a win occurs.
- Clear `playerTargets` (set to `null`) when starting a new round so the server can assign fresh targets.
- Respect `hardConvergenceActive` / `vicinity` flags to surface UI hints (e.g., "forced target insert").

Following this contract ensures both the API route and the React hook stay in sync with the DGS scoring engine.
