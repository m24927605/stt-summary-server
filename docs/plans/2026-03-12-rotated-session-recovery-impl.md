# Rotated Session Recovery — Implementation Plan

> For implementers: follow the steps in order and keep the checkbox state updated as work progresses.

**Goal:** Allow `GET /api/tasks/session` to recover from a stale rotated cookie by following the `rotatedTo` chain to the latest active session, refreshing cookies, and preserving task history continuity.

**Architecture:** Add a `followRotationChain()` helper that walks `rotatedTo` links with cycle/hop protection. Insert a narrow recovery branch in the session plugin's `onRequest` hook that fires only for `GET /api/tasks/session` when a revoked session is encountered. All other routes continue to reject revoked sessions immediately.

**Tech Stack:** TypeScript, Fastify, Prisma (PostgreSQL), Vitest

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `packages/server/src/plugins/session.ts` | Add `followRotationChain()` + recovery branch in `onRequest` |
| Modify | `packages/server/src/__tests__/unit/session.test.ts` | Unit tests for `followRotationChain()` |
| Modify | `packages/server/src/__tests__/unit/session-rotation-order.test.ts` | Prove unsafe methods still reject revoked cookies |
| Modify | `packages/server/src/__tests__/integration/security-stack.test.ts` | Integration tests for recovery flow |
| Modify | `docs/security.md` | Document recovery behavior |
| Modify | `docs/architecture.md` | No change needed (already describes bootstrap) |

---

## Task 1: Unit tests + implementation for `followRotationChain()`

**Files:**
- Modify: `packages/server/src/plugins/session.ts`
- Modify: `packages/server/src/__tests__/unit/session.test.ts`

### Step 1: Write failing tests for `followRotationChain()`

Add the following test block to `packages/server/src/__tests__/unit/session.test.ts`, after the existing `rotateSession` describe block (line ~179):

```ts
describe('followRotationChain', () => {
  function mockDb(sessions: Record<string, any>) {
    return {
      session: {
        findUnique: vi.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(sessions[where.id] ?? null),
        ),
      },
    } as unknown as any;
  }

  function makeSession(id: string, overrides: Record<string, any> = {}) {
    return {
      id,
      uaHash: 'hash',
      ipPrefix: '192.168.1',
      csrfToken: 'tok-' + id,
      expiresAt: new Date(Date.now() + 86400000),
      rotatedTo: null,
      revoked: false,
      createdAt: new Date(),
      lastSeenAt: new Date(),
      ...overrides,
    };
  }

  it('returns the session itself when it is active', async () => {
    const active = makeSession('s1');
    const db = mockDb({ s1: active });
    const result = await followRotationChain(db, 's1');
    expect(result).toEqual(active);
  });

  it('follows a one-hop chain to the active session', async () => {
    const revoked = makeSession('s1', { revoked: true, rotatedTo: 's2' });
    const active = makeSession('s2');
    const db = mockDb({ s1: revoked, s2: active });
    const result = await followRotationChain(db, 's1');
    expect(result).toEqual(active);
  });

  it('follows a multi-hop chain to the active session', async () => {
    const s1 = makeSession('s1', { revoked: true, rotatedTo: 's2' });
    const s2 = makeSession('s2', { revoked: true, rotatedTo: 's3' });
    const s3 = makeSession('s3', { revoked: true, rotatedTo: 's4' });
    const s4 = makeSession('s4');
    const db = mockDb({ s1, s2, s3, s4 });
    const result = await followRotationChain(db, 's1');
    expect(result).toEqual(s4);
  });

  it('returns null when session does not exist', async () => {
    const db = mockDb({});
    const result = await followRotationChain(db, 'nonexistent');
    expect(result).toBeNull();
  });

  it('returns null for a revoked session with rotatedTo = null', async () => {
    const revoked = makeSession('s1', { revoked: true, rotatedTo: null });
    const db = mockDb({ s1: revoked });
    const result = await followRotationChain(db, 's1');
    expect(result).toBeNull();
  });

  it('returns null when hop count exceeds maxHops', async () => {
    // Build a chain of 10 hops (exceeds default maxHops=8)
    const sessions: Record<string, any> = {};
    for (let i = 1; i <= 10; i++) {
      sessions[`s${i}`] = makeSession(`s${i}`, {
        revoked: true,
        rotatedTo: i < 10 ? `s${i + 1}` : null,
      });
    }
    sessions['s10'] = makeSession('s10'); // active end — but unreachable within 8 hops
    // Chain: s1->s2->...->s9->s10, starting at s1 needs 9 hops to reach s10
    // With maxHops=8, should return null
    const db = mockDb(sessions);
    const result = await followRotationChain(db, 's1');
    expect(result).toBeNull();
  });

  it('returns null when a cycle is detected', async () => {
    const s1 = makeSession('s1', { revoked: true, rotatedTo: 's2' });
    const s2 = makeSession('s2', { revoked: true, rotatedTo: 's1' }); // cycle
    const db = mockDb({ s1, s2 });
    const result = await followRotationChain(db, 's1');
    expect(result).toBeNull();
  });

  it('returns null when chain leads to a missing session', async () => {
    const s1 = makeSession('s1', { revoked: true, rotatedTo: 's2' });
    const db = mockDb({ s1 }); // s2 does not exist
    const result = await followRotationChain(db, 's1');
    expect(result).toBeNull();
  });
});
```

