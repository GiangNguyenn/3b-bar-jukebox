# Track Suggestions Genre Implementation Guide

## Overview

This guide provides a step-by-step implementation for integrating genre selection into the track suggestions service. The implementation ensures that:

1. Selected genres from the UI component are passed through the application chain
2. FALLBACK_GENRES are used when no genres are selected
3. Genre selections are properly synchronized between components
4. State updates are handled efficiently

## UI Component Guidelines

When implementing or modifying UI components:

1. **Maintain Existing Styling**

   - Use basic HTML elements with Tailwind CSS classes
   - Preserve existing component structure and layout
   - Avoid introducing new UI libraries or complex components

2. **Component Structure**

   - Keep components simple and functional
   - Use standard HTML form elements
   - Maintain consistent spacing and typography

3. **Styling Approach**

   - Use Tailwind utility classes for styling
   - Avoid custom CSS unless absolutely necessary
   - Maintain existing color scheme and design patterns

4. **Accessibility**
   - Ensure proper ARIA attributes
   - Maintain keyboard navigation
   - Keep focus management simple

## Prerequisites

- Next.js 14+ project with App Router
- Existing track suggestions service
- FALLBACK_GENRES constant defined
- Spotify API integration

## Implementation Steps

### Step 1: TrackSuggestionsTab Component

**Guidance:**

- Use React useState for genre management
- Initialize state with FALLBACK_GENRES
- Pass genres and setter to child components
- Handle genre change events
- Implement state persistence using localStorage

**Acceptance Criteria:**

- [ ] Genres are initialized with FALLBACK_GENRES
- [ ] State updates trigger UI re-renders
- [ ] Genre updates are handled correctly
- [ ] State is properly passed to child components
- [ ] Selected genres persist when navigating between tabs
- [ ] State is preserved during page refreshes
- [ ] State is restored from localStorage on component mount
- [ ] State is saved to localStorage on changes

### Step 2: GenresSelector Component

**Guidance:**

- Create a controlled multiple select component
- Use FALLBACK_GENRES for options
- Implement proper change handling
- Add visual feedback for selected genres

**Acceptance Criteria:**

- [ ] Multiple genre selection works correctly
- [ ] Selected genres are visually indicated
- [ ] Changes trigger parent component updates
- [ ] Component is fully accessible
- [ ] Mobile-friendly interaction

### Step 3: Admin Page Integration

**Guidance:**

- Access genres from TrackSuggestionsTab
- Format genres for API request
- Handle refresh button click
- Manage loading states

**Acceptance Criteria:**

- [ ] Genres are correctly encoded for API
- [ ] Refresh requests include current genres
- [ ] Loading states are properly managed
- [ ] Error states are handled gracefully

### Step 4: API Route Implementation

**Guidance:**

- Parse genres from query parameters
- Validate genre data
- Pass genres to PlaylistRefresh service
- Handle error cases

**Acceptance Criteria:**

- [ ] Genres are correctly parsed from URL
- [ ] Invalid genre data is handled
- [ ] Genres are properly passed to service
- [ ] Error responses are meaningful

### Step 5: PlaylistRefresh Service

**Guidance:**

- Accept genres as parameter
- Pass genres to TrackSuggestion service
- Handle genre-based refresh logic
- Update diagnostic info

**Acceptance Criteria:**

- [ ] Genres are correctly passed through
- [ ] Refresh logic considers genres
- [ ] Diagnostic info includes genres
- [ ] Error handling is comprehensive

### Step 6: TrackSuggestion Service

**Guidance:**

- Accept genres as parameter
- Use genres for track search
- Fallback to FALLBACK_GENRES when needed
- Log genre usage

**Acceptance Criteria:**

- [ ] Selected genres are used when available
- [ ] FALLBACK_GENRES are used appropriately
- [ ] Genre selection affects track results
- [ ] Logging is informative

## Testing Checklist

1. State Management

   - [ ] Verify genres are initialized with FALLBACK_GENRES
   - [ ] Test genre updates
   - [ ] Verify state updates trigger UI changes

2. Track Suggestions

   - [ ] Test suggestions with selected genres
   - [ ] Test suggestions with FALLBACK_GENRES
   - [ ] Verify error handling

3. Integration
   - [ ] Test genre selection affects track suggestions
   - [ ] Test error recovery

## Error Handling Guidelines

1. State Updates

   - Handle errors in genre updates
   - Show user-friendly error messages
   - Maintain consistent state

2. Service Layer
   - Handle API errors gracefully
   - Implement proper fallbacks
   - Log errors appropriately

## Logging Guidelines

1. State Changes

   - Log genre updates
   - Log initialization
   - Log fallback scenarios

2. Track Suggestions
   - Log genre selection
   - Log search attempts
   - Log fallback usage

## Notes

1. Architecture

   - Proper data flow through the application chain
   - Efficient state updates
   - Clear separation of concerns

2. Safety Features

   - Error handling
   - Fallback mechanisms
   - State consistency

3. Performance
   - Instant UI updates
   - Efficient state management
   - Clear data flow
