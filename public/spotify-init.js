// Define the callback before loading the SDK
window.onSpotifyWebPlaybackSDKReady = () => {
  window.Spotify = Spotify
}

// Load the SDK script
const script = document.createElement('script')
script.src = 'https://sdk.scdn.co/spotify-player.js'
script.async = true
script.onerror = () => {
  console.error('Failed to load Spotify Web Playback SDK')
  window.dispatchEvent(
    new CustomEvent('playerError', {
      detail: { error: { message: 'Failed to load SDK' } }
    })
  )
}
document.body.appendChild(script)
