---
inclusion: always
---

# Tech Stack

## Core
- Next.js 14 (App Router) + TypeScript (strict mode) + React 18
- Node.js 18 (see `.nvmrc`), deployed on Vercel
- Path alias: `@/*` maps to project root

## Data & Auth
- Supabase (PostgreSQL) for storage, auth, realtime
- NextAuth v4 for Spotify OAuth
- Supabase SSR client for middleware auth

## External APIs
- Spotify Web API (`spotify-web-api-node`) + Web Playback SDK
- Stripe for subscriptions/billing
- Venice AI for DJ script generation and TTS

## State Management
- Zustand for client stores (`stores/`, `hooks/spotifyPlayerStore.ts`)
- SWR for data fetching/caching
- React Context for toasts and console logs

## Styling & UI
- Tailwind CSS 3 with `tailwindcss-animate`
- Radix UI, Headless UI, Framer Motion
- Icons: FontAwesome, Heroicons, Lucide, React Icons
- Recharts for analytics; react-window for virtualized lists

## Validation
- Zod for schema validation

## Code Style (Prettier)
- Single quotes, JSX single quotes, no semicolons, no trailing commas
- Tailwind class sorting via `prettier-plugin-tailwindcss`

## Logging
- `console.log` and `console.info` are **banned by ESLint**
- Use `createModuleLogger` from `@/shared/utils/logger` in non-React files
- Use `useConsoleLogsContext` + `addLog()` in React components

## Common Commands

```bash
yarn install          # Install dependencies
yarn dev              # Dev server
yarn build            # Runs tests then next build
yarn test             # Node.js built-in test runner via tsx
yarn lint:check       # ESLint check
yarn lint:fix         # ESLint auto-fix
yarn format           # Prettier write
yarn check            # Prettier check
```

## Testing
- Node.js built-in test runner (`node:test`) executed via `tsx --test`
- No Jest or Vitest — use `describe`, `it`, `assert` from `node:test` and `node:assert`
- Test files live in `__tests__/` directories adjacent to the code they test
- Environment variables mocked via `cross-env` in the test script
