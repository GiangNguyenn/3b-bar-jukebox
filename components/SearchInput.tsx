import { TrackDetails } from "@/shared/types";
import { FC, useState } from "react";
import { faSearch } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useAddTrackToPlaylist } from "@/hooks/useAddTrackToPlaylist";

interface SearchInputProps {
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  searchResults: TrackDetails[];
  setSearchResults: (value: TrackDetails[]) => void;
}

const SearchInput: FC<SearchInputProps> = ({
  searchQuery,
  setSearchQuery,
  searchResults,
  setSearchResults,
}) => {
  const { addTrack } = useAddTrackToPlaylist();
  const [isOpen, setIsOpen] = useState(false);

  const handleChange = (value: string) => {
    setSearchQuery(value);
    setIsOpen(true);
  };

  const handleAddTrack = (trackURI: string) => {
    setSearchResults([]);
    setSearchQuery("");
    setIsOpen(false);
    addTrack(trackURI);
  };

  return (
    <div className="relative flex bg-white-500 w-full sm:w-10/12 md:w-8/12 lg:w-9/12 rounded-lg flex-wrap md:flex-nowrap gap-4">
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
      </div>
      {isOpen && searchResults.length > 0 && (
        <div className="absolute z-10 w-full mt-1 bg-white rounded-md shadow-lg max-h-60 overflow-auto">
          <ul className="py-1 text-base overflow-auto focus:outline-none sm:text-sm">
            {searchResults.map((track) => (
              <li
                key={track.id}
                onClick={() => handleAddTrack(track.uri)}
                className="cursor-pointer select-none relative py-2 pl-3 pr-9 hover:bg-gray-100"
              >
                <div className="flex items-center">
                  <img
                    src={track.album.images[2].url}
                    alt={track.name}
                    className="h-8 w-8 rounded-full flex-shrink-0"
                  />
                  <div className="ml-3">
                    <p className="text-sm font-medium text-gray-900">{track.name}</p>
                    <p className="text-xs text-gray-500">
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
      )}
    </div>
  );
};

export default SearchInput;
