# Implementation Plan: Dynamic Admin Page Migration

## Objective

Migrate the legacy admin page to dynamic routing (`/[username]/admin`), ensuring:
- All original admin features are preserved.
- The UI/UX and component structure match the mainline version.
- The codebase adheres to the architecture and best practices outlined in `architecture-decisions.md`.

---

## 1. **Preparation & Analysis**

- [x] **Review Mainline Admin Page**
  - The mainline admin page (`app/admin/page.tsx`) uses a top-level structure with `ConsoleLogsProvider`, `ProtectedRoute`, and `Suspense` for loading states.
  - The main content is rendered by `AdminPageContent`, which logs mount/unmount events and renders a basic admin dashboard layout.
  - Key components and features include:
    - `ConsoleLogsProvider` for logging.
    - `ProtectedRoute` for authentication.
    - `AdminPageContent` for rendering the main dashboard content.
    - Dashboard tab includes:
      - Status indicators (device, playback, token, playlist).
      - Playback controls.
      - Uptime display.
      - Console logs.
      - Error boundaries.
    - Playlist tab includes:
      - Playlist display with track management.
    - Track Suggestions tab includes:
      - Various selectors for genres, year range, popularity, etc.
      - Last suggested track display.

- [x] **Audit Current Dynamic Admin Implementation**
  - The dynamic admin implementation (`app/[username]/admin/page.tsx`) mirrors the mainline structure but includes dynamic routing with a `username` parameter.
  - Key components and features include:
    - `ConsoleLogsProvider` and `ProtectedRoute` for logging and authentication.
    - `AdminPageContent` for rendering the main dashboard content with dynamic routing.
    - Tab-based navigation for Dashboard, Queue, and Track Suggestions.
    - Dashboard tab includes:
      - Now Playing section.
      - Playlist display with track management.
      - Track suggestions with state management.
      - Player status indicators.
    - Queue tab displays the user's queue with track details.
    - Track Suggestions tab allows adding and displaying track suggestions.
  - Missing or incomplete features compared to mainline:
    - Some dashboard subcomponents (e.g., status indicators, playback controls) may need further implementation or alignment with mainline.
    - Ensure all hooks and utility functions are available and compatible.

---

## 2. **Routing & Entry Point**

- [x] **Ensure Dynamic Route Exists**
  - The dynamic route is set up in `app/[username]/admin/page.tsx`, which includes the `username` parameter.
  - The `AdminPage` component correctly handles the `username` parameter and renders the `AdminPageContent` with it.

- [x] **Authentication & Authorization**
  - Ensure only authenticated users can access `/[username]/admin`.
  - Redirect unauthenticated users to sign-in.

---

## 3. **Component Parity & Refactoring**

- [x] **Dashboard Component Structure**
  - Replicate the mainline dashboard layout and tabs (Dashboard, Queue, Track Suggestions).
  - Ensure all dashboard subcomponents are present:
    - Status indicators (device, playback, token, playlist)
    - Playback controls
    - Uptime display
    - Console logs
    - Error boundaries

- [x] **Component Migration/Creation**
  - For each mainline component (e.g., `status-grid.tsx`, `playback-controls.tsx`, etc.):
    - [x] Copy or refactor into `app/[username]/admin/components/dashboard/components/`.
    - [x] Update imports/exports to use barrel files (`index.ts`).
    - [x] Ensure all hooks and utility functions are available and compatible.

- [x] **Tab Layout**
  - Implement tab navigation using the same UI library as mainline (e.g., Radix UI Tabs).
  - Ensure each tab loads the correct content/component.

---

## 4. **Feature Parity**

- [x] **Playlist Management**
  - Ensure playlist display, refresh, and track management features are present.
  - Integrate with `/api/playlists` and `/api/track-suggestions` endpoints.

- [x] **Track Suggestions**
  - Implement the track suggestions tab and related state management.
  - Ensure suggestions can be added, displayed, and managed as in mainline.

- [x] **Queue Management**
  - Implement queue display and management features.

- [x] **Playback Controls**
  - Integrate Spotify Web Playback SDK for playback controls.
  - Ensure device selection, play/pause, skip, and volume controls work.

- [x] **Status & Health Monitoring**
  - Implement status indicators for device, playback, token, and playlist health.
  - Integrate with health monitoring hooks/services.

- [x] **Console Logs & Error Boundaries**
  - Integrate the mainline console log provider and error boundary components.

---

## 5. **Data Fetching & State Management**

- [x] **SWR Integration**
  - Use SWR for client-side data fetching as per architecture decisions.
  - Ensure all data fetching hooks are compatible with dynamic routing.

- [x] **Token Management**
  - [x] Ensure tokens are refreshed and stored according to NextAuth and Supabase integration
  - [x] Update database tokens as needed

---

## 6. **Styling & UI Consistency**

- [x] **Tailwind & UI Library**
  - Ensure all components use Tailwind CSS and the same UI library as mainline
  - Match spacing, colors, and responsive design

- [ ] **Accessibility & Responsiveness**
  - Test all components for accessibility and mobile responsiveness

---

## 7. **Testing & Validation**

- [ ] **Unit & Integration Tests**
  - Write/port tests for all critical components and hooks.
  - Ensure authentication, playlist, and playback flows are covered.

- [ ] **Manual QA**
  - Test all admin features as an authenticated user.
  - Validate error handling, edge cases, and UI consistency.

---

## 8. **Documentation & Cleanup**

- [ ] **Update Documentation**
  - Document new/changed components and hooks.
  - Update README and architecture docs as needed.

- [ ] **Remove Deprecated Code**
  - Delete old admin page files and unused components.

---

## 9. **Deployment**

- [ ] **Staging Deployment**
  - Deploy to a staging environment for final validation.

- [ ] **Production Rollout**
  - Merge to main branch and deploy to production.

---

## 10. **Post-Migration Monitoring**

- [ ] **Monitor Logs & Errors**
  - Use Sentry and console logs to monitor for issues post-deployment.

- [ ] **Gather User Feedback**
  - Collect feedback from admin users and iterate as needed.

---

## Notes

- **Keep all original features:** No feature regressions are allowed.
- **Dynamic routing:** All admin functionality must work under `/[username]/admin`.
- **Architecture alignment:** Follow all patterns and decisions in `architecture-decisions.md`. 