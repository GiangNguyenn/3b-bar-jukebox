-- Enable RLS on playlists table
ALTER TABLE playlists ENABLE ROW LEVEL SECURITY;

-- Create policy to allow public read access to playlists
CREATE POLICY "Public can view playlists"
ON playlists
FOR SELECT
USING (true);

-- Create policy to restrict modification to playlist owner
CREATE POLICY "Users can modify their own playlists"
ON playlists
FOR ALL
USING (auth.uid() = user_id); 