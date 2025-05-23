# Multi-User Spotify Authentication Flow PRD

## Overview

This document outlines the requirements and implementation details for supporting multiple user authentication, allowing users to connect their individual Spotify accounts and play music simultaneously.

## Goals

- Enable multiple users to authenticate with their own Spotify accounts
- Support simultaneous playback from different user accounts
- Maintain secure token management for each user
- Provide a seamless user experience for authentication and playback
- Minimize changes to existing token refresh mechanism
- All services are free, no additional costs.

## Technical Requirements

### 1. Authentication Flow

- Implement Spotify OAuth 2.0 Authorization Code Flow
- Support PKCE (Proof Key for Code Exchange) for enhanced security
- Store user tokens securely in the database
- Implement token refresh mechanism per user
- Validate user's Spotify Premium subscription status
- Handle non-premium account authentication attempts gracefully
- Maintain existing token refresh logic

### 2. Database Schema Updates

```typescript
// PlanetScale Schema
// Note: PlanetScale requires explicit foreign key constraints to be disabled
// and uses a different syntax for indexes

model SpotifyUser {
  id                String    @id @default(cuid())
  spotifyId         String    @unique
  accessToken       String    @db.Text
  refreshToken      String    @db.Text
  tokenExpiry       DateTime
  displayName       String
  createdAt         DateTime  @default(now())
  lastActive        DateTime  @updatedAt
  isActive          Boolean   @default(true)
  isPremium         Boolean   @default(false)
  subscriptionExpiry DateTime?
  sessions          UserSession[]

  @@index([spotifyId])
  @@index([isActive])
  @@index([lastActive])
}

model UserSession {
  id          String      @id @default(cuid())
  userId      String
  jwtToken    String      @db.Text
  expiresAt   DateTime
  createdAt   DateTime    @default(now())
  lastActive  DateTime    @updatedAt
  userAgent   String      @db.Text
  ipAddress   String
  user        SpotifyUser @relation(fields: [userId], references: [id])

  @@index([userId])
  @@index([expiresAt])
  @@index([lastActive])
}
```

### 3. Database Configuration

```typescript
// prisma/schema.prisma
datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
  relationMode = "prisma" // Required for PlanetScale
}

generator client {
  provider = "prisma-client-js"
}
```

### 4. API Endpoints

#### Authentication

- `POST /api/auth/spotify/login` - Initiate Spotify login
- `GET /api/auth/spotify/callback` - Handle OAuth callback
- `POST /api/auth/spotify/refresh` - Refresh user token
- `POST /api/auth/spotify/logout` - Disconnect Spotify account
- `GET /api/auth/spotify/subscription` - Check user's subscription status

#### User Management

- `GET /api/users/me` - Get current user info
- `GET /api/users/active` - Get list of active users
- `PUT /api/users/me/active` - Update user active status

### 5. Performance Considerations

- Implement basic connection pooling for database operations
- Monitor for any significant performance issues
- Implement basic error handling for connection issues

### 6. Security Considerations

- Encrypt sensitive data before storage
- Use PlanetScale's built-in security features
- Implement proper access controls

## Technical Dependencies

- Next.js 14+ (for API routes and server components)
- Prisma (for database management)
- NextAuth.js (for authentication)
- Spotify Web Playback SDK
- React Query (for state management)
- jsonwebtoken (for JWT handling)
- bcrypt (for token encryption)
- PlanetScale (for database hosting)

## Infrastructure Requirements

- PlanetScale account setup
- Vercel project configuration
- Environment variables setup
- Database connection configuration

## Risks and Mitigations

### Risks

1. Token refresh failures
2. Concurrent playback

### Mitigations

1. Implement robust error handling
2. JWT token rotation

## Future Considerations

1. User preferences storage
2. User activity analytics
