# Implementation Plan: DJ Voice Selection

## Overview

Add a configurable English TTS voice picker to the admin dashboard. A shared voice constant feeds both the UI selector and server-side validation. The selected voice flows from localStorage through DJService to the `/api/dj-tts` route and on to Venice AI. Vietnamese TTS is unaffected.

## Tasks

- [x] 1. Create shared voice constants

  - [x] 1.1 Create `shared/constants/djVoices.ts` with `DJVoiceOption` interface, `DEFAULT_DJ_VOICE`, `DJ_VOICES` array, and `DJ_VOICE_IDS` derived list
    - Export `DJVoiceOption` interface with `value` and `label` fields
    - Export `DEFAULT_DJ_VOICE` as `'af_nova'`
    - Export `DJ_VOICES` array with entries: af_nova/Nova, af_heart/Heart, af_bella/Bella, af_nicole/Nicole, af_sarah/Sarah, af_sky/Sky, am_adam/Adam, am_michael/Michael
    - Export `DJ_VOICE_IDS` mapped from `DJ_VOICES`
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 2. Update DJService to include voice in TTS requests

  - [x] 2.1 Modify `_doFetchAudioBlob` in `services/djService.ts` to read `localStorage["djVoice"]`, validate against `DJ_VOICE_IDS`, fall back to `DEFAULT_DJ_VOICE`, and include `voice` in the POST body to `/api/dj-tts`

    - Import `DJ_VOICE_IDS` and `DEFAULT_DJ_VOICE` from `@/shared/constants/djVoices`
    - After reading `djLanguage`, read `localStorage["djVoice"]`
    - Validate the value is in `DJ_VOICE_IDS`; if not, resolve to `DEFAULT_DJ_VOICE`
    - Add `voice: resolvedVoice` to the `/api/dj-tts` POST body
    - _Requirements: 2.1, 2.2, 5.1_

  - [ ]\* 2.2 Write property test: DJService includes resolved voice in TTS request

    - **Property 3: DJService includes resolved voice in TTS request**
    - **Validates: Requirements 2.1, 2.2**

  - [ ]\* 2.3 Write property test: DJService falls back to default for corrupted localStorage voice
    - **Property 8: DJService falls back to default for corrupted localStorage voice**
    - **Validates: Requirements 5.1**

- [x] 3. Update TTS API route to accept and validate voice parameter

  - [x] 3.1 Modify `app/api/dj-tts/route.ts` to extract `voice` from request body, validate against `DJ_VOICE_IDS`, fall back to `DEFAULT_DJ_VOICE`, and forward to Venice AI for English requests

    - Import `DJ_VOICE_IDS` and `DEFAULT_DJ_VOICE` from `@/shared/constants/djVoices`
    - Extract `voice` from the parsed request body alongside `text` and `language`
    - For English: validate `voice` against `DJ_VOICE_IDS`, fall back to `DEFAULT_DJ_VOICE` if invalid/missing
    - Replace hardcoded `ENGLISH_TTS_VOICE` with the resolved voice in the Venice AI request body
    - Vietnamese path unchanged — continues using `Vivian` with `tts-qwen3-0-6b`
    - _Requirements: 2.3, 2.4, 2.5, 4.3, 4.4_

  - [ ]\* 3.2 Write property test: TTS route forwards valid English voice to Venice AI

    - **Property 4: TTS route forwards valid English voice to Venice AI**
    - **Validates: Requirements 2.3, 2.4**

  - [ ]\* 3.3 Write property test: Vietnamese TTS ignores voice field

    - **Property 5: Vietnamese TTS ignores voice field**
    - **Validates: Requirements 2.5**

  - [ ]\* 3.4 Write property test: TTS route falls back to default for invalid English voice
    - **Property 7: TTS route falls back to default for invalid English voice**
    - **Validates: Requirements 4.3, 4.4**

- [x] 4. Checkpoint

  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Create DJVoiceSelect UI component

  - [x] 5.1 Create `app/[username]/admin/components/dashboard/components/dj-voice-select.tsx` following the same pattern as `DJLanguageSelect`

    - Button-style pill selector rendering options from `DJ_VOICES`
    - Read `djMode`, `djLanguage`, `djVoice` from localStorage on mount
    - Default to `DEFAULT_DJ_VOICE` if `djVoice` is absent or not in `DJ_VOICE_IDS`
    - Listen for `storage`, `djmode-changed`, `djlanguage-changed`, and `djvoice-changed` events to re-sync state
    - Render only when DJ Mode is enabled AND language is English
    - On selection: update state, write to `localStorage["djVoice"]`, call `DJService.getInstance().invalidatePrefetch()`, dispatch `djvoice-changed` custom event
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 3.1, 3.2_

  - [ ]\* 5.2 Write property test: Voice selector visibility depends on DJ Mode and language

    - **Property 1: Voice selector visibility depends on DJ Mode and language**
    - **Validates: Requirements 1.1, 1.6, 1.7**

  - [ ]\* 5.3 Write property test: Voice localStorage round-trip

    - **Property 2: Voice localStorage round-trip**
    - **Validates: Requirements 1.3, 1.4, 1.5**

  - [ ]\* 5.4 Write property test: Voice change triggers prefetch invalidation and custom event
    - **Property 6: Voice change triggers prefetch invalidation and custom event**
    - **Validates: Requirements 3.1, 3.2**

- [x] 6. Wire DJVoiceSelect into the dashboard

  - [x] 6.1 Export `DJVoiceSelect` from the barrel file at `app/[username]/admin/components/dashboard/components/index.ts`

    - Add `export * from './dj-voice-select'` to the barrel file
    - _Requirements: 1.1_

  - [x] 6.2 Render `DJVoiceSelect` in the dashboard DJ settings area, after the language selector and before the frequency selector
    - Import and place the component in the appropriate location in the dashboard tab
    - _Requirements: 1.1_

- [x] 7. Update DJLanguageSelect to dispatch language change event

  - [x] 7.1 Modify `dj-language-select.tsx` to dispatch a `djlanguage-changed` custom event in `handleSelect` so `DJVoiceSelect` can react to language changes
    - Add `window.dispatchEvent(new Event('djlanguage-changed'))` after setting localStorage
    - _Requirements: 1.7_

- [x] 8. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties from the design document
- The implementation language is TypeScript throughout, matching the existing codebase
