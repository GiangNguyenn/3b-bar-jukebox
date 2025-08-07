-- Create branding_settings table
CREATE TABLE IF NOT EXISTS public.branding_settings (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL,
    
    -- Logo and Images
    logo_url text NULL,
    favicon_url text NULL,
    
    -- Text Elements
    venue_name text NULL DEFAULT '3B Jukebox',
    subtitle text NULL,
    welcome_message text NULL,
    footer_text text NULL,
    
    -- Typography
    font_family text NULL DEFAULT 'Belgrano',
    font_size text NULL DEFAULT 'text-4xl',
    font_weight text NULL DEFAULT 'normal',
    text_color text NULL DEFAULT '#ffffff',
    
    -- Color Scheme
    primary_color text NULL DEFAULT '#C09A5E',
    secondary_color text NULL DEFAULT '#191414',
    background_color text NULL DEFAULT '#000000',
    accent_color_1 text NULL,
    accent_color_2 text NULL,
    accent_color_3 text NULL,
    
    -- Gradients
    gradient_type text NULL DEFAULT 'none', -- 'none', 'linear', 'radial'
    gradient_direction text NULL, -- 'to-b', 'to-r', 'to-br', etc.
    gradient_stops text NULL, -- JSON array of color stops
    
    -- SEO & Metadata
    page_title text NULL DEFAULT '3B Jukebox',
    meta_description text NULL DEFAULT 'The Ultimate Shared Music Experience',
    open_graph_title text NULL DEFAULT '3B Jukebox',
    
    -- Timestamps
    created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    
    CONSTRAINT branding_settings_pkey PRIMARY KEY (id),
    CONSTRAINT branding_settings_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
    CONSTRAINT branding_settings_profile_id_key UNIQUE (profile_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS branding_settings_profile_id_idx ON public.branding_settings (profile_id);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_branding_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if it exists, then create it
DROP TRIGGER IF EXISTS branding_settings_updated_at ON public.branding_settings;
CREATE TRIGGER branding_settings_updated_at
    BEFORE UPDATE ON public.branding_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_branding_settings_updated_at(); 