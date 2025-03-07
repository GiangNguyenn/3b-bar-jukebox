import { TrackItem } from "@/shared/types";
import React from "react";
import QueueItem from "./QueueItem";
import NowPlaying from "./NowPlaying";

interface IPlaylistProps {
  tracks: TrackItem[];
}

export const Playlist: React.FC<IPlaylistProps> = ({ tracks }) => {
  return (
    <div className="w-full">
      <div className="flex w-8/12  bg-white shadow-md rounded-lg overflow-hidden mx-auto">
        <div className="flex flex-col w-full">
          <NowPlaying />

          <div className="flex flex-col p-5">
            <div className="border-b pb-1 flex justify-between items-center mb-2">
              <span className=" text-base font-semibold uppercase text-gray-700">
                QUEUE
              </span>
              <img
                className="w-4 cursor-pointer"
                src="https://p.kindpng.com/picc/s/152-1529312_filter-ios-filter-icon-png-transparent-png.png"
              />
            </div>
            {tracks.map((track) => (
              <QueueItem key={track.track.id} track={track} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
