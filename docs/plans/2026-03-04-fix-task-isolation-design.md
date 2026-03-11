# Fix Task Isolation - Design

## Problem

Users opening the website in a new browser can see other users' tasks. Root causes:

1. **Legacy data**: Tasks created before session isolation have `sessionId = 'legacy'`, making them visible under certain conditions.
2. **SSE route has no session validation**: `/api/tasks/:id/events` does not check session ownership. The `EventSource` API does not support custom headers.
3. **Deployment uncertainty**: The deployed version may not include the session isolation code.

## Solution

### 1. Clean up legacy tasks

Add a Prisma migration to delete all tasks with `sessionId = 'legacy'`:

```sql
DELETE FROM tasks WHERE session_id = 'legacy';
```

These tasks cannot be attributed to any user and should be removed.

### 2. Fix SSE events route

**Backend** (`packages/server/src/routes/events.ts`):
- Read `sessionId` from query parameter `?sessionId=...`
- After finding the task, verify `task.sessionId === sessionId`
- Return 403 if session does not match

**Frontend** (`packages/frontend/src/hooks/useSSE.ts`):
- Append `sessionId` query parameter when creating EventSource URL
- Export `getSessionId` from `api.ts` so `useSSE.ts` can access it

### 3. Verify deployment

Ensure the latest code (including session isolation and this fix) is deployed and migrations are executed.

## Files to modify

- `packages/server/prisma/migrations/` - new migration for legacy cleanup
- `packages/server/src/routes/events.ts` - add session validation
- `packages/frontend/src/hooks/useSSE.ts` - pass sessionId in URL
- `packages/frontend/src/api.ts` - export getSessionId
