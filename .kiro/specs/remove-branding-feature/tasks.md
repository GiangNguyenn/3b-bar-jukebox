# Implementation Plan: Remove Branding Feature

## Overview

Delete all branding-related code from 3B Jukebox in dependency order (leaf-first), refactor the public playlist page to use hardcoded defaults, update the subscription tab and test references, and create a database migration to drop the `branding_settings` table.

## Tasks

- [x] 1. Delete branding leaf dependencies

  - [x] 1.1 Delete the entire `app/[username]/admin/components/branding/` directory

    - Remove all 13 files: `branding-tab.tsx`, `error-boundary.tsx`, `loading-states.tsx`, `types.ts`, `hooks/useBrandingSettings.ts`, `hooks/useImageToBase64.ts`, `sections/colors-section.tsx`, `sections/logo-section.tsx`, `sections/seo-section.tsx`, `sections/text-section.tsx`, `sections/typography-section.tsx`, `utils/default-settings.ts`, `validation/branding-validation.ts`
    - _Requirements: 2.1, 2.2_

  - [x] 1.2 Delete the branding API routes directory `app/api/branding/`

    - Remove `settings/route.ts`, `reset/route.ts`, `public/[username]/route.ts`, `public/test/route.ts`
    - _Requirements: 3.1, 3.2_

  - [x] 1.3 Delete the branding service `services/brandingService.ts`

    - _Requirements: 4.1, 4.2_

  - [x] 1.4 Delete the branding Zustand store `stores/brandingStore.ts`

    - _Requirements: 5.1, 5.2_

  - [x] 1.5 Delete the public branding hook `hooks/usePublicBranding.ts`
    - _Requirements: 6.1, 6.2_

- [x] 2. Update admin page to remove branding tab

  - [x] 2.1 Remove branding references from `app/[username]/admin/page.tsx`
    - Remove `import { BrandingTab } from './components/branding/branding-tab'`
    - Remove `'branding'` from the `activeTab` union type (in both `useState` and `handleTabChange` cast)
    - Remove the `<TabsTrigger value='branding'>` element
    - Change `grid-cols-6` to `grid-cols-5` on the `TabsList` (5 remaining tabs: dashboard, playlist, settings, analytics, subscription)
    - Remove the `<TabsContent value='branding'><BrandingTab /></TabsContent>` block
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 3. Refactor public playlist page to hardcoded defaults

  - [x] 3.1 Replace dynamic branding with static values in `app/[username]/playlist/page.tsx`
    - Remove `import { usePublicBranding } from '@/hooks/usePublicBranding'`
    - Remove the `usePublicBranding` hook call and all `settings` / `brandingLoading` state
    - Remove `getFontSizeValue` helper, welcome message `useEffect` and `showWelcomeMessage` state
    - Remove page title/meta description/OG title `useEffect` that reads from `settings`
    - Remove `getPageStyle()` function — replace with static style: `{ backgroundColor: '#000000', color: '#ffffff', fontFamily: 'Belgrano' }`
    - Remove the `brandingLoading` early return / loading gate
    - Hardcode logo to `/logo.png`, venue name to `'3B Jukebox'`
    - Hardcode SearchInput color props: `textColor='#000000'`, `secondaryColor='#6b7280'`, `accentColor1='#d1d5db'`, `accentColor3='#f3f4f6'`
    - Hardcode search container background to `#C09A5E`
    - Hardcode Playlist color props: `primaryColor='#C09A5E'`, `textColor='#000000'`, `secondaryColor='#6b7280'`, `accentColor2='#6b7280'`, `accentColor1='#d1d5db'`, `accentColor3='#f3f4f6'`
    - Remove the custom footer block entirely
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [x] 4. Checkpoint - Verify build passes

  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Update subscription tab and test references

  - [x] 5.1 Remove branding from subscription feature lists in `app/[username]/admin/components/subscription/subscription-tab.tsx`

    - Remove the "Branding customization" `<li>` from the Free Plan list (the one with ✗)
    - Remove the "Branding customization" `<li>` from the Monthly Plan list (the one with ✓)
    - _Requirements: 8.1_

  - [x] 5.2 Remove branding reference from test file `lib/__tests__/supabase-client-consolidation.test.ts`

    - Remove `'app/[username]/admin/components/branding/hooks/useBrandingSettings.ts'` from the `browserFiles` array
    - _Requirements: 9.1, 9.2_

  - [ ]\* 5.3 Write property test: No dangling branding imports (Property 1)

    - **Property 1: No dangling branding imports**
    - Scan all `.ts`/`.tsx` files (excluding `node_modules`, `.next`, migrations) and assert none contain import statements referencing `BrandingService`, `useBrandingStore`, `usePublicBranding`, `BrandingTab`, `useBrandingSettings`, or paths under `components/branding/`
    - **Validates: Requirements 1.4, 4.2, 5.2, 6.2**

  - [ ]\* 5.4 Write property test: No dynamic branding constructs in playlist page (Property 2)

    - **Property 2: No dynamic branding constructs in playlist page**
    - Assert `app/[username]/playlist/page.tsx` does not contain any of: `getFontSizeValue`, `gradient_type`, `gradient_direction`, `footer_text`, `welcome_message`, `brandingLoading`, `usePublicBranding`, `settings?.page_title`, `settings?.meta_description`, `settings?.open_graph_title`
    - **Validates: Requirements 7.4, 7.5, 7.6**

  - [ ]\* 5.5 Write property test: No branding references in test assertions (Property 3)
    - **Property 3: No branding references in test assertions**
    - Scan all test files (`**/__tests__/**/*.ts`) and assert none contain branding-related path strings (`branding/`, `brandingService`, `brandingStore`)
    - **Validates: Requirements 9.1, 9.2**

- [x] 6. Create database migration

  - [x] 6.1 Create and apply migration to drop `branding_settings`

    - Create local migration file `supabase/migrations/20250714000000_drop_branding_settings.sql`
    - Drop all RLS policies on `branding_settings` using `DROP POLICY IF EXISTS`
    - Drop the `branding_settings_updated_at` trigger using `DROP TRIGGER IF EXISTS`
    - Drop the `update_branding_settings_updated_at` function using `DROP FUNCTION IF EXISTS`
    - Drop the `branding_settings` table using `DROP TABLE IF EXISTS`
    - All statements must use `IF EXISTS` for idempotency
    - Use the Supabase MCP `apply_migration` tool to execute the migration against the database
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [ ]\* 6.2 Write property test: Migration idempotency (Property 4)
    - **Property 4: Migration idempotency**
    - Parse all `DROP` statements from the migration file and assert each contains `IF EXISTS`
    - **Validates: Requirements 10.4**

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Deletion order is leaf-first to avoid intermediate broken import states
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties from the design document
- The `types/supabase.ts` file is auto-generated and will update on next `supabase gen types` run — no manual edit needed
