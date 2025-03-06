import useNowPlayingTrack from "@/hooks/useNowPlayingTrack";
import React from "react";

const NowPlaying = () => {
  const { data: nowPlaying } = useNowPlayingTrack();
  console.log("nowPlaying :>> ", nowPlaying);

  const { item: nowPlayingTrack, is_playing } = nowPlaying!;

  const {
    name,
    artists,
    album: { images },
  } = nowPlayingTrack;

  return (
    <div>
      <div className="flex p-5 border-b">
        <img
          className="w-20 h-20 object-cover"
          alt="User avatar"
          src={images[0].url}
        />
        <div className="flex flex-col px-2 w-full">
          <span className="text-xs text-gray-700 uppercase font-medium ">
            now playing
          </span>
          <span className="text-sm text-red-500 capitalize font-semibold pt-1">
            {name}
          </span>
          <span className="text-xs text-gray-500 uppercase font-medium ">
            - {artists.map((artist) => artist.name).join(", ")}
          </span>
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
    </div>
  );
};

export default NowPlaying;
