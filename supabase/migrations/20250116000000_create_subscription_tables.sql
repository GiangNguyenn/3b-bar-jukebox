-- Create subscription management tables
-- User Story 1.1: Create Subscription Management Tables

-- Create subscriptions table
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL,
    stripe_subscription_id text UNIQUE,
    stripe_customer_id text,
    plan_type text NOT NULL CHECK (plan_type IN ('free', 'premium')),
    payment_type text NOT NULL CHECK (payment_type IN ('monthly', 'lifetime')),
    status text NOT NULL CHECK (status IN ('active', 'canceled', 'past_due', 'trialing', 'incomplete')),
    current_period_start timestamp with time zone,
    current_period_end timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    
    CONSTRAINT subscriptions_pkey PRIMARY KEY (id),
    CONSTRAINT subscriptions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

-- Add subscription_id foreign key to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS subscription_id uuid REFERENCES public.subscriptions(id);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS subscriptions_profile_id_idx ON public.subscriptions (profile_id);
CREATE INDEX IF NOT EXISTS subscriptions_stripe_subscription_id_idx ON public.subscriptions (stripe_subscription_id);
CREATE INDEX IF NOT EXISTS subscriptions_stripe_customer_id_idx ON public.subscriptions (stripe_customer_id);
CREATE INDEX IF NOT EXISTS subscriptions_plan_type_idx ON public.subscriptions (plan_type);
CREATE INDEX IF NOT EXISTS subscriptions_status_idx ON public.subscriptions (status);
CREATE INDEX IF NOT EXISTS subscriptions_payment_type_idx ON public.subscriptions (payment_type);
CREATE INDEX IF NOT EXISTS subscriptions_current_period_end_idx ON public.subscriptions (current_period_end);

-- Create index for profiles subscription_id
CREATE INDEX IF NOT EXISTS profiles_subscription_id_idx ON public.profiles (subscription_id);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_subscriptions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if it exists, then create it
DROP TRIGGER IF EXISTS subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER subscriptions_updated_at
    BEFORE UPDATE ON public.subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_subscriptions_updated_at();

-- Create helper function to get user's current plan type
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

-- Create helper function to check if user has premium access
CREATE OR REPLACE FUNCTION has_premium_access(user_profile_id uuid)
RETURNS boolean AS $$
DECLARE
    user_plan text;
BEGIN
    SELECT get_user_plan_type(user_profile_id) INTO user_plan;
    RETURN user_plan = 'premium';
END;
$$ LANGUAGE plpgsql;

-- Create helper function to get subscription details
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