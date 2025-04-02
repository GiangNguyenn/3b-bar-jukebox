import { TrackItem } from "@/shared/types";
import React, { useEffect, useRef } from "react";
import QueueItem from "./QueueItem";
import NowPlaying from "./NowPlaying";
import useNowPlayingTrack from "@/hooks/useNowPlayingTrack";
import { filterUpcomingTracks } from "@/lib/utils";
import { useAutoRemoveFinishedTrack } from "@/hooks/useAutoRemoveFinishedTrack";

interface IPlaylistProps {
  tracks: TrackItem[];
  refetchPlaylists: () => void;
}

const Playlist: React.FC<IPlaylistProps> = ({ tracks, refetchPlaylists }) => {
  const { data: playbackState } = useNowPlayingTrack();
  const currentTrackId = playbackState?.item?.id ?? null;
  const previousTrackIdRef = useRef<string | null>(null);

  // Use the auto-remove hook
  useAutoRemoveFinishedTrack({
    currentTrackId,
    playlistTracks: tracks,
    playbackState: playbackState ?? null
  });

  const { tracks: upcomingTracks, shouldRemoveOldest } = filterUpcomingTracks(tracks, currentTrackId);

  // Check for playlist changes every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      console.log('[Playlist] Checking for playlist changes');
      // Dispatch a custom event instead of directly calling refetchPlaylists
      const event = new CustomEvent('playlistRefresh', {
        detail: { timestamp: Date.now() }
      });
      window.dispatchEvent(event);
    }, 30000);

    return () => clearInterval(interval);
  }, []); // No dependencies needed since we're using window events

  // Track changes for logging purposes only
  useEffect(() => {
    if (currentTrackId !== previousTrackIdRef.current) {
      console.log('[Playlist] Track changed:', {
        previous: previousTrackIdRef.current,
        current: currentTrackId
      });
      previousTrackIdRef.current = currentTrackId;
    }
  }, [currentTrackId]);

  console.log('[Playlist] Component data:', {
    totalTracks: tracks.length,
    currentTrackId,
    upcomingTracksLength: upcomingTracks.length,
    shouldRemoveOldest,
    tracks
  });

  // If no track is currently playing, show all tracks
  const tracksToShow = currentTrackId ? upcomingTracks : tracks;

  if (tracksToShow.length === 0) {
    return (
      <div className="w-full">
        <div className="flex w-full sm:w-10/12 md:w-8/12 lg:w-9/12 bg-primary-100 shadow-md rounded-lg overflow-hidden mx-auto">
          <div className="flex flex-col w-full">
            <NowPlaying nowPlaying={playbackState} />
            <div className="flex flex-col p-5">
              <div className="text-center text-gray-500">
                No tracks in the playlist yet
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex w-full sm:w-10/12 md:w-8/12 lg:w-9/12 bg-primary-100 shadow-md rounded-lg overflow-hidden mx-auto">
        <div className="flex flex-col w-full">
          <NowPlaying nowPlaying={playbackState} />
          
          <div className="flex flex-col p-5">
            <div className="border-b pb-1 flex justify-between items-center mb-2">
              <span className="text-base font-semibold uppercase text-gray-700">
                UPCOMING TRACKS
              </span>
            </div>
            {tracksToShow.map((track) => (
              <QueueItem key={track.track.id} track={track} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Playlist;
