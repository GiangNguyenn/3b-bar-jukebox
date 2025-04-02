import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { TrackItem } from "@/shared/types"
import { SpotifyPlaybackState } from "@/shared/types"

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export const filterUpcomingTracks = (
  playlistTracks: TrackItem[],
  currentTrackId: string | null,
  _nowPlaying?: SpotifyPlaybackState // Prefix with _ since it's unused
): TrackItem[] => {
  if (!currentTrackId) return playlistTracks; // If no track is playing, return full list

  // Find all occurrences of the current track
  const indices = playlistTracks
    .map((track, index) => track.track.id === currentTrackId ? index : -1)
    .filter(index => index !== -1);

  if (indices.length === 0) return playlistTracks; // If current track isn't found, return full list

  // Always use the last instance of the track
  const lastIndex = indices[indices.length - 1];
  return playlistTracks.slice(lastIndex + 1);
};
