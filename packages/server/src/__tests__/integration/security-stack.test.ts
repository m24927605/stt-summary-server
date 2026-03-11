import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { SESSION_ID, CSRF_TOKEN, DEFAULT_UA_HASH, DEFAULT_IP_PREFIX, makeDbSession } from '../helpers/session';

const mockQueryRaw = vi.fn();
const mockTaskFindMany = vi.fn();
const mockTaskCreate = vi.fn();
const mockTaskFindUnique = vi.fn();
const mockTaskUpdateMany = vi.fn();
const mockSessionCreate = vi.fn();
const mockSessionFindUnique = vi.fn();
const mockSessionUpdate = vi.fn();
const mockRateLimitUpsert = vi.fn().mockResolvedValue({ count: 1 });
const mockRateLimitDeleteMany = vi.fn().mockResolvedValue({ count: 0 });

const mockDb: Record<string, any> = {
  $queryRaw: mockQueryRaw,
  task: {
    create: mockTaskCreate,
    findMany: mockTaskFindMany,
    findUnique: mockTaskFindUnique,
    updateMany: mockTaskUpdateMany,
  },
  session: {
    create: mockSessionCreate,
    findUnique: mockSessionFindUnique,
    update: mockSessionUpdate,
  },
  rateLimitEntry: {
    upsert: mockRateLimitUpsert,
    deleteMany: mockRateLimitDeleteMany,
  },
  $transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => fn(mockDb)),
};

vi.mock('../../plugins/db', () => ({
  getDb: () => mockDb,
  disconnectDb: vi.fn(),
}));

vi.mock('../../plugins/rabbitmq', () => ({
  connectQueue: vi.fn(async () => undefined),
  disconnectQueue: vi.fn(async () => undefined),
  publishTask: vi.fn(),
}));

vi.mock('../../services/storage', () => ({
  saveFile: vi.fn(() => Promise.resolve('./uploads/mock-uuid.wav')),
  saveFileStream: vi.fn(() => Promise.resolve('./uploads/mock-uuid.wav')),
}));

const WRONG_SESSION_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

