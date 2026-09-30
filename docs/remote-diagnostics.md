# Remote diagnostics

The jukebox uploads its own logs and diagnostics to Supabase whenever something goes wrong, so a problem at a venue can be diagnosed without anyone there doing anything. This page is the runbook for reading them, written for a person or an AI agent.

## How to get the logs

Run SQL against the jukebox Supabase project. In Claude Code that is the `supabase-jukebox` MCP server's `execute_sql` tool; the Supabase SQL editor works too. The tables have row-level security with no policies, so they are not readable through the app's public API.

Start here:

```sql
-- 1. Is the jukebox alive, and what is it doing right now?
select p.display_name, s.page, s.last_seen_at, now() - s.last_seen_at as silent_for,
       s.state->'player' as player, s.state->>'online' as online, s.app_version
from client_sessions s join profiles p on p.id = s.profile_id
order by s.last_seen_at desc limit 10;

-- 2. What went wrong recently? (one row per automatic snapshot)
select d.id, p.display_name, d.captured_at, d.trigger, d.trigger_detail, d.severity, d.page, d.session_id
from diagnostic_snapshots d join profiles p on p.id = d.profile_id
order by d.captured_at desc limit 20;

-- 3. Read one snapshot in full
select snapshot from diagnostic_snapshots where id = <id>;

-- 4. The timeline around it (same page load, 10 minutes before to 5 after)
select logged_at, level, context, message, repeat_count, error, details
from client_logs
where session_id = '<session_id>'
  and logged_at between timestamptz '<captured_at>' - interval '10 minutes'
                    and timestamptz '<captured_at>' + interval '5 minutes'
order by logged_at, id;
```

Other useful queries:

```sql
-- Errors and warnings in the last 6 hours for one venue
select l.logged_at, l.level, l.context, l.message, l.repeat_count, l.error->>'message' as error
from client_logs l join profiles p on p.id = l.profile_id
where p.display_name = '<venue>' and l.level in ('WARN','ERROR')
  and l.logged_at > now() - interval '6 hours'
order by l.logged_at desc;

-- Which subsystem is failing most, and since which deploy
select context, level, app_version, sum(repeat_count) as lines, min(logged_at), max(logged_at)
from client_logs
where level in ('WARN','ERROR') and logged_at > now() - interval '24 hours'
group by 1, 2, 3 order by lines desc;

-- Failed network requests by host and status
select details->>'host' as host, details->>'status' as status, details->>'errorName' as error,
       count(*), max(logged_at) as last_seen
from client_logs
where context = 'Network' and logged_at > now() - interval '24 hours'
group by 1, 2, 3 order by count(*) desc;

-- Was the tab backgrounded, frozen, or the laptop asleep?
select logged_at, level, message, details
from client_logs
where context = 'Lifecycle' and session_id = '<session_id>'
order by logged_at;
```

## What is stored

| Table                  | One row per              | Written when                                                                |
| ---------------------- | ------------------------ | --------------------------------------------------------------------------- |
| `client_sessions`      | page load (`session_id`) | Every upload, and a heartbeat every 5 minutes. Updated in place.            |
| `client_logs`          | log line                 | WARN/ERROR immediately. INFO only when a snapshot is triggered (see below). |
| `diagnostic_snapshots` | detected problem         | Automatically, on the triggers below.                                       |

Only signed-in venue owners upload, from any page their browser has open. Guests upload nothing.

### `client_logs`

- `context` is the module that logged the line (`PlaybackHealth`, `TokenManager`, `PlayerLifecycle`, …). Special values:
  - `Console` — a raw `console.warn` / `console.error` that did not go through the app's logger.
  - `Network` — a failed or slow (>5s) `fetch`, or an online/offline change. `details` has `method`, `host`, `path`, `status` (null if the request threw), `durationMs`, `errorName`, `retryAfter`, and for the app's own `/api/*` routes the start of the error `body`.
  - `Lifecycle` — tab hidden/visible, frozen/resumed, discarded, or "Main thread paused for Ns" (laptop asleep, tab throttled, or a long blocking task).
  - `Window` — an uncaught error or unhandled promise rejection.
- `repeat_count` — consecutive identical lines are collapsed into one row.
- `logged_at` is the browser's clock; `received_at` is the server's. A large difference means the line was queued while offline.
- INFO lines are the "flight recorder": the last 200 are kept in memory and uploaded only when a snapshot fires, so they show the lead-up to a problem. A quiet period with no INFO rows means nothing went wrong, not that nothing happened.

