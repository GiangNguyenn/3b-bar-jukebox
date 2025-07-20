# JM Bar Jukebox

A web application that allows users to control a jukebox using their Spotify accounts. Built with Next.js, Supabase, and the Spotify Web API.

## 🎯 Project Overview

The JM Bar Jukebox is a collaborative music platform that enables users to:

- Queue tracks to a shared jukebox
- Control playback through a web interface
- Vote on queued tracks
- Get track suggestions based on customizable criteria
- Monitor system health and recovery

## 🏗️ Architecture

This project uses:

- **Frontend**: Next.js 14 with TypeScript and Tailwind CSS
- **Authentication**: Supabase Auth with Spotify OAuth
- **Database**: PostgreSQL via Supabase
- **State Management**: Zustand for global state, React Context for specific features
- **Real-time**: Supabase Realtime subscriptions
- **External APIs**: Spotify Web API and Spotify Web Playback SDK

For detailed architecture information, see [docs/architecture.md](docs/architecture.md).

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Yarn package manager
- Spotify Developer Account
- Supabase Project

### Environment Setup

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd jm-bar-jukebox
   ```

2. **Install dependencies**

   ```bash
   yarn install
   ```

3. **Environment Variables**

   Create a `.env.local` file with the following variables:

   ```env
   # Supabase
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

   # Spotify
   SPOTIFY_CLIENT_ID=your_spotify_client_id
   SPOTIFY_CLIENT_SECRET=your_spotify_client_secret

   # Sentry (optional)
   SENTRY_DSN=your_sentry_dsn
   ```

4. **Run development server**

   ```bash
   yarn dev
   ```

5. **Open your browser**

   Navigate to [http://localhost:3000](http://localhost:3000) to see the application.

## 📁 Project Structure

```
jm-bar-jukebox/
├── app/                    # Next.js app directory
│   ├── api/               # API routes
│   ├── [username]/        # Dynamic user routes
│   │   ├── admin/         # Admin dashboard
│   │   └── playlist/      # Public playlist view
│   └── auth/              # Authentication pages
├── components/            # Reusable React components
├── hooks/                # Custom React hooks
├── services/             # Business logic and external API interactions
├── shared/               # Shared utilities and types
├── stores/               # Zustand state stores
├── contexts/             # React Context providers
├── docs/                 # Project documentation
└── supabase/             # Database migrations and config
```

## 🛠️ Development

### Available Scripts

```bash
# Development
yarn dev              # Start development server
yarn build            # Build for production
yarn start            # Start production server

# Code Quality
yarn lint:check       # Run ESLint
yarn lint:fix         # Fix ESLint issues
yarn format           # Format code with Prettier
yarn check            # Check code formatting

# Pre-commit
yarn precommit        # Format and lint before commit
```

### Key Development Guidelines

1. **TypeScript**: All code must be written in TypeScript with proper type definitions
2. **State Management**: Use Zustand for global state, React Context for feature-specific state
3. **Error Handling**: Use the centralized error handling utilities in `shared/utils/errorHandling.ts`
4. **Logging**: Use `ConsoleLogsProvider` for consistent logging across the application
5. **API Calls**: Use `sendApiRequest` from `shared/api.ts` for Spotify API interactions
6. **Recovery**: Place recovery logic in the `@/recovery` directory

### Authentication Flow

The application uses Supabase Auth with Spotify OAuth:

1. Users sign in via Spotify OAuth
2. Supabase handles token exchange and session management
3. User profiles are stored in the `profiles` table
4. Premium status is verified via Spotify API

### Database Schema

Key tables:

- `profiles`: User profiles and Spotify authentication data
- `tracks`: Spotify track metadata
- `jukebox_queue`: Queue items for each user's jukebox
- `suggested_tracks`: Track suggestion history
- `playlists`: User playlist associations

See [docs/database-schema.md](docs/database-schema.md) for complete schema.

## 🔧 Key Features

### Admin Dashboard

- Real-time queue management
- Track suggestions with customizable criteria
- System health monitoring
- Analytics and playback controls

### Public Playlist View

- View current queue
- Vote on tracks
- See currently playing track
- Artist information display

### Recovery System

- Circuit breaker pattern for API calls
- Automatic player recovery
- Health monitoring and alerts
- Token refresh management

## 📦 Deployment

### Manual Deployment

```bash
# Build the application
yarn build

# Start production server
yarn start
```

## 🤝 Contributing

1. Create a feature branch from `main`
2. Make your changes following the development guidelines
3. Run `yarn precommit` to ensure code quality
4. Submit a pull request with a clear description

## 📚 Documentation

- [Architecture Documentation](docs/architecture.md)
- [Database Schema](docs/database-schema.md)

### Getting Help

- Check the [architecture documentation](docs/architecture.md)
- Review existing issues in the repository
  -If something is wrong, blame Giang.