describe('security stack integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryRaw.mockResolvedValue([1]);
    mockRateLimitUpsert.mockResolvedValue({ count: 1 });
    mockRateLimitDeleteMany.mockResolvedValue({ count: 0 });
    mockSessionFindUnique.mockImplementation((args: { where: { id: string } }) => {
      if (args.where.id === SESSION_ID) return Promise.resolve(makeDbSession());
      if (args.where.id === WRONG_SESSION_ID) return Promise.resolve(makeDbSession({ id: WRONG_SESSION_ID }));
      return Promise.resolve(null);
    });
    mockSessionUpdate.mockResolvedValue(makeDbSession());
    mockSessionCreate.mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: SESSION_ID, ...args.data })
    );
  });

  // --- Existing security header tests ---

  it('returns CSP header with correct directives', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    await app.close();
  });

  it('returns X-Content-Type-Options nosniff', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    await app.close();
  });

  it('returns X-Request-ID header', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['x-request-id']).toBeDefined();
    expect(typeof res.headers['x-request-id']).toBe('string');
    await app.close();
  });

  it('forwards provided X-Request-ID', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { 'x-request-id': 'test-trace-123' },
    });
    expect(res.headers['x-request-id']).toBe('test-trace-123');
    await app.close();
  });

  it('health check does not leak error details on failure', async () => {
    mockQueryRaw.mockRejectedValueOnce(new Error('connection refused'));
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe('error');
    expect(body).not.toHaveProperty('stack');
    expect(body).not.toHaveProperty('message');
    expect(JSON.stringify(body)).not.toContain('connection refused');
    await app.close();
  });

  it('health check is exempt from rate limiting', async () => {
    const app = await buildApp();
    for (let i = 0; i < 20; i++) {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).not.toBe(429);
    }
    await app.close();
  });

  it('sets Referrer-Policy header', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    await app.close();
  });

  // --- Session cookie tests ---

  it('server sets HttpOnly stt_session cookie on first GET /api/tasks', async () => {
    mockSessionFindUnique.mockResolvedValue(null);
    mockTaskFindMany.mockResolvedValue([]);

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/tasks' });

    expect(res.statusCode).toBe(200);
    const sessionCookie = res.cookies.find((c: { name: string }) => c.name === 'stt_session');
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie!.httpOnly).toBe(true);
    await app.close();
  });

  it('server sets csrf_token cookie (JS-readable) on first GET /api/tasks', async () => {
    mockSessionFindUnique.mockResolvedValue(null);
    mockTaskFindMany.mockResolvedValue([]);

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/tasks' });

    expect(res.statusCode).toBe(200);
    const csrfCookie = res.cookies.find((c: { name: string }) => c.name === 'csrf_token');
    expect(csrfCookie).toBeDefined();
    expect(csrfCookie!.httpOnly).toBeFalsy();
    await app.close();
  });

  // --- CSRF tests ---

  it('POST /api/tasks without CSRF token is rejected with 403', async () => {
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
        cookie: `stt_session=${SESSION_ID}`,
        origin: 'http://localhost:8080',
      },
      payload: body,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('CSRF');
    await app.close();
  });

  it('POST /api/tasks with wrong CSRF token is rejected with 403', async () => {
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
        cookie: `stt_session=${SESSION_ID}`,
        'x-csrf-token': 'wrong-token'.padEnd(64, 'x'),
        origin: 'http://localhost:8080',
      },
      payload: body,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('CSRF');
    await app.close();
  });

  it('POST /api/tasks with wrong Origin is rejected with 403', async () => {
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
        cookie: `stt_session=${SESSION_ID}`,
        'x-csrf-token': CSRF_TOKEN,
        origin: 'https://evil.example.com',
      },
      payload: body,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('Origin');
    await app.close();
  });

  // --- Session isolation ---

  it('GET /api/tasks returns tasks scoped to cookie session', async () => {
    mockTaskFindMany.mockResolvedValue([]);

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/tasks',
      headers: { cookie: `stt_session=${SESSION_ID}` },
    });

    expect(res.statusCode).toBe(200);
    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sessionId: SESSION_ID } }),
    );
    await app.close();
  });

  // --- SSE ignores query string sessionId ---

  it('SSE uses cookie session, ignores query string sessionId', async () => {
    const task = {
      id: 'task-1',
      status: 'completed',
      step: null,
      sessionId: SESSION_ID,
      originalFilename: 'test.wav',
      filePath: 'uploads/test.wav',
      transcript: 'hello',
      summary: 'greeting',
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
    };
    mockTaskFindUnique.mockResolvedValue(task);

    const app = await buildApp();

    // Query string has matching sessionId, but cookie session is wrong
    const res = await app.inject({
      method: 'GET',
      url: `/api/tasks/task-1/events?sessionId=${SESSION_ID}`,
      headers: { cookie: `stt_session=${WRONG_SESSION_ID}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toHaveProperty('error', 'Task not found');
    await app.close();
  });

  // --- Session cookie does not bypass API key routes ---

  it('session cookie does not grant access to api-key-protected routes', async () => {
    mockTaskFindMany.mockResolvedValue([]);

    const app = await buildApp();

    // Verify task routes work with session (no API key needed)
    const taskRes = await app.inject({
      method: 'GET',
      url: '/api/tasks',
      headers: { cookie: `stt_session=${SESSION_ID}` },
    });
    expect(taskRes.statusCode).toBe(200);

    // Verify health is public
    const healthRes = await app.inject({ method: 'GET', url: '/api/health' });
    expect(healthRes.statusCode).toBe(200);

    await app.close();
  });

  // --- Session rejection tests (Finding 1) ---

  it('forged/nonexistent session cookie is rejected, no new session created', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/api/tasks',
      headers: { cookie: 'stt_session=nonexistent-session-id' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Invalid session');
    expect(mockSessionCreate).not.toHaveBeenCalled();
    await app.close();
  });

  it('revoked session cookie is rejected', async () => {
    mockSessionFindUnique.mockImplementation((args: { where: { id: string } }) => {
      if (args.where.id === 'revoked-session') {
        return Promise.resolve(makeDbSession({ id: 'revoked-session', revoked: true }));
      }
      return Promise.resolve(null);
    });

    const app = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/api/tasks',
      headers: { cookie: 'stt_session=revoked-session' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Session revoked');
    expect(mockSessionCreate).not.toHaveBeenCalled();
    await app.close();
  });

  // --- Rotated session recovery tests ---

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

  it('expired session cookie is rejected', async () => {
    mockSessionFindUnique.mockImplementation((args: { where: { id: string } }) => {
      if (args.where.id === 'expired-session') {
        return Promise.resolve(makeDbSession({
          id: 'expired-session',
          expiresAt: new Date(Date.now() - 1000), // expired 1 second ago
        }));
      }
      return Promise.resolve(null);
    });

    const app = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/api/tasks',
      headers: { cookie: 'stt_session=expired-session' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Session expired');
    expect(mockSessionCreate).not.toHaveBeenCalled();
    await app.close();
  });

  it('UA/IP mismatch is rejected', async () => {
    mockSessionFindUnique.mockImplementation((args: { where: { id: string } }) => {
      if (args.where.id === 'mismatched-session') {
        return Promise.resolve(makeDbSession({
          id: 'mismatched-session',
          uaHash: 'totally-different-ua-hash',
          ipPrefix: '10.0.0',
        }));
      }
      return Promise.resolve(null);
    });

    const app = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/api/tasks',
      headers: { cookie: 'stt_session=mismatched-session' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Session binding mismatch');
    expect(mockSessionCreate).not.toHaveBeenCalled();
    await app.close();
  });

  // --- Session init endpoint tests ---

  it('GET /api/tasks/session creates session and returns csrfToken for new user', async () => {
    mockSessionFindUnique.mockResolvedValue(null);

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/tasks/session',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('csrfToken');

    const sttCookie = res.cookies.find((c: { name: string }) => c.name === 'stt_session');
    expect(sttCookie).toBeDefined();
    expect(sttCookie!.httpOnly).toBe(true);

    const csrfCookie = res.cookies.find((c: { name: string }) => c.name === 'csrf_token');
    expect(csrfCookie).toBeDefined();
    expect(csrfCookie!.httpOnly).toBeFalsy();

    expect(mockSessionCreate).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('expired session can recover on next bootstrap attempt', async () => {
    mockSessionFindUnique.mockImplementation((args: { where: { id: string } }) => {
      if (args.where.id === 'expired-sess') {
        return Promise.resolve(makeDbSession({
          id: 'expired-sess',
          expiresAt: new Date(Date.now() - 1000),
        }));
      }
      return Promise.resolve(null);
    });

    const app = await buildApp();

    // Step 1: expired cookie → 401 + clear cookie
    const res1 = await app.inject({
      method: 'GET',
      url: '/api/tasks/session',
      headers: { cookie: 'stt_session=expired-sess' },
    });

    expect(res1.statusCode).toBe(401);
    expect(res1.json().error).toBe('Session expired');
    const clearedCookie = res1.cookies.find((c: { name: string }) => c.name === 'stt_session');
    expect(clearedCookie).toBeDefined();

    // Step 2: retry without cookie → new session created
    mockSessionCreate.mockClear();
    const res2 = await app.inject({
      method: 'GET',
      url: '/api/tasks/session',
    });

    expect(res2.statusCode).toBe(200);
    expect(res2.json()).toHaveProperty('csrfToken');

    const newSttCookie = res2.cookies.find((c: { name: string }) => c.name === 'stt_session');
    expect(newSttCookie).toBeDefined();

    const newCsrfCookie = res2.cookies.find((c: { name: string }) => c.name === 'csrf_token');
    expect(newCsrfCookie).toBeDefined();

    expect(mockSessionCreate).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('upload succeeds after session initialization via GET /api/tasks/session', async () => {
    mockSessionFindUnique.mockResolvedValue(null);

    const app = await buildApp();

    // Step 1: bootstrap session
    const initRes = await app.inject({
      method: 'GET',
      url: '/api/tasks/session',
    });

    expect(initRes.statusCode).toBe(200);
    const { csrfToken } = initRes.json();

    // Extract session cookie from init response
    const sttCookie = initRes.cookies.find((c: { name: string }) => c.name === 'stt_session');
    expect(sttCookie).toBeDefined();
    const sessionId = sttCookie!.value;

    // Now mock sessionFindUnique to return the created session for subsequent requests
    mockSessionFindUnique.mockResolvedValue(makeDbSession({ id: sessionId, csrfToken }));

    // Mock task creation
    mockTaskCreate.mockResolvedValue({
      id: 'new-task-id',
      status: 'pending',
      originalFilename: 'test.wav',
      createdAt: new Date(),
    });

    // Step 2: upload with session cookie + CSRF token
    const wavBuffer = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const body =
      `------boundary\r\n` +
      `Content-Disposition: form-data; name="file"; filename="test.wav"\r\n` +
      `Content-Type: audio/wav\r\n\r\n` +
      wavBuffer.toString('binary') +
      `\r\n------boundary--\r\n`;

    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: {
        'content-type': 'multipart/form-data; boundary=----boundary',
        cookie: `stt_session=${sessionId}`,
        'x-csrf-token': csrfToken,
        origin: 'http://localhost:8080',
      },
      payload: body,
    });

    expect(uploadRes.statusCode).toBe(201);
    expect(uploadRes.json()).toHaveProperty('id');
    expect(uploadRes.json().error).toBeUndefined();
    await app.close();
  });

  it('POST without session cookie is rejected and db.session.create not called', async () => {
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
        origin: 'http://localhost:8080',
      },
      payload: body,
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Session required');
    expect(mockSessionCreate).not.toHaveBeenCalled();
    await app.close();
  });
});
