import { TrackItem } from "@/shared/types";
import React from "react";
import QueueItem from "./QueueItem";

interface IPlaylistProps {
  tracks: TrackItem[];
}

export const Playlist: React.FC<IPlaylistProps> = ({ tracks }) => {
  return (
    <div className="w-full">
      <div className="flex w-8/12  bg-white shadow-md rounded-lg overflow-hidden mx-auto">
        <div className="flex flex-col w-full">
          <div className="flex p-5 border-b">
            <img
              className="w-20 h-20 object-cover"
              alt="User avatar"
              src="https://images.unsplash.com/photo-1477118476589-bff2c5c4cfbb?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=crop&w=200&q=200"
            />
            <div className="flex flex-col px-2 w-full">
              <span className="text-xs text-gray-700 uppercase font-medium ">
                now playing
              </span>
              <span className="text-sm text-red-500 capitalize font-semibold pt-1">
                I think I need a sunrise, I&apos;m tired of the sunset
              </span>
              <span className="text-xs text-gray-500 uppercase font-medium ">
                -&quot;Boston,&rdquo; Augustana
              </span>
              <div className="flex justify-end">
                <img
                  className="w-5 cursor-pointer"
                  src="https://www.iconpacks.net/icons/2/free-favourite-icon-2765-thumb.png"
                />
                <img
                  className="w-5 cursor-pointer mx-2"
                  src="https://www.iconpacks.net/icons/2/free-favourite-icon-2765-thumb.png"
                />
                <img
                  className="w-5 cursor-pointer"
                  src="https://www.iconpacks.net/icons/2/free-favourite-icon-2765-thumb.png"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center p-5">
            <div className="flex items-center">
              <div className="flex space-x-3 p-2">
                <button className="focus:outline-none">
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#ef4444"
                    stroke-width="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polygon points="19 20 9 12 19 4 19 20"></polygon>
                    <line x1="5" y1="19" x2="5" y2="5"></line>
                  </svg>
                </button>
                <button className="rounded-full w-10 h-10 flex items-center justify-center pl-0.5 ring-1 ring-red-400 focus:outline-none">
                  <svg
                    className="w-5 h-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#ef4444"
                    stroke-width="2"
                    stroke-linecap="round"
                    strokeLinejoin="round"
                  >
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                  </svg>
                </button>
                <button className="focus:outline-none">
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#ef4444"
                    stroke-width="2"
                    stroke-linecap="round"
                    strokeLinejoin="round"
                  >
                    <polygon points="5 4 15 12 5 20 5 4"></polygon>
                    <line x1="19" y1="5" x2="19" y2="19"></line>
                  </svg>
                </button>
              </div>
            </div>
            <div className="relative w-full sm:w-1/2 md:w-7/12 lg:w-4/6 ml-2">
              <div className="bg-red-300 h-2 w-full rounded-lg"></div>
              <div className="bg-red-500 h-2 w-1/2 rounded-lg absolute top-0"></div>
            </div>
            <div className="flex justify-end w-full sm:w-auto pt-1 sm:pt-0">
              <span className="text-xs text-gray-700 uppercase font-medium pl-2">
                02:00/04:00
              </span>
            </div>
          </div>

          <div className="flex flex-col p-5">
            <div className="border-b pb-1 flex justify-between items-center mb-2">
              <span className=" text-base font-semibold uppercase text-gray-700">
                {" "}
                play list
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
