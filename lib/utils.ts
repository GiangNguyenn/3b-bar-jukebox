import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { TrackItem } from "@/shared/types"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const filterUpcomingTracks = (
  playlistTracks: TrackItem[],
  currentTrackId: string | null
): TrackItem[] => {
  if (!currentTrackId) return playlistTracks; // If no track is playing, return full list

  const index = playlistTracks.findIndex(track => track.track.id === currentTrackId);
  
  if (index === -1) return playlistTracks; // If current track isn't found, return full list

  return playlistTracks.slice(index + 1); // Return only upcoming songs
};
