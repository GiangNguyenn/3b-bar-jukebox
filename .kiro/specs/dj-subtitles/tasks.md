# Implementation Plan: DJ Subtitles

## Overview

Persist DJ announcement text to Supabase and display it as subtitles on the public display page via realtime subscriptions. Implementation proceeds bottom-up: database migration first, then the API route, then the DJService integration, then the display-side hook and UI component, and finally wiring everything into the display page. Each step builds on the previous and ends with integration into the existing system.

## Tasks

- [x] 1. Create database migration for `dj_announcements` table
  - [x] 1.1 Apply migration via Supabase MCP `apply_migration` tool (name: `create_dj_announcements`)
    - Define `dj_announcements` table with `id` (UUID PK, default `gen_random_uuid()`), `profile_id` (UUID FK to `profiles(id)` ON DELETE CASCADE), `script_text` (TEXT NOT NULL DEFAULT ''), `is_active` (BOOLEAN NOT NULL DEFAULT false), `created_at` (TIMESTAMPTZ DEFAULT now()), `updated_at` (TIMESTAMPTZ DEFAULT now())
    - Add UNIQUE constraint on `profile_id` so each venue has at most one row
    - Enable Row Level Security with a public SELECT policy and a service-role ALL policy
    - Add table to `supabase_realtime` publication via `ALTER PUBLICATION supabase_realtime ADD TABLE public.dj_announcements`
    - Use the Supabase MCP `apply_migration` tool to execute the migration directly against the database
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 2. Implement announcement API route and validation
  - [x] 2.1 Create `app/api/dj-announcement/route.ts` POST handler
    - Accept JSON body with `profileId` (required string), optional `scriptText` (non-empty string), optional `clear` (boolean)
    - Validate: `profileId` required and non-empty; either `scriptText` or `clear: true` must be provided; if both, `clear` takes precedence
    - On set action: upsert `dj_announcements` with `profile_id`, `script_text`, `is_active: true`, `updated_at: now()`; conflict on `profile_id`
    - On clear action: upsert with `is_active: false`, `script_text: ''`, `updated_at: now()`
    - Return 200 `{ success: true }` on success, 400 on validation error, 500 on Supabase write failure
    - Use `supabaseAdmin` from `@/lib/supabase-admin` and `createModuleLogger` from `@/shared/utils/logger`
    - _Requirements: 1.2, 1.3, 1.4, 2.3_

  - [x] 2.2 Write property test for invalid request rejection (Property 1)
    - **Property 1: Invalid announcement requests are rejected**
    - Generate random request bodies where `profileId` is missing/empty OR neither `scriptText` nor `clear: true` is provided
    - Verify the validation function returns an error and never produces a database payload
    - Test file: `app/api/dj-announcement/__tests__/route.test.ts`
    - **Validates: Requirements 1.3**

  - [x] 2.3 Write property test for payload construction (Property 2)
    - **Property 2: Announcement API payload construction**
    - Generate random valid profile IDs and script texts; verify upsert payload has correct `profile_id`, `is_active`, and `script_text` for both set and clear actions
    - Test file: `app/api/dj-announcement/__tests__/route.test.ts`
    - **Validates: Requirements 1.2, 2.3**


- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Integrate DJService with announcement API
  - [x] 4.1 Modify `services/djService.ts` to post announcement text after script generation
    - In `_doFetchAudioBlob`, after successfully receiving the script from `/api/dj-script` and before calling `/api/dj-tts`, fire-and-forget a POST to `/api/dj-announcement` with `{ profileId, scriptText: data.script }`
    - Read `profileId` from `localStorage` (key: `profileId`), matching the existing pattern for admin settings
    - Use `.catch(() => {})` so failures never block or delay audio playback
    - Log the announcement call via the existing DJService `log()` / `warn()` helpers
    - _Requirements: 1.1, 1.4_

  - [x] 4.2 Modify `services/djService.ts` to clear announcement on audio end and error
    - In `playAudioBlob`, on `audio.onended` callback, fire-and-forget a POST to `/api/dj-announcement` with `{ profileId, clear: true }`
    - In `playAudioBlob`, on `audio.onerror` callback, fire-and-forget the same clear request
    - Use `.catch(() => {})` so failures never block volume restoration or other cleanup
    - _Requirements: 2.1, 2.2_

  - [x] 4.3 Write unit tests for DJService announcement integration
    - Verify `_doFetchAudioBlob` calls `/api/dj-announcement` with script text after successful script fetch (mocked fetch)
    - Verify `playAudioBlob` calls `/api/dj-announcement` with `clear: true` on `onended` and `onerror` events
    - Verify announcement failures do not throw or block audio playback
    - Test file: `services/__tests__/djService.test.ts`
    - _Requirements: 1.1, 1.4, 2.1, 2.2_

