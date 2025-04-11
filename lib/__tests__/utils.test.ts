import { filterUpcomingTracks } from "../utils";
import { TrackItem, SpotifyPlaybackState } from "@/shared/types";

describe("filterUpcomingTracks", () => {
  const createMockTrack = (
    id: string,
    duration: number = 180000,
  ): TrackItem => ({
    added_at: new Date().toISOString(),
    added_by: {
      external_urls: { spotify: "https://open.spotify.com/user/test" },
      href: "https://api.spotify.com/v1/users/test",
      id: "test-user",
      type: "user",
      uri: "spotify:user:test",
    },
    is_local: false,
    track: {
      album: {
        album_type: "album",
        total_tracks: 1,
        available_markets: ["US"],
        external_urls: { spotify: "https://open.spotify.com/album/test" },
        href: "https://api.spotify.com/v1/albums/test",
        id: "test-album",
        images: [{ url: "test-url", height: 300, width: 300 }],
        name: "Test Album",
        release_date: "2024-01-01",
        release_date_precision: "day",
        type: "album",
        uri: "spotify:album:test",
        artists: [
          {
            external_urls: { spotify: "https://open.spotify.com/artist/test" },
            href: "https://api.spotify.com/v1/artists/test",
            id: "test-artist",
            name: "Test Artist",
            type: "artist",
            uri: "spotify:artist:test",
          },
        ],
      },
      artists: [
        {
          external_urls: { spotify: "https://open.spotify.com/artist/test" },
          href: "https://api.spotify.com/v1/artists/test",
          id: "test-artist",
          name: "Test Artist",
          type: "artist",
          uri: "spotify:artist:test",
        },
      ],
      available_markets: ["US"],
      disc_number: 1,
      duration_ms: duration,
      explicit: false,
      external_ids: {
        isrc: "TEST123456789",
        ean: "TEST123456789",
        upc: "TEST123456789",
      },
      external_urls: { spotify: "https://open.spotify.com/track/test" },
      href: "https://api.spotify.com/v1/tracks/test",
      id: id,
      is_playable: true,
      name: "Test Track",
      popularity: 50,
      preview_url: "https://p.scdn.co/mp3-preview/test",
      track_number: 1,
      type: "track",
      uri: `spotify:track:${id}`,
      is_local: false,
    },
  });

  const createMockPlaybackState = (
    trackId: string,
    progress: number,
    isPlaying: boolean = true,
  ): SpotifyPlaybackState => {
    const track = createMockTrack(trackId);
    return {
      device: {
        id: "test-device",
        is_active: true,
        is_private_session: false,
        is_restricted: false,
        name: "Test Device",
        type: "Computer",
        volume_percent: 50,
        supports_volume: true,
      },
      repeat_state: "off",
      shuffle_state: false,
      context: {
        type: "playlist",
        href: "https://api.spotify.com/v1/playlists/test",
        external_urls: { spotify: "https://open.spotify.com/playlist/test" },
        uri: "spotify:playlist:test",
      },
      timestamp: Date.now(),
      progress_ms: progress,
      is_playing: isPlaying,
      item: {
        album: track.track.album,
        artists: track.track.artists,
        available_markets: track.track.available_markets,
        disc_number: track.track.disc_number,
        duration_ms: track.track.duration_ms,
        explicit: track.track.explicit,
        external_ids: {
          isrc: "TEST123456789",
          ean: "TEST123456789",
          upc: "TEST123456789",
        },
        external_urls: track.track.external_urls,
        href: track.track.href,
        id: trackId,
        is_playable: track.track.is_playable,
        linked_from: {},
        name: track.track.name,
        popularity: track.track.popularity,
        preview_url: "https://p.scdn.co/mp3-preview/test",
        track_number: track.track.track_number,
        type: track.track.type,
        uri: track.track.uri,
        is_local: track.track.is_local,
      },
      currently_playing_type: "track",
      actions: {
        interrupting_playback: false,
        pausing: false,
        resuming: false,
        seeking: false,
        skipping_next: false,
        skipping_prev: false,
        toggling_repeat_context: false,
        toggling_shuffle: false,
        toggling_repeat_track: false,
        transferring_playback: false,
      },
    };
  };

  it("should return all tracks when no track is playing", () => {
    const tracks = [
      createMockTrack("track1"),
      createMockTrack("track2"),
      createMockTrack("track3"),
    ];

    const result = filterUpcomingTracks(tracks, null);
    expect(result).toEqual(tracks);
  });

  it("should return all tracks when current track is not found in playlist", () => {
    const tracks = [
      createMockTrack("track1"),
      createMockTrack("track2"),
      createMockTrack("track3"),
    ];

    const result = filterUpcomingTracks(tracks, "non-existent-track");
    expect(result).toEqual(tracks);
  });

  it("should return tracks after the current track when found", () => {
    const tracks = [
      createMockTrack("track1"),
      createMockTrack("track2"),
      createMockTrack("track3"),
    ];

    const result = filterUpcomingTracks(tracks, "track1");
    expect(result).toEqual([tracks[1], tracks[2]]);
  });

  it("should handle multiple occurrences of the same track", () => {
    const tracks = [
      createMockTrack("track1"),
      createMockTrack("track2"),
      createMockTrack("track1"),
      createMockTrack("track3"),
    ];

    const result = filterUpcomingTracks(tracks, "track1");
    expect(result).toEqual([tracks[3]]);
  });

  it("should use the last instance when there is progress information", () => {
    const tracks = [
      createMockTrack("track1", 180000),
      createMockTrack("track2", 180000),
      createMockTrack("track1", 180000),
      createMockTrack("track3", 180000),
    ];

    const nowPlaying = createMockPlaybackState("track1", 90000);
    const result = filterUpcomingTracks(tracks, "track1", nowPlaying);
    expect(result).toEqual([tracks[3]]);
  });

  it("should handle tracks near the end of their duration", () => {
    const tracks = [
      createMockTrack("track1", 180000),
      createMockTrack("track2", 180000),
      createMockTrack("track1", 180000),
      createMockTrack("track3", 180000),
    ];

    const nowPlaying = createMockPlaybackState("track1", 179000);
    const result = filterUpcomingTracks(tracks, "track1", nowPlaying);
    expect(result).toEqual([tracks[3]]);
  });

  it("should handle paused tracks", () => {
    const tracks = [
      createMockTrack("track1", 180000),
      createMockTrack("track2", 180000),
      createMockTrack("track3", 180000),
    ];

    const nowPlaying = createMockPlaybackState("track1", 90000, false);
    const result = filterUpcomingTracks(tracks, "track1", nowPlaying);
    expect(result).toEqual([tracks[1], tracks[2]]);
  });

  it("should handle tracks with zero progress", () => {
    const tracks = [
      createMockTrack("track1", 180000),
      createMockTrack("track2", 180000),
      createMockTrack("track3", 180000),
    ];

    const nowPlaying = createMockPlaybackState("track1", 0);
    const result = filterUpcomingTracks(tracks, "track1", nowPlaying);
    expect(result).toEqual([tracks[1], tracks[2]]);
  });
});
