-- Add unique constraint to display_name column
-- This ensures each username is unique for routing purposes

-- Add unique constraint for display_name
ALTER TABLE public.profiles ADD CONSTRAINT profiles_display_name_key UNIQUE (display_name);

-- Add index for performance on display_name lookups
CREATE INDEX IF NOT EXISTS profiles_display_name_idx ON public.profiles (display_name); 