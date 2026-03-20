# Implementation Plan: DJ Mode

## Overview

Implement DJ Mode by adding a `DJService` singleton, a server-side `/api/dj-script` route, a `DJModeToggle` UI component, and wiring the announcement into `QueueSynchronizer` between track selection and playback.

## Tasks

- [x] 1. Add environment configuration

  - Add `VENICE_AI_API_KEY=` entry to `.env.example` with a comment explaining it is required for DJ Mode
  - _Requirements: 5.2_

- [x] 2. Create the `/api/dj-script` Next.js route

  - [x] 2.1 Implement `app/api/dj-script/route.ts`

    - Export a `POST` handler that reads `VENICE_AI_API_KEY` from `process.env`
    - Return 500 if the key is absent or empty
    - Parse `{ trackName, artistName }` from the request body; return 400 if either field is missing
    - Call Venice AI chat completions at `https://api.venice.ai/api/v1` with model `llama-3.3-70b`, the system prompt instructing ≤ 3 sentences, and a user message containing the track name and artist
    - Return `{ script: string }` on success; return 500 on Venice AI failure
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 5.1, 5.3_

  - [ ]\* 2.2 Write unit tests for `/api/dj-script`
    - Test returns 500 when `VENICE_AI_API_KEY` is absent
    - Test returns 400 when request body is missing `trackName` or `artistName`
    - Test sends `model: "llama-3.3-70b"` in the Venice AI request body
    - Test sends the correct system prompt instructing ≤ 3 sentences
    - _Requirements: 3.1, 3.3, 3.6, 5.1_

- [x] 3. Implement `DJService`

  - [x] 3.1 Create `services/djService.ts` with the `DJService` singleton

    - Implement `static getInstance(): DJService`
    - Implement `isEnabled(): boolean` — reads `localStorage.getItem("djMode") === "true"`
    - Implement `setEnabled(enabled: boolean): void` — writes to `localStorage`
    - Implement `speakScript(text: string): Promise<void>` — wraps `window.speechSynthesis.speak()` in a Promise resolving on `utterance.onend`, rejecting on `utterance.onerror`; returns immediately if `speechSynthesis` is not available
    - Implement `maybeAnnounce(track: JukeboxQueueItem): Promise<void>` — re-reads `localStorage` each call; skips if disabled, `Math.random() >= 0.2`, or track has no name/artist; calls `/api/dj-script`; calls `speakScript`; catches and logs all errors without rethrowing
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.4, 3.5, 4.1, 4.2, 4.4, 4.5, 5.3_

  - [ ]\* 3.2 Write property test for announcement probability gate (Property 2)

    - **Property 2: Announcement probability gate**
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [ ]\* 3.3 Write property test for graceful fallback on any error (Property 4)

    - **Property 4: Graceful fallback on any error**
    - **Validates: Requirements 2.4, 3.4, 3.5, 4.4, 4.5, 5.3**

  - [ ]\* 3.4 Write property test for prompt containing track metadata (Property 3)
    - **Property 3: Prompt contains track metadata**
    - **Validates: Requirements 3.2**

- [x] 4. Checkpoint — Ensure all tests pass

  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Create the `DJModeToggle` component

  - [x] 5.1 Implement `app/[username]/admin/components/dashboard/components/dj-mode-toggle.tsx`

    - Export `DJModeToggle(): JSX.Element`
    - On mount, read `localStorage.getItem("djMode")` to set initial checked state
    - On checkbox change, write to `localStorage` and call `DJService.getInstance().setEnabled(checked)`
    - Render a labeled checkbox with the text "DJ Mode"
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ]\* 5.2 Write property test for DJ Mode localStorage round-trip (Property 1)

    - **Property 1: DJ Mode localStorage round-trip**
    - **Validates: Requirements 1.2, 1.3, 1.4**

  - [ ]\* 5.3 Write unit tests for `DJModeToggle`
    - Test renders a checkbox with label "DJ Mode"
    - Test reads initial state from `localStorage` on mount
    - _Requirements: 1.1, 1.4_

- [x] 6. Place `DJModeToggle` in the dashboard tab

  - Locate `JukeboxSection` in the dashboard tab and render `<DJModeToggle />` below the playback controls
  - _Requirements: 1.1_

- [x] 7. Wire `DJService.maybeAnnounce` into `QueueSynchronizer`

  - [x] 7.1 Modify `services/playerLifecycle/QueueSynchronizer.ts`

    - Import `DJService` from `services/djService`
    - In `handleTrackFinishedImpl`, after `findNextValidTrack` resolves and before `playNextTrackImpl` is called, insert `await DJService.getInstance().maybeAnnounce(nextTrack)`
    - Ensure the `await` is inside the existing `if (nextTrack)` guard so it only runs when a next track exists
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 4.2, 4.3_

  - [ ]\* 7.2 Write property test for TTS sequencing (Property 5)
    - **Property 5: TTS sequencing — next track waits for speech**
    - **Validates: Requirements 4.2, 4.3**

