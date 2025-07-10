# Artist Extract Feature

This document outlines the architectural plan for implementing the "Artist Extract" feature. This feature will display a biographical extract for the currently playing artist.

## API Endpoint Definition

A new API endpoint will be created to fetch the artist's biographical extract.

*   **Route**: `GET /api/artist-extract`
*   **Query Parameter**: `artistName` (string) - The name of the artist to look up.
*   **Successful Response (200 OK)**:
    *   A JSON object containing the artist's biographical extract.
    *   **Payload Example**:
        ```json
        {
          "extract": "An English rock band formed in Liverpool in 1960..."
        }
        ```
*   **Error Responses**:
    *   **404 Not Found**: Returned if the artist cannot be found or has no extract available.
    *   **500 Internal Server Error**: Returned for any unexpected server-side errors, such as issues with a third-party API (e.g., Wikipedia/MusicBrainz).

## Frontend Changes

The frontend will be updated to consume the new API endpoint and display the artist extract in the "Now Playing" section.

### New Hook: `useArtistExtract.ts`

A new React hook will be created to manage fetching the artist extract.

*   **Path**: `hooks/useArtistExtract.ts`
*   **Input**: `artistName: string | null`
*   **Functionality**:
    *   Takes an artist's name as an argument.
    *   When `artistName` is provided, it will make a GET request to the `/api/artist-extract` endpoint.
    *   It will manage the loading state while the data is being fetched.
    *   It will manage any errors that occur during the fetch operation.
*   **Returns**: An object containing:
    *   `extract: string | null`
    *   `isLoading: boolean`
    *   `error: Error | null`

### Playlist Page: `app/[username]/playlist/page.tsx`

The main playlist page will integrate the new hook to fetch the data.

*   **Integration**:
    *   The page will use the `useCurrentlyPlaying` hook to get the current track.
    *   It will then call the `useArtistExtract` hook, passing the artist's name from the `currentlyPlaying` track.
    *   The fetched `extract`, `isLoading`, and `error` states will be passed down to the `NowPlaying` component.

### Now Playing Component: `components/Playlist/NowPlaying.tsx`

The `NowPlaying` component will be modified to display the artist extract.

*   **Props**:
    *   It will accept new props: `extract: string | null`, `isExtractLoading: boolean`.
*   **UI Changes**:
    *   When `isExtractLoading` is `true`, a loading skeleton or placeholder will be displayed where the extract will appear.
    *   If an `extract` is available, it will be displayed below the artist's name.
    *   If there is no extract or an error occurs, nothing will be displayed in its place.