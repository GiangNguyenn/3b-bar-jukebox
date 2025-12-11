# Architecture Document: JM Bar Jukebox

## 1. Project Overview

This document outlines the architecture of the JM Bar Jukebox, a web application that allows users to control a jukebox using their Spotify accounts. The application is built with Next.js and integrates with Supabase for backend services and Spotify for music playback and user data.

## 2. Technology Stack

- **Framework:** [Next.js](https://nextjs.org/)
- **Language:** [TypeScript](https://www.typescriptlang.org/)
- **Authentication:** [NextAuth.js](https://next-auth.js.org/) with Spotify as the OAuth provider.
- **Backend & Database:** [Supabase](https://supabase.com/) (PostgreSQL)
- **Error Monitoring:** None (Sentry removed)
- **Schema Validation:** [Zod](https://zod.dev/)
- **External Services:**
  - [Spotify Web API](https://developer.spotify.com/documentation/web-api/)
  - [Spotify Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk)
- **Data Fetching:** [SWR](https://swr.vercel.app/)
- **Styling:** [Tailwind CSS](https://tailwindcss.com/)
- **State Management:** [Zustand](https://github.com/pmndrs/zustand)
- **Animations:** [Framer Motion](https://www.framer.com/motion/)
- **UI Libraries:**
  - [Headless UI](https://headlessui.com/)
  - [Radix UI](https://www.radix-ui.com/)
  - [Lucide React](https://lucide.dev/)

## 3. Folder Structure

The project is organized into the following key directories:

- **`app/`**: The core of the Next.js application, containing pages and API routes.
  - **`app/api/`**: Backend API endpoints.
  - **`app/[username]/admin/`**: The main dashboard for authenticated users.
  - **`app/[username]/playlist/`**: The public-facing playlist view.
- **`components/`**: Reusable React components.
  - **`components/ui/`**: Reusable UI components like `Card`, `Progress`, and `Tabs`.
- **`hooks/`**: Custom React hooks for managing state and side effects.
- **`lib/`**: Utility functions and library initializations.
- **`public/`**: Static assets like images and icons.
- **`services/`**: Business logic and interactions with external APIs.
- **`shared/`**: Code shared between the client and server.
- **`stores/`**: Zustand stores for managing global application state.
- **`supabase/`**: Supabase-related configurations and migrations.
- **`types/`**: Global TypeScript type definitions.

## 4. Authentication Flow

User authentication is handled by NextAuth.js, using Spotify as the OAuth provider. The `middleware.ts` file only protects routes under `/admin`.

The authentication callback logic has been refactored into a dedicated `AuthService` to improve separation of concerns. The API route acts as a thin controller that coordinates the authentication flow.

```mermaid
sequenceDiagram
    participant User
    participant Next.js App (Client)
    participant API Route
    participant AuthService
    participant Spotify
    participant Supabase

    User->>Next.js App (Client): Clicks 'Sign in with Spotify'
    Next.js App (Client)->>API Route: Initiates OAuth flow

    API Route->>Spotify: Redirects user for authorization
    User->>Spotify: Logs in and grants permissions
    Spotify->>API Route: Redirects with authorization code

    API Route->>AuthService: exchangeCodeForSession(code)
    AuthService->>Supabase: Exchanges code for session
    Supabase-->>AuthService: Returns session

    API Route->>AuthService: getSpotifyUserProfile(token)
    AuthService->>Spotify: Fetches user profile
    Spotify-->>AuthService: Returns profile

    API Route->>AuthService: upsertUserProfile(profile)
    AuthService->>Supabase: Upserts profile data
    Supabase-->>AuthService: Confirms upsert

    alt Premium User
        API Route->>User: Redirects to /:username/admin
    else Non-Premium User
        API Route->>User: Redirects to /premium-required
    end
```

## 5. API Endpoints

The application exposes several API endpoints under `app/api/` to handle various backend operations:

- **`app/api/auth/...`**: Manages authentication, including callbacks, session management, and profile handling.
- **`app/api/fixed-playlist/...`**: Manages the fixed playlist.
- **`app/api/ping/...`**: A simple endpoint to check if the API is running.
- **`app/api/playback/...`**: Controls Spotify playback, such as play, pause, and skip.
- **`app/api/playlists/[id]/`**: Manages individual playlists.
- **`app/api/search/...`**: Searches for tracks on Spotify.
- **`app/api/token/[username]/`**: Manages tokens for a specific user.
- **`app/api/track-suggestions/`**: A consolidated endpoint for managing track suggestions.
  - `GET ?latest=true`: Fetches the last suggested track.
  - `POST`: Requests a new track suggestion based on the criteria in the body.
  - `PUT`: Updates the "last suggested" track in the cache.

## 6. Data Management

- **Database:** The application uses a PostgreSQL database managed by Supabase. The schema is managed via Supabase's built-in migration tools, located in the `supabase/migrations` directory.
- **State Management:** Client-side state is managed exclusively with Zustand, a small, fast, and scalable state-management solution. This provides a single, consistent pattern for managing global state.

## 7. Key Components

- **`Header.tsx`**: The main application header.
- **`SearchInput.tsx`**: A reusable search input component.
- **`SpotifyPlayer`**: The main component for controlling music playback.
- **`Playlist`**: Displays the current jukebox playlist.
- **`QueueItem`**: Represents a single item in the playlist queue.
- **`Admin Dashboard`**: This is not a single component but a collection of components located under the `app/[username]/admin/components/` directory, forming the main interface for authenticated users to manage the jukebox.
- **`components/ui/`**: This directory contains a set of reusable UI components, such as `Card`, `Progress`, and `Tabs`.
