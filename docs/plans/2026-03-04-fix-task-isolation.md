# Fix Task Isolation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix session-based task isolation so legacy tasks are cleaned up and the SSE events route validates session ownership.

**Architecture:** Add a database migration to delete legacy tasks, add session validation to the SSE events route using query parameters (since EventSource API doesn't support custom headers), and export `getSessionId` from the frontend API module.

**Tech Stack:** Fastify, Prisma, Vitest, React

---

### Task 1: Add session validation tests for events route

**Files:**
- Modify: `packages/server/src/__tests__/integration/events-routes.test.ts`

**Step 1: Write failing tests for session validation**

Add these tests to the existing `describe('event routes')` block, before the SSE polling describe:

```typescript
it('returns 404 when sessionId query param is missing', async () => {
  const task = makeTask({ status: 'completed', transcript: 'hi', summary: 'greeting' });
  mockFindUnique.mockResolvedValue(task);

  const response = await app.inject({
    method: 'GET',
    url: `/api/tasks/${task.id}/events`,
  });

  expect(response.statusCode).toBe(404);
  expect(response.json()).toHaveProperty('error', 'Task not found');
});

it('returns 404 when sessionId does not match task', async () => {
  const task = makeTask({ sessionId: 'owner-session' });
  mockFindUnique.mockResolvedValue(task);

  const response = await app.inject({
    method: 'GET',
    url: `/api/tasks/${task.id}/events?sessionId=wrong-session`,
  });

  expect(response.statusCode).toBe(404);
  expect(response.json()).toHaveProperty('error', 'Task not found');
});

it('sends events when sessionId matches', async () => {
  const task = makeTask({
    status: 'completed',
    sessionId: 'my-session',
    transcript: 'hello',
    summary: 'a greeting',
  });
  mockFindUnique.mockResolvedValue(task);

  const response = await app.inject({
    method: 'GET',
    url: `/api/tasks/${task.id}/events?sessionId=my-session`,
  });

  expect(response.statusCode).toBe(200);
  expect(response.body).toContain('event: completed');
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/server && npx vitest run src/__tests__/integration/events-routes.test.ts`
Expected: 2 FAIL (the missing/wrong sessionId tests should pass 200 instead of 404), 1 PASS (the matching test already works)

**Step 3: Commit failing tests**

```bash
git add packages/server/src/__tests__/integration/events-routes.test.ts
git commit -m "test: add session validation tests for events route (red)"
```

---

### Task 2: Implement session validation in events route

**Files:**
- Modify: `packages/server/src/routes/events.ts:7-14`

**Step 1: Add session validation to events route**

Replace the beginning of the route handler (lines 7-14) with:

```typescript
  app.get<{ Params: { id: string }; Querystring: { sessionId?: string } }>('/api/tasks/:id/events', async (request, reply) => {
    const db = getDb();
    const taskId = request.params.id;
    const sessionId = request.query.sessionId || '';

    const task = await db.task.findUnique({ where: { id: taskId } });
    if (!task || !sessionId || task.sessionId !== sessionId) {
      return reply.status(404).send({ error: 'Task not found' });
    }
```

**Step 2: Update existing tests to pass sessionId query param**

In `events-routes.test.ts`, update all existing test URLs that don't have `?sessionId=` to include the default session ID from `makeTask` (`test-session-id`):

- `'/api/tasks/non-existent/events'` → `'/api/tasks/non-existent/events?sessionId=test-session-id'`
- `` `/api/tasks/${task.id}/events` `` → `` `/api/tasks/${task.id}/events?sessionId=test-session-id` ``
- `'/api/tasks/test-task-id-1/events'` → `'/api/tasks/test-task-id-1/events?sessionId=test-session-id'`

**Step 3: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run src/__tests__/integration/events-routes.test.ts`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add packages/server/src/routes/events.ts packages/server/src/__tests__/integration/events-routes.test.ts
git commit -m "feat: add session validation to SSE events route"
```

---

### Task 3: Update frontend to pass sessionId in SSE URL

**Files:**
- Modify: `packages/frontend/src/api.ts:4` (export getSessionId)
- Modify: `packages/frontend/src/hooks/useSSE.ts:1,23`

**Step 1: Export getSessionId from api.ts**

In `packages/frontend/src/api.ts`, change line 4 from:

```typescript
function getSessionId(): string {
```

to:

```typescript
export function getSessionId(): string {
```

**Step 2: Update useSSE.ts to include sessionId in URL**

In `packages/frontend/src/hooks/useSSE.ts`, add import:

```typescript
import { getSessionId } from '../api';
```

Change line 23 from:

```typescript
    const es = new EventSource(`/api/tasks/${taskId}/events`);
```

to:

```typescript
    const es = new EventSource(`/api/tasks/${taskId}/events?sessionId=${encodeURIComponent(getSessionId())}`);
```

**Step 3: Verify frontend builds**

Run: `cd packages/frontend && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/frontend/src/api.ts packages/frontend/src/hooks/useSSE.ts
git commit -m "feat: pass sessionId to SSE events endpoint"
```

---

### Task 4: Add migration to clean up legacy tasks

**Files:**
- Create: `packages/server/prisma/migrations/20260304100000_cleanup_legacy_tasks/migration.sql`

**Step 1: Create the migration file**

```sql
-- Delete tasks that were created before session isolation was added
DELETE FROM tasks WHERE session_id = 'legacy';
```

**Step 2: Verify migration syntax**

Run: `cd packages/server && npx prisma migrate status`
Expected: Shows 1 pending migration

**Step 3: Commit**

```bash
git add packages/server/prisma/migrations/20260304100000_cleanup_legacy_tasks/
git commit -m "migration: clean up legacy tasks without session ownership"
```

---

### Task 5: Run full test suite

**Step 1: Run all server tests**

Run: `cd packages/server && npx vitest run`
Expected: ALL PASS

**Step 2: Run frontend type check**

Run: `cd packages/frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: Final commit (if any fixes needed)**

If any test fixes were needed, commit them.