Also add `followRotationChain` to the import at the top of the file (line ~18):

```ts
import {
  hashUserAgent,
  extractIpPrefix,
  validateSessionBinding,
  createSessionData,
  shouldRotateSession,
  rotateSession,
  followRotationChain,
} from '../../plugins/session';
```

- [ ] **Step 1a: Save the test file changes**

- [ ] **Step 1b: Run tests to verify they fail**

Run: `cd packages/server && npx vitest run src/__tests__/unit/session.test.ts`
Expected: FAIL — `followRotationChain` is not exported / does not exist

### Step 2: Implement `followRotationChain()`

Add this function to `packages/server/src/plugins/session.ts`, after the `rotateSession()` function (after line 92) and before `getClientIp()`:

```ts
/**
 * Walks the rotatedTo chain from a starting session ID until it finds
 * an active (non-revoked) session or exhausts the chain.
 *
 * Returns the active session or null if the chain is broken, cyclic,
 * exceeds maxHops, or leads to a missing/revoked-without-successor session.
 */
export async function followRotationChain(
  db: PrismaClient,
  startSessionId: string,
  maxHops: number = 8,
): Promise<{
  id: string;
  uaHash: string;
  ipPrefix: string;
  csrfToken: string;
  expiresAt: Date;
  rotatedTo: string | null;
  revoked: boolean;
  createdAt: Date;
  lastSeenAt: Date;
} | null> {
  const visited = new Set<string>();
  let currentId: string | null = startSessionId;

  for (let hop = 0; hop <= maxHops; hop++) {
    if (!currentId) return null;
    if (visited.has(currentId)) return null; // cycle detected
    visited.add(currentId);

    const session = await db.session.findUnique({ where: { id: currentId } });
    if (!session) return null;

    if (!session.revoked) return session;

    // Revoked — follow the chain
    currentId = session.rotatedTo;
  }

  return null; // exceeded maxHops
}
```

- [ ] **Step 2a: Save the implementation**

- [ ] **Step 2b: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run src/__tests__/unit/session.test.ts`
Expected: ALL PASS

- [ ] **Step 2c: Commit**

```bash
git add packages/server/src/plugins/session.ts packages/server/src/__tests__/unit/session.test.ts
git commit -m "feat(session): add followRotationChain helper with unit tests

