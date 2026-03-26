# Implementation Plan: Drinking Anthems Preset

## Overview

Prepend a new "Drinking Anthems" `PresetPrompt` entry to the `PRESET_PROMPTS` array at index 0 in `shared/constants/aiSuggestion.ts`, then add unit and property-based tests in `shared/constants/__tests__/aiSuggestion.test.ts`. No other files need modification — the hook, UI, types, and API all consume the array generically.

## Tasks

- [x] 1. Add Drinking Anthems preset to PRESET_PROMPTS array

  - [x] 1.1 Prepend the new PresetPrompt entry at index 0 of the `PRESET_PROMPTS` array in `shared/constants/aiSuggestion.ts`

    - Add `{ id: 'drinking-anthems', label: 'Drinking Anthems', emoji: '🍺', prompt: 'Classic drinking songs, pub anthems, and bar singalongs. Songs about beer, whiskey, pubs, bars, and drinking culture from rock, country, folk, and pop.' }` as the first element
    - All 11 existing presets remain in the array unchanged, shifted to indices 1–11
    - _Requirements: 1.1, 1.2, 2.1, 3.2_

  - [x] 1.2 Write unit tests for the Drinking Anthems preset entry

    - Assert `PRESET_PROMPTS[0].id === 'drinking-anthems'`, `label === 'Drinking Anthems'`, `emoji === '🍺'`
    - Assert `PRESET_PROMPTS[0].prompt` contains references to beer, pubs, bars, and drinking culture
    - Assert `PRESET_PROMPTS.length === 12`
    - Assert default `selectedPresetId` (from `PRESET_PROMPTS[0].id`) equals `'drinking-anthems'` when no localStorage state exists
    - Assert `deriveActivePrompt('drinking-anthems', '')` returns the drinking anthems prompt text
    - Tests go in `shared/constants/__tests__/aiSuggestion.test.ts`
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3_

  - [x] 1.3 Write property test: Original presets preserved

    - **Property 1: Original presets preserved**
    - For each of the 11 originally existing preset IDs, assert the preset still exists in `PRESET_PROMPTS` with unchanged `id`, `label`, `emoji`, and `prompt` fields
    - Tests go in `shared/constants/__tests__/aiSuggestion.test.ts`
    - **Validates: Requirements 3.2**

  - [x] 1.4 Write property test: Saved preset selection restored over default
    - **Property 2: Saved preset selection restored over default**
    - For any valid preset ID from `PRESET_PROMPTS`, construct a serialized `AiSuggestionsState` with that ID as `selectedPresetId`, verify that restoring from that state yields the saved ID rather than the default `PRESET_PROMPTS[0].id`
    - Tests go in `shared/constants/__tests__/aiSuggestion.test.ts`
    - **Validates: Requirements 3.1**

- [x] 2. Final checkpoint
  - Ensure all tests pass (`yarn test`), ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The only production code change is a single array prepend in `shared/constants/aiSuggestion.ts`
- All downstream consumers (PresetPromptSelector, useAiSuggestions hook, deriveActivePrompt) work generically over the array and require zero changes
- Property tests use `fast-check` with the Node.js built-in test runner (`node:test`)
- Code style: single quotes, no semicolons, no trailing commas
