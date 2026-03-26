-- Drop RLS policies
DROP POLICY IF EXISTS "Allow all branding operations" ON public.branding_settings;
DROP POLICY IF EXISTS "Users can manage their own branding" ON public.branding_settings;
DROP POLICY IF EXISTS "Public read access to branding settings" ON public.branding_settings;

-- Drop trigger and function
DROP TRIGGER IF EXISTS branding_settings_updated_at ON public.branding_settings;
DROP FUNCTION IF EXISTS update_branding_settings_updated_at();

-- Drop table
DROP TABLE IF EXISTS public.branding_settings;
