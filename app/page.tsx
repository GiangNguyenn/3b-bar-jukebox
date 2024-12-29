"use client";

import { useCreateNewDailyPlaylist } from "@/hooks/useCreateNewDailyPlayList";
import { useGetPlaylist } from "@/hooks/useGetPlaylist";
import { useMyPlaylists } from "@/hooks/useMyPlaylists";
import { useEffect } from "react";

export default function Home() {
  const { data } = useMyPlaylists();
  const { createPlaylist, isLoading, todayPlaylistId } =
    useCreateNewDailyPlaylist();
  
  const { data: todayPlaylist } = useGetPlaylist(todayPlaylistId ?? "");

  console.log("data :>> ", data);

  useEffect(() => {
    const createDailyPlaylist = async () => {
      try {
        const playlist = await createPlaylist();
        console.log("Daily playlist:", playlist);
      } catch (err) {
        console.error("Error creating daily playlist:", err);
      }
    };

    createDailyPlaylist();
  }, [createPlaylist]);

  if (isLoading) return <p>Loading playlists...</p>;

  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      {/* display name + tracks of the playlist */}
      {todayPlaylist ? (
        <div>
          <h1 className="text-3xl font-bold text-center">Today's Playlist</h1>
          <h2 className="text-xl font-semibold text-center">
            {todayPlaylist.name}
          </h2>
          <>
            {todayPlaylist.tracks?.items?.map((track) => (
              <li key={track.track.id}>{track.track.name}</li>
            ))}
          </>
        </div>
      ) : (
        <p>No playlist found.</p>
      )}
    </div>
  );
}
