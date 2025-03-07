import useNowPlayingTrack from "@/hooks/useNowPlayingTrack";
import React from "react";
import VinylSpinningAnimation from "./VinylSpinningAnimation";

const NowPlaying = () => {
  const { data: nowPlaying } = useNowPlayingTrack();

  if (!nowPlaying || !nowPlaying.item) {
    return (
      <div className="flex flex-rows items-center justify-start bg-white shadow-lg rounded-lg">
        <VinylSpinningAnimation is_playing={nowPlaying?.is_playing ?? false} />
        <div className="flex p-5 rounded-lg items-center justify-center">
          <span className="text-sm text-gray-600 font-medium">
            🎵 Nothing is playing right now, you can still add your track
          </span>
        </div>
      </div>
    );
  }

  const { item: nowPlayingTrack, is_playing } = nowPlaying;
  const { name, artists, album } = nowPlayingTrack;

  return (
    <div className="bg-white shadow-lg rounded-lg">
      <div className="flex p-5 border-b items-center">
        <VinylSpinningAnimation
          is_playing={is_playing}
          albumCover={album.images[0].url}
        />
        <div className="flex flex-col px-3 w-full">
          <span className="text-xs text-gray-600 uppercase font-medium tracking-wide">
            Now Playing
          </span>
          <span className="text-sm text-red-500 capitalize font-semibold pt-1 truncate">
            {name}
          </span>
          <span className="text-xs text-gray-500 uppercase font-medium truncate">
            - {artists.map((artist) => artist.name).join(", ")}
          </span>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-center p-5">
        <div className="relative w-full sm:w-1/2 md:w-7/12 lg:w-5/6 ml-3">
          <div className="bg-gray-300 h-2 w-full rounded-lg overflow-hidden">
            <div
              className="bg-red-500 h-2 rounded-lg"
              style={{ width: is_playing ? "50%" : "0%" }}
            ></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NowPlaying;
