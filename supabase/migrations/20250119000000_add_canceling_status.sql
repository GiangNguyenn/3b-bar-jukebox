-- Add 'canceling' status for subscriptions that are canceled but still active until period end
-- This allows premium access to continue until the billing period actually ends

-- Update the status constraint to include 'canceling'
ALTER TABLE public.subscriptions 
DROP CONSTRAINT IF EXISTS subscriptions_status_check;

ALTER TABLE public.subscriptions 
ADD CONSTRAINT subscriptions_status_check 
CHECK (status IN ('active', 'canceled', 'canceling', 'past_due', 'trialing', 'incomplete'));

-- Update the get_user_plan_type function to include 'canceling' as active
CREATE OR REPLACE FUNCTION get_user_plan_type(user_profile_id uuid)
RETURNS text AS $$
DECLARE
    user_plan text;
BEGIN
    -- Get the most recent active or canceling subscription for the user
    SELECT plan_type INTO user_plan
    FROM public.subscriptions
    WHERE profile_id = user_profile_id
      AND status IN ('active', 'canceling')
    ORDER BY created_at DESC
    LIMIT 1;
    
    -- Return 'free' if no active subscription found
    RETURN COALESCE(user_plan, 'free');
END;
$$ LANGUAGE plpgsql;

-- Update the get_user_subscription_details function to include 'canceling'
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
      AND s.status IN ('active', 'canceling')
    ORDER BY s.created_at DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql; 