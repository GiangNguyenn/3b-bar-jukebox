# Requirements Document

## Introduction

DJ Mode currently generates AI voice announcements between tracks using a hardcoded "laid back, relaxed and chill DJ" personality in the English system prompt. This feature introduces 6 selectable DJ personality options that alter the tone and script style of the generated announcements. The personality selector appears in the admin dashboard alongside the existing voice selector, only when DJ Mode is enabled and the language is set to English.

## Glossary

- **Personality_Selector**: A UI component in the admin dashboard jukebox section that displays the available DJ personality options as toggle buttons, following the same pattern as the existing DJ Voice selector.
- **DJ_Personality**: A named personality option (e.g. "Chill", "Hype", "Smooth", "Witty", "Old_School", "Storyteller") that defines the tone and style of the DJ script system prompt sent to Venice AI.
- **Personality_Constants**: A shared constants file (`shared/constants/djPersonalities.ts`) defining the 6 personality options with their IDs, display labels, and system prompt fragments, following the same pattern as `djVoices.ts`.
- **Script_Generator**: The `/api/dj-script` API route that generates DJ announcement scripts via Venice AI, currently using a hardcoded English system prompt.
- **DJService**: The client-side singleton service (`services/djService.ts`) that manages DJ state, prefetching, and audio playback.
- **Default_Personality**: The "Chill" personality, which preserves the current hardcoded behavior and is used when no personality is explicitly selected.

## Requirements

### Requirement 1: Define Personality Constants

**User Story:** As a developer, I want DJ personality options defined in a shared constants file, so that the UI and API can reference the same set of personalities consistently.

#### Acceptance Criteria

1. THE Personality_Constants file SHALL define exactly 6 DJ_Personality options, each with a unique string ID, a display label, and a system prompt fragment describing the tone and style.
2. THE Personality_Constants file SHALL export a default personality ID matching the "Chill" personality.
3. THE Personality_Constants file SHALL export a list of all valid personality IDs for validation purposes.
4. THE Personality_Constants file SHALL follow the same structure and export pattern as the existing `djVoices.ts` constants file.

### Requirement 2: Personality Selector UI

**User Story:** As a venue owner, I want to choose a DJ personality from the admin dashboard, so that the AI announcements match the vibe of my venue.

#### Acceptance Criteria

1. WHEN DJ Mode is enabled AND the DJ language is set to English, THE Personality_Selector SHALL display 6 personality options as toggle buttons.
2. WHEN DJ Mode is disabled OR the DJ language is not English, THE Personality_Selector SHALL not render.
3. WHEN the venue owner selects a DJ_Personality, THE Personality_Selector SHALL persist the selection to localStorage under the key `djPersonality`.
4. WHEN the venue owner selects a DJ_Personality, THE Personality_Selector SHALL call `DJService.invalidatePrefetch()` to discard any stale prefetched audio.
5. WHEN no DJ_Personality has been previously selected, THE Personality_Selector SHALL display the Default_Personality ("Chill") as the active selection.
6. THE Personality_Selector SHALL follow the same visual style and component pattern as the existing DJ Voice selector (green active button, gray inactive buttons, `text-xs` toggle buttons with `flex-wrap`).

### Requirement 3: Persist and Transmit Personality Selection

**User Story:** As a venue owner, I want my personality selection to persist across page reloads, so that I do not need to re-select it each session.

#### Acceptance Criteria

1. WHEN the admin dashboard loads, THE Personality_Selector SHALL read the stored personality from localStorage and restore the selection.
2. WHEN the stored personality value in localStorage is missing or not a valid personality ID, THE Personality_Selector SHALL fall back to the Default_Personality.
3. WHEN the DJService fetches a DJ script, THE DJService SHALL read the current personality from localStorage and include it in the request body sent to the Script_Generator API.

### Requirement 4: Inject Personality into Script Generation

**User Story:** As a venue owner, I want the selected personality to change how the DJ speaks, so that announcements feel distinct based on my choice.

#### Acceptance Criteria

1. WHEN the Script_Generator receives a request with a valid `personality` field, THE Script_Generator SHALL use the corresponding system prompt fragment from Personality_Constants to construct the English system prompt.
2. WHEN the Script_Generator receives a request with a missing or invalid `personality` field, THE Script_Generator SHALL use the Default_Personality system prompt fragment.
3. THE Script_Generator SHALL only apply personality-based prompt modification for English language requests; Vietnamese language requests SHALL continue to use the existing fixed Vietnamese system prompt.
4. THE Script_Generator SHALL replace the hardcoded "laid back, relaxed and chill DJ" phrase in the English system prompt with the tone description from the selected DJ_Personality.

### Requirement 5: Integrate Personality Selector into Jukebox Section

**User Story:** As a venue owner, I want the personality selector to appear in the natural flow of DJ settings, so that it is easy to find and configure.

#### Acceptance Criteria

1. THE Jukebox_Section SHALL render the Personality_Selector between the DJ Voice selector and the Duck Overlay toggle.
2. WHEN the DJ language changes, THE Personality_Selector SHALL reactively show or hide based on whether the new language is English.
3. WHEN the DJ Mode toggle changes, THE Personality_Selector SHALL reactively show or hide based on whether DJ Mode is enabled.

### Requirement 6: Dispatch Personality Change Event

**User Story:** As a developer, I want personality changes to emit a custom DOM event, so that other components can react to the change consistently with the existing DJ settings pattern.

#### Acceptance Criteria

1. WHEN the venue owner selects a new DJ_Personality, THE Personality_Selector SHALL dispatch a `djpersonality-changed` custom event on the `window` object.
2. THE Personality_Selector SHALL listen for `djmode-changed`, `djlanguage-changed`, and `djpersonality-changed` events to keep its displayed state in sync.
