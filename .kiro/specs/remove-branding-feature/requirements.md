# Requirements Document

## Introduction

Remove the branding customization feature from 3B Jukebox entirely. The branding feature allows venue owners to customize colors, logos, typography, SEO metadata, and text on their public jukebox pages. This feature is being deprecated and all associated code, API routes, services, stores, hooks, UI components, and database references must be deleted. The public playlist page must revert to using hardcoded default styling instead of fetching branding settings from the database.

## Glossary

- **Admin_Dashboard**: The venue owner management interface at `/{username}/admin`, organized into tabs (dashboard, playlist, analytics, branding, subscription)
- **Branding_Tab**: The admin dashboard tab containing UI for customizing venue appearance (colors, logos, typography, text, SEO)
- **Branding_Store**: The Zustand store (`stores/brandingStore.ts`) managing client-side branding state
- **Branding_Service**: The server-side service (`services/brandingService.ts`) handling branding CRUD operations against Supabase
- **Branding_API**: The set of API routes under `app/api/branding/` (settings, reset, public) serving branding data
- **Public_Playlist_Page**: The patron-facing page at `/{username}/playlist` that currently applies branding styles dynamically
- **Subscription_Tab**: The admin tab displaying free/premium tier feature comparisons, which currently lists branding as a premium feature
- **Supabase_Types**: The auto-generated TypeScript types in `types/supabase.ts` reflecting the database schema

## Requirements

### Requirement 1: Delete Branding Admin UI Components

**User Story:** As a developer, I want to remove all branding admin UI components, so that the deprecated branding feature no longer ships in the application bundle.

#### Acceptance Criteria

1. WHEN the branding feature is removed, THE Build_System SHALL produce a successful build with no references to deleted branding modules
2. THE Admin_Dashboard SHALL exclude the branding tab from its tab list and tab content
3. THE Admin_Dashboard SHALL remove the `'branding'` value from the `activeTab` union type
4. THE Admin_Dashboard SHALL remove the import of `BrandingTab` from `./components/branding/branding-tab`

### Requirement 2: Delete Branding Component Directory

**User Story:** As a developer, I want to delete the entire branding component directory, so that no deprecated branding UI code remains in the codebase.

#### Acceptance Criteria

1. WHEN the branding feature is removed, THE Codebase SHALL contain no files under `app/[username]/admin/components/branding/`
2. THE Codebase SHALL contain no files matching the following paths: `branding-tab.tsx`, `error-boundary.tsx`, `loading-states.tsx`, `types.ts`, `hooks/useBrandingSettings.ts`, `hooks/useImageToBase64.ts`, `sections/colors-section.tsx`, `sections/logo-section.tsx`, `sections/seo-section.tsx`, `sections/text-section.tsx`, `sections/typography-section.tsx`, `utils/default-settings.ts`, `validation/branding-validation.ts`

### Requirement 3: Delete Branding API Routes

**User Story:** As a developer, I want to remove all branding API routes, so that no server endpoints for branding data remain.

#### Acceptance Criteria

1. WHEN the branding feature is removed, THE Codebase SHALL contain no files under `app/api/branding/`
2. THE Codebase SHALL contain no API route handlers for branding settings retrieval, update, reset, or public access

### Requirement 4: Delete Branding Service

**User Story:** As a developer, I want to remove the branding service, so that no server-side branding business logic remains.

#### Acceptance Criteria

1. WHEN the branding feature is removed, THE Codebase SHALL contain no `services/brandingService.ts` file
2. THE Codebase SHALL contain no imports referencing `BrandingService`

### Requirement 5: Delete Branding Store

**User Story:** As a developer, I want to remove the branding Zustand store, so that no client-side branding state management remains.

#### Acceptance Criteria

1. WHEN the branding feature is removed, THE Codebase SHALL contain no `stores/brandingStore.ts` file
2. THE Codebase SHALL contain no imports referencing `useBrandingStore`

### Requirement 6: Delete Public Branding Hook

**User Story:** As a developer, I want to remove the public branding hook, so that no client-side branding data fetching logic remains.

#### Acceptance Criteria

1. WHEN the branding feature is removed, THE Codebase SHALL contain no `hooks/usePublicBranding.ts` file
2. THE Codebase SHALL contain no imports referencing `usePublicBranding`

### Requirement 7: Revert Public Playlist Page to Default Styling

**User Story:** As a venue patron, I want the playlist page to display with consistent default styling, so that the page loads without depending on branding settings.

#### Acceptance Criteria

1. THE Public_Playlist_Page SHALL use hardcoded default values for all visual properties: background color `#000000`, text color `#ffffff`, font family `Belgrano`, primary color `#C09A5E`, secondary color `#191414`
2. THE Public_Playlist_Page SHALL display the default logo from `/logo.png`
3. THE Public_Playlist_Page SHALL display `3B Jukebox` as the venue name heading
4. THE Public_Playlist_Page SHALL remove all dynamic branding style computation (gradient logic, font size mapping, custom footer, welcome message overlay)
5. THE Public_Playlist_Page SHALL remove the branding loading state gate that blocks page render while branding data loads
6. THE Public_Playlist_Page SHALL remove the dynamic page title, meta description, and Open Graph title update logic that reads from branding settings

### Requirement 8: Update Subscription Tab Feature List

**User Story:** As a venue owner, I want the subscription comparison to accurately reflect available features, so that I see only features that exist in the product.

#### Acceptance Criteria

1. THE Subscription_Tab SHALL remove "Branding customization" from both the free tier and premium tier feature lists

### Requirement 9: Update Test References

**User Story:** As a developer, I want tests to pass after branding removal, so that the test suite remains green.

#### Acceptance Criteria

1. WHEN the branding feature is removed, THE Test_Suite SHALL contain no references to branding file paths in test assertions
2. THE `lib/__tests__/supabase-client-consolidation.test.ts` file SHALL remove the branding hook path from its file list assertion

### Requirement 10: Create Database Migration to Drop Branding Table

**User Story:** As a developer, I want to drop the `branding_settings` table from the database, so that no unused data structures remain.

#### Acceptance Criteria

1. WHEN the migration is applied, THE Database SHALL no longer contain the `branding_settings` table
2. THE Migration SHALL drop all associated RLS policies before dropping the table
3. THE Migration SHALL drop the `update_branding_settings_updated_at` trigger and function
4. THE Migration SHALL be idempotent by using `IF EXISTS` clauses