- [x] 8. Final checkpoint — Ensure all tests pass

  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Verify environment configuration for TTS

  - No new environment variables are needed — `VENICE_AI_API_KEY` already covers both script generation and TTS audio via `/api/dj-tts`. Confirm `.env.example` already documents `VENICE_AI_API_KEY`.
  - _Requirements: 5.1, 5.2_

- [x] 10. Verify the `/api/dj-tts` Next.js route

  - [x] 10.1 Confirm `app/api/dj-tts/route.ts` is correct

    - The route already exists and exports a `POST` handler
    - Reads `VENICE_AI_API_KEY` from `process.env`; returns 500 if absent
    - Parses `{ text }` from the request body; returns 400 if missing
    - Calls `https://api.venice.ai/api/v1/audio/speech` with model `tts-kokoro`, voice `af_nova`, format `mp3`
    - Returns the audio buffer as `Content-Type: audio/mpeg`
    - _Requirements: 4.1, 4.5, 4.6_

  - [ ]\* 10.2 Write unit tests for `/api/dj-tts`
    - Test returns 500 when `VENICE_AI_API_KEY` is absent
    - Test returns 400 when `text` field is missing
    - Test forwards the text to Venice AI TTS and streams the response
    - _Requirements: 4.5, 4.6_

- [x] 11. Update `DJService` with TTS audio playback, prefetch logic, and frequency config

  - [x] 11.1 Replace `speakScript` with audio blob playback via `HTMLAudioElement`

    - Remove the `window.speechSynthesis` implementation
    - Add a private `playAudioBlob(blob: Blob): Promise<void>` method that creates an `HTMLAudioElement` with `URL.createObjectURL(blob)`, plays it, and resolves on `onended` (rejects on `onerror`)
    - _Requirements: 4.2, 4.3, 4.4_

  - [x] 11.2 Add `DJFrequency` type, `FREQUENCY_MAP`, and frequency methods

    - Define `type DJFrequency = "never" | "rarely" | "sometimes" | "often" | "always"`
    - Define `const FREQUENCY_MAP: Record<DJFrequency, number>` with values `{ never: 0, rarely: 0.1, sometimes: 0.25, often: 0.5, always: 1.0 }`
    - Implement `getFrequency(): DJFrequency` — reads `localStorage["djFrequency"]`, defaults to `"sometimes"`
    - Implement `setFrequency(freq: DJFrequency): void` — writes to `localStorage["djFrequency"]`
    - _Requirements: 2.2, 2.5, 2.6, 7.2, 7.3_

  - [x] 11.3 Add Duck & Overlay methods

    - Implement `isDuckOverlayEnabled(): boolean` — reads `localStorage["duckOverlayMode"] === "true"`
    - Implement `setDuckOverlay(enabled: boolean): void` — writes to `localStorage["duckOverlayMode"]`
    - _Requirements: 8.2, 8.3, 8.4, 8.9_

  - [x] 11.4 Implement `onTrackStarted` with concurrent prefetch

    - Add `private prefetchState: PrefetchState | null` field
    - Implement `onTrackStarted(currentTrack: JukeboxQueueItem, nextTrack: JukeboxQueueItem | null): void`
    - Re-read `localStorage["djMode"]` and `localStorage["djFrequency"]` on each call
    - If disabled or `Math.random() >= FREQUENCY_MAP[freq]`, clear any stale prefetch and return
    - If `nextTrack` is null or has no name/artist, return
    - Store `prefetchTrackId = nextTrack.id` and set `prefetchPromise` to a chained fetch: POST `/api/dj-script` → on success POST `/api/dj-tts` → return `Blob`; catch all errors and resolve to `null`
    - _Requirements: 6.1, 6.2, 6.5_

  - [x] 11.5 Update `maybeAnnounce` to consume cached prefetch and support Duck & Overlay

    - If `prefetchState` is null, return immediately
    - If `nextTrack.id !== prefetchState.trackId`, discard and return immediately
    - Await `prefetchState.promise` to get `audioBlob | null`
    - If `audioBlob` is null, return immediately
    - If Duck & Overlay disabled: call `playAudioBlob`, await `onended`, return
    - If Duck & Overlay enabled: signal caller to start next track at 50% volume, call `playAudioBlob`, await `onended`, ramp volume from 0.5 to 1.0 over ≤ 2 s using `setInterval` (50 ms steps), return
    - _Requirements: 4.3, 4.4, 6.3, 6.4, 6.6, 8.5, 8.6, 8.7, 8.8_

  - [ ]\* 11.6 Write property test for DJ Frequency localStorage round-trip (Property 6)

    - **Property 6: DJ Frequency localStorage round-trip**
    - **Validates: Requirements 2.3, 2.4, 7.2, 7.3**

  - [ ]\* 11.7 Write property test for prefetch fires during playback (Property 7)

    - **Property 7: Prefetch fires during playback, not at track-end**
    - **Validates: Requirements 6.1, 6.2**

  - [ ]\* 11.8 Write property test for no duplicate requests (Property 8)

    - **Property 8: No duplicate requests when prefetch is reused**
    - **Validates: Requirements 6.3, 6.4**

  - [ ]\* 11.9 Write property test for stale prefetch discard (Property 9)

    - **Property 9: Stale prefetch is discarded on queue change**
    - **Validates: Requirements 6.6**

  - [ ]\* 11.10 Write property test for Duck & Overlay volume behavior (Property 11)

    - **Property 11: Duck mode starts next track at 50% volume and ramps to 100%**
    - **Validates: Requirements 8.5, 8.6**

  - [ ]\* 11.11 Write property test for no-announcement full volume invariant (Property 12)
    - **Property 12: No-announcement invariant — full volume when no DJ fires**
    - **Validates: Requirements 8.8**

