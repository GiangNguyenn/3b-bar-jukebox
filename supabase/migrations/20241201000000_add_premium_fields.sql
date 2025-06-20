-- Add premium-related fields to profiles table
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS spotify_provider_id TEXT,
ADD COLUMN IF NOT EXISTS spotify_product_type TEXT,
ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS premium_verified_at TIMESTAMP WITH TIME ZONE;

-- Add Spotify token fields if they don't exist
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS spotify_access_token TEXT,
ADD COLUMN IF NOT EXISTS spotify_refresh_token TEXT,
ADD COLUMN IF NOT EXISTS spotify_token_expires_at BIGINT;

-- Add index on is_premium for faster queries
CREATE INDEX IF NOT EXISTS idx_profiles_is_premium ON profiles(is_premium);

-- Add index on spotify_product_type for faster queries
CREATE INDEX IF NOT EXISTS idx_profiles_spotify_product_type ON profiles(spotify_product_type);

-- Add index on premium_verified_at for faster queries
CREATE INDEX IF NOT EXISTS idx_profiles_premium_verified_at ON profiles(premium_verified_at); 