Walks rotatedTo links to find the latest active session in a
rotation chain. Fails closed on cycles, hop overflow, missing
rows, and revoked-without-successor sessions."
```

---

## Task 2: Recovery branch in `onRequest` hook

**Files:**
- Modify: `packages/server/src/plugins/session.ts`
- Modify: `packages/server/src/__tests__/unit/session-rotation-order.test.ts`

### Step 1: Write failing test for revoked-cookie recovery on unsafe method

Add to `packages/server/src/__tests__/unit/session-rotation-order.test.ts`, after the last `it` block (line ~207):

```ts
it('POST with revoked rotated cookie still returns 401 Session revoked', async () => {
  const revokedSession = {
    ...makeOldSession(validCsrfToken),
    revoked: true,
    rotatedTo: 'new-active-session-id',
    // Override createdAt so it does NOT trigger the rotation-threshold branch
    createdAt: new Date(),
  };
  mockFindUnique.mockResolvedValue(revokedSession);

  const hook = await getOnRequestHook();
  const request = makeRequest('POST', {
    'x-csrf-token': validCsrfToken,
    origin: 'http://localhost:8080',
  });
  const reply = makeReply();

  await hook(request, reply);

  expect(reply.status).toHaveBeenCalledWith(401);
  expect(reply.body).toEqual({ error: 'Session revoked' });
});
```

- [ ] **Step 1a: Save the test**

- [ ] **Step 1b: Run to verify it passes (current behavior already rejects)**

Run: `cd packages/server && npx vitest run src/__tests__/unit/session-rotation-order.test.ts`
Expected: PASS (this confirms existing behavior is preserved)

### Step 2: Write failing test for GET /api/tasks/session recovery

Add another test to `session-rotation-order.test.ts`:

```ts
it('GET /api/tasks/session with revoked rotated cookie recovers to active session', async () => {
  const activeSession = {
    id: 'active-session-id',
    uaHash: hashUserAgent('Mozilla/5.0 Test'),
    ipPrefix: extractIpPrefix('192.168.1.100'),
    csrfToken: 'active-csrf-token',
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    rotatedTo: null,
    revoked: false,
    createdAt: new Date(),
    lastSeenAt: new Date(),
  };

  const revokedSession = {
    ...makeOldSession(validCsrfToken),
    revoked: true,
    rotatedTo: 'active-session-id',
    createdAt: new Date(),
  };

  mockFindUnique.mockImplementation(({ where }: any) => {
    if (where.id === 'old-session-id') return Promise.resolve(revokedSession);
    if (where.id === 'active-session-id') return Promise.resolve(activeSession);
    return Promise.resolve(null);
  });

  const hook = await getOnRequestHook();
  const request = {
    ...makeRequest('GET'),
    url: '/api/tasks/session',
  };
  const reply = makeReply();

  await hook(request, reply);

  // Should NOT return 401
  expect(reply.status).not.toHaveBeenCalledWith(401);
  // Should adopt the active session
  expect(request.sessionId).toBe('active-session-id');
  expect(request.csrfToken).toBe('active-csrf-token');
  // Should refresh cookies
  expect(reply.setCookie).toHaveBeenCalledWith('stt_session', 'active-session-id', expect.any(Object));
  expect(reply.setCookie).toHaveBeenCalledWith('csrf_token', 'active-csrf-token', expect.any(Object));
});
```

- [ ] **Step 2a: Save the test**

- [ ] **Step 2b: Run to verify it fails**

Run: `cd packages/server && npx vitest run src/__tests__/unit/session-rotation-order.test.ts`
Expected: FAIL — current code returns 401 for all revoked sessions

### Step 3: Implement the recovery branch

Modify `packages/server/src/plugins/session.ts`. Replace the `session.revoked` block (lines 139-142):

```ts
      if (session.revoked) {
        void reply.clearCookie(SESSION_COOKIE, { path: '/' });
        return reply.status(401).send({ error: 'Session revoked' });
      }
