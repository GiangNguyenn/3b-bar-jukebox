import useNowPlayingTrack from "@/hooks/useNowPlayingTrack";
import React from "react";
import VinylSpinningAnimation from "./VinylSpinningAnimation";

const NowPlaying = () => {
  const { data: nowPlaying } = useNowPlayingTrack();

  if (!nowPlaying || !nowPlaying.item) {
    return (
      <div className="flex flex-rows p-2 items-center justify-start bg-white shadow-lg rounded-lg">
        <VinylSpinningAnimation is_playing={nowPlaying?.is_playing ?? false} />
        <div className="flex flex-col px-3 w-full">
          <span className="text-sm text-gray-500 font-medium">
            🎵 Nothing is playing right now, you can still add your track
          </span>
        </div>
      </div>
    );
  }

  const { item: nowPlayingTrack, is_playing } = nowPlaying;
  const { name, artists, album } = nowPlayingTrack;

  return (
    <div className="flex flex-rows items-center justify-start p-2 bg-white shadow-lg rounded-lg">
      <VinylSpinningAnimation
        is_playing={is_playing}
        albumCover={album.images[0].url}
      />
      <div className="flex flex-col px-3 w-full">
        <span className="text-xs text-gray-600 uppercase font-medium tracking-wide">
          Now Playing
        </span>
        <span className="text-sm text-secondary-500 capitalize font-semibold pt-1 truncate">
          {name}
        </span>
        <span className="text-xs text-gray-500 uppercase font-medium truncate">
          - {artists.map((artist) => artist.name).join(", ")}
        </span>
      </div>
    </div>
  );
};

export default NowPlaying;