- [x] 12. Update `QueueSynchronizer` to call `onTrackStarted`

  - In `QueueSynchronizer.ts`, when a new track begins playing, call `DJService.getInstance().onTrackStarted(currentTrack, nextTrack)` so prefetching starts during playback
  - Ensure `onTrackStarted` is called before the track's playback duration elapses (i.e. at track-start, not track-end)
  - _Requirements: 6.1, 6.2_

- [x] 13. Create `DJFrequencySelect` component

  - [x] 13.1 Implement `app/[username]/admin/components/dashboard/components/dj-frequency-select.tsx`

    - Export `DJFrequencySelect(): JSX.Element`
    - Render a `<select>` (or equivalent dropdown) labeled "DJ Frequency" with exactly five options: Never, Rarely, Sometimes, Often, Always
    - On mount, read `localStorage["djFrequency"]`, defaulting to `"sometimes"` if absent
    - On change, write to `localStorage["djFrequency"]` and call `DJService.getInstance().setFrequency(value)`
    - Only render when DJ Mode is enabled (read `localStorage["djMode"]`)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 7.1, 7.4_

  - [ ]\* 13.2 Write property test for DJ Frequency localStorage round-trip (Property 6)

    - **Property 6: DJ Frequency localStorage round-trip**
    - **Validates: Requirements 2.3, 2.4, 7.2, 7.3**

  - [ ]\* 13.3 Write unit tests for `DJFrequencySelect`
    - Test renders exactly five options: Never, Rarely, Sometimes, Often, Always
    - Test defaults to "Sometimes" when `localStorage["djFrequency"]` is absent
    - _Requirements: 2.2, 2.5_

- [x] 14. Create `DuckOverlayToggle` component

  - [x] 14.1 Implement `app/[username]/admin/components/dashboard/components/duck-overlay-toggle.tsx`

    - Export `DuckOverlayToggle(): JSX.Element`
    - Render a labeled checkbox/toggle with the text "Duck & Overlay"
    - On mount, read `localStorage["duckOverlayMode"]` to set initial state
    - On change, write to `localStorage["duckOverlayMode"]` and call `DJService.getInstance().setDuckOverlay(checked)`
    - Operates independently of DJ Mode toggle state
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.9_

  - [ ]\* 14.2 Write property test for Duck & Overlay localStorage round-trip (Property 10)

    - **Property 10: Duck & Overlay localStorage round-trip**
    - **Validates: Requirements 8.2, 8.3, 8.4, 8.9**

  - [ ]\* 14.3 Write unit tests for `DuckOverlayToggle`
    - Test renders a toggle labeled "Duck & Overlay"
    - Test reads initial state from `localStorage` on mount
    - Test state is independent of DJ Mode toggle
    - _Requirements: 8.1, 8.4, 8.9_

- [x] 15. Update `JukeboxSection` to render new components

  - Import and render `<DJFrequencySelect />` below `<DJModeToggle />` in `jukebox-section.tsx`
  - Import and render `<DuckOverlayToggle />` below `<DJFrequencySelect />`
  - _Requirements: 2.1, 7.1, 8.1_

- [x] 16. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- `maybeAnnounce` must never throw — all errors are caught internally so the track transition is never blocked
- Property tests use `fast-check`; add it as a dev dependency if not already present (`npm install -D fast-check`)
- Each property test should run a minimum of 100 iterations
- The Duck & Overlay volume ramp uses `setInterval` at 50 ms steps; total ramp must complete within 2 seconds (≤ 40 steps of ~0.0125 volume increment each)