```

With:

```ts
      if (session.revoked) {
        // Recovery: only on GET /api/tasks/session bootstrap endpoint
        const isBootstrap =
          request.method === 'GET' &&
          request.url.split('?')[0] === '/api/tasks/session';

        if (isBootstrap && session.rotatedTo) {
          const target = await followRotationChain(db, session.rotatedTo);

          if (!target || target.expiresAt <= new Date()) {
            void reply.clearCookie(SESSION_COOKIE, { path: '/' });
            return reply.status(401).send({ error: 'Session revoked' });
          }

          if (!validateSessionBinding(target, currentUaHash, currentIpPrefix)) {
            void reply.clearCookie(SESSION_COOKIE, { path: '/' });
            return reply.status(401).send({ error: 'Session binding mismatch' });
          }

          // Adopt the active target session
          request.sessionId = target.id;
          request.csrfToken = target.csrfToken;
          setCookies(reply, target.id, target.csrfToken);

          // Best-effort update lastSeenAt
          db.session.update({
            where: { id: target.id },
            data: { lastSeenAt: new Date() },
          }).catch(() => {});

          return; // allow route handler to respond normally
        }

        void reply.clearCookie(SESSION_COOKIE, { path: '/' });
        return reply.status(401).send({ error: 'Session revoked' });
      }
```

- [ ] **Step 3a: Save the implementation**

- [ ] **Step 3b: Run rotation-order tests**

Run: `cd packages/server && npx vitest run src/__tests__/unit/session-rotation-order.test.ts`
Expected: ALL PASS

- [ ] **Step 3c: Run all unit tests**

Run: `cd packages/server && npx vitest run src/__tests__/unit/`
Expected: ALL PASS

- [ ] **Step 3d: Commit**

```bash
git add packages/server/src/plugins/session.ts packages/server/src/__tests__/unit/session-rotation-order.test.ts
git commit -m "feat(session): recover stale rotated cookie on GET /api/tasks/session

Only the bootstrap endpoint follows rotatedTo chains. Unsafe methods
and other GETs continue to reject revoked sessions immediately.
Validates binding and expiry on the target before adopting."
```

---

## Task 3: Integration tests

**Files:**
- Modify: `packages/server/src/__tests__/integration/security-stack.test.ts`

### Step 1: Add recovery integration test

Add after the `'revoked session cookie is rejected'` test (~line 362) in `security-stack.test.ts`:

```ts
it('GET /api/tasks/session with revoked rotated cookie recovers to active session', async () => {
  const activeSessionData = makeDbSession({
    id: 'active-sess',
    csrfToken: 'recovered-csrf-token',
  });

  mockSessionFindUnique.mockImplementation((args: { where: { id: string } }) => {
    if (args.where.id === 'revoked-rotated') {
      return Promise.resolve(makeDbSession({
        id: 'revoked-rotated',
        revoked: true,
        rotatedTo: 'active-sess',
      }));
    }
    if (args.where.id === 'active-sess') {
      return Promise.resolve(activeSessionData);
    }
    return Promise.resolve(null);
  });

  const app = await buildApp();

  const res = await app.inject({
    method: 'GET',
    url: '/api/tasks/session',
    headers: { cookie: 'stt_session=revoked-rotated' },
  });

  expect(res.statusCode).toBe(200);
  expect(res.json()).toHaveProperty('csrfToken', 'recovered-csrf-token');

  const sttCookie = res.cookies.find((c: { name: string }) => c.name === 'stt_session');
  expect(sttCookie).toBeDefined();
  expect(sttCookie!.value).toBe('active-sess');

  const csrfCookie = res.cookies.find((c: { name: string }) => c.name === 'csrf_token');
  expect(csrfCookie).toBeDefined();
  expect(csrfCookie!.value).toBe('recovered-csrf-token');

  await app.close();
});

