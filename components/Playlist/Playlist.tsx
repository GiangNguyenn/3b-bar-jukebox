import { TrackItem } from "@/shared/types";
import React, { useEffect, useRef, memo, useMemo } from "react";
import QueueItem from "./QueueItem";
import NowPlaying from "./NowPlaying";
import useNowPlayingTrack from "@/hooks/useNowPlayingTrack";
import { filterUpcomingTracks } from "@/lib/utils";
import { useAutoRemoveFinishedTrack } from "@/hooks/useAutoRemoveFinishedTrack";
import { useGetPlaylist } from "@/hooks/useGetPlaylist";
import { useCreateNewDailyPlaylist } from "@/hooks/useCreateNewDailyPlayList";

interface IPlaylistProps {
  tracks: TrackItem[];
}

const Playlist: React.FC<IPlaylistProps> = memo(({ tracks }) => {
  const { data: playbackState } = useNowPlayingTrack();
  const currentTrackId = playbackState?.item?.id ?? null;
  const previousTrackIdRef = useRef<string | null>(null);
  const { todayPlaylistId } = useCreateNewDailyPlaylist();
  const { data: playlist, refetchPlaylist } = useGetPlaylist(todayPlaylistId ?? "");

  // Use the auto-remove hook
  useAutoRemoveFinishedTrack({
    currentTrackId,
    playlistTracks: tracks,
    playbackState: playbackState ?? null
  });

  const upcomingTracks = useMemo(() => 
    filterUpcomingTracks(tracks, currentTrackId) ?? [], 
    [tracks, currentTrackId]
  );

  const shouldRemoveOldest = useMemo(() => 
    currentTrackId && tracks.length > 5,
    [currentTrackId, tracks.length]
  );

  // Check for playlist changes every 30 seconds using SWR's refetch
  useEffect(() => {
    const interval = setInterval(() => {
      console.log('[Playlist] Checking for playlist changes');
      refetchPlaylist();
    }, 30000);

    return () => clearInterval(interval);
  }, [refetchPlaylist]);

  // Only refresh when current track changes
  useEffect(() => {
    if (currentTrackId !== previousTrackIdRef.current) {
      console.log('[Playlist] Track changed, refreshing:', {
        previous: previousTrackIdRef.current,
        current: currentTrackId
      });
      previousTrackIdRef.current = currentTrackId;
      refetchPlaylist();
    }
  }, [currentTrackId, refetchPlaylist]);

  console.log('[Playlist] Component data:', {
    totalTracks: tracks.length,
    currentTrackId,
    upcomingTracksLength: upcomingTracks?.length ?? 0,
    shouldRemoveOldest,
    tracks
  });

  // If no track is currently playing, show all tracks
  const tracksToShow = useMemo(() => 
    currentTrackId ? upcomingTracks : tracks,
    [currentTrackId, upcomingTracks, tracks]
  );

  if (!tracksToShow?.length) {
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
});

Playlist.displayName = 'Playlist';

export default Playlist;
