# Implementation Plan

- [x] 1. Write bug condition exploration test

  - **Property 1: Bug Condition** — Dependent Services Continue After Token Recovery Exhaustion
  - **IMPORTANT**: Write this property-based test BEFORE implementing the fix
  - **GOAL**: Surface counterexamples that demonstrate dependent services keep making Spotify API calls after RecoveryManager exhausts retries
  - **Scoped PBT Approach**: Scope the property to the concrete failing scenario: all 3 token endpoints return 401, RecoveryManager.failureCount >= 3 (maxRetries), then observe dependent service behavior
  - Create test file `services/__tests__/tokenCascadeBugCondition.test.ts` using `node:test` and `node:assert`
  - Mock `tokenManager.getToken()` to reject (simulating all 3 endpoints failing)
  - Mock `recoveryManager` with `failureCount >= maxRetries` so `canAttemptRecovery()` returns false
  - Test that `AutoPlayService.checkPlaybackState()` still calls `sendApiRequest` even when recovery is exhausted (from Bug Condition: `servicesStillRequesting` after `recoveryExhausted`)
  - Test that `recoveryManager` has no `isTokenSuspended()` method (no suspension mechanism exists)
  - Test that `recoveryManager` has no `onSuspensionChange()` listener method (no notification system exists)
  - Run test on UNFIXED code — expect FAILURE (this confirms the bug exists: services keep calling, no suspension API)
  - **EXPECTED OUTCOME**: Test FAILS — confirms dependent services have no way to detect exhausted recovery state
  - Document counterexamples: e.g., "AutoPlayService calls sendApiRequest 5 times in 25s after RecoveryManager exhausted retries"
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2_

