/**
 * Unit tests for describeMissingDevice: the log line that says what Spotify
 * does list when the jukebox's own player device has gone.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { describeMissingDevice } from '../deviceManagement/deviceValidation'
import type {
  SpotifyDevice,
  SpotifyPlaybackState
} from '@/shared/types/spotify'

const PLAYER_ID = '4ba4a72928b1e66c98ca08cea1f7ff7dfca3e138'

function device(overrides: Partial<SpotifyDevice>): SpotifyDevice {
  return {
    id: 'aaaaaaaabbbbbbbbccccccccdddddddd',
    is_active: false,
    is_private_session: false,
    is_restricted: false,
    name: 'Phone',
    type: 'Smartphone',
    volume_percent: 50,
    ...overrides
  }
}

void describe('describeMissingDevice', () => {
  void it('says so when Spotify lists no devices at all', () => {
    assert.equal(
      describeMissingDevice(PLAYER_ID, [], null),
      'Player device 4ba4a729… is not registered with Spotify. Spotify lists no devices for this account. Spotify reports no active playback.'
    )
  })

  void it('names the devices Spotify does list and where it is playing', () => {
    const phone = device({ name: "Bar's iPhone", is_active: true })
    const message = describeMissingDevice(PLAYER_ID, [phone], {
      is_playing: true,
      device: phone
    } as unknown as SpotifyPlaybackState)

    assert.match(
      message,
      /Spotify lists 1 other device: "Bar's iPhone" \(Smartphone, active, aaaaaaaa…\)/
    )
    assert.match(
      message,
      /Spotify playback is playing on "Bar's iPhone" \(aaaaaaaa…\)\.$/
    )
  })
})
