# Requirements Document

## Introduction

Add a "Drinking Anthems" preset to the AI track suggestions feature. This preset targets songs about beer, pubs, bars, and drinking culture. It becomes the default preset when no prior selection has been persisted, making it the go-to vibe for the jukebox's bar-centric audience.

## Glossary

- **Preset_Prompt_Selector**: The UI component that renders the grid of available music vibe presets for the venue owner to choose from.
- **PRESET_PROMPTS**: The constant array in `shared/constants/aiSuggestion.ts` that defines all available preset prompt objects.
- **PresetPrompt**: A data object with `id`, `label`, `emoji`, and `prompt` fields representing a single music vibe preset.
- **AI_Suggestions_Hook**: The `useAiSuggestions` React hook that manages AI suggestion state including the selected preset, custom prompt, and auto-fill target size.
- **Active_Prompt**: The derived prompt string used for AI track suggestion requests, resolved from either the custom prompt or the selected preset's prompt.
- **Default_Preset**: The preset automatically selected when no prior state exists in localStorage, determined by the first element of the PRESET_PROMPTS array.

## Requirements

### Requirement 1: Drinking Anthems Preset Definition

**User Story:** As a venue owner, I want a "Drinking Anthems" music vibe preset available in the AI suggestions tab, so that I can quickly generate song suggestions themed around beer, pubs, bars, and drinking.

#### Acceptance Criteria

1. THE PRESET_PROMPTS array SHALL contain a PresetPrompt entry with `id` set to `'drinking-anthems'`, `label` set to `'Drinking Anthems'`, and `emoji` set to `'🍺'`.
2. THE Drinking Anthems PresetPrompt `prompt` field SHALL reference songs about beer, pubs, bars, and drinking culture.
3. THE Preset_Prompt_Selector SHALL render the Drinking Anthems preset as a selectable button alongside all other presets.

### Requirement 2: Default Preset Behavior

**User Story:** As a venue owner opening the AI suggestions tab for the first time, I want the Drinking Anthems preset to be selected by default, so that the jukebox is immediately tuned to the bar atmosphere without manual configuration.

#### Acceptance Criteria

1. THE Drinking Anthems PresetPrompt SHALL be the first element (index 0) in the PRESET_PROMPTS array.
2. WHEN no prior AI suggestions state exists in localStorage, THE AI_Suggestions_Hook SHALL initialize `selectedPresetId` to the Drinking Anthems preset id (`'drinking-anthems'`).
3. WHEN no prior AI suggestions state exists in localStorage, THE Active_Prompt SHALL resolve to the Drinking Anthems preset prompt text.

### Requirement 3: Existing Preset Preservation

**User Story:** As a venue owner who has already configured a different preset, I want my previous selection to persist, so that adding the new default does not override my saved preference.

#### Acceptance Criteria

1. WHEN prior AI suggestions state exists in localStorage with a valid `selectedPresetId`, THE AI_Suggestions_Hook SHALL restore that saved preset selection instead of defaulting to Drinking Anthems.
2. THE PRESET_PROMPTS array SHALL continue to contain all 11 previously existing presets with unchanged `id`, `label`, `emoji`, and `prompt` values.