- [x] 2. Write preservation property tests (BEFORE implementing fix)

  - **Property 2: Preservation** — Normal Token and Service Operation Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Create test file `services/__tests__/tokenCascadePreservation.test.ts` using `node:test` and `node:assert`
  - Observe on UNFIXED code: `tokenManager.getToken()` returns cached token when valid (no fetch calls)
  - Observe on UNFIXED code: `fetchWithRetry` retries up to 2 times with backoff on single transient failure, then falls through to next endpoint
  - Observe on UNFIXED code: successful token refresh invokes all registered `onRefresh` callbacks and resets RecoveryManager state
  - Observe on UNFIXED code: `formatDiagnosticsForClipboard` output contains `summary`, `criticalIssues`, `systemState`, `details`, `errorAnalysis`, `logs` fields
  - Write property-based tests:
    - For all valid token states (not expired, not in recovery): `getToken()` returns cached token without making network requests
    - For all single-transient-failure scenarios: `fetchWithRetry` retries per endpoint before falling through, token eventually obtained from a working endpoint
    - For all successful refresh scenarios: every registered `onRefresh` callback is invoked, `recoveryManager.failureCount` resets to 0
    - For all healthy system states: diagnostic output JSON contains all 6 existing top-level fields unchanged
  - Verify all tests PASS on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS — confirms baseline behavior to preserve
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 3. Implement token suspension and coordinated recovery in RecoveryManager

  - [x] 3.1 Add token suspension state and listener system to RecoveryManager

    - In `services/player/recoveryManager.ts`, add `private isSuspended = false` and `private suspendedAt: number | null = null`
    - Add `private suspensionListeners: Set<(suspended: boolean) => void>`
    - Add `public isTokenSuspended(): boolean` method returning `this.isSuspended`
    - Add `public onSuspensionChange(callback: (suspended: boolean) => void): () => void` that registers listener and returns unsubscribe function
    - Add `public enterSuspendedState(failureDetails: EndpointFailureDetail[]): void` that sets `isSuspended = true`, records `suspendedAt = Date.now()`, stores `lastFailureDetails`, notifies all listeners, and starts the backoff recovery loop
    - Add `private lastFailureDetails: EndpointFailureDetail[]` to track per-endpoint failure info (HTTP status, error code, endpoint label, timestamp)
    - Update `getDiagnostics()` to include `isSuspended`, `suspendedAt`, and `lastFailureDetails`
    - Use `createModuleLogger` for all logging — no `console.log`
    - _Bug_Condition: isBugCondition(input) where allEndpointsFailed AND recoveryRetryCount >= 3 AND servicesStillRequesting_
    - _Expected_Behavior: recoveryManager.isTokenSuspended() === true, all listeners notified_
    - _Preservation: When failureCount < maxRetries, isSuspended remains false; recordSuccess() clears suspension_
    - _Requirements: 2.1, 2.2, 1.1, 1.2_

  - [x] 3.2 Add exponential backoff recovery loop to RecoveryManager

    - Add `private startBackoffRecovery(): void` that starts a background retry loop
    - Backoff schedule: 5s → 10s → 20s → 40s → ... capped at 5 minutes between attempts
    - On each attempt, call `tokenManager.refreshIfNeeded()` (or equivalent)
    - On success: set `isSuspended = false`, clear `suspendedAt`, call `recordSuccess()`, notify listeners with `false`, stop loop
    - On max duration exceeded (30 minutes): log error, surface user-facing error via listener notification
    - Add `private backoffTimer: NodeJS.Timeout | null` and clean up in `reset()`
    - _Bug_Condition: After suspension, system must periodically reattempt recovery_
    - _Expected_Behavior: Exponential backoff retry until success or max duration_
    - _Requirements: 2.1_

  - [x] 3.3 Capture HTTP error details in TokenManager

    - In `shared/token/tokenManager.ts`, update `tryTokenEndpoint` to capture `{ endpoint: label, httpStatus: response.status, errorCode, errorMessage, timestamp: Date.now() }` on non-OK responses
    - Add `private lastRefreshAttemptDetails: EndpointFailureDetail[]` field
    - Add `public getLastRefreshAttemptDetails(): EndpointFailureDetail[]` method
    - Add `private lastSuccessfulRefresh: number | null` and `private tokenExpiryTime: number | null` timestamp tracking
    - Add `public getTokenTimestamps(): { lastSuccessfulRefresh?: number, tokenExpiryTime?: number }` method
    - In `refreshToken()`, after all endpoints fail, call `recoveryManager.enterSuspendedState(this.lastRefreshAttemptDetails)` to trigger coordinated suspension
    - _Bug_Condition: tryTokenEndpoint returns { expiry: 0 } without capturing HTTP details_
    - _Expected_Behavior: HTTP status, error code, endpoint label, and timestamp captured per failed endpoint_
    - _Preservation: Successful token refresh flow unchanged; fetchWithRetry backoff unchanged_
    - _Requirements: 2.3, 1.3_

  - [x] 3.4 Add suspension guard to sendApiRequest

    - In `shared/api.ts`, at the top of `sendApiRequest` (before token acquisition), check `recoveryManager.isTokenSuspended()`
    - If suspended, throw `new ApiError('Token refresh suspended — recovery in progress', { status: 503 })` instead of attempting the doomed token refresh
    - Import `recoveryManager` from `@/services/player/recoveryManager`
    - _Bug_Condition: sendApiRequest currently always attempts token refresh even when recovery is exhausted_
    - _Expected_Behavior: Immediate 503 rejection when suspended, preventing cascade amplification_
    - _Preservation: When not suspended, sendApiRequest behaves exactly as before_
    - _Requirements: 2.1, 2.2, 1.1_

  - [x] 3.5 Add suspension awareness to AutoPlayService

    - In `services/autoPlayService.ts`, in `start()`, subscribe to `recoveryManager.onSuspensionChange()` — when suspended, call `stop()` or pause polling; when resumed, call `startPolling()`
    - In `checkPlaybackState()`, add early-return guard: `if (recoveryManager.isTokenSuspended()) return`
    - Store unsubscribe function and call it in `stop()` for cleanup
    - _Bug_Condition: AutoPlayService.checkPlaybackState() fires every 5s during cascade_
    - _Expected_Behavior: Polling pauses when suspended, resumes on recovery_
    - _Preservation: When token is valid, AutoPlayService operates identically_
    - _Requirements: 2.1, 2.2, 1.1_

  - [x] 3.6 Add suspension guard to useDeviceHealth and useMetadataBackfill

    - In `hooks/health/useDeviceHealth.ts`, add early-return in `checkDeviceHealth()`: `if (recoveryManager.isTokenSuspended()) return`
    - In `hooks/useMetadataBackfill.ts`, add early-return in `runBackfill()`: `if (recoveryManager.isTokenSuspended()) return`
    - Import `recoveryManager` singleton in both files
    - _Bug_Condition: Both hooks fire on intervals during cascade, generating doomed API calls_
    - _Expected_Behavior: Hooks skip API calls when token is suspended_
    - _Preservation: When token is valid, hooks operate identically_
    - _Requirements: 2.1, 1.1, 1.2_

  - [x] 3.7 Enrich diagnostic output with root cause analysis

    - In `app/[username]/admin/components/dashboard/components/diagnostic-utils.ts`:
    - Add `rootCauseAnalysis` section to `formatDiagnosticsForClipboard` output: analyze `recentEvents` and logs to find earliest token-related error, build causal chain array (token failure → downstream cascade), include token timestamps from `tokenManager.getTokenTimestamps()`
    - Add error deduplication: before outputting `recentEvents`, collapse consecutive identical events into `{ message, count, firstSeen, lastSeen }` entries
    - Add `disconnectedAt` timestamp from health status when connection is disconnected
    - Add per-endpoint HTTP failure details from `recoveryManager.getDiagnostics()` in the output
    - Preserve all existing fields: `summary`, `criticalIssues`, `systemState`, `details`, `errorAnalysis`, `logs` remain unchanged
    - _Bug_Condition: Diagnostic output during cascade lacks rootCauseAnalysis, deduplication, timestamps_
    - _Expected_Behavior: Output includes rootCauseAnalysis with causal chain, deduplicated events, token timestamps, HTTP details_
    - _Preservation: All existing diagnostic fields and format unchanged; new fields are additive_
    - _Requirements: 2.4, 2.5, 2.6, 1.4, 1.5, 1.6_

  - [x] 3.8 Add disconnectedAt and tokenTimestamps to HealthStatus type

    - In `shared/types/health.ts`, add `disconnectedAt?: number` to `HealthStatus` interface
    - Add `tokenTimestamps?: { lastSuccessfulRefresh?: number, tokenExpiryTime?: number }` to `HealthStatus` interface
    - _Requirements: 2.4, 2.6_

  - [x] 3.9 Verify bug condition exploration test now passes

    - **Property 1: Expected Behavior** — Dependent Services Suspend on Token Recovery Failure
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 encodes the expected behavior: `isTokenSuspended()` exists and returns true, `onSuspensionChange()` exists, dependent services stop calling after suspension
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed — services now suspend on token failure)
    - _Requirements: 2.1, 2.2_

  - [x] 3.10 Verify preservation tests still pass
    - **Property 2: Preservation** — Normal Token and Service Operation Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions — cached tokens, fetchWithRetry, onRefresh callbacks, diagnostic fields all unchanged)
    - Confirm all tests still pass after fix (no regressions)

- [x] 4. Checkpoint — Ensure all tests pass
  - Run full test suite: `yarn test`
  - Ensure bug condition test (task 1) passes after fix
  - Ensure preservation tests (task 2) still pass after fix
  - Ensure all existing project tests still pass
  - Ask the user if questions arise
