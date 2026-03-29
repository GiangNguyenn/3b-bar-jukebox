# Implementation Plan: DJ Winner Announcement

## Overview

Add volume ducking and announcement queuing to `DJService.announceTriviaWinner()`, and add Realtime health monitoring with polling fallback to `useTriviaWinnerAnnouncement`. Implementation proceeds bottom-up: extract shared ducking logic, add the queue, update `announceTriviaWinner()`, refactor `maybeAnnounce()` to reuse the shared helpers, then update the hook with fallback polling and deduplication.

## Tasks

- [x] 1. Add announcement queue and shared ducking/drain helpers to DJService

  - [x] 1.1 Add `announcementQueue` private member and `duckAndPlay` private method to `DJService`

    - Add `private announcementQueue: Array<() => Promise<void>> = []` member
    - Extract the volume duck logic from `maybeAnnounce()` into a new `private async duckAndPlay(audioBlob: Blob, scriptText: string | null, waitForEnd: boolean): Promise<void>` method
    - `duckAndPlay` reads current Spotify volume via `getPlaybackState()`, computes `Math.round(originalVolume * 0.2)`, calls `setVolume(duckedVolume)`, re-applies duck after 500ms, persists announcement text via `/api/dj-announcement`, then calls `playAudioBlob(blob, waitForEnd, originalVolume)`
    - If `getPlaybackState()` fails, assume `originalVolume = 100`
    - If `setVolume(duckedVolume)` fails, still play the announcement (skip ducking)
    - _Requirements: 1.1, 1.2, 1.4, 1.5_

  - [x] 1.2 Add `drainQueue` private method to `DJService`

    - Implement `private drainQueue(): void` that sets `isAnnouncementInProgress = false`, shifts the next thunk from `announcementQueue`, and if present sets `isAnnouncementInProgress = true` and executes it with `.catch(() => {}).finally(() => this.drainQueue())`
    - This ensures the queue always advances regardless of errors
    - _Requirements: 2.2, 5.1, 5.2_

  - [x] 1.3 Write property tests for volume ducking calculation

    - **Property 1: Ducked volume is 20% of original**
    - **Validates: Requirements 1.2**
    - Create test file at `services/__tests__/djServiceAnnouncement.test.ts`
    - Use `fast-check` with `fc.integer({ min: 0, max: 100 })` to verify `Math.round(v * 0.2)` for all volumes

  - [x] 1.4 Write property test for FIFO queue ordering

    - **Property 2: All announcements are played in FIFO order, none dropped**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.5**
    - Add to `services/__tests__/djServiceAnnouncement.test.ts`
    - Use `fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 10 })` to generate announcement sequences, simulate queue, verify all played in order

  - [x] 1.5 Write property test for mutual exclusion
    - **Property 3: At most one announcement plays at a time**
    - **Validates: Requirements 2.4**
    - Add to `services/__tests__/djServiceAnnouncement.test.ts`
    - Track `isAnnouncementInProgress` transitions across a sequence of announcements, verify never two concurrent

- [x] 2. Update `announceTriviaWinner` to use ducking and queuing

  - [x] 2.1 Refactor `announceTriviaWinner(text: string)` in `services/djService.ts`

    - Wrap the TTS fetch + `duckAndPlay` call in an `execute` async thunk
    - If `isAnnouncementInProgress`, push `execute` onto `announcementQueue` and return
    - Otherwise set `isAnnouncementInProgress = true`, run `execute()` in a try/finally that calls `drainQueue()`
    - Winner announcements always duck (no `duckOverlayMode` check)
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.5, 3.1, 3.2, 3.3_

  - [x] 2.2 Write property test for error recovery

    - **Property 4: Error recovery restores volume and drains queue**
    - **Validates: Requirements 5.1, 5.2**
    - Add to `services/__tests__/djServiceAnnouncement.test.ts`
    - Simulate error during playback, verify volume restored and queue drained

  - [x] 2.3 Write property test for DJ disabled guard

    - **Property 5: DJ disabled skips announcement without error**
    - **Validates: Requirements 4.3**
    - Add to `services/__tests__/djServiceAnnouncement.test.ts`
    - Generate random announcement texts with DJ disabled, verify no side effects

  - [x] 2.4 Write property test for voice passthrough
    - **Property 6: Configured voice is passed to TTS API**
    - **Validates: Requirements 3.2**
    - Add to `services/__tests__/djServiceAnnouncement.test.ts`
    - Generate random voice IDs from `DJ_VOICE_IDS`, verify passthrough to TTS fetch body

