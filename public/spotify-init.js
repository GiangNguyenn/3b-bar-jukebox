// Define the callback before loading the SDK
window.onSpotifyWebPlaybackSDKReady = () => {
  console.log('Spotify Web Playback SDK is ready')
}

// Load the SDK script
const script = document.createElement('script')
script.src = 'https://sdk.scdn.co/spotify-player.js'
script.async = true
document.body.appendChild(script) 