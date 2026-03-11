# Session Init Endpoint - Design

## Goal

Fix the first-time upload failure where a new user opens the frontend and immediately uploads audio, but the API returns:

```json
{ "error": "Session required" }
```

The fix must work with the current security model and current route auth behavior.

## Problem

Current request flow:

1. User opens the frontend page
2. The page load is served by the frontend server, not the Fastify API server
3. No API request has happened yet, so no session cookie exists
4. User uploads audio
5. Frontend sends `POST /api/tasks`
6. `sessionPlugin` rejects the request because unsafe methods require an existing valid session

Result:

```json
{ "error": "Session required" }
```

## Root Cause

The current frontend does call `GET /api/tasks` on mount, which is a safe method that creates a session. However, the upload UI is available immediately and the `getTasks()` call is fire-and-forget async. This creates a race condition:

- `fetchTasks()` starts an async `GET /api/tasks` request on mount
- The upload button is rendered and interactive before the GET response arrives
- If the user uploads before the GET response sets the session cookie, `POST /api/tasks` is sent without a cookie
- `sessionPlugin` rejects the POST with `401 Session required`

The root cause is not a missing safe request, but a missing ordering guarantee: **the upload UI becomes usable before the session is established**.

## Constraints

### 1. Keep the current security model

Do not redesign authentication.

Keep:

- `stt_session` as the server-managed session cookie
- `csrf_token` as the JS-readable CSRF cookie
- `X-CSRF-Token` as the CSRF request header
- session creation on safe methods only
- unsafe methods requiring an existing valid session

### 2. Keep current auth middleware behavior unless clearly necessary

Current auth middleware already exempts:

- `GET /api/health`
- `/api/tasks`
- `/api/tasks/:id`
- `/api/tasks/:id/events`

All other `/api/*` routes may require API key auth in production.

This means adding a new top-level route such as `GET /api/session` would require extra auth middleware changes and creates unnecessary risk.

### 3. Assume browser-visible same-origin or same-site deployment

This design assumes the browser sees frontend and API as the same site, typically through reverse proxy.

Example:

- `https://app.example.com/` -> frontend
- `https://app.example.com/api/*` -> Fastify API

This matches the current cookie setup, which uses `SameSite: 'strict'`.

If frontend and API are truly cross-site from the browser perspective, this design will not fully solve the issue and the cookie/auth strategy must be redesigned separately.

This task does not include deployment changes.

Assume the browser already reaches frontend and API through the same site or origin boundary.

If that assumption is false, stop and raise it as a deployment or auth architecture issue instead of implementing only the endpoint.

## Proposed Solution

Add a new endpoint:

- `GET /api/tasks/session`

Frontend will call this endpoint during app startup before the first upload.

The endpoint will:

- run inside the existing `taskScope`
- use the existing `sessionPlugin`
- create a session automatically on first safe request
- return the CSRF token needed for later unsafe requests

## Why `GET /api/tasks/session`

### Recommended

Use:

- `GET /api/tasks/session`

Reasons:

- stays inside the existing `/api/tasks/**` namespace
- works with the current auth exemption pattern
- avoids widening public top-level API surface
- keeps session bootstrap close to task-related behavior

### Rejected Alternative

Do not use:

- `GET /api/session`

Reason:

- current `registerAuth()` only exempts `/api/tasks/**` and `/api/health`
- in production, `/api/session` may be blocked by API key middleware before `sessionPlugin` runs
- that would require separate auth changes for a problem that does not need them

## Backend Design

### 1. Add `GET /api/tasks/session`

Implement a new safe endpoint under the existing task route scope.

Response body:

```json
{ "csrfToken": "<token>" }
```

Behavior:

- if no session cookie exists, `sessionPlugin` creates a new session
- if a valid session cookie already exists, return the existing CSRF token
- if the cookie is invalid, revoked, expired, or binding-mismatched, preserve current behavior and return the existing `401` response from `sessionPlugin`
- when `sessionPlugin` rejects an invalid, revoked, expired, or binding-mismatched `stt_session` cookie, it should also clear that cookie in the response, matching existing behavior

### 2. Do not create session manually in the route

The route handler must not duplicate session creation logic.

Session creation and validation remain the responsibility of `sessionPlugin`.

The route handler should stay minimal and only return:

```ts
return { csrfToken: request.csrfToken };
```

### 3. Route resolution: no conflict with `/api/tasks/:id`

Fastify resolves static path segments before parametric ones, so `/api/tasks/session` will not conflict with `/api/tasks/:id`.

### 4. Keep route inside the existing scoped plugin context

The new endpoint must run inside the same Fastify scoped registration where:

- `sessionPlugin` is already applied
- task routes are already mounted

This ensures the route gets the same session behavior as the existing task endpoints.

### 5. Add stricter rate limiting

Suggested route-level limit:

- 5 requests per minute per IP

Reason:

- this endpoint can create sessions
- lower rate limit reduces session flooding risk

## Frontend Design

### 1. Initialize session during app startup

When the app starts, call:

- `GET /api/tasks/session`

Request requirements:

- include credentials/cookies

Expected result:

- server sets `stt_session` if absent
- server sets `csrf_token` if absent
- response returns `csrfToken`

### 2. Store the returned CSRF token in the API client

After initialization:

- keep the returned `csrfToken` in frontend memory or API client state
- attach it to later unsafe requests with `X-CSRF-Token`

This is required for:

- `POST /api/tasks`

### 3. Session init must happen before upload

Do not wait until upload time to discover whether a session exists.

Session bootstrap should happen during app initialization or before the upload UI becomes usable.

### 4. Handle recovery cases explicitly

