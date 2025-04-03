import { TrackDetails, TrackItem } from "@/shared/types";
import { FC, useState } from "react";
import { faSearch } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useAddTrackToPlaylist } from "@/hooks/useAddTrackToPlaylist";
import { Portal } from "@headlessui/react";

interface SearchInputProps {
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  searchResults: TrackDetails[];
  setSearchResults: (value: TrackDetails[]) => void;
  playlistId: string;
}

const SearchInput: FC<SearchInputProps> = ({
  searchQuery,
  setSearchQuery,
  searchResults,
  setSearchResults,
  playlistId,
}) => {
  const { addTrack } = useAddTrackToPlaylist({ playlistId });
  const [isOpen, setIsOpen] = useState(false);

  const handleChange = (value: string) => {
    setSearchQuery(value);
    setIsOpen(true);
  };

  const handleAddTrack = (track: TrackDetails) => {
    setSearchResults([]);
    setSearchQuery("");
    setIsOpen(false);
    const trackItem: TrackItem = {
      added_at: new Date().toISOString(),
      added_by: {
        id: "user",
        type: "user",
        uri: "spotify:user:user",
        href: "https://api.spotify.com/v1/users/user",
        external_urls: {
          spotify: "https://open.spotify.com/user/user",
        },
      },
      is_local: false,
      track: {
        uri: track.uri,
        name: track.name,
        artists: track.artists,
        album: track.album,
        duration_ms: track.duration_ms,
        id: track.id,
        available_markets: track.available_markets,
        disc_number: track.disc_number,
        explicit: track.explicit,
        external_ids: track.external_ids,
        external_urls: track.external_urls,
        href: track.href,
        is_local: track.is_local,
        is_playable: track.is_playable,
        popularity: track.popularity,
        preview_url: track.preview_url,
        track_number: track.track_number,
        type: track.type,
      },
    };
    console.log('Adding track:', trackItem);
    addTrack(trackItem, () => {
      // Dispatch a custom event to refresh the playlist
      const event = new CustomEvent('playlistRefresh', {
        detail: { timestamp: Date.now() }
      });
      window.dispatchEvent(event);
    }).catch(error => {
      console.error('Failed to add track:', error);
    });
  };

  return (
    <div className="relative flex w-full sm:w-10/12 md:w-8/12 lg:w-9/12 rounded-lg flex-wrap md:flex-nowrap gap-4">
      <div className="relative flex-1">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <FontAwesomeIcon icon={faSearch} className="text-gray-400" />
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="What do you want to listen to?"
          className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          aria-label="Search for songs, albums, or artists"
        />
        {isOpen && searchResults.length > 0 && (
          <div className="absolute z-50 w-full mt-1 bg-white rounded-md shadow-lg max-h-60 overflow-auto border border-gray-200" style={{ isolation: 'isolate' }}>
            <div className="bg-white rounded-md">
              <ul className="py-1 text-base overflow-auto focus:outline-none sm:text-sm">
                {searchResults.map((track) => (
                  <li
                    key={track.id}
                    onClick={() => handleAddTrack(track)}
                    className="cursor-pointer select-none relative py-2 pl-3 pr-9 bg-gray-100 hover:bg-gray-200"
                  >
                    <div className="flex items-center">
                      <img
                        src={track.album.images[2].url}
                        alt={track.name}
                        className="h-8 w-8 rounded-full flex-shrink-0"
                      />
                      <div className="ml-3">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{track.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {track.artists.map((artist, index) => (
                            <span key={index}>
                              {artist.name}
                              {index < track.artists.length - 1 ? ", " : ""}
                            </span>
                          ))}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchInput;
