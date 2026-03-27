# Token Refresh Cascade Fix — Bugfix Design

## Overview

When all three token endpoints (user, admin, public) fail to return a fresh Spotify token, the system enters a cascade failure: `RecoveryManager` caps at 3 retries but never signals downstream services to stop. `AutoPlayService`, `useDeviceHealth`, `useMetadataBackfill`, and `QueueManager` continue making doomed Spotify API requests via `sendApiRequest` → `tokenManager.getToken()`, each independently hitting the same dead token endpoints and generating a storm of timeout/abort errors.

The fix introduces a coordinated "token suspended" state in `RecoveryManager` that dependent services can query before making API calls. When all endpoints fail and retries are exhausted, `RecoveryManager` broadcasts a suspension signal, dependent services pause, and a background exponential-backoff loop periodically reattempts token refresh. On success, services resume automatically.

The secondary fix enriches the diagnostic clipboard output with token timestamps, HTTP error details, a `rootCauseAnalysis` causal chain section, error deduplication, and disconnection timestamps.

## Glossary

- **Bug_Condition (C)**: All three token endpoints fail AND `RecoveryManager` exhausts retries AND dependent services continue making Spotify API requests with the expired token
- **Property (P)**: Dependent services enter a suspended state, no further Spotify API calls are made until token recovery succeeds, and diagnostic output captures the full causal chain
- **Preservation**: Existing token caching, per-endpoint `fetchWithRetry`, `onRefresh` callbacks, independent service operation with valid tokens, and existing diagnostic panel format/fields remain unchanged
- **RecoveryManager**: Singleton in `services/player/recoveryManager.ts` that tracks auth retry state (failure count, cooldown) — currently has no mechanism to notify downstream services
- **TokenManager**: Singleton in `shared/token/tokenManager.ts` that manages token caching and refresh across three endpoints (user → admin → public) with `fetchWithRetry` per endpoint
- **sendApiRequest**: Shared API utility in `shared/api.ts` that acquires tokens via `tokenManager.getToken()` before each Spotify API call — handles 401 retry but has no awareness of coordinated token failure
- **Dependent Services**: `AutoPlayService` (polling-based playback monitor), `useDeviceHealth` (interval-based device checker), `useMetadataBackfill` (interval-based metadata enricher), `QueueManager` (queue operations via fetch)

## Bug Details

### Bug Condition

The bug manifests when the Spotify auth token expires and all three token endpoints fail to return a fresh token. The `RecoveryManager` exhausts its 3 retry attempts and sets `isRecoveryNeeded = true`, but this flag is only checked by `PlayerLifecycleService.handleAuthenticationError` — it is never propagated to `AutoPlayService`, `useDeviceHealth`, `useMetadataBackfill`, or `QueueManager`. These services continue their polling/interval loops, each independently calling `tokenManager.getToken()` or `sendApiRequest`, which re-triggers the failed token refresh flow, generating cascading timeout and abort errors.

**Formal Specification:**

```
FUNCTION isBugCondition(input)
  INPUT: input of type { tokenEndpointResults: EndpointResult[], recoveryRetryCount: number, dependentServiceRequests: ApiRequest[] }
  OUTPUT: boolean

  allEndpointsFailed := EVERY endpoint IN input.tokenEndpointResults
                        SATISFIES endpoint.success == false

  recoveryExhausted := input.recoveryRetryCount >= 3

  servicesStillRequesting := EXISTS request IN input.dependentServiceRequests
                             WHERE request.timestamp > recoveryExhaustedTimestamp
                             AND request.targetIsSpotifyApi == true

  RETURN allEndpointsFailed
         AND recoveryExhausted
         AND servicesStillRequesting
END FUNCTION
```

### Examples

