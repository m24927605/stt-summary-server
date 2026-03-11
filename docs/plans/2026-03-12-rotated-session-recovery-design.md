# Rotated Session Recovery - Safe Design

## Goal

Preserve task continuity when a browser still holds an old rotated `stt_session` cookie, without weakening the current session and CSRF security model.

This design replaces the earlier "follow rotated session chain for all requests" approach. That earlier approach is not acceptable because it would make revoked session IDs usable again across the full task API surface.

## Problem

Current behavior in `packages/server/src/plugins/session.ts` is:

1. Browser sends `stt_session=<old-session-id>`
2. Server loads the session row
3. If `revoked === true`, server immediately clears the cookie and returns `401 Session revoked`

This breaks continuity after a valid session rotation if the browser still presents a stale cookie value that points to a revoked session with `rotatedTo=<new-session-id>`.

The user impact is:

1. `GET /api/tasks/session` returns `401`
2. Frontend retries without the cookie
3. Server creates a brand-new session
4. Existing tasks remain attached to the rotated session chain, so the browser appears to lose history

## Security Constraints

These constraints are mandatory. Claude must not violate them.

1. Do not allow revoked session IDs to act as general-purpose aliases on all `/api/tasks/**` routes.
2. Do not change the existing guarantee that unsafe methods validate CSRF and Origin against the currently active session before state-changing work proceeds.
3. Do not accept an old CSRF token for a new rotated session.
4. Do not add schema changes or migrations for this fix.
5. Do not change frontend cookie strategy.

## Root Cause

The database already stores safe recovery metadata:

1. `rotateSession()` creates a new session
2. It marks the old session `revoked = true`
3. It writes `rotatedTo = <new-session-id>`
4. It migrates task ownership atomically

The missing piece is limited recovery logic on the validation side. The current code treats all revoked sessions identically and never follows `rotatedTo`.

### Why History Disappears After ECS Redeploy

ECS redeploy is not deleting task data. The continuity break happens in the session layer.

Sequence:

1. A user's old session has already been rotated previously
2. The old session row is now `revoked = true` and points to the latest session via `rotatedTo`
3. Task ownership has already been migrated to the latest session in that chain
4. The browser still holds the old `stt_session` cookie
5. After ECS redeploy, the next request reaches a fresh container but still carries that stale cookie
6. Current validation rejects the revoked session immediately instead of following `rotatedTo`
7. The frontend bootstrap flow receives `401`, retries without the cleared cookie, and gets a brand-new unrelated session
8. The browser now queries with this new session, which has no ownership of the old tasks

Result:

1. the task rows still exist
2. the rotated session chain still exists
3. but the browser is no longer attached to that chain, so the old upload history appears to disappear

## Required Outcome

After this change:

1. `GET /api/tasks/session` can recover from a rotated stale cookie by adopting the latest active session in the chain.
2. The response refreshes both `stt_session` and `csrf_token` cookies to the active session values.
3. Unsafe methods such as `POST /api/tasks` do not automatically follow rotated chains from revoked session cookies.
4. A browser must perform or complete a safe bootstrap request before unsafe requests use the new session.

## Design Decision

## 1. Recovery Is Allowed Only On Safe Bootstrap Requests

Only allow rotated-session chain recovery on:

1. `GET /api/tasks/session`

Do not enable this behavior for:

1. `POST /api/tasks`
2. `PUT /api/tasks/**`
3. `DELETE /api/tasks/**`
4. arbitrary task reads such as `GET /api/tasks` unless explicitly approved later

Reason:

1. `GET /api/tasks/session` already exists to bootstrap session state
2. it is the narrowest safe place to repair stale cookies
3. it refreshes the JS-readable `csrf_token` cookie before the browser sends the next unsafe request
4. it avoids turning revoked IDs into broadly valid credentials

## 2. Unsafe Methods Must Continue To Reject Revoked Cookies

For unsafe methods, keep the current semantics:

1. load the cookie session
2. if `revoked === true`, clear `stt_session`
3. return `401 Session revoked`

Do not follow `rotatedTo` inside unsafe requests.

Reason:

1. the request header will usually carry the old `csrf_token`
2. the rotated session has a different CSRF token by design
3. auto-adopting the new session inside an unsafe request would either fail unexpectedly or force acceptance of old CSRF material, which is not allowed

## 3. Follow The Chain Only To Reach The Latest Active Session

Add a helper in `packages/server/src/plugins/session.ts`:

```ts
export async function followRotationChain(
  db: PrismaClient,
  startSessionId: string,
  maxHops: number = 8,
): Promise<Session | null>
```

Behavior:

