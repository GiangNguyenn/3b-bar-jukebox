# Dashboard Tab Refactoring Guide

## Step 1: Create Status Indicator Component

### Files Affected:

- `app/admin/components/dashboard/components/status-indicator.tsx` (new)
- `app/admin/components/dashboard/dashboard-tab.tsx`

### Instructions:

1. Create a new StatusIndicator component that accepts:

```typescript
interface StatusIndicatorProps {
  title: string
  status: string
  colorMap: Record<string, string>
  label: string
  subtitle?: string
}
```

2. Move the status indicator UI pattern from DashboardTab into this component
3. Replace all status indicator instances in DashboardTab with the new component

## Step 2: Create Controls Section Component

### Files Affected:

- `app/admin/components/dashboard/components/playback-controls.tsx` (new)
- `app/admin/components/dashboard/dashboard-tab.tsx`

### Instructions:

1. Create a new PlaybackControls component that accepts:

```typescript
interface PlaybackControlsProps {
  isLoading: boolean
  tokenExpiryTime: number | null
  fixedPlaylistIsInitialFetchComplete: boolean
  playbackState: SpotifyPlaybackState | null
  onPlaybackControl: (
    action: 'play' | 'pause' | 'next' | 'previous'
  ) => Promise<void>
  onTokenRefresh: () => Promise<void>
  onPlaylistRefresh: () => Promise<void>
}
```

2. Move the controls section UI and handlers from DashboardTab
3. Replace the controls section in DashboardTab with the new component

## Step 3: Create Uptime Display Component

### Files Affected:

- `app/admin/components/dashboard/components/uptime-display.tsx` (new)
- `app/admin/components/dashboard/dashboard-tab.tsx`

### Instructions:

1. Create a new UptimeDisplay component that accepts:

```typescript
interface UptimeDisplayProps {
  uptime: number
}
```

2. Move the uptime display UI and formatTime helper from DashboardTab
3. Replace the uptime section in DashboardTab with the new component

## Step 4: Create Console Logs Component

### Files Affected:

- `app/admin/components/dashboard/components/console-logs.tsx` (new)
- `app/admin/components/dashboard/dashboard-tab.tsx`

### Instructions:

1. Create a new ConsoleLogs component that accepts:

```typescript
interface ConsoleLogsProps {
  logs: string[]
}
```

2. Move the console logs UI from DashboardTab
3. Replace the console logs section in DashboardTab with the new component

## Step 5: Create Status Grid Component

### Files Affected:

- `app/admin/components/dashboard/components/status-grid.tsx` (new)
- `app/admin/components/dashboard/dashboard-tab.tsx`

### Instructions:

1. Create a new StatusGrid component that accepts:

```typescript
interface StatusGridProps {
  healthStatus: HealthStatus
  playbackState: SpotifyPlaybackState | null
  tokenExpiryTime: number | null
  isReady: boolean
  fixedPlaylistIsInitialFetchComplete: boolean
}
```

2. Move the status grid container and layout from DashboardTab
3. Use StatusIndicator components within StatusGrid
4. Replace the status grid section in DashboardTab with the new component

## Step 6: Create Types File

### Files Affected:

- `app/admin/components/dashboard/types.ts` (new)
- All new component files

### Instructions:

1. Create a shared types file containing:

```typescript
export interface HealthStatus {
  deviceId: string | null
  device: 'healthy' | 'unresponsive' | 'disconnected' | 'unknown' | 'error'
  playback: 'playing' | 'paused' | 'stopped' | 'unknown' | 'error'
  token: 'valid' | 'expired' | 'error' | 'unknown'
  tokenExpiringSoon: boolean
  connection: 'good' | 'poor' | 'unstable' | 'error' | 'unknown'
  fixedPlaylist: 'found' | 'not_found' | 'error' | 'unknown'
}

export interface PlaybackInfo {
  isPlaying: boolean
  currentTrack: string
  progress: number
}
```

2. Update imports in all new components to use this types file

## Step 7: Update DashboardTab Component

### Files Affected:

- `app/admin/components/dashboard/dashboard-tab.tsx`

### Instructions:

1. Remove all UI code that has been moved to components
2. Import and use all new components
3. Pass required props to each component
4. Keep all state management and event handlers in DashboardTab
5. Update imports to use the new types file

## Step 8: Create Index File for Components

### Files Affected:

- `app/admin/components/dashboard/components/index.ts` (new)

### Instructions:

1. Create a barrel file to export all components:

```typescript
export * from './status-indicator'
export * from './playback-controls'
export * from './uptime-display'
export * from './console-logs'
export * from './status-grid'
```

2. Update DashboardTab to import components from the index file

## Step 9: Add Error Boundaries

### Files Affected:

- `app/admin/components/dashboard/components/error-boundary.tsx` (new)
- All new component files

### Instructions:

1. Create an ErrorBoundary component
2. Wrap each new component with ErrorBoundary in DashboardTab
3. Add error states and loading states to each component

## Step 10: Add Component Tests

### Files Affected:

- `__tests__/components/dashboard/components/status-indicator.test.tsx` (new)
- `__tests__/components/dashboard/components/playback-controls.test.tsx` (new)
- `__tests__/components/dashboard/components/uptime-display.test.tsx` (new)
- `__tests__/components/dashboard/components/console-logs.test.tsx` (new)
- `__tests__/components/dashboard/components/status-grid.test.tsx` (new)

### Instructions:

1. Create test files for each new component
2. Add snapshot tests
3. Add interaction tests
4. Add error state tests
5. Add loading state tests