it('GET /api/tasks/session with revoked rotated cookie and expired target returns 401', async () => {
  mockSessionFindUnique.mockImplementation((args: { where: { id: string } }) => {
    if (args.where.id === 'revoked-exp') {
      return Promise.resolve(makeDbSession({
        id: 'revoked-exp',
        revoked: true,
        rotatedTo: 'expired-target',
      }));
    }
    if (args.where.id === 'expired-target') {
      return Promise.resolve(makeDbSession({
        id: 'expired-target',
        expiresAt: new Date(Date.now() - 1000),
      }));
    }
    return Promise.resolve(null);
  });

  const app = await buildApp();

  const res = await app.inject({
    method: 'GET',
    url: '/api/tasks/session',
    headers: { cookie: 'stt_session=revoked-exp' },
  });

  expect(res.statusCode).toBe(401);
  expect(res.json().error).toBe('Session revoked');
  const clearedCookie = res.cookies.find((c: { name: string }) => c.name === 'stt_session');
  expect(clearedCookie).toBeDefined();
  await app.close();
});

it('GET /api/tasks/session with revoked rotated cookie and binding mismatch returns 401', async () => {
  mockSessionFindUnique.mockImplementation((args: { where: { id: string } }) => {
    if (args.where.id === 'revoked-bind') {
      return Promise.resolve(makeDbSession({
        id: 'revoked-bind',
        revoked: true,
        rotatedTo: 'mismatch-target',
      }));
    }
    if (args.where.id === 'mismatch-target') {
      return Promise.resolve(makeDbSession({
        id: 'mismatch-target',
        uaHash: 'completely-different-ua-hash',
        ipPrefix: '10.0.0',
      }));
    }
    return Promise.resolve(null);
  });

  const app = await buildApp();

  const res = await app.inject({
    method: 'GET',
    url: '/api/tasks/session',
    headers: { cookie: 'stt_session=revoked-bind' },
  });

  expect(res.statusCode).toBe(401);
  expect(res.json().error).toBe('Session binding mismatch');
  const clearedCookie = res.cookies.find((c: { name: string }) => c.name === 'stt_session');
  expect(clearedCookie).toBeDefined();
  await app.close();
});

it('POST /api/tasks with revoked rotated cookie still returns 401', async () => {
  mockSessionFindUnique.mockImplementation((args: { where: { id: string } }) => {
    if (args.where.id === 'revoked-post') {
      return Promise.resolve(makeDbSession({
        id: 'revoked-post',
        revoked: true,
        rotatedTo: 'active-target',
      }));
    }
    if (args.where.id === 'active-target') {
      return Promise.resolve(makeDbSession({ id: 'active-target' }));
    }
    return Promise.resolve(null);
  });

  const app = await buildApp();

  const wavBuffer = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const body =
    `------boundary\r\n` +
    `Content-Disposition: form-data; name="file"; filename="test.wav"\r\n` +
    `Content-Type: audio/wav\r\n\r\n` +
    wavBuffer.toString('binary') +
    `\r\n------boundary--\r\n`;

  const res = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    headers: {
      'content-type': 'multipart/form-data; boundary=----boundary',
      cookie: 'stt_session=revoked-post',
      'x-csrf-token': CSRF_TOKEN,
      origin: 'http://localhost:8080',
    },
    payload: body,
  });

  expect(res.statusCode).toBe(401);
  expect(res.json().error).toBe('Session revoked');
  const clearedCookie = res.cookies.find((c: { name: string }) => c.name === 'stt_session');
  expect(clearedCookie).toBeDefined();
  await app.close();
});

it('GET /api/tasks with revoked rotated cookie still returns 401 (not bootstrap)', async () => {
  mockSessionFindUnique.mockImplementation((args: { where: { id: string } }) => {
    if (args.where.id === 'revoked-list') {
      return Promise.resolve(makeDbSession({
        id: 'revoked-list',
        revoked: true,
        rotatedTo: 'active-list-target',
      }));
    }
    if (args.where.id === 'active-list-target') {
      return Promise.resolve(makeDbSession({ id: 'active-list-target' }));
    }
    return Promise.resolve(null);
  });

  const app = await buildApp();

  const res = await app.inject({
    method: 'GET',
    url: '/api/tasks',
    headers: { cookie: 'stt_session=revoked-list' },
  });

  expect(res.statusCode).toBe(401);
  expect(res.json().error).toBe('Session revoked');
  const clearedCookie = res.cookies.find((c: { name: string }) => c.name === 'stt_session');
  expect(clearedCookie).toBeDefined();
  await app.close();
});

