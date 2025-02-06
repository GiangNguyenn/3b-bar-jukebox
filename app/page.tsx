"use client";

import Search from "@/components/Search";
import { useCreateNewDailyPlaylist } from "@/hooks/useCreateNewDailyPlayList";
import { useGetPlaylist } from "@/hooks/useGetPlaylist";
import { useEffect, useState } from "react";
import { useSearchTracks } from "../hooks/useSearchTracks";
import { TrackDetails } from "@/shared/types";

export default function Home() {
  const { createPlaylist, todayPlaylistId } = useCreateNewDailyPlaylist();
  const { data: todayPlaylist } = useGetPlaylist(todayPlaylistId ?? "");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<TrackDetails[]>([]);
  const { searchTracks } = useSearchTracks();

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
  }, []);

  const onSearchQueryChange = (e) => {
    setSearchQuery(e.target.value);
  };

  const onSearch = async () => {
    try {
      const tracks = await searchTracks(searchQuery);
      console.log("Search results:", tracks);
      setSearchResults(tracks);
    } catch (error) {
      console.error("Error searching tracks:", error);
    }
  };

  return (
    <div>
      <Search onChange={onSearchQueryChange} onSearch={onSearch} />
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

      <div>
        <h1 className="text-3xl font-bold text-center">Search Results</h1>
        <ul>
          {searchResults.map((track) => (
            <li key={track.id}>{track.name}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
