// Define the callback before loading the SDK
window.onSpotifyWebPlaybackSDKReady = () => {
  console.log('[SpotifyPlayer] SDK Ready')
  window.Spotify = Spotify
  // Dispatch an event to notify that the SDK is ready
  window.dispatchEvent(new CustomEvent('spotifySDKReady'))
}

// Load the SDK script
const script = document.createElement('script')
script.src = 'https://sdk.scdn.co/spotify-player.js'
script.async = true
script.onerror = () => {
  console.error('[SpotifyPlayer] Failed to load Spotify Web Playback SDK')
  window.dispatchEvent(
    new CustomEvent('playerError', {
      detail: { error: { message: 'Failed to load SDK' } }
    })
  )
}
document.body.appendChild(script)