- **AutoPlayService cascade**: Token expires → `checkPlaybackState()` fires on its 5s interval → calls `getCurrentPlaybackState()` → `sendApiRequest` → `tokenManager.getToken()` → all 3 endpoints fail (user 401, admin 401, public 401) → throws → `checkPlaybackState` catches silently → 5s later, repeats. Meanwhile `RecoveryManager` has already given up after 3 attempts.
- **DeviceHealth cascade**: `useDeviceHealth` fires on 60s interval → calls `sendApiRequest({ path: 'me/player' })` → same token failure → `handleHealthError` logs it → next interval repeats.
- **MetadataBackfill cascade**: `useMetadataBackfill` fires on 60s interval → calls `backfillRandomMissingTrack(accessToken)` with a stale token → Spotify returns 401 → logged as error → next interval repeats.
- **Diagnostic blind spot**: Admin copies diagnostics during cascade → output shows `token: "error"` but no HTTP status codes, no endpoint-specific failures, no timestamps of when token expired vs when cascade started, and 50+ duplicate "Token refresh failed" log entries with no grouping.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- When the token is valid and not expiring soon, `tokenManager.getToken()` returns the cached token without making refresh requests (requirement 3.1)
- When a single transient network error occurs during token refresh, `fetchWithRetry` retries up to 2 times with exponential backoff per endpoint before falling through to the next endpoint (requirement 3.2)
- When the token is successfully refreshed, all registered `onRefresh` callbacks are invoked and `RecoveryManager` state is reset (requirement 3.3)
- When dependent services operate with a valid token, they function independently with their existing retry and error handling logic (requirement 3.4)
- When the diagnostic panel is opened with no active errors, it displays the current system status, playback state, queue information, and recent events in the existing format (requirement 3.5)
- When "Copy Diagnostics" is clicked, the output includes all existing fields (`summary`, `criticalIssues`, `systemState`, `details`, `errorAnalysis`, `logs`) in addition to any new fields (requirement 3.6)

**Scope:**
All inputs where the token is valid OR where only a single transient failure occurs (recoverable within `fetchWithRetry`) should be completely unaffected by this fix. This includes:

- Normal playback with valid tokens
- Single-endpoint transient failures that recover on retry
- Manual pause/resume operations
- Queue operations with valid auth
- Diagnostic panel display when system is healthy

## Hypothesized Root Cause

Based on the bug description and code analysis, the root causes are:

1. **No downstream notification mechanism**: `RecoveryManager` tracks retry state (`failureCount`, `cooldownMs`) but has no pub/sub or callback system to notify dependent services when recovery is exhausted. The `isRecoveryNeeded` flag in `PlayerLifecycleService` is a local boolean, not a shared signal.

2. **Dependent services are fire-and-forget**: `AutoPlayService.checkPlaybackState()` catches all errors silently in its polling loop. `useDeviceHealth` catches errors in `handleHealthError` but continues its interval. `useMetadataBackfill` catches errors and continues its interval. None of them check whether the system is in a token-failure state before making API calls.

3. **`sendApiRequest` 401 retry amplifies the problem**: When a Spotify API call returns 401, `sendApiRequest` clears the token cache and calls `tokenManager.getToken()` again — which re-triggers the full 3-endpoint refresh flow (each with up to 2 retries via `fetchWithRetry`). Every dependent service poll cycle triggers this amplification independently.

4. **TokenManager lacks failure metadata**: `tryTokenEndpoint` returns `{ expiry: 0 }` on failure without capturing HTTP status codes or response bodies. The `refreshToken` method stores `lastError` but doesn't record per-endpoint failure details, making it impossible to distinguish network failures from invalid credentials from Spotify outages.

5. **Diagnostic output lacks temporal and causal context**: `formatDiagnosticsForClipboard` includes `errorAnalysis.repeatedFailures` (good) but doesn't include token-specific timestamps (last refresh, expiry time), doesn't identify the root cause in the causal chain, doesn't deduplicate consecutive identical events in `recentEvents`, and doesn't record disconnection timestamps.

## Correctness Properties

Property 1: Bug Condition — Dependent Services Suspend on Token Recovery Failure

_For any_ system state where all three token endpoints have failed and `RecoveryManager` has exhausted its retry attempts, the fixed system SHALL prevent all dependent services (`AutoPlayService`, `useDeviceHealth`, `useMetadataBackfill`, `QueueManager`) from making Spotify API requests, and SHALL enter a coordinated token recovery state with exponential backoff retry.

**Validates: Requirements 2.1, 2.2**

Property 2: Preservation — Normal Operation Unchanged When Token Is Valid

_For any_ system state where the token is valid (not expired, not in recovery), the fixed code SHALL produce exactly the same behavior as the original code: dependent services operate independently, `tokenManager.getToken()` returns cached tokens, `fetchWithRetry` handles transient errors per-endpoint, `onRefresh` callbacks fire on success, and diagnostic output retains all existing fields and format.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

Property 3: Diagnostic Enrichment — Root Cause Analysis and Deduplication

_For any_ diagnostic output generated during a token cascade failure, the fixed `formatDiagnosticsForClipboard` SHALL include a `rootCauseAnalysis` section identifying the earliest causal error, token timestamps, HTTP error details per endpoint, deduplicated consecutive identical errors with count and time range, and disconnection timestamps.

**Validates: Requirements 2.3, 2.4, 2.5, 2.6**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `services/player/recoveryManager.ts`

**Function**: `RecoveryManager` class

**Specific Changes**:

1. **Add token suspension state**: Add `isSuspended` boolean and `suspendedAt` timestamp. When `failureCount >= maxRetries`, set `isSuspended = true`.
2. **Add suspension listener system**: Add `onSuspensionChange(callback: (suspended: boolean) => void): () => void` method that dependent services can subscribe to. When suspension state changes, notify all listeners.
3. **Add `isTokenSuspended()` public method**: Returns whether the system is in token-suspended state. Dependent services check this before making API calls.
4. **Add exponential backoff recovery loop**: When suspended, start a background retry loop with exponential backoff (5s, 10s, 20s, 40s... capped at 5 minutes). On success, clear suspension and notify listeners. On max duration exceeded (e.g., 30 minutes), surface a user-facing error.
5. **Add token failure metadata**: Track per-endpoint failure details (HTTP status, error code, endpoint label, timestamp) in a `lastFailureDetails` array exposed via `getDiagnostics()`.

---

**File**: `shared/token/tokenManager.ts`

**Function**: `tryTokenEndpoint`, `refreshToken`

**Specific Changes**:

1. **Capture HTTP error details in `tryTokenEndpoint`**: When a non-OK response is received, record `{ endpoint: label, httpStatus: response.status, errorCode, errorMessage, timestamp: Date.now() }` and return it alongside the existing error.
2. **Expose last refresh attempt details**: Add `getLastRefreshAttemptDetails()` method returning per-endpoint failure info from the most recent `refreshToken` call.
3. **Add token timestamps**: Track `lastSuccessfulRefresh` and `tokenExpiryTime` timestamps, exposed via a `getTokenTimestamps()` method.
4. **Notify RecoveryManager on total failure**: After all endpoints fail in `refreshToken`, call `recoveryManager.enterSuspendedState(failureDetails)` to trigger coordinated suspension.

---

**File**: `shared/api.ts`

**Function**: `sendApiRequest` (inner `makeRequest`)

**Specific Changes**:

1. **Check suspension before API calls**: Before acquiring a token for Spotify API calls, check `recoveryManager.isTokenSuspended()`. If suspended, throw an `ApiError` with a descriptive message and status 503 instead of attempting the doomed token refresh.

---

**File**: `services/autoPlayService.ts`

**Function**: `AutoPlayService.checkPlaybackState`, `start`

**Specific Changes**:

1. **Subscribe to suspension changes**: In `start()`, subscribe to `recoveryManager.onSuspensionChange()`. When suspended, pause the polling interval. When resumed, restart polling.
2. **Guard API calls**: In `checkPlaybackState()`, early-return if `recoveryManager.isTokenSuspended()`.

---

**File**: `hooks/health/useDeviceHealth.ts`

**Function**: `useDeviceHealth`

**Specific Changes**:

1. **Guard health checks**: In `checkDeviceHealth()`, early-return if `recoveryManager.isTokenSuspended()`.

---

**File**: `hooks/useMetadataBackfill.ts`

**Function**: `useMetadataBackfill`

**Specific Changes**:

1. **Guard backfill runs**: In `runBackfill()`, early-return if `recoveryManager.isTokenSuspended()`.

---

**File**: `app/[username]/admin/components/dashboard/components/diagnostic-utils.ts`

**Function**: `formatDiagnosticsForClipboard`

**Specific Changes**:

1. **Add `rootCauseAnalysis` section**: Analyze `recentEvents` and logs to identify the earliest token-related error, build a causal chain (token failure → downstream cascade), and include token timestamps from `tokenManager.getTokenTimestamps()`.
2. **Add error deduplication**: Before outputting `recentEvents`, collapse consecutive identical events into `{ message, count, firstSeen, lastSeen }` entries.
3. **Add disconnection timestamp**: Include `disconnectedAt` timestamp from health status when connection is disconnected.
4. **Add HTTP error details**: Include per-endpoint failure details from `recoveryManager.getDiagnostics()` in the output.
5. **Preserve all existing fields**: The new sections are additive — `summary`, `criticalIssues`, `systemState`, `details`, `errorAnalysis`, `logs` remain unchanged.

---

**File**: `shared/types/health.ts`

**Specific Changes**:

1. **Add `disconnectedAt` to `HealthStatus`**: Optional `disconnectedAt?: number` field to record when disconnection occurred.
2. **Add `tokenTimestamps` to `HealthStatus`**: Optional `tokenTimestamps?: { lastSuccessfulRefresh?: number, tokenExpiryTime?: number }` field.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that simulate all three token endpoints failing, verify that `RecoveryManager` exhausts retries, then observe whether dependent services continue making API calls. Run these tests on the UNFIXED code to observe failures and understand the root cause.

**Test Cases**:

1. **Cascade Propagation Test**: Mock all 3 token endpoints to return 401 → exhaust RecoveryManager retries → verify AutoPlayService.checkPlaybackState() still fires and calls sendApiRequest (will fail on unfixed code — services keep calling)
2. **No Suspension Signal Test**: After RecoveryManager exhausts retries → verify there is no mechanism for dependent services to detect the exhausted state (will fail on unfixed code — no isTokenSuspended method exists)
3. **Token Error Detail Test**: Mock token endpoint returning 401 with `{ error: "invalid_grant" }` → verify tryTokenEndpoint captures HTTP status and error code (will fail on unfixed code — details not captured)
4. **Diagnostic Missing Info Test**: Generate diagnostic output during simulated cascade → verify rootCauseAnalysis section exists (will fail on unfixed code — section doesn't exist)

**Expected Counterexamples**:

- Dependent services continue making API calls after RecoveryManager exhausts retries
- No suspension notification mechanism exists in RecoveryManager
- Token endpoint failure details (HTTP status, error code) are not captured
- Diagnostic output lacks rootCauseAnalysis, token timestamps, and deduplication

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**

```
FOR ALL input WHERE isBugCondition(input) DO
  // All endpoints failed, recovery exhausted
  result := simulateTokenCascade(input)
  ASSERT recoveryManager.isTokenSuspended() == true
  ASSERT dependentServiceApiCallCount == 0
  ASSERT diagnosticOutput.rootCauseAnalysis IS NOT NULL
  ASSERT diagnosticOutput.rootCauseAnalysis.causalChain.length > 0
  ASSERT diagnosticOutput.tokenTimestamps IS NOT NULL
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**

```
FOR ALL input WHERE NOT isBugCondition(input) DO
  // Token is valid, or single transient failure recovers
  ASSERT tokenManager.getToken_fixed(input) == tokenManager.getToken_original(input)
  ASSERT recoveryManager.isTokenSuspended() == false
  ASSERT dependentServicesOperateIndependently(input)
  ASSERT diagnosticOutput_fixed CONTAINS ALL FIELDS OF diagnosticOutput_original
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:

- It generates many test cases automatically across the input domain (valid tokens, single transient failures, various token expiry times)
- It catches edge cases that manual unit tests might miss (e.g., token expiring exactly at the refresh threshold boundary)
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for valid-token scenarios and single-failure recovery, then write property-based tests capturing that behavior.

**Test Cases**:

1. **Token Caching Preservation**: Verify that `tokenManager.getToken()` returns cached token without fetch calls when token is valid — observe on unfixed code, then verify after fix
2. **fetchWithRetry Preservation**: Verify that single transient network errors trigger retry with exponential backoff per endpoint — observe on unfixed code, then verify after fix
3. **onRefresh Callback Preservation**: Verify that successful token refresh invokes all registered callbacks — observe on unfixed code, then verify after fix
4. **Diagnostic Format Preservation**: Verify that diagnostic output with no errors contains all existing fields in the same structure — observe on unfixed code, then verify after fix

### Unit Tests

- Test `RecoveryManager.isTokenSuspended()` returns true after max retries exhausted
- Test `RecoveryManager.onSuspensionChange()` notifies listeners on state transitions
- Test `RecoveryManager` exponential backoff recovery loop timing
- Test `TokenManager.tryTokenEndpoint` captures HTTP status and error details
- Test `TokenManager.getTokenTimestamps()` returns correct timestamps
- Test `sendApiRequest` throws 503 when `isTokenSuspended()` is true
- Test `formatDiagnosticsForClipboard` includes `rootCauseAnalysis` section
- Test error deduplication collapses consecutive identical errors with count and time range
- Test disconnection timestamp is recorded and included in diagnostic output

### Property-Based Tests

- Generate random sequences of token endpoint results (success/failure combinations) and verify: suspension is entered if and only if all endpoints fail AND retries exhausted
- Generate random valid token states and verify: `getToken()` returns cached token, no suspension triggered, dependent services not affected
- Generate random sequences of diagnostic events with duplicates and verify: deduplication produces correct counts and time ranges, and expanding deduplicated entries matches original count
- Generate random health status objects with no errors and verify: diagnostic output contains all existing fields unchanged

### Integration Tests

- Test full cascade scenario: mock all 3 endpoints failing → verify AutoPlayService pauses → mock endpoint recovery → verify AutoPlayService resumes
- Test partial failure: mock 2 endpoints failing, 1 succeeding → verify no suspension triggered, token obtained from working endpoint
- Test diagnostic panel during cascade: trigger cascade → copy diagnostics → verify rootCauseAnalysis, token timestamps, deduplication, and all existing fields present