- [x] 5. Implement display-side hook and UI component
  - [x] 5.1 Create `hooks/useDjSubtitles.ts` realtime subscription hook
    - Accept `{ profileId: string | null }` options
    - Subscribe to `postgres_changes` on `dj_announcements` table filtered by `profile_id` using the existing Supabase anon client from `@/lib/supabase`
    - On active announcement (INSERT or UPDATE with `is_active: true`): set `subtitleText` to `script_text`, set `isVisible` to `true`, start/reset a 30-second timeout
    - On inactive announcement (UPDATE with `is_active: false`) or timeout expiry: set `isVisible` to `false`
    - Clean up subscription channel and timeout on unmount
    - Skip subscription setup if `profileId` is null
    - Return `{ subtitleText: string | null, isVisible: boolean }`
    - _Requirements: 3.1, 3.2, 3.3, 5.1, 5.2, 5.3_

  - [x] 5.2 Write property test for realtime payload to visibility mapping (Property 3)
    - **Property 3: Realtime payload maps to visibility state**
    - Generate random payloads with varying `is_active` and `script_text` values
    - Verify `isVisible` equals `is_active` and `subtitleText` equals `script_text` when active, `null` when inactive
    - Test file: `hooks/__tests__/useDjSubtitles.test.ts`
    - **Validates: Requirements 3.2, 3.3**

  - [x] 5.3 Write property test for auto-hide timeout (Property 4)
    - **Property 4: Subtitle auto-hides after timeout**
    - Activate subtitle, advance fake timers by 30 seconds without a clear signal
    - Verify `isVisible` becomes `false`
    - Test file: `hooks/__tests__/useDjSubtitles.test.ts`
    - **Validates: Requirements 5.1, 5.2**

  - [x] 5.4 Write property test for timeout reset on new announcement (Property 5)
    - **Property 5: New announcement resets timeout**
    - Send two active announcements within 30 seconds; verify timeout resets from the second announcement
    - Test file: `hooks/__tests__/useDjSubtitles.test.ts`
    - **Validates: Requirements 5.3**

  - [x] 5.5 Create `components/Display/SubtitleOverlay.tsx` UI component
    - Accept `{ text: string | null, isVisible: boolean }` props
    - Use Framer Motion `AnimatePresence` with `motion.div` for fade-in (opacity 0→1) and fade-out (opacity 1→0) transitions
    - Position `fixed` at bottom-center of viewport, above the QR code (`bottom: 6rem`)
    - Semi-transparent dark background panel (`bg-black/70`, rounded)
    - White text, minimum `text-3xl` (≥2rem), with `text-shadow` for contrast against dynamic backgrounds
    - Constrain max width (`max-w-4xl`) with natural line wrapping for longer announcements
    - Render nothing when `isVisible` is false and animation completes
    - _Requirements: 3.4, 3.5, 4.1, 4.2, 4.3_

- [x] 6. Wire hook and overlay into the display page
  - [x] 6.1 Integrate `useDjSubtitles` and `SubtitleOverlay` into `app/[username]/display/page.tsx`
    - Look up the venue's `profile_id` from the `username` param (reuse the same Supabase query pattern as `usePlaylistData`)
    - Pass `profileId` to `useDjSubtitles` hook
    - Render `SubtitleOverlay` with `text` and `isVisible` from the hook in all display states (playing, no track, error) so subtitles appear regardless of playback state
    - Position the overlay in the existing layout without disrupting album art, metadata, or QR code
    - _Requirements: 3.1, 3.2, 3.3, 3.5_

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties using fast-check with Node.js built-in test runner (`node:test`)
- All fire-and-forget calls from DJService use `.catch(() => {})` to guarantee announcement failures never block audio playback
- The implementation uses TypeScript throughout, matching the existing codebase
