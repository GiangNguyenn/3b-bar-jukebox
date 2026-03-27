# Bugfix Requirements Document

## Introduction

A production incident occurred where a venue's jukebox became completely unresponsive after a Spotify auth token expired and could not be refreshed. The token refresh failure cascaded into failures across all dependent services (AutoPlayService, MetadataBackfill, DeviceHealth, QueueManager), ultimately stopping music playback with no automatic recovery. The system retried individual operations indefinitely but never successfully recovered the auth token, leaving the venue without music for an extended period.

This bug has two dimensions:

1. **Primary**: The token refresh failure cascade — the system lacks a mechanism to escalate from per-operation retries to a full token recovery cycle, and dependent services don't back off when the root cause is an expired token.
2. **Secondary**: The diagnostic panel's clipboard output lacks critical information needed to quickly identify root causes in production incidents (no token expiry timestamps, no HTTP error details, no causal chain analysis, heavy event duplication).

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the Spotify auth token expires and all three token endpoints (user, admin, public) fail to return a fresh token THEN the system continues retrying individual service operations (AutoPlay, MetadataBackfill, DeviceHealth, QueueManager) against the Spotify API with the expired token, generating a cascade of failures across all services without ever escalating to a coordinated token recovery

1.2 WHEN the RecoveryManager exhausts its 3 auth retry attempts and sets `isRecoveryNeeded = true` THEN dependent services (AutoPlayService, MetadataBackfill, DeviceHealth, QueueManager) are not notified of the unrecoverable token state and continue making requests that are guaranteed to fail, producing repeated timeout and abort errors

1.3 WHEN a token refresh failure occurs THEN the system does not record or expose the HTTP status codes, response bodies, or specific failure reasons from each token endpoint attempt, making it impossible to distinguish between network failures, invalid credentials, and Spotify API outages

1.4 WHEN the diagnostic panel's "Copy Diagnostics" output is generated during a cascade failure THEN the output does not include token expiry/refresh timestamps, does not surface the causal chain (token failure → downstream cascade), and does not separate root-cause errors from downstream/cascade errors

1.5 WHEN the diagnostic panel captures recent events during a cascade failure THEN the events are heavily duplicated (same errors repeated every few seconds) with no deduplication or grouping, making it difficult to locate the initial failure point

1.6 WHEN the connection status transitions to "disconnected" THEN no timestamp is recorded for when the disconnection occurred, preventing diagnosis of whether the disconnection preceded or followed the token failure

### Expected Behavior (Correct)

2.1 WHEN the Spotify auth token expires and token refresh fails across all endpoints THEN the system SHALL enter a coordinated "token recovery" state that pauses dependent service operations, preventing cascade failures, and SHALL periodically reattempt token refresh with exponential backoff until successful or until a maximum recovery duration is exceeded

2.2 WHEN the RecoveryManager determines that auth recovery has failed (max retries exhausted) THEN the system SHALL notify all dependent services to enter a suspended state where they stop making Spotify API requests, and SHALL surface a clear user-facing error indicating that re-authentication is required

2.3 WHEN a token refresh attempt fails THEN the system SHALL record the HTTP status code, a summary of the response body, and the specific endpoint that failed, and SHALL make this information available in the diagnostic output and internal logs

2.4 WHEN the diagnostic panel's "Copy Diagnostics" output is generated THEN the output SHALL include a "rootCauseAnalysis" section that identifies the earliest error in the causal chain, token expiry and last successful refresh timestamps, and clearly separates root-cause errors from downstream/cascade errors

2.5 WHEN the diagnostic panel captures recent events that contain repeated identical errors THEN the output SHALL deduplicate consecutive identical errors and display them as a single entry with a count and time range (e.g., "Token refresh failed × 12, 11:49:03–11:58:31")

2.6 WHEN the connection status transitions to "disconnected" THEN the system SHALL record the timestamp of the disconnection event and include it in the diagnostic output

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the Spotify auth token is valid and not expiring soon THEN the system SHALL CONTINUE TO serve the cached token without making refresh requests

3.2 WHEN a single transient network error occurs during token refresh THEN the system SHALL CONTINUE TO retry with the existing `fetchWithRetry` mechanism (up to 2 retries with exponential backoff per endpoint) before falling through to the next endpoint

3.3 WHEN the token is successfully refreshed THEN the system SHALL CONTINUE TO notify registered `onRefresh` callbacks and reset the RecoveryManager state

3.4 WHEN dependent services (AutoPlay, MetadataBackfill, DeviceHealth) operate with a valid token THEN they SHALL CONTINUE TO function independently with their existing retry and error handling logic

3.5 WHEN the diagnostic panel is opened with no active errors THEN it SHALL CONTINUE TO display the current system status, playback state, queue information, and recent events in the existing format

3.6 WHEN the "Copy Diagnostics" button is clicked THEN the output SHALL CONTINUE TO include all existing fields (summary, criticalIssues, systemState, details, errorAnalysis, logs) in addition to any new fields
