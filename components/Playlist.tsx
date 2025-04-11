import { TrackItem } from "@/shared/types";
import React, { useState } from "react";
import QueueItem from "@/components/Playlist/QueueItem";
import NowPlaying from "@/components/Playlist/NowPlaying";
import useNowPlayingTrack from "@/hooks/useNowPlayingTrack";
import { filterUpcomingTracks } from "@/lib/utils";

interface IPlaylistProps {
  tracks: TrackItem[];
}

const Playlist: React.FC<IPlaylistProps> = ({ tracks }) => {
  const { data: playbackState } = useNowPlayingTrack();
  const currentTrackId = playbackState?.item?.id ?? null;
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    try {
      setIsRefreshing(true);
      const response = await fetch("/api/refresh-site");
      if (!response.ok) {
        throw new Error("Failed to refresh site");
      }
      // Visual feedback that refresh was successful
      window.dispatchEvent(
        new CustomEvent("playlistRefresh", {
          detail: { timestamp: Date.now() },
        }),
      );
    } catch (error) {
      console.error("Error refreshing site:", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const upcomingTracks = filterUpcomingTracks(tracks, currentTrackId) ?? [];
  const tracksToShow = currentTrackId ? upcomingTracks : tracks;

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
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className={`
                  px-3 py-1 rounded text-sm font-medium
                  ${
                    isRefreshing
                      ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                      : "bg-blue-600 text-white hover:bg-blue-500"
                  }
                `}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
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