it('recovered bootstrap session can see tasks from the existing rotation chain', async () => {
  const activeSessionData = makeDbSession({
    id: 'active-history-sess',
    csrfToken: 'history-csrf-token',
  });

  mockSessionFindUnique.mockImplementation((args: { where: { id: string } }) => {
    if (args.where.id === 'revoked-history') {
      return Promise.resolve(makeDbSession({
        id: 'revoked-history',
        revoked: true,
        rotatedTo: 'active-history-sess',
      }));
    }
    if (args.where.id === 'active-history-sess') {
      return Promise.resolve(activeSessionData);
    }
    return Promise.resolve(null);
  });

  mockTaskFindMany.mockResolvedValue([
    {
      id: 'task-from-chain',
      status: 'completed',
      originalFilename: 'existing.wav',
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
    },
  ]);

  const app = await buildApp();

  const bootstrapRes = await app.inject({
    method: 'GET',
    url: '/api/tasks/session',
    headers: { cookie: 'stt_session=revoked-history' },
  });

  expect(bootstrapRes.statusCode).toBe(200);
  const recoveredCookie = bootstrapRes.cookies.find((c: { name: string }) => c.name === 'stt_session');
  expect(recoveredCookie).toBeDefined();
  expect(recoveredCookie!.value).toBe('active-history-sess');

  const listRes = await app.inject({
    method: 'GET',
    url: '/api/tasks',
    headers: { cookie: `stt_session=${recoveredCookie!.value}` },
  });

  expect(listRes.statusCode).toBe(200);
  expect(listRes.json()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'task-from-chain' }),
    ]),
  );

  await app.close();
});
```

- [ ] **Step 1a: Save the test file**

- [ ] **Step 1b: Run integration tests**

Run: `cd packages/server && npx vitest run src/__tests__/integration/security-stack.test.ts`
Expected: ALL PASS

- [ ] **Step 1c: Run full test suite**

Run: `cd packages/server && npx vitest run`
Expected: ALL PASS

- [ ] **Step 1d: Commit**

```bash
git add packages/server/src/__tests__/integration/security-stack.test.ts
git commit -m "test(session): add integration tests for rotated session recovery

Covers: successful recovery, expired target, binding mismatch,
POST rejection, non-bootstrap GET rejection, cookie clearing,
and recovered continuity."
```

---

## Task 4: Update documentation

**Files:**
- Modify: `docs/security.md`

### Step 1: Add recovery documentation

In `docs/security.md`, after the "Session Rotation" subsection (after line ~49, before `## CSRF`), add:

```markdown
### Rotated Session Recovery

If a browser presents a stale `stt_session` cookie pointing to a revoked session that has a `rotated_to` value, limited recovery is available:

**Recovery scope:** `GET /api/tasks/session` only. All other routes reject revoked cookies immediately.

**Recovery flow:**
1. Session plugin detects revoked session with `rotated_to` set
2. `followRotationChain()` walks the `rotated_to` chain (max 8 hops, cycle-safe)
3. Target session must be active, not expired, and pass UA hash + IP prefix binding
4. On success: adopts target session, refreshes `stt_session` + `csrf_token` cookies
5. On failure: clears cookie, returns 401

**Security invariants preserved:**
- Unsafe methods (POST/PUT/DELETE) never follow rotation chains from revoked cookies
- Old CSRF tokens are never accepted for rotated sessions
- The browser must complete a bootstrap request before unsafe requests use the new session
```

- [ ] **Step 1a: Save the docs change**

- [ ] **Step 1b: Commit**

```bash
git add docs/security.md
git commit -m "docs(security): document rotated session recovery behavior"
```

---

## Summary of Commits

1. `feat(session): add followRotationChain helper with unit tests`
2. `feat(session): recover stale rotated cookie on GET /api/tasks/session`
3. `test(session): add integration tests for rotated session recovery`
4. `docs(security): document rotated session recovery behavior`
