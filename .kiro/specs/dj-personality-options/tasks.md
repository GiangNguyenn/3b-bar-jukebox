# Implementation Plan: DJ Personality Options

## Overview

Add 6 selectable DJ personality options following the established DJ Voice pattern: shared constants → UI selector → localStorage persistence → DJService transmits → API route consumes. The implementation proceeds bottom-up from constants through service layer to UI, wiring everything together at the end.

## Tasks

- [x] 1. Create personality constants file

  - [x] 1.1 Create `shared/constants/djPersonalities.ts`

    - Define `DJPersonalityOption` interface with `value`, `label`, and `prompt` fields
    - Export `DEFAULT_DJ_PERSONALITY` as `'chill'`
    - Export `DJ_PERSONALITIES` array with 6 entries: Chill, Hype, Smooth, Witty, Old School, Storyteller
    - Export `DJ_PERSONALITY_IDS` derived from the array
    - Follow the same structure and export pattern as `shared/constants/djVoices.ts`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 1.2 Write property test for personality ID list consistency

    - **Property 1: Personality ID list consistency**
    - **Validates: Requirements 1.3**
    - Create `shared/constants/__tests__/djPersonalities.test.ts`
    - Use `fast-check` with `node:test` runner (see `aiSuggestion.test.ts` for pattern)
    - Verify every `DJ_PERSONALITIES` entry has its `value` in `DJ_PERSONALITY_IDS`, lengths match, and every ID maps back to an entry

  - [x] 1.3 Write unit tests for personality constants

    - Verify exactly 6 personalities are defined (Req 1.1)
    - Verify default personality ID is `'chill'` (Req 1.2)
    - Verify all IDs are unique strings and all prompts are non-empty
    - _Requirements: 1.1, 1.2_

  - [x] 1.4 Write property test for personality resolution round-trip
    - **Property 2: Personality resolution round-trip**
    - **Validates: Requirements 3.1, 3.2**
    - Add to `shared/constants/__tests__/djPersonalities.test.ts`
    - For any valid personality ID, storing and resolving returns the same ID
    - For any invalid string or missing key, resolving returns `DEFAULT_DJ_PERSONALITY`

- [x] 2. Checkpoint — Ensure all tests pass

  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Modify DJService to read and transmit personality

  - [x] 3.1 Update `services/djService.ts` `_doFetchAudioBlob` method
    - Import `DJ_PERSONALITY_IDS` and `DEFAULT_DJ_PERSONALITY` from `@/shared/constants/djPersonalities`
    - After reading `djVoice` from localStorage, read `djPersonality` and resolve it (validate against `DJ_PERSONALITY_IDS`, fall back to default)
    - Include `personality: resolvedPersonality` in the `/api/dj-script` request body
    - _Requirements: 3.2, 3.3_

- [x] 4. Inject personality into script generation API

  - [x] 4.1 Update `app/api/dj-script/route.ts` to use personality

    - Import `DJ_PERSONALITY_IDS`, `DEFAULT_DJ_PERSONALITY`, and `DJ_PERSONALITIES` from `@/shared/constants/djPersonalities`
    - Extract `personality` from request body
    - Resolve personality: validate against `DJ_PERSONALITY_IDS`, fall back to `DEFAULT_DJ_PERSONALITY`
    - Look up the `prompt` fragment from `DJ_PERSONALITIES`
    - Replace the hardcoded `"laid back, relaxed and chill DJ"` in the English system prompt with `${personalityPrompt} DJ`
    - Leave Vietnamese prompt completely untouched
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 4.2 Write property test for English prompt personality injection

    - **Property 5: English prompt contains resolved personality fragment**
    - **Validates: Requirements 4.1, 4.2, 4.4**
    - Create `app/api/dj-script/__tests__/route.test.ts`
    - For any valid personality ID, the constructed English prompt must contain that personality's prompt fragment
    - For any invalid or missing personality, the prompt must contain the default (`'chill'`) fragment
    - When a non-chill personality is selected, `"laid back, relaxed and chill"` must not appear

  - [x] 4.3 Write property test for Vietnamese prompt isolation
    - **Property 6: Vietnamese prompt isolation**
    - **Validates: Requirements 4.3**
    - Add to `app/api/dj-script/__tests__/route.test.ts`
    - For any personality value (valid or invalid), when language is `'vietnamese'`, the system prompt must be the fixed Vietnamese prompt and must not contain any English personality prompt fragment

- [x] 5. Checkpoint — Ensure all tests pass

  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Create personality selector UI component

  - [x] 6.1 Create `app/[username]/admin/components/dashboard/components/dj-personality-select.tsx`
    - `'use client'` component following the exact pattern of `dj-voice-select.tsx`
    - State: `djEnabled`, `language`, `personality` — synced from localStorage via `useEffect`
    - Listen for `djmode-changed`, `djlanguage-changed`, `djpersonality-changed` events
    - Return `null` when `!djEnabled || language !== 'english'`
    - `handleSelect(value)`: set state, write to `localStorage('djPersonality')`, call `DJService.getInstance().invalidatePrefetch()`, dispatch `djpersonality-changed` event
    - Render toggle buttons with green active / gray inactive styling matching voice selector
    - Default to `'chill'` when no stored personality or stored value is invalid
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 6.1, 6.2_

- [x] 7. Integrate personality selector into jukebox section

  - [x] 7.1 Update `app/[username]/admin/components/dashboard/components/jukebox-section.tsx`

    - Import `DJPersonalitySelect` from `./dj-personality-select`
    - Render `<DJPersonalitySelect />` between `<DJVoiceSelect />` and `<DuckOverlayToggle />`
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 7.2 Export personality selector from dashboard components index
    - Add export for `DJPersonalitySelect` in `app/[username]/admin/components/dashboard/components/index.ts`
    - _Requirements: 5.1_

- [x] 8. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Test runner: `node:test` via `tsx --test` with `fast-check` for property-based tests
