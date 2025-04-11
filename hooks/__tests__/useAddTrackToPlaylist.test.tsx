import { renderHook, act } from "@testing-library/react-hooks";
import { useAddTrackToPlaylist } from "../useAddTrackToPlaylist";
import { sendApiRequest } from "@/shared/api";
import { ERROR_MESSAGES } from "@/shared/constants/errors";
import { useGetPlaylist } from "../useGetPlaylist";
import { TrackItem } from "@/shared/types";
import { AppError } from "@/shared/utils/errorHandling";

jest.mock("@/shared/api");
jest.mock("../useGetPlaylist");

const mockSendApiRequest = sendApiRequest as jest.MockedFunction<
  typeof sendApiRequest
>;
const mockUseGetPlaylist = useGetPlaylist as jest.MockedFunction<
  typeof useGetPlaylist
>;

const mockTrack: TrackItem = {
  added_at: "2024-01-01T00:00:00Z",
  added_by: {
    external_urls: { spotify: "https://spotify.com/user/test" },
    href: "https://api.spotify.com/v1/users/test",
    id: "test-user",
    type: "user",
    uri: "spotify:user:test",
  },
  is_local: false,
  track: {
    uri: "spotify:track:test",
    name: "Test Track",
    artists: [
      {
        name: "Test Artist",
        external_urls: { spotify: "https://spotify.com/artist/test" },
        href: "https://api.spotify.com/v1/artists/test",
        id: "test-artist",
        type: "artist",
        uri: "spotify:artist:test",
      },
    ],
    album: {
      name: "Test Album",
      images: [
        {
          url: "test.jpg",
          height: 640,
          width: 640,
        },
      ],
      album_type: "album",
      total_tracks: 1,
      available_markets: ["US"],
      external_urls: { spotify: "https://spotify.com/album/test" },
      href: "https://api.spotify.com/v1/albums/test",
      id: "test-album",
      release_date: "2024-01-01",
      release_date_precision: "day",
      type: "album",
      uri: "spotify:album:test",
      artists: [
        {
          name: "Test Artist",
          external_urls: { spotify: "https://spotify.com/artist/test" },
          href: "https://api.spotify.com/v1/artists/test",
          id: "test-artist",
          type: "artist",
          uri: "spotify:artist:test",
        },
      ],
    },
    duration_ms: 180000,
    explicit: false,
    external_urls: { spotify: "https://spotify.com/track/test" },
    href: "https://api.spotify.com/v1/tracks/test",
    id: "test-track",
    is_local: false,
    popularity: 50,
    preview_url: "https://preview.spotify.com/test",
    track_number: 1,
    type: "track",
    available_markets: ["US"],
    disc_number: 1,
    external_ids: {},
    is_playable: true,
  },
};

describe("useAddTrackToPlaylist", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseGetPlaylist.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      refetchPlaylist: jest.fn(),
    });
  });

  it("should add track to playlist successfully", async () => {
    mockSendApiRequest.mockResolvedValueOnce({});

    const { result } = renderHook(() =>
      useAddTrackToPlaylist({ playlistId: "test-playlist-id" }),
    );

    await act(async () => {
      await result.current.addTrack(mockTrack);
    });

    expect(mockSendApiRequest).toHaveBeenCalledWith({
      path: "playlists/test-playlist-id/tracks",
      method: "POST",
      body: {
        uris: [mockTrack.track.uri],
      },
    });
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("should handle API error", async () => {
    mockSendApiRequest.mockRejectedValueOnce(new Error("API Error"));

    const { result } = renderHook(() =>
      useAddTrackToPlaylist({ playlistId: "test-playlist-id" }),
    );

    await act(async () => {
      await result.current.addTrack(mockTrack);
    });

    expect(result.current.error).toBeInstanceOf(AppError);
    expect(result.current.error?.message).toBe(ERROR_MESSAGES.FAILED_TO_ADD);
    expect(result.current.isSuccess).toBe(false);
  });

  it("should handle missing playlist ID", async () => {
    const { result } = renderHook(() =>
      useAddTrackToPlaylist({ playlistId: "" }),
    );

    await act(async () => {
      await result.current.addTrack(mockTrack);
    });

    expect(result.current.error).toBeInstanceOf(AppError);
    expect(result.current.error?.message).toBe(ERROR_MESSAGES.NO_PLAYLIST);
    expect(result.current.isSuccess).toBe(false);
  });

  it("should handle playlist error", async () => {
    mockUseGetPlaylist.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetchPlaylist: jest.fn(),
    });

    const { result } = renderHook(() =>
      useAddTrackToPlaylist({ playlistId: "test-playlist-id" }),
    );

    await act(async () => {
      await result.current.addTrack(mockTrack);
    });

    expect(result.current.error).toBeInstanceOf(AppError);
    expect(result.current.error?.message).toBe("Failed to load playlist");
    expect(result.current.isSuccess).toBe(false);
  });
});