If `GET /api/tasks/session` returns `401`, assume there is an invalid existing cookie state.

Frontend behavior should be:

- clear in-memory session-related state if any
- stop the upload flow
- treat the first `401` as a recoverable bootstrap failure if the response cleared `stt_session`
- allow one explicit retry path after cookie clear has been applied by the browser, such as page reload or one controlled re-init attempt

Expected recovery sequence:

1. request with expired or invalid `stt_session`
2. server returns `401`
3. server clears `stt_session` cookie in the response
4. frontend performs one controlled retry after the browser applies the cookie update
5. retry is now sent without `stt_session`
6. `sessionPlugin` creates a new session
7. endpoint returns `200` with a fresh CSRF token

Do not retry forever in a loop.

### 5. Prevent duplicate session bootstrap calls

Frontend must treat session initialization as a singleton operation.

Do not allow multiple components to independently call `GET /api/tasks/session` during initial render.

Frontend should use a shared in-flight promise, singleton initializer, or equivalent mutex pattern so that:

- only one bootstrap request is active at a time
- concurrent callers await the same result
- duplicate session creation attempts are avoided

## API Contract

### Request

```http
GET /api/tasks/session
```

### Success Response

```json
{
  "csrfToken": "64-char-hex-string"
}
```

### Error Responses

#### Invalid or expired session

Examples:

```json
{ "error": "Invalid session" }
```

```json
{ "error": "Session revoked" }
```

```json
{ "error": "Session expired" }
```

```json
{ "error": "Session binding mismatch" }
```

Status:

- `401 Unauthorized`

When applicable, the response should clear the invalid `stt_session` cookie.

#### Rate limited

```json
{ "error": "Too Many Requests" }
```

Status:

- `429 Too Many Requests`

## Security Considerations

### 1. No meaningful new capability

This endpoint does not add a new privilege boundary.

Today, `GET /api/tasks` already creates a session on first safe request.

The new endpoint only makes session bootstrap explicit and purpose-specific.

### 2. Returning CSRF token in JSON is acceptable

The CSRF token is already exposed to browser JavaScript via the existing `csrf_token` cookie because that cookie is not `HttpOnly`.

Returning the same token in the JSON response does not materially change exposure.

### 3. Session flooding risk exists but is bounded

Because safe requests can create sessions, this endpoint should use a stricter rate limit than normal read endpoints.

### 4. Session fixation is not introduced

Session IDs remain server-generated only.

The client never supplies the session ID except by returning the server-issued cookie.

## Test Plan

Tests are required for this task.

Do not treat tests as optional follow-up work.

Implementation is not complete unless the new backend behavior is covered by automated tests.

Add integration tests that cover the following cases.

### 1. First-time initialization creates a session

Scenario:

- request `GET /api/tasks/session` with no cookies

Assert:

- status is `200`
- response contains `csrfToken`
- `stt_session` cookie is set
- `csrf_token` cookie is set
- session create is called once

### 2. Existing valid session returns the existing token

Scenario:

- request `GET /api/tasks/session` with a valid session cookie

Assert:

- status is `200`
- response contains the existing session CSRF token
- no new session is created

### 3. Invalid session is rejected

Scenario:

- request `GET /api/tasks/session` with a nonexistent or invalid session cookie

Assert:

- status is `401`
- error matches the existing `sessionPlugin` behavior
- invalid, revoked, expired, or binding-mismatched `stt_session` cookies are cleared in the response
- no new session is created in the same request

### 4. Expired session can recover on next bootstrap attempt

Scenario:

1. call `GET /api/tasks/session` with an expired `stt_session`
2. verify the response is `401` and clears `stt_session`
3. call `GET /api/tasks/session` again without the expired cookie

Assert:

- first response is `401`
- first response clears `stt_session`
- second response is `200`
- second response returns a new `csrfToken`
- second response sets fresh `stt_session` and `csrf_token` cookies

### 5. Upload succeeds after session initialization

Scenario:

1. call `GET /api/tasks/session`
2. extract returned `csrfToken`
3. call `POST /api/tasks` with cookie plus `X-CSRF-Token`

Assert:

- upload succeeds
- no `Session required` error occurs

## Files To Modify

### Backend

- `packages/server/src/routes/tasks.ts`
  - add `GET /api/tasks/session`

If the team prefers a separate route module, it may be implemented in a dedicated file, but the exposed path should remain:

- `GET /api/tasks/session`

### App Registration

- `packages/server/src/app.ts`
  - ensure the new route remains registered inside the existing `taskScope`

### Tests

- `packages/server/src/__tests__/integration/tasks-routes.test.ts`
- `packages/server/src/__tests__/integration/security-stack.test.ts`

### Frontend

- `packages/frontend/src/App.tsx`
  - trigger session bootstrap during app initialization
  - ensure bootstrap is not triggered concurrently by multiple components
- `packages/frontend/src/api.ts`
  - add session bootstrap helper for `GET /api/tasks/session`
  - keep CSRF token setup and request header injection aligned with the bootstrap flow

## Non-Goals

This change does not:

- redesign API auth middleware
- support truly cross-site cookie auth
- change SSE auth behavior
- rotate sessions differently
- change the CSRF strategy

## Definition of Done

This work is complete when:

1. A first-time user can open the app and upload without receiving `Session required`
2. `GET /api/tasks/session` works within the current auth architecture
3. Existing security behavior remains unchanged for all other routes
4. Integration tests cover both session bootstrap and upload-after-bootstrap behavior
5. Relevant backend tests are updated or added as part of the same change
6. Expired-session recovery is covered by tests
7. Frontend session bootstrap is implemented as a singleton or equivalent one-request-at-a-time flow
