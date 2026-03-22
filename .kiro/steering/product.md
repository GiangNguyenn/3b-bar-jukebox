---
inclusion: always
---

# Product: 3B Jukebox (jukebox.beer)

Collaborative Spotify-powered jukebox for venues (bars, restaurants). Venue owners connect Spotify Premium; patrons search and queue songs from their phones.

## Core Domains

- **Playback**: Spotify Web Playback SDK, device lifecycle, recovery, queue sync, auto-play
- **Admin**: Dashboard with playback controls, diagnostics, branding, analytics, DJ mode config
- **Public**: Now-playing display page, search, song request flow, queue with voting
- **DJ Mode**: AI voice announcements between tracks (Venice AI for script generation + TTS)
- **Game**: Music trivia with genre similarity scoring and artist graph recommendations
- **Subscriptions**: Stripe billing, free/premium tiers gating branding and analytics

## User Roles

- **Venue owner**: Connects Spotify, manages settings via admin dashboard at `/{username}/admin`
- **Patron**: Searches and queues songs via public playlist page at `/{username}/playlist`