1. load `startSessionId`
2. if session does not exist, return `null`
3. if session is active (`revoked === false`), return it
4. if session is revoked and `rotatedTo` exists, continue
5. if session is revoked and `rotatedTo` is missing, return `null`
6. if hop count exceeds `maxHops`, return `null`
7. if a cycle is detected, return `null`

Implementation requirement:

1. track visited session IDs in a `Set<string>` so circular references fail closed

`maxHops` should be `8`, not `5`, because the earlier proposal itself noted that a week of missed visits can exceed 5 daily rotations.

## 4. Recovery Flow For `GET /api/tasks/session`

Inside the session plugin, introduce a narrow branch:

1. request has a cookie
2. loaded session is `revoked === true`
3. request method is `GET`
4. request router path is `/api/tasks/session`

Only in that case:

1. if `rotatedTo` is absent, clear cookie and return `401 Session revoked`
2. call `followRotationChain(db, session.rotatedTo)`
3. if no active target is found, clear cookie and return `401 Session revoked`
4. if target is expired, clear cookie and return `401 Session revoked`
5. validate UA hash and IP prefix against the target session
6. if binding fails, clear cookie and return `401 Session binding mismatch`
7. set `request.sessionId = target.id`
8. set `request.csrfToken = target.csrfToken`
9. refresh `stt_session` and `csrf_token` cookies with the target values
10. best-effort update `lastSeenAt` on the target session
11. return and allow the route handler to respond normally

Important:

1. do not fall through to logic that still references the revoked source session
2. do not rotate again during the same recovery pass

## 5. Path Check Must Be Explicit And Narrow

Claude must not use a broad heuristic like "any safe GET can recover".

Use an explicit route/path check for the bootstrap endpoint only. If Fastify exposes a stable router path in this hook, use that. If not, compare the request URL path after stripping query string.

Accepted target:

1. `/api/tasks/session`

Rejected target examples:

1. `/api/tasks`
2. `/api/tasks/:id`
3. `/api/tasks/:id/events`

## 6. Keep Existing Rotation Order Guarantees

Do not change the existing behavior for normal active-session rotation:

1. active session is validated first
2. unsafe methods validate CSRF and Origin against the current active session
3. only then may `rotateSession()` run

This existing order must remain intact.

Recovery from a revoked chain is different from rotating an active session and must be handled in a separate branch.

## Non-Goals

This change does not include:

1. accepting old CSRF tokens on new sessions
2. allowing POST requests to transparently recover from stale rotated cookies
3. schema changes
4. background cleanup of old session chains
5. frontend architectural changes beyond using the existing bootstrap flow

## Required File Changes

Claude must update at least:

1. `packages/server/src/plugins/session.ts`
2. `packages/server/src/__tests__/unit/session.test.ts`
3. `packages/server/src/__tests__/unit/session-rotation-order.test.ts` if needed to prove unsafe-method behavior remains unchanged
4. `packages/server/src/__tests__/integration/security-stack.test.ts`
5. `docs/security.md`
6. `docs/architecture.md` if it describes rotated-session behavior

## Test Requirements

Add automated coverage for all of the following:

1. `followRotationChain()` returns the active session for a one-hop chain
2. `followRotationChain()` returns the active session for a multi-hop chain
3. `followRotationChain()` returns `null` for a broken chain
4. `followRotationChain()` returns `null` for a revoked session with `rotatedTo = null`
5. `followRotationChain()` returns `null` when hop count exceeds limit
6. `followRotationChain()` returns `null` when a cycle is detected
7. `GET /api/tasks/session` with a revoked rotated cookie adopts the active target session and refreshes both cookies
8. `GET /api/tasks/session` with a revoked rotated cookie and target binding mismatch returns `401`
9. `GET /api/tasks/session` with a revoked rotated cookie and expired target returns `401`
10. `POST /api/tasks` with a revoked rotated cookie still returns `401 Session revoked`
11. Existing active-session rotation tests still pass, especially the ordering rule that CSRF/Origin are checked before rotation on unsafe methods

## Acceptance Criteria

This work is complete only if all of the following are true:

1. A stale rotated cookie can be repaired through `GET /api/tasks/session`
2. The repaired response sets the latest `stt_session` and `csrf_token` cookies
3. Revoked cookies are still rejected on unsafe methods
4. No code path accepts an old CSRF token for a rotated target session
5. Existing session rotation ordering guarantees remain true
6. Server tests pass
7. Documentation matches the implemented behavior

## Implementation Notes For Claude Code

1. Prefer a small helper function over duplicating chain traversal logic inline.
2. Fail closed on any ambiguity: missing row, cycle, hop overflow, expired target, or binding mismatch must all reject.
3. Keep the recovery branch self-contained so later checks do not accidentally use the original revoked session object.
4. Do not update docs to claim transparent recovery for POST requests.
