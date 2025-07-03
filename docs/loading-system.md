# Loading System Documentation

This document describes the centralized loading system implemented across the jukebox application to ensure consistent loading states.

## Components

### Loading Component

The main `Loading` component provides consistent loading indicators with multiple variants and sizes.

```tsx
import { Loading } from '@/components/ui/loading'

// Basic usage
<Loading />

// With custom size and variant
<Loading variant="spinner" size="lg" />

// Full screen loading
<Loading variant="gear" size="xl" fullScreen />

// With message
<Loading message="Loading playlist..." />
```

#### Props

- `size`: 'sm' | 'md' | 'lg' | 'xl' (default: 'md')
- `variant`: 'spinner' | 'gear' | 'dots' (default: 'gear')
- `fullScreen`: boolean (default: false)
- `message`: string (optional)
- `className`: string (optional)

#### Variants

- **spinner**: Circular border spinner (most common)
- **gear**: FontAwesome gear icon (used for main page loading)
- **dots**: Bouncing dots animation

### Skeleton Components

Skeleton components provide content placeholders during loading.

```tsx
import { Skeleton, TrackSkeleton, PlaylistSkeleton, TableSkeleton } from '@/components/ui/skeleton'

// Basic skeleton
<Skeleton variant="text" width="60%" />

// Pre-built skeletons
<TrackSkeleton />
<PlaylistSkeleton />
<TableSkeleton rows={8} />
```

## Usage Patterns

### Page Loading

For full-page loading states, use the `fullScreen` prop:

```tsx
// app/loading.tsx
export default function LoadingPage(): JSX.Element {
  return <Loading variant='gear' size='xl' fullScreen />
}
```

### Component Loading

For component-level loading, use appropriate skeleton components:

```tsx
if (isLoading) {
  return <TableSkeleton rows={8} />
}
```

### Button Loading

For button loading states, use small spinners:

```tsx
<button disabled={isLoading}>
  {isLoading ? (
    <Loading variant='spinner' size='sm' />
  ) : (
    <PlayIcon className='h-4 w-4' />
  )}
</button>
```

### Search Loading

For search inputs, use small spinners in the input field:

```tsx
{
  isSearching && (
    <div className='absolute right-3 top-1/2 -translate-y-1/2'>
      <Loading variant='spinner' size='sm' />
    </div>
  )
}
```

## Custom Hook

Use the `useLoadingState` hook for consistent loading state management:

```tsx
import { useLoadingState } from '@/hooks/useLoadingState'

function MyComponent() {
  const { isLoading, loadingMessage, withLoading } = useLoadingState()

  const handleAction = async () => {
    await withLoading(async () => {
      // Your async operation
      await someApiCall()
    }, 'Loading data...')
  }

  return (
    <div>
      {isLoading && <Loading message={loadingMessage} />}
      <button onClick={handleAction}>Load Data</button>
    </div>
  )
}
```

## Migration Guide

### Before (Inconsistent)

```tsx
// Different patterns across components
<div className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"></div>
<div className="border-white h-4 w-4 animate-spin rounded-full border-b-2 border-t-2"></div>
<FontAwesomeIcon className="h-16 w-16 animate-spin" icon={faGear} />
```

### After (Consistent)

```tsx
// Unified loading components
<Loading variant="spinner" size="md" />
<Loading variant="spinner" size="sm" />
<Loading variant="gear" size="xl" fullScreen />
```

## Best Practices

1. **Use appropriate sizes**: 'sm' for buttons, 'md' for components, 'lg'/'xl' for pages
2. **Choose the right variant**: 'spinner' for most cases, 'gear' for main page loading
3. **Use skeletons for content**: Provide better UX than spinners for content loading
4. **Include messages**: Help users understand what's happening
5. **Consistent placement**: Keep loading indicators in predictable locations

## File Structure

```
components/ui/
├── loading.tsx          # Main Loading component
├── skeleton.tsx         # Skeleton components
└── index.ts            # Barrel exports

hooks/
└── useLoadingState.ts   # Loading state management hook
```
