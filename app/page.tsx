"use client";
import { useCreateNewDailyPlaylist } from "@/hooks/useCreateNewDailyPlayList";
import { useGetPlaylist } from "@/hooks/useGetPlaylist";
import { useEffect } from "react";
import { Playlist } from "@/components/Playlist/Playlist";
import Loading from "./loading";
import SearchInput from "@/components/SearchInput";

export default function Home() {
  const { createPlaylist, todayPlaylistId } = useCreateNewDailyPlaylist();
  const { data: todayPlaylist, isLoading } = useGetPlaylist(
    todayPlaylistId ?? ""
  );

  useEffect(() => {
    (async () => {
      if (!todayPlaylistId) {
        await createPlaylist();
      }
    })();
  }, [createPlaylist]);

  if (isLoading || !todayPlaylist || !todayPlaylistId) {
    return <Loading />;
  }

  const { tracks, name } = todayPlaylist!;

  return (
    <div className="items-center justify-items-center space-y-3 p-4 pt-10 font-mono">
      <SearchInput />
      <h1 className="text-3xl text-center font-[family-name:var(--font-parklane)]">
        {name}
      </h1>
      <Playlist tracks={tracks.items} />
    </div>
  );
}