### `diagnostic_snapshots`

`snapshot->>'kind'` is `full` when the admin page was open (the same data as the "Copy Diagnostics" button: `summary`, `criticalIssues`, `systemState`, `details`, `errorAnalysis`, `rootCauseAnalysis`, `tokenRecovery`) or `reduced` on any other page (player status, lifecycle internals, recovery state, token timestamps). Both add `network` (per-host request counts, failures, p95 duration) and `performance` (uptime, JS heap, long tasks). `truncated: true` means sections were dropped to stay under 100KB.

| `trigger`          | Meaning                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `health_error`     | Health check in error for 10s+: device error/disconnected, playback error/stalled, token error, connection lost, consecutive failures |
| `health_degraded`  | Device unresponsive or connection poor/unstable for 30s+                                                                              |
| `player_stuck`     | Player not `ready` for 30s+                                                                                                           |
| `recovery_attempt` | Spotify device lost; the player is being rebuilt                                                                                      |
| `token_suspended`  | Token recovery exhausted                                                                                                              |
| `error_log`        | An ERROR line was logged                                                                                                              |
| `uncaught_error`   | Uncaught error or unhandled promise rejection                                                                                         |
| `warn_burst`       | 5+ WARN lines within a minute                                                                                                         |
| `offline`          | Browser offline, or 3+ failed requests to one host within a minute                                                                    |
| `timer_gap`        | Main thread paused 15s+ (5 min+ if the tab was hidden)                                                                                |
| `realtime_down`    | Supabase realtime channel error or timeout                                                                                            |
| `still_unhealthy`  | Every 15 minutes while a condition above persists                                                                                     |
| `recovered`        | A condition cleared; `trigger_detail` names it                                                                                        |

Triggers that land within 5 seconds share one snapshot; the others are listed in `trigger_detail` as `(also: …)`. Each trigger type has a 60s cooldown and a page load uploads at most 10 snapshots an hour, so a missing snapshot during a storm is expected. The WARN/ERROR lines are still there.

### `client_sessions.state`

`player` (`status`, `hasDevice`, `isPlaying`, `track`), `online`, `visibility`, `connection` (`effectiveType`, `downlink`, `rtt`), `performance` (`uptimeSeconds`, `heapMb`, `longTasks`), `buffers` (lines waiting to upload).

## Reading it

- **`last_seen_at` stopped** — the laptop is off, asleep, offline, or the tab was closed. Nothing else can tell you this: no errors are logged by a machine that isn't running.
- **`Lifecycle` rows just before playback stopped** — the browser paused the tab; this is not an app bug.
- **`Network` rows for `api.spotify.com` with 401** — token trouble; look at `rootCauseAnalysis` in the snapshot. **429** — rate limited; `retryAfter` says for how long. **Thrown errors across several hosts** — the venue's connection.
- **`app_version`** is the git commit SHA of the deploy, to tie a new failure to a change.

## Limits

- Retention is **3 days**, and at most 20,000 log rows and 200 snapshots per venue. An hourly `pg_cron` job (`prune-client-diagnostics`) enforces both.
- Requests made by the Supabase client are not captured by the network tap (it binds `fetch` before the tap is installed). Their failures still appear as ordinary log lines.
- Server-side errors in API routes are not stored here. The response body of a failed `/api/*` call is, which usually carries the message; the rest is in Vercel's runtime logs.
- Access tokens, query strings and request bodies are never uploaded; messages are redacted for bearer tokens, JWTs and long opaque strings.

## Where the code is

| Piece                                       | File                                                               |
| ------------------------------------------- | ------------------------------------------------------------------ |
| Upload queue, flight recorder, redaction    | `shared/utils/remoteLogShipper.ts`                                 |
| When to take a snapshot                     | `services/diagnostics/anomalyDetector.ts`                          |
| Console, network, lifecycle, heartbeat      | `services/diagnostics/instrumentation.ts`                          |
| Enables it for signed-in owners             | `components/RemoteLogBridge.tsx`                                   |
| Health-based triggers and the full snapshot | `hooks/useDiagnosticSnapshotUploader.ts`                           |
| Ingest endpoint                             | `app/api/diagnostics/route.ts`                                     |
| Tables, retention job                       | `supabase/migrations/20260930000000_create_client_diagnostics.sql` |
