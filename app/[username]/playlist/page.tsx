'use client'

import { Suspense, useEffect, useState, useCallback } from 'react'
import Image from 'next/image'
import { useUserToken } from '@/hooks/useUserToken'
import { useNowPlayingTrack } from '@/hooks/useNowPlayingTrack'
import { useArtistExtract } from '@/hooks/useArtistExtract'
import { usePlaylistData } from '@/hooks/usePlaylistData'
import { TrackDetails } from '@/shared/types/spotify'
import SearchInput from '@/components/SearchInput'
import Playlist from '@/components/Playlist/Playlist'
import { handleApiError } from '@/shared/utils/errorHandling'
import { AppError } from '@/shared/utils/errorHandling'
import { ERROR_MESSAGES } from '@/shared/constants/errors'
import type { JukeboxQueueItem } from '@/shared/types/queue'
import { useParams } from 'next/navigation'
import { Loading, PlaylistSkeleton, ErrorMessage, Toast } from '@/components/ui'
import { AutoFillNotification } from '@/components/ui/auto-fill-notification'
import { usePublicBranding } from '@/hooks/usePublicBranding'

type VoteFeedback = {
  message: string
  variant: 'success' | 'warning'
}

export default function PlaylistPage(): JSX.Element {
  const params = useParams()
  const username = params?.username as string | undefined
  const [voteFeedback, setVoteFeedback] = useState<VoteFeedback | null>(null)
  const [showWelcomeMessage, setShowWelcomeMessage] = useState(false)
  const { settings, loading: brandingLoading } = usePublicBranding(
    username ?? ''
  )

  // Helper function to convert Tailwind text classes to CSS values
  const getFontSizeValue = (
    tailwindClass: string | null | undefined
  ): string => {
    if (!tailwindClass) return '2.25rem' // text-4xl default

    const sizeMap: Record<string, string> = {
      'text-xs': '0.75rem',
      'text-sm': '0.875rem',
      'text-base': '1rem',
      'text-lg': '1.125rem',
      'text-xl': '1.25rem',
      'text-2xl': '1.5rem',
      'text-3xl': '1.875rem',
      'text-4xl': '2.25rem',
      'text-5xl': '3rem',
      'text-6xl': '3.75rem',
      'text-7xl': '4.5rem',
      'text-8xl': '6rem',
      'text-9xl': '8rem'
    }

    return sizeMap[tailwindClass] || '2.25rem'
  }

  const {
    loading: isTokenLoading,
    error: tokenError,
    isRecovering,
    isJukeboxOffline,
    fetchToken
  } = useUserToken()

  const {
    data: queue,
    error: playlistError,
    isLoading: isPlaylistLoading,
    isRefreshing: isPlaylistRefreshing,
    mutate: refreshQueue,
    optimisticUpdate
  } = usePlaylistData(username)

  const { data: currentlyPlaying } = useNowPlayingTrack({
    token: null, // Don't use user token for public pages
    enabled: true, // Always enabled for public pages
    refetchInterval: 5000 // Poll every 5 seconds for more responsive updates
  })

  // Manage welcome message timing
  useEffect(() => {
    const hasWelcomeMessage =
      settings?.welcome_message && settings.welcome_message.trim() !== ''
    const allLoadingComplete =
      !brandingLoading && !isTokenLoading && !isPlaylistLoading && !isRecovering

    if (hasWelcomeMessage && allLoadingComplete) {
      setShowWelcomeMessage(true)
      const timer = setTimeout(() => {
        setShowWelcomeMessage(false)
      }, 2000) // 2 seconds

      return (): void => clearTimeout(timer)
    }

    return undefined
  }, [
    brandingLoading,
    isTokenLoading,
    isPlaylistLoading,
    isRecovering,
    settings
  ])

  // Update page title, meta description, and Open Graph title when branding settings change
  useEffect(() => {
    // Update page title
    if (settings?.page_title && settings.page_title.trim() !== '') {
      document.title = settings.page_title
    } else {
      document.title = '3B Jukebox'
    }

    // Update meta description
    const metaDescriptionContent =
      settings?.meta_description?.trim() ??
      'The Ultimate Shared Music Experience'
    let metaDescription = document.querySelector('meta[name="description"]')
    if (!metaDescription) {
      metaDescription = document.createElement('meta')
      metaDescription.setAttribute('name', 'description')
      document.head.appendChild(metaDescription)
    }
    metaDescription.setAttribute('content', metaDescriptionContent)

    // Update Open Graph title
    const ogTitleContent = settings?.open_graph_title?.trim() ?? '3B Jukebox'
    let ogTitle = document.querySelector('meta[property="og:title"]')
    if (!ogTitle) {
      ogTitle = document.createElement('meta')
      ogTitle.setAttribute('property', 'og:title')
      document.head.appendChild(ogTitle)
    }
    ogTitle.setAttribute('content', ogTitleContent)
  }, [
    settings?.page_title,
    settings?.meta_description,
    settings?.open_graph_title
  ])

  // Force refresh queue when currently playing track changes
  useEffect(() => {
    if (currentlyPlaying?.item?.id) {
      // Refresh queue to update the currently playing indicator
      void refreshQueue()
    }
  }, [currentlyPlaying?.item?.id, currentlyPlaying?.item?.name, refreshQueue])

  const artistName = currentlyPlaying?.item?.artists[0]?.name
  const {
    data: extract,
    isLoading: isExtractLoading,
    error: extractError
  } = useArtistExtract(artistName)

  const [lastAddedTrack, setLastAddedTrack] = useState<TrackDetails | null>(
    null
  )

  const handleAddTrack = useCallback(
    async (track: TrackDetails): Promise<void> => {
      if (!username) return

      // Create optimistic queue item
      const optimisticItem: JukeboxQueueItem = {
        id: `temp-${Date.now()}-${track.id}`, // Temporary ID
        profile_id: '', // Will be filled by the server
        track_id: '', // Will be filled by the server
        votes: 5, // Initial votes
        queued_at: new Date().toISOString(),
        tracks: {
          id: '', // Will be filled by the server
          spotify_track_id: track.id,
          name: track.name,
          artist: track.artists[0]?.name || 'Unknown Artist',
          album: track.album.name,
          genre: null,
          created_at: new Date().toISOString(),
          popularity: track.popularity,
          duration_ms: track.duration_ms,
          spotify_url: track.uri,
          release_year: new Date().getFullYear() // Default to current year
        }
      }

      // Optimistically add the track to the queue
      if (optimisticUpdate && queue) {
        optimisticUpdate((currentQueue) => [optimisticItem, ...currentQueue])
      }

      try {
        const response = await fetch(`/api/playlist/${username}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tracks: track,
            initialVotes: 5,
            source: 'user' // Mark as user-initiated
          })
        })

        if (!response.ok) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
          throw new AppError(
            ERROR_MESSAGES.FAILED_TO_ADD,
            response.status,
            'PlaylistPage'
          )
        }

        setLastAddedTrack(track)
        // The real-time subscription will update the queue with the actual data
        // so we don't need to call refreshQueue() here
      } catch (error: unknown) {
        // Remove the optimistic item on error
        if (optimisticUpdate && queue) {
          optimisticUpdate((currentQueue) =>
            currentQueue.filter((item) => item.id !== optimisticItem.id)
          )
        }

        const appError = handleApiError(error, 'PlaylistPage')
        if (appError instanceof AppError) {
          setVoteFeedback({ message: appError.message, variant: 'warning' })
        }
      }
    },
    [username, optimisticUpdate, queue]
  )

  const handleVote = useCallback(
    async (queueId: string, voteDirection: 'up' | 'down'): Promise<void> => {
      const VOTE_STORAGE_KEY = `vote_${queueId}`
      if (localStorage.getItem(VOTE_STORAGE_KEY)) {
        setVoteFeedback({
          message: 'You have already voted for this track.',
          variant: 'warning'
        })
        return
      }

      // Optimistic update - update vote count immediately
      if (optimisticUpdate && queue) {
        optimisticUpdate((currentQueue) =>
          currentQueue.map((item) =>
            item.id === queueId
              ? {
                  ...item,
                  votes: item.votes + (voteDirection === 'up' ? 1 : -1)
                }
              : item
          )
        )
      }

      try {
        const response = await fetch('/api/queue/vote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ queueId, voteDirection })
        })

        if (!response.ok) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
          const errorData: { error?: string } = await response.json()
          throw new Error(errorData.error ?? 'Failed to cast vote.')
        }

        localStorage.setItem(VOTE_STORAGE_KEY, 'true')
        setVoteFeedback({ message: 'Vote recorded!', variant: 'success' })

        // Real-time subscription will handle the update, but we can trigger a refresh
        // to ensure we have the latest data
        void refreshQueue()
      } catch (error: unknown) {
        // If optimistic update was used, the real-time subscription will correct the state
        if (error instanceof Error) {
          setVoteFeedback({
            message: error.message,
            variant: 'warning'
          })
        }
        handleApiError(error, 'VoteError')
      }
    },
    [refreshQueue, optimisticUpdate, queue]
  )

  const [isTokenInvalid, setIsTokenInvalid] = useState<boolean>(false)

  useEffect(() => {
    if (
      playlistError &&
      typeof playlistError === 'object' &&
      'message' in playlistError &&
      typeof (playlistError as { message: unknown }).message === 'string' &&
      (playlistError as { message: string }).message.includes(
        'Token invalid'
      ) &&
      !isRecovering
    ) {
      setIsTokenInvalid(true)
    }
  }, [playlistError, isRecovering])

  const handleTokenRecovery = useCallback(async (): Promise<void> => {
    if (fetchToken) {
      const newToken = await fetchToken()
      if (newToken) {
        setIsTokenInvalid(false)
        void refreshQueue()
      }
    }
  }, [fetchToken, refreshQueue])

  useEffect(() => {
    if (isTokenInvalid) {
      void handleTokenRecovery()
    }
  }, [isTokenInvalid, handleTokenRecovery])

  useEffect(() => {
    if (isJukeboxOffline) {
      const reloadTimer = setTimeout(() => {
        window.location.reload()
      }, 1000)
      return (): void => clearTimeout(reloadTimer)
    }
    return (): void => {}
  }, [isJukeboxOffline])

  if (isJukeboxOffline) {
    return (
      <div className='w-full'>
        <div className='mx-auto flex w-full flex-col space-y-6 sm:w-10/12 md:w-8/12 lg:w-9/12'>
          <Loading fullScreen message='Reconnecting to jukebox...' />
        </div>
      </div>
    )
  }

  if (tokenError) {
    return (
      <div className='w-full'>
        <div className='mx-auto flex w-full flex-col space-y-6 sm:w-10/12 md:w-8/12 lg:w-9/12'>
          <ErrorMessage
            message={tokenError}
            variant='error'
            autoDismissMs={0}
            className='text-center'
          />
        </div>
      </div>
    )
  }

  if (playlistError) {
    const errorMessage =
      playlistError &&
      typeof playlistError === 'object' &&
      'message' in playlistError
        ? (playlistError as { message: string }).message
        : 'An unknown error occurred while fetching the playlist.'
    return (
      <div className='w-full'>
        <div className='mx-auto flex w-full flex-col space-y-6 sm:w-10/12 md:w-8/12 lg:w-9/12'>
          <ErrorMessage
            message={errorMessage}
            variant='error'
            className='text-center'
          />
        </div>
      </div>
    )
  }

  // Apply branding styles
  const getPageStyle = (): React.CSSProperties => {
    const style: React.CSSProperties = {
      backgroundColor: settings?.background_color ?? '#000000',
      color: settings?.text_color ?? '#ffffff',
      fontFamily: settings?.font_family ?? 'Belgrano'
    }

    // Apply gradient if configured
    if (settings?.gradient_type && settings.gradient_type !== 'none') {
      const tailwindDirection = settings.gradient_direction ?? 'to-b'
      const backgroundColor = settings?.background_color ?? '#000000'
      const accentColor3 = settings?.accent_color_3 ?? '#f3f4f6'

      // Convert Tailwind direction to CSS direction
      const directionMap: Record<string, string> = {
        'to-b': 'to bottom',
        'to-r': 'to right',
        'to-br': 'to bottom right',
        'to-bl': 'to bottom left',
        'to-t': 'to top',
        'to-l': 'to left'
      }
      const cssDirection = directionMap[tailwindDirection] || 'to bottom'

      if (settings.gradient_type === 'linear') {
        style.background = `linear-gradient(${cssDirection}, ${backgroundColor}, ${accentColor3})`
      } else if (settings.gradient_type === 'radial') {
        style.background = `radial-gradient(circle, ${backgroundColor}, ${accentColor3})`
      }
    }

    return style
  }

  // Early returns for loading states
  if (brandingLoading) {
    const loadingMessage = 'Loading...'
    return <Loading fullScreen message={loadingMessage} />
  }

  // Show welcome message immediately after branding loads, regardless of other loading states
  const hasWelcomeMessage =
    settings?.welcome_message && settings.welcome_message.trim() !== ''
  if (
    hasWelcomeMessage &&
    (isTokenLoading || isPlaylistLoading || isRecovering)
  ) {
    const loadingMessage = isRecovering
      ? ERROR_MESSAGES.RECONNECTING
      : (settings.welcome_message ?? 'Loading...')

    return <Loading fullScreen message={loadingMessage} />
  }

  // If we have a welcome message but no other loading, show it briefly
  if (
    hasWelcomeMessage &&
    !isTokenLoading &&
    !isPlaylistLoading &&
    !isRecovering
  ) {
    if (showWelcomeMessage) {
      return (
        <Loading
          fullScreen
          message={settings.welcome_message ?? 'Loading...'}
        />
      )
    }
  }

  if (!queue) {
    return (
      <div className='w-full'>
        <div className='mx-auto flex w-full flex-col space-y-6 sm:w-10/12 md:w-8/12 lg:w-9/12'>
          <ErrorMessage
            message='Playlist not found'
            variant='error'
            className='text-center'
          />
        </div>
      </div>
    )
  }

  return (
    <div className='min-h-screen w-full' style={getPageStyle()}>
      <AutoFillNotification />
      {lastAddedTrack && (
        <Toast
          message={`"${lastAddedTrack.name}" added to playlist`}
          onDismiss={() => setLastAddedTrack(null)}
          variant='success'
          autoDismissMs={3000}
        />
      )}
      {voteFeedback && (
        <Toast
          message={voteFeedback.message}
          onDismiss={() => setVoteFeedback(null)}
          variant={voteFeedback.variant}
          autoDismissMs={3000}
        />
      )}

      {/* Custom Header with Branding */}
      <div className='mx-auto flex w-full flex-col items-center justify-center space-y-4 p-4 sm:w-10/12 md:w-8/12 lg:w-9/12'>
        <div className='mx-auto flex w-full overflow-hidden sm:w-10/12 md:w-8/12 lg:w-9/12'>
          <div className='relative flex aspect-[32/9] w-full items-center justify-center overflow-hidden'>
            <Image
              src={settings?.logo_url ?? '/logo.png'}
              alt='Venue Logo'
              fill
              className='object-contain'
              sizes='(max-width: 640px) 100vw, (max-width: 768px) 83.333333vw, (max-width: 1024px) 66.666667vw, 75vw'
            />
          </div>
        </div>

        <div className='text-center'>
          <h1
            style={{
              fontFamily: settings?.font_family ?? 'Belgrano',
              fontSize: getFontSizeValue(settings?.font_size),
              fontWeight: settings?.font_weight ?? 'normal',
              color: settings?.text_color ?? '#ffffff'
            }}
          >
            {settings?.venue_name ?? '3B Jukebox'}
          </h1>
          {settings?.subtitle && (
            <p
              className='mt-2 text-lg opacity-80'
              style={{
                fontFamily: settings?.font_family ?? 'Belgrano',
                color:
                  settings?.secondary_color === '#191414'
                    ? '#cccccc'
                    : (settings?.secondary_color ?? '#cccccc')
              }}
            >
              {settings.subtitle}
            </p>
          )}
        </div>
      </div>

      {/* Search Input with Branding */}
      <div className='mx-auto flex w-full flex-col space-y-6 p-4 sm:w-10/12 md:w-8/12 lg:w-9/12'>
        <div
          className='mx-auto flex w-full overflow-hidden rounded-lg shadow-md sm:w-10/12 md:w-8/12 lg:w-9/12'
          style={{
            backgroundColor: settings?.primary_color ?? '#C09A5E',
            border: settings?.accent_color_1
              ? `2px solid ${settings.accent_color_1}`
              : 'none'
          }}
        >
          <div className='flex w-full flex-col p-5'>
            <SearchInput
              onAddTrack={handleAddTrack}
              username={username}
              currentQueue={queue || []}
              textColor={settings?.text_color ?? '#000000'}
              secondaryColor={settings?.secondary_color ?? '#6b7280'}
              accentColor1={settings?.accent_color_1 ?? '#d1d5db'}
              accentColor3={settings?.accent_color_3 ?? '#f3f4f6'}
            />
          </div>
        </div>
        <Suspense fallback={<PlaylistSkeleton />}>
          <div className='relative'>
            <Playlist
              tracks={queue || []}
              currentlyPlaying={currentlyPlaying}
              artistExtract={extract}
              isExtractLoading={isExtractLoading}
              extractError={extractError}
              onVote={(queueId, voteDirection) => {
                void handleVote(queueId, voteDirection)
              }}
              isRefreshing={isPlaylistRefreshing}
              primaryColor={settings?.primary_color ?? undefined}
              textColor={settings?.text_color ?? '#000000'}
              secondaryColor={settings?.secondary_color ?? '#6b7280'}
              accentColor2={settings?.accent_color_2 ?? '#6b7280'}
              accentColor1={settings?.accent_color_1 ?? '#d1d5db'}
              accentColor3={settings?.accent_color_3 ?? '#f3f4f6'}
              username={username}
            />
          </div>
        </Suspense>
      </div>

      {/* Custom Footer */}
      {settings?.footer_text && (
        <footer
          className='mt-8 p-6 text-center'
          style={{
            borderTop: settings?.accent_color_1
              ? `1px solid ${settings.accent_color_1}`
              : 'none',
            paddingTop: settings?.accent_color_1 ? '1.5rem' : '1.5rem'
          }}
        >
          <p
            className='text-sm opacity-60'
            style={{
              fontFamily: settings?.font_family ?? 'Belgrano',
              color:
                settings?.secondary_color ?? settings.text_color ?? '#cccccc'
            }}
          >
            {settings.footer_text}
          </p>
        </footer>
      )}
    </div>
  )
}
