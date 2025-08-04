-- Update existing profiles to have subscription links
-- User Story 1.2: Update Profile Schema - Migration for existing profiles

-- Create free subscriptions for existing profiles that don't have subscriptions
INSERT INTO public.subscriptions (
    profile_id,
    plan_type,
    payment_type,
    status,
    stripe_subscription_id,
    stripe_customer_id
)
SELECT 
    p.id as profile_id,
    'free' as plan_type,
    'monthly' as payment_type,
    'active' as status,
    NULL as stripe_subscription_id,
    NULL as stripe_customer_id
FROM public.profiles p
LEFT JOIN public.subscriptions s ON p.id = s.profile_id
WHERE s.id IS NULL;

-- Update existing profiles to link to their subscriptions
UPDATE public.profiles 
SET subscription_id = s.id
FROM public.subscriptions s
WHERE profiles.id = s.profile_id 
  AND profiles.subscription_id IS NULL;

-- Create a helper function to get user's current plan type (if not already exists)
CREATE OR REPLACE FUNCTION get_user_plan_type(user_profile_id uuid)
RETURNS text AS $$
DECLARE
    user_plan text;
BEGIN
    -- Get the most recent active subscription for the user
    SELECT plan_type INTO user_plan
    FROM public.subscriptions
    WHERE profile_id = user_profile_id
      AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 1;
    
    -- Return 'free' if no active subscription found
    RETURN COALESCE(user_plan, 'free');
END;
$$ LANGUAGE plpgsql;

-- Create a helper function to check if user has premium access (if not already exists)
CREATE OR REPLACE FUNCTION has_premium_access(user_profile_id uuid)
RETURNS boolean AS $$
DECLARE
    user_plan text;
BEGIN
    SELECT get_user_plan_type(user_profile_id) INTO user_plan;
    RETURN user_plan = 'premium';
END;
$$ LANGUAGE plpgsql;

-- Create a helper function to get subscription details (if not already exists)
CREATE OR REPLACE FUNCTION get_user_subscription_details(user_profile_id uuid)
RETURNS TABLE(
    plan_type text,
    payment_type text,
    status text,
    current_period_end timestamp with time zone,
    stripe_subscription_id text
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.plan_type,
        s.payment_type,
        s.status,
        s.current_period_end,
        s.stripe_subscription_id
    FROM public.subscriptions s
    WHERE s.profile_id = user_profile_id
      AND s.status = 'active'
    ORDER BY s.created_at DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql; 