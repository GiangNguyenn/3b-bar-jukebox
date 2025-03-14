import { TrackDetails } from "@/shared/types";
import { Autocomplete, AutocompleteItem, Avatar, Button } from "@heroui/react";
import { useEffect, useState } from "react";
import { faSearch } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useAddTrackToPlaylist } from "@/hooks/useAddTrackToPlaylist";
import { useDebouncedCallback } from "use-debounce";
import useSearchTracks from "@/hooks/useSearchTracks";


const SearchInput = () => {
  const { addTrack } = useAddTrackToPlaylist();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<TrackDetails[]>([]);

  const handleChange = (value: string) => {
    setSearchQuery(value);
  };
  const { searchTracks } = useSearchTracks();

  async function fetchTracks() {
    const tracks = await searchTracks(searchQuery);
    setSearchResults(tracks);
  }

  const debouced = useDebouncedCallback(fetchTracks, 300);
  useEffect(() => {
    if (searchQuery) {
      debouced();
    }
  }, [searchQuery]);


  const handleAddTrack = (trackURI: string) => {
    setSearchResults([]);
    setSearchQuery("");

    addTrack(trackURI);
  };

  return (
    <div className="flex w-8/12 flex-wrap md:flex-nowrap gap-4">
      <Autocomplete
        aria-label="Search for songs, albums, or artists"
        placeholder="What do you want to listen to?"
        type="text"
        inputValue={searchQuery}
        onInputChange={(value) => handleChange(value)}
        selectorIcon={<FontAwesomeIcon icon={faSearch} />}
        disableSelectorIconRotation
        allowsEmptyCollection={searchResults.length > 0}
        listboxProps={{
          hideSelectedIcon: true,
          itemClasses: {
            base: [
              "rounded-medium",
              "text-default-500",
              "transition-opacity",
              "data-[hover=true]:text-foreground",
              "dark:data-[hover=true]:bg-default-50",
              "data-[pressed=true]:opacity-70",
              "data-[hover=true]:bg-default-200",
              "data-[selectable=true]:focus:bg-default-100",
              "data-[focus-visible=true]:ring-default-500",
            ],
          },
        }}
      >
        {searchResults.map((track) => (
          <AutocompleteItem
            key={track.id}
            textValue={track.name}
            onPress={() => handleAddTrack(track.uri)}
          >
            <div className="flex justify-between items-center">
              <div className="flex gap-2 items-center">
                <Avatar
                  alt={track.name}
                  className="flex-shrink-0"
                  size="sm"
                  src={track.album.images[2].url}
                />
                <div className="flex flex-col">
                  <span className="text-small">{track.name}</span>
                  <div className="text-tiny text-default-400">
                    {track.artists.map((artist, index) => (
                      <span key={index}>
                        {artist.name}
                        {index < track.artists.length - 1 ? ", " : ""}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </AutocompleteItem>
        ))}
      </Autocomplete>
    </div>
  );
};

export default SearchInput;
