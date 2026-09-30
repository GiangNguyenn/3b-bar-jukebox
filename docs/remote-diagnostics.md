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

When the music stopped, start with the playback timeline. It needs no snapshot:

```sql
-- 5. What played, when it stopped, and what the player and Spotify said about it
select logged_at, level, context, message, repeat_count
from client_logs
where session_id = '<session_id>'
  and context in ('PlaybackTimeline','PlaybackWatch','SpotifySDK','PlayerInit',
                  'PlayerAutoRecovery','DeviceValidation','PlayerLifecycle')
  and logged_at > now() - interval '1 hour'
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

| Table                  | One row per              | Written when                                                                                                                                  |
| ---------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `client_sessions`      | page load (`session_id`) | Every upload, and a heartbeat every 5 minutes. Updated in place.                                                                              |
| `client_logs`          | log line                 | WARN/ERROR immediately. INFO only when a snapshot is triggered (see below), except the playback timeline contexts, which are always uploaded. |
| `diagnostic_snapshots` | detected problem         | Automatically, on the triggers below.                                                                                                         |

Only signed-in venue owners upload, from any page their browser has open. Guests upload nothing.

### `client_logs`

- `context` is the module that logged the line (`PlaybackHealth`, `TokenManager`, `PlayerLifecycle`, …). Special values:
  - `Console` — a raw `console.warn` / `console.error` that did not go through the app's logger.
  - `Network` — a failed or slow (>5s) `fetch`, or an online/offline change. `details` has `method`, `host`, `path`, `status` (null if the request threw), `durationMs`, `errorName`, `retryAfter`, and for the app's own `/api/*` routes the start of the error `body`.
  - `Lifecycle` — tab hidden/visible, frozen/resumed, discarded, or "Main thread paused for Ns" (laptop asleep, tab throttled, or a long blocking task).
  - `Window` — an uncaught error or unhandled promise rejection.
  - `PlaybackTimeline` — always uploaded, a few lines per track: `Track started: "…" by … (3:45)`, `Playback paused: … at 1:23 of 3:45, not requested from the jukebox`, `Playback paused from the jukebox: …`, `Playback resumed: …`, `Track ended: … — nothing has started after it yet`. The gap between two tracks is not logged.
  - `PlaybackWatch` — one ERROR, `Playback stopped: silent for 30s after "…" — <reason>; player <status>, N in queue, tab <visible | hidden for …>`, once the jukebox has been silent for 30s when it should be playing (it had been playing and nobody paused it). The reason is one of: the player is in an error status, the track ended and the next one did not start, the queue is empty, playback paused mid-track without a request, or the SDK went quiet past the end of the track. Followed by a WARN `Playback resumed after … of silence` when music returns. **Search for this first.**
  - `SpotifySDK` — always uploaded: every event from the Spotify Web Playback SDK (`ready`, `not_ready`, `initialization_error`, `authentication_error`, `account_error`, `playback_error`, `autoplay_failed`, and `player_state_changed with no state`, which means another device took over).
  - `PlayerInit` — always uploaded: each step of creating the player (`loading the Spotify SDK script`, `connecting to Spotify`, `waiting for Spotify to report the device ready`, `verifying the new device with Spotify`, `moving playback to the new device (attempt n of 4)`), then `Player setup complete in …` or an ERROR naming the step it failed or timed out in and whether the tab was hidden.
  - `DeviceValidation` — when Spotify's device list does not include the player: `Player device 4ba4a729… is not registered with Spotify. Spotify lists …` with the name, type and active flag of every device it does list, and where Spotify says playback is. An empty list and a phone that took over the account are different problems.
- `repeat_count` — a line that keeps repeating is uploaded once, then as one row per minute carrying the number of repeats in that minute, even when other lines are interleaved with it. A high `repeat_count` on a row means a loop.
- `logged_at` is the browser's clock; `received_at` is the server's. A large difference means the line was queued while offline.
- INFO lines are the "flight recorder": the last 200 are kept in memory and uploaded only when a snapshot fires, so they show the lead-up to a problem. A quiet period with no INFO rows means nothing went wrong, not that nothing happened.

### `diagnostic_snapshots`

`snapshot->>'kind'` is `full` when the admin page was open (the same data as the "Copy Diagnostics" button: `summary`, `criticalIssues`, `systemState`, `details`, `errorAnalysis`, `rootCauseAnalysis`, `tokenRecovery`) or `reduced` on any other page (player status, lifecycle internals, recovery state, token timestamps). Both add `network` (per-host request counts, failures, p95 duration) and `performance` (uptime, JS heap, long tasks). `truncated: true` means sections were dropped to stay under 100KB.

| `trigger`          | Meaning                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `playback_stopped` | Silent for 30s when it should be playing; `trigger_detail` has the reason (see `PlaybackWatch` above)                                 |
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

Triggers that land within 5 seconds share one snapshot, filed under the most serious of them; the others are listed in `trigger_detail` as `(also: …)`. Each trigger type has a 60s cooldown.

There are two hourly budgets per page load. `playback_stopped`, `recovery_attempt`, `player_stuck`, `health_error`, `token_suspended`, `still_unhealthy` and `recovered` share a budget of 10 that nothing else can use, so a real failure always gets its snapshot. Everything else shares another 10, of which any one trigger may take at most 4, and `warn_burst` and `realtime_down` at most 2 each. A missing routine snapshot during a storm is expected; the WARN/ERROR lines are still there.

### `client_sessions.state`

`capturedAt`, `player`, `online`, `visibility`, `hiddenForSeconds`, `connection` (`effectiveType`, `downlink`, `rtt`), `performance` (`uptimeSeconds`, `heapMb`, `longTasks`), `buffers` (lines waiting to upload).

`player` has `status`, `lastError`, `recoveryRequested`, `hasDevice`, `isPlaying`, `track`, `positionSeconds`, `durationSeconds`, `sdkEventAgeSeconds` (how old that position is; the SDK is quiet during steady play), `manualPause`, `queueLength`, `lastTrack`, `lastTrackStartedAt`, `silentForSeconds` and `stopped` (the `Playback stopped` alarm is active).

The state is rewritten every 5 minutes and also within a few seconds of the player status, the track, or playing/paused changing, and when playback is declared stopped or resumes. `last_seen_at` moves with every upload, so compare it with `state->>'capturedAt'` to see how old the state is.

## Reading it

- **`last_seen_at` stopped** — the laptop is off, asleep, offline, or the tab was closed. Nothing else can tell you this: no errors are logged by a machine that isn't running.
- **The music stopped** — find the `Playback stopped` row (`context = 'PlaybackWatch'`), read its reason, then read the `SpotifySDK`, `PlayerInit` and `DeviceValidation` rows around it (query 5). A `not_ready` or `player_state_changed with no state` just before says Spotify dropped or replaced the device; a `DeviceValidation` row listing another active device says something else is using the account; `Player setup timed out … while <step>` says where a rebuild got stuck, and `tab hidden for …` on those rows says whether it happened in a background tab.
- **`Lifecycle` rows just before playback stopped** — the browser paused the tab; this is not an app bug.
- **`Network` rows for `api.spotify.com` with 401** — token trouble; look at `rootCauseAnalysis` in the snapshot. **429** — rate limited; `retryAfter` says for how long. **Thrown errors across several hosts** — the venue's connection.
- **`app_version`** is the git commit SHA of the deploy, to tie a new failure to a change.

## Limits

- Retention is **3 days**, and at most 20,000 log rows and 200 snapshots per venue. An hourly `pg_cron` job (`prune-client-diagnostics`) enforces both.
- Requests made by the Supabase client are not captured by the network tap (it binds `fetch` before the tap is installed). Their failures still appear as ordinary log lines.
- Server-side errors in API routes are not stored here. The response body of a failed `/api/*` call is, which usually carries the message; the rest is in Vercel's runtime logs.
- Access tokens, query strings and request bodies are never uploaded; messages are redacted for bearer tokens, JWTs and long opaque strings.

## Where the code is

| Piece                                       | File                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| Upload queue, flight recorder, redaction    | `shared/utils/remoteLogShipper.ts`                                         |
| When to take a snapshot                     | `services/diagnostics/anomalyDetector.ts`                                  |
| Playback timeline and the stopped alarm     | `services/diagnostics/playbackWatch.ts`                                    |
| SDK events and player setup steps           | `services/playerLifecycle/PlayerEventHandler.ts`, `SDKLifecycleManager.ts` |
| What Spotify lists when the device is gone  | `services/deviceManagement/deviceValidation.ts`                            |
| Console, network, lifecycle, heartbeat      | `services/diagnostics/instrumentation.ts`                                  |
| Enables it for signed-in owners             | `components/RemoteLogBridge.tsx`                                           |
| Health-based triggers and the full snapshot | `hooks/useDiagnosticSnapshotUploader.ts`                                   |
| Ingest endpoint                             | `app/api/diagnostics/route.ts`                                             |
| Tables, retention job                       | `supabase/migrations/20260930000000_create_client_diagnostics.sql`         |
