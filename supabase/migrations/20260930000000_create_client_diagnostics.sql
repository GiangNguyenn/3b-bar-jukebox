-- Remote diagnostics: browser logs, automatic diagnostic snapshots and a
-- per-page-load heartbeat, written by POST /api/diagnostics with the service
-- role and read over SQL. See docs/remote-diagnostics.md.

CREATE TABLE IF NOT EXISTS public.client_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  logged_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  level text NOT NULL CHECK (level IN ('INFO', 'WARN', 'ERROR')),
  context text,
  message text NOT NULL,
  repeat_count integer NOT NULL DEFAULT 1,
  error jsonb,
  details jsonb,
  path text,
  app_version text
);

CREATE INDEX IF NOT EXISTS idx_client_logs_profile_logged
  ON public.client_logs(profile_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_logs_session
  ON public.client_logs(session_id, logged_at);

CREATE TABLE IF NOT EXISTS public.diagnostic_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  captured_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  trigger text NOT NULL,
  trigger_detail text,
  severity text NOT NULL,
  page text,
  app_version text,
  snapshot jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_diagnostic_snapshots_profile_captured
  ON public.diagnostic_snapshots(profile_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS public.client_sessions (
  session_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  page text,
  app_version text,
  user_agent text,
  state jsonb
);

CREATE INDEX IF NOT EXISTS idx_client_sessions_profile_seen
  ON public.client_sessions(profile_id, last_seen_at DESC);

-- No policies: only the service role (the ingest route) and direct SQL can
-- read or write these tables.
ALTER TABLE public.client_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnostic_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_sessions ENABLE ROW LEVEL SECURITY;

-- Keeps storage bounded: everything older than 3 days goes, and a per-profile
-- row cap stops a runaway error loop filling the database inside that window.
CREATE OR REPLACE FUNCTION public.prune_client_diagnostics()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  DELETE FROM public.client_logs
    WHERE received_at < now() - interval '3 days';
  DELETE FROM public.diagnostic_snapshots
    WHERE received_at < now() - interval '3 days';
  DELETE FROM public.client_sessions
    WHERE last_seen_at < now() - interval '3 days';

  DELETE FROM public.client_logs l
    USING (
      SELECT id,
        row_number() OVER (PARTITION BY profile_id ORDER BY id DESC) AS rn
      FROM public.client_logs
    ) ranked
    WHERE l.id = ranked.id AND ranked.rn > 20000;

  DELETE FROM public.diagnostic_snapshots s
    USING (
      SELECT id,
        row_number() OVER (PARTITION BY profile_id ORDER BY id DESC) AS rn
      FROM public.diagnostic_snapshots
    ) ranked
    WHERE s.id = ranked.id AND ranked.rn > 200;
$$;

REVOKE ALL ON FUNCTION public.prune_client_diagnostics()
  FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

SELECT cron.schedule(
  'prune-client-diagnostics',
  '17 * * * *',
  $$SELECT public.prune_client_diagnostics()$$
);
