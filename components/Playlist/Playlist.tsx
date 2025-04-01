import { TrackItem } from "@/shared/types";
import React from "react";
import QueueItem from "./QueueItem";
import NowPlaying from "./NowPlaying";
import useNowPlayingTrack from "@/hooks/useNowPlayingTrack";
import { filterUpcomingTracks } from "@/lib/utils";

interface IPlaylistProps {
  tracks: TrackItem[];
}

export const Playlist: React.FC<IPlaylistProps> = ({ tracks }) => {
  const { data: nowPlaying } = useNowPlayingTrack();
  const currentTrackId = nowPlaying?.item?.id ?? null;
  const upcomingTracks = filterUpcomingTracks(tracks, currentTrackId);

  return (
    <div className="w-full">
      <div className="flex w-full sm:w-10/12 md:w-8/12 lg:w-9/12 bg-white-500 shadow-md rounded-lg overflow-hidden mx-auto">
        <div className="flex flex-col w-full">
          <NowPlaying nowPlaying={nowPlaying} />

          <div className="flex flex-col p-5">
            <div className="border-b pb-1 flex justify-between items-center mb-2">
              <span className="text-base font-semibold uppercase text-gray-700">
                UPCOMING TRACKS
              </span>
            </div>
            {upcomingTracks.map((track) => (
              <QueueItem key={track.track.id} track={track} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