- [x] 3. Refactor `maybeAnnounce` to use shared helpers

  - [x] 3.1 Refactor `maybeAnnounce(nextTrack)` in `services/djService.ts`

    - Replace inline ducking logic with a call to `duckAndPlay(audioBlob, this.lastGeneratedScript, false)` when `duckOverlay` is enabled
    - Replace inline `isAnnouncementInProgress = false` in `finally` with `drainQueue()`
    - If `isAnnouncementInProgress`, push the execute thunk onto `announcementQueue` instead of returning early
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.2 Write unit tests for maybeAnnounce queuing behavior
    - Test that a second `maybeAnnounce` call during an in-progress announcement is queued, not dropped
    - Test that queued announcements play after the current one finishes
    - Add to `services/__tests__/djServiceAnnouncement.test.ts`
    - _Requirements: 2.1, 2.2_

- [x] 4. Checkpoint — Verify DJService changes

  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Add Realtime health monitoring and polling fallback to `useTriviaWinnerAnnouncement`

  - [x] 5.1 Update `useTriviaWinnerAnnouncement` hook with health monitoring, polling fallback, and deduplication

    - Extend `AnnouncementRow` interface to include `id: string`
    - Add `processedIds` ref (`Set<string>`), `isRealtimeHealthy` ref, and `pollIntervalRef` ref
    - Extract shared `handleAnnouncement(rowId, scriptText)` function that checks `processedIds`, adds the ID, updates `is_active = false` in DB, and calls `djService.announceTriviaWinner(scriptText)`
    - Update the Realtime `.subscribe()` callback to track channel status: set `isRealtimeHealthy` to `true` when `SUBSCRIBED`, call `stopPolling()`; set to `false` otherwise, call `startPolling(profileId)`
    - Add 30-second timeout: if not `SUBSCRIBED` within 30s, start polling
    - Update the Realtime `postgres_changes` callback to call `handleAnnouncement(row.id, row.script_text)` instead of directly calling `djService`
    - Implement `startPolling(profileId)`: `setInterval` every 10s querying `dj_announcements` for `is_active = true` rows ordered by `created_at ASC`, calling `handleAnnouncement` for each
    - Implement `stopPolling()`: clear the interval
    - Update cleanup to clear health timeout, stop polling, and remove channel
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x] 5.2 Write property test for polling activation tracking

    - **Property 8: Polling activation tracks Realtime health**
    - **Validates: Requirements 6.1, 6.2, 6.3**
    - Create test file at `hooks/__tests__/triviaWinnerAnnouncementFallback.test.ts`
    - Use `fc.array(fc.constantFrom('SUBSCRIBED', 'TIMED_OUT', 'CLOSED', 'CHANNEL_ERROR'))` to generate status sequences, verify polling is active iff status ≠ SUBSCRIBED

  - [x] 5.3 Write property test for announcement deduplication

    - **Property 9: Announcement deduplication — each row ID delivered at most once**
    - **Validates: Requirements 6.5, 6.6**
    - Add to `hooks/__tests__/triviaWinnerAnnouncementFallback.test.ts`
    - Generate sequences of row IDs with intentional duplicates, verify each unique ID triggers exactly one `announceTriviaWinner` call and one DB update

  - [x] 5.4 Write unit tests for hook fallback behavior
    - Test: Realtime channel reaches SUBSCRIBED → polling does not start
    - Test: Realtime channel times out after 30s → polling starts at 10s interval
    - Test: Polling finds active row → delivers to djService and sets `is_active = false`
    - Test: Hook unmounts → polling interval cleared and Realtime channel removed
    - Test: `is_active = false` update fails → announcement still delivered, no duplicate due to processedIds
    - Add to `hooks/__tests__/triviaWinnerAnnouncementFallback.test.ts`
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 6.6, 6.7_

- [x] 6. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- The design uses TypeScript throughout — all implementation uses TypeScript with strict mode
- Use `node:test` runner with `tsx` for all tests (no Jest/Vitest)
- Use `fast-check` for property-based tests
- Use `createModuleLogger` for logging in non-React files; never use `console.log`
- Follow existing code style: single quotes, no semicolons, no trailing commas
- Property tests reference their design document property number and validated requirements
