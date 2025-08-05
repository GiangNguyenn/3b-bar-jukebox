-- Optimize subscription queries with additional indexes
-- This migration adds indexes for common subscription query patterns

-- Index for querying subscriptions by profile_id and status (most common query)
CREATE INDEX IF NOT EXISTS idx_subscriptions_profile_status 
ON subscriptions(profile_id, status);

-- Index for querying active subscriptions only
CREATE INDEX IF NOT EXISTS idx_subscriptions_active 
ON subscriptions(profile_id) WHERE status = 'active';

-- Index for querying by plan type
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan_type 
ON subscriptions(profile_id, plan_type);

-- Index for querying by payment type
CREATE INDEX IF NOT EXISTS idx_subscriptions_payment_type 
ON subscriptions(profile_id, payment_type);

-- Index for querying by current period end (for expiration checks)
CREATE INDEX IF NOT EXISTS idx_subscriptions_period_end 
ON subscriptions(current_period_end) WHERE current_period_end IS NOT NULL;

-- Composite index for profile_id with all commonly queried fields
CREATE INDEX IF NOT EXISTS idx_subscriptions_profile_composite 
ON subscriptions(profile_id, status, plan_type, payment_type);

-- Index for Stripe-related queries
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe 
ON subscriptions(stripe_subscription_id, stripe_customer_id) 
WHERE stripe_subscription_id IS NOT NULL;

-- Index for profiles table to optimize JOIN queries
CREATE INDEX IF NOT EXISTS idx_profiles_subscription_lookup 
ON profiles(id, subscription_id);

-- Optimize the existing profiles_subscription_id_idx for better performance
DROP INDEX IF EXISTS profiles_subscription_id_idx;
CREATE INDEX IF NOT EXISTS idx_profiles_subscription_id 
ON profiles(subscription_id) WHERE subscription_id IS NOT NULL;

-- Create a materialized view for frequently accessed subscription data
CREATE MATERIALIZED VIEW IF NOT EXISTS user_subscription_summary AS
SELECT 
  p.id as profile_id,
  p.display_name,
  s.id as subscription_id,
  s.plan_type,
  s.payment_type,
  s.status,
  s.current_period_start,
  s.current_period_end,
  s.stripe_subscription_id,
  s.stripe_customer_id,
  s.created_at as subscription_created_at,
  s.updated_at as subscription_updated_at
FROM profiles p
LEFT JOIN subscriptions s ON p.subscription_id = s.id
WHERE s.status = 'active' OR s.status IS NULL;

-- Create index on the materialized view
CREATE INDEX IF NOT EXISTS idx_user_subscription_summary_profile 
ON user_subscription_summary(profile_id);

CREATE INDEX IF NOT EXISTS idx_user_subscription_summary_plan 
ON user_subscription_summary(profile_id, plan_type);

-- Function to refresh the materialized view
CREATE OR REPLACE FUNCTION refresh_user_subscription_summary()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW user_subscription_summary;
END;
$$ LANGUAGE plpgsql;

-- Create a function to get user subscription status efficiently
CREATE OR REPLACE FUNCTION get_user_subscription_status(user_profile_id uuid)
RETURNS TABLE(
  profile_id uuid,
  plan_type text,
  payment_type text,
  status text,
  has_premium_access boolean,
  current_period_end timestamp with time zone
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id as profile_id,
    COALESCE(s.plan_type, 'free') as plan_type,
    COALESCE(s.payment_type, 'monthly') as payment_type,
    COALESCE(s.status, 'active') as status,
    (s.plan_type = 'premium' AND s.status = 'active') as has_premium_access,
    s.current_period_end
  FROM profiles p
  LEFT JOIN subscriptions s ON p.subscription_id = s.id
  WHERE p.id = user_profile_id;
END;
$$ LANGUAGE plpgsql;

-- Create a function to check if user has premium access (optimized)
CREATE OR REPLACE FUNCTION check_premium_access(user_profile_id uuid)
RETURNS boolean AS $$
DECLARE
  has_access boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 
    FROM subscriptions s
    JOIN profiles p ON p.subscription_id = s.id
    WHERE p.id = user_profile_id 
    AND s.plan_type = 'premium' 
    AND s.status = 'active'
  ) INTO has_access;
  
  RETURN COALESCE(has_access, false);
END;
$$ LANGUAGE plpgsql;

-- Create a function to get user plan type (optimized)
CREATE OR REPLACE FUNCTION get_user_plan_type_optimized(user_profile_id uuid)
RETURNS text AS $$
DECLARE
  plan text;
BEGIN
  SELECT COALESCE(s.plan_type, 'free')
  FROM profiles p
  LEFT JOIN subscriptions s ON p.subscription_id = s.id
  WHERE p.id = user_profile_id
  INTO plan;
  
  RETURN plan;
END;
$$ LANGUAGE plpgsql;

-- Create a trigger to refresh materialized view when subscriptions change
CREATE OR REPLACE FUNCTION refresh_subscription_summary_trigger()
RETURNS trigger AS $$
BEGIN
  PERFORM refresh_user_subscription_summary();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for the materialized view
DROP TRIGGER IF EXISTS trigger_refresh_subscription_summary ON subscriptions;
CREATE TRIGGER trigger_refresh_subscription_summary
  AFTER INSERT OR UPDATE OR DELETE ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION refresh_subscription_summary_trigger();

DROP TRIGGER IF EXISTS trigger_refresh_subscription_summary_profiles ON profiles;
CREATE TRIGGER trigger_refresh_subscription_summary_profiles
  AFTER UPDATE OF subscription_id ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION refresh_subscription_summary_trigger(); 