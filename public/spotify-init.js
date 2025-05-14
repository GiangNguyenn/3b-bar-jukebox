// Define the callback before loading the SDK
window.onSpotifyWebPlaybackSDKReady = () => {
  console.log('[SpotifyPlayer] SDK Ready')
  window.Spotify = Spotify
  // Dispatch an event to notify that the SDK is ready
  window.dispatchEvent(new CustomEvent('spotifySDKReady'))
}

// Add error handling for SDK loading
window.onSpotifyWebPlaybackSDKError = (error) => {
  console.error('[SpotifyPlayer] SDK Error:', error)
  window.dispatchEvent(
    new CustomEvent('playerError', {
      detail: { error: { message: 'SDK Error: ' + error } }
    })
  )
}

// Add loading state tracking
window.spotifySDKLoading = true

// Check if SDK is already loaded
if (window.Spotify) {
  console.log('[SpotifyPlayer] SDK already loaded')
  window.spotifySDKLoading = false
  window.dispatchEvent(new CustomEvent('spotifySDKReady'))
} else {
  console.log('[SpotifyPlayer] Loading SDK...')
  // Load the SDK script
  const script = document.createElement('script')
  script.src = 'https://sdk.scdn.co/spotify-player.js'
  script.async = true
  script.onerror = () => {
    console.error('[SpotifyPlayer] Failed to load Spotify Web Playback SDK')
    window.spotifySDKLoading = false
    window.dispatchEvent(
      new CustomEvent('playerError', {
        detail: { error: { message: 'Failed to load SDK' } }
      })
    )
  }

  script.onload = () => {
    console.log('[SpotifyPlayer] SDK script loaded')
    window.spotifySDKLoading = false
  }

  document.body.appendChild(script)
}
