# Implementation Plan: Vietnamese DJ Language

## Overview

Additive change across four files: update the two API routes independently, then update `DJService` to pass the language field, then create the `DJLanguageSelect` UI component, wire it into the dashboard, and finally add property-based tests for all 8 correctness properties.

## Tasks

- [x] 1. Update `/api/dj-script/route.ts` to support language branching

  - Add constants `ENGLISH_LLM_MODEL = 'llama-3.3-70b'` and `VIETNAMESE_LLM_MODEL = 'qwen3-235b-a22b-instruct-2507'` at the top of the file
  - Extract `language` from the request body alongside existing fields; derive `isVietnamese = language === 'vietnamese'`
  - Select `model` and `systemPrompt` based on `isVietnamese`; Vietnamese system prompt must be written in Vietnamese
  - Pass the selected `model` and `systemPrompt` to the Venice AI chat/completions call
  - English path must remain byte-for-byte identical to current behaviour when `language` is absent or `"english"`
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 5.1_

  - [ ]\* 1.1 Write property test for Script API model selection (Property 3)

    - **Property 3: Script API uses correct model per language**
    - **Validates: Requirements 2.1, 2.2, 5.1**

  - [ ]\* 1.2 Write property test for Vietnamese system prompt language (Property 4)
    - **Property 4: Vietnamese system prompt is in Vietnamese**
    - **Validates: Requirements 2.4**

- [x] 2. Update `/api/dj-tts/route.ts` to support language branching

  - Add constants `ENGLISH_TTS_MODEL = 'tts-kokoro'`, `ENGLISH_TTS_VOICE = 'af_nova'`, `VIETNAMESE_TTS_MODEL = 'tts-qwen3-1-7b'` at the top of the file
  - Extract `language` from the request body alongside `text`; derive `isVietnamese = language === 'vietnamese'`
  - Build `ttsBody` conditionally: Vietnamese uses `{ model: VIETNAMESE_TTS_MODEL, input: text, response_format: 'mp3' }` (no `voice`); English uses `{ model: ENGLISH_TTS_MODEL, voice: ENGLISH_TTS_VOICE, input: text, response_format: 'mp3' }`
  - English path must remain byte-for-byte identical to current behaviour when `language` is absent or `"english"`
  - _Requirements: 3.2, 3.3, 3.4, 5.2_

  - [ ]\* 2.1 Write property test for TTS API model and voice config (Property 6)
    - **Property 6: TTS API uses correct model and voice config per language**
    - **Validates: Requirements 3.2, 3.3, 5.2**

- [x] 3. Checkpoint — Ensure all tests pass, ask the user if questions arise.

- [x] 4. Update `services/djService.ts` to read and forward `djLanguage`

  - At the top of `fetchAudioBlob`, read `localStorage.getItem('djLanguage')` and resolve to `'english' | 'vietnamese'` (default `'english'` for absent or unrecognised values)
  - Include `language` in the `/api/dj-script` request body alongside `trackName`, `artistName`, `recentScripts`
  - Include `language` in the `/api/dj-tts` request body alongside `text`
  - No other methods in `DJService` change
  - _Requirements: 2.5, 3.1, 4.4, 5.3_

  - [ ]\* 4.1 Write property test for DJService language forwarding (Property 5)

    - **Property 5: DJService passes language to both APIs**
    - **Validates: Requirements 2.5, 3.1, 5.3**

  - [ ]\* 4.2 Write property test for unknown language fallback (Property 8)

    - **Property 8: Unknown language falls back to English**
    - **Validates: Requirements 4.4**

  - [ ]\* 4.3 Write property test for graceful degradation on Vietnamese errors (Property 7)
    - **Property 7: Vietnamese path graceful degradation**
    - **Validates: Requirements 4.1, 4.2, 4.3**

- [x] 5. Create `DJLanguageSelect` component

  - Create `app/[username]/admin/components/dashboard/components/dj-language-select.tsx`
  - Follow the same pattern as `DJFrequencySelect`: listen for `djmode-changed` and `storage` events, return `null` when DJ Mode is disabled
  - Render a "DJ Language" label and two toggle buttons: "English" and "Vietnamese"
  - On mount, read `localStorage["djLanguage"]`; default to `'english'` if absent or unrecognised
  - On button click, write the selected value to `localStorage["djLanguage"]` and update local state
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [ ]\* 5.1 Write property test for localStorage round-trip (Property 1)

    - **Property 1: Language selector localStorage round-trip**
    - **Validates: Requirements 1.3, 1.4**

  - [ ]\* 5.2 Write property test for visibility tied to DJ Mode state (Property 2)
    - **Property 2: Language selector visibility tied to DJ Mode state**
    - **Validates: Requirements 1.1, 1.6**

- [x] 6. Wire `DJLanguageSelect` into the dashboard

  - Export `DJLanguageSelect` from `app/[username]/admin/components/dashboard/components/index.ts`
  - Import and render `<DJLanguageSelect />` in `jukebox-section.tsx` immediately after `<DJFrequencySelect />` (before `<DuckOverlayToggle />`)
  - _Requirements: 1.1_

- [x] 7. Final checkpoint — Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Property tests use `fast-check` with a minimum of 100 iterations each
- The English path must remain unchanged — all branching is additive
- Model identifiers are hardcoded constants; no new environment variables are needed
