import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

/**
 * Tests that session rotation happens AFTER CSRF/Origin validation for unsafe methods,
 * and that safe methods can rotate without CSRF/Origin checks.
 *
 * We test the session plugin's onRequest hook by building a minimal Fastify-like mock.
 */

const mockFindUnique = vi.fn();
const mockSessionCreate = vi.fn();
const mockSessionUpdate = vi.fn();
const mockTaskUpdateMany = vi.fn();
const mockTransaction = vi.fn();

vi.mock('../../plugins/db', () => ({
  getDb: () => ({
    session: {
      findUnique: mockFindUnique,
      create: mockSessionCreate,
      update: mockSessionUpdate,
    },
    task: {
      updateMany: mockTaskUpdateMany,
    },
    $transaction: mockTransaction,
  }),
}));

vi.mock('../../config', () => ({
  config: { corsOrigin: 'http://localhost:8080', apiKey: '' },
}));

import {
  hashUserAgent,
  extractIpPrefix,
} from '../../plugins/session';

// Build a session that is past rotation threshold (25 hours old)
function makeOldSession(csrfToken: string) {
  const ua = 'Mozilla/5.0 Test';
  return {
    id: 'old-session-id',
    uaHash: hashUserAgent(ua),
    ipPrefix: extractIpPrefix('192.168.1.100'),
    csrfToken,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // not expired
    rotatedTo: null,
    revoked: false,
    createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25 hours ago
    lastSeenAt: new Date(),
  };
}

function makeRequest(method: string, headers: Record<string, string> = {}) {
  return {
    method,
    cookies: { stt_session: 'old-session-id' },
    headers: {
      'user-agent': 'Mozilla/5.0 Test',
      ...headers,
    },
    ip: '192.168.1.100',
    sessionId: '',
    csrfToken: '',
  };
}

function makeReply() {
  const reply: any = {
    statusCode: 200,
    body: null,
    cookies: {} as Record<string, any>,
    clearedCookies: [] as string[],
  };
  reply.status = vi.fn((code: number) => {
    reply.statusCode = code;
    return reply;
  });
  reply.send = vi.fn((body: any) => {
    reply.body = body;
    return reply;
  });
  reply.setCookie = vi.fn((name: string, value: string, opts: any) => {
    reply.cookies[name] = { value, opts };
  });
  reply.clearCookie = vi.fn((name: string, opts: any) => {
    reply.clearedCookies.push(name);
  });
  reply.header = vi.fn();
  return reply;
}

// We need to test the plugin hook directly, so we'll register it on a mock app
async function getOnRequestHook() {
  let hookFn: any;
  const mockApp = {
    decorateRequest: vi.fn(),
    addHook: vi.fn((_name: string, fn: any) => {
      hookFn = fn;
    }),
  };

  // Dynamically import and register the plugin
  const { sessionPlugin } = await import('../../plugins/session');
  await (sessionPlugin as any)(mockApp, {}, vi.fn());

  return hookFn;
}

describe('session rotation order with CSRF/Origin validation', () => {
  const validCsrfToken = 'a'.repeat(64);

  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionCreate.mockResolvedValue({
      id: 'new-session-id',
      csrfToken: 'new-csrf-token',
    });
    mockSessionUpdate.mockResolvedValue({});
    mockTaskUpdateMany.mockResolvedValue({ count: 0 });
    mockTransaction.mockImplementation(async (fn: any) => {
      return fn({
        session: { create: mockSessionCreate, update: mockSessionUpdate },
        task: { updateMany: mockTaskUpdateMany },
      });
    });
  });

  it('POST with wrong CSRF token: returns 403 and does NOT rotate', async () => {
    const session = makeOldSession(validCsrfToken);
    mockFindUnique.mockResolvedValue(session);

    const hook = await getOnRequestHook();
    const request = makeRequest('POST', {
      'x-csrf-token': 'wrong-token-that-is-definitely-not-matching!!!',
      origin: 'http://localhost:8080',
    });
    const reply = makeReply();

    await hook(request, reply);

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.body).toEqual({ error: 'CSRF token validation failed' });
    // Rotation must NOT have happened
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it('POST with wrong Origin: returns 403 and does NOT rotate', async () => {
    const session = makeOldSession(validCsrfToken);
    mockFindUnique.mockResolvedValue(session);

    const hook = await getOnRequestHook();
    const request = makeRequest('POST', {
      'x-csrf-token': validCsrfToken,
      origin: 'https://evil.example.com',
    });
    const reply = makeReply();

    await hook(request, reply);

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.body).toEqual({ error: 'Origin validation failed' });
    // Rotation must NOT have happened
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it('POST with valid CSRF and Origin: rotates session successfully', async () => {
    const session = makeOldSession(validCsrfToken);
    mockFindUnique.mockResolvedValue(session);

    const hook = await getOnRequestHook();
    const request = makeRequest('POST', {
      'x-csrf-token': validCsrfToken,
      origin: 'http://localhost:8080',
    });
    const reply = makeReply();

    await hook(request, reply);

    // Should NOT return 403
    expect(reply.status).not.toHaveBeenCalledWith(403);
    // Rotation SHOULD have happened
    expect(mockTransaction).toHaveBeenCalled();
    expect(request.sessionId).toBe('new-session-id');
  });

  it('GET (safe method) past threshold: rotates without CSRF/Origin check', async () => {
    const session = makeOldSession(validCsrfToken);
    mockFindUnique.mockResolvedValue(session);

    const hook = await getOnRequestHook();
    const request = makeRequest('GET');
    // No CSRF token or origin header at all
    const reply = makeReply();

    await hook(request, reply);

    // Should NOT return 403
    expect(reply.status).not.toHaveBeenCalledWith(403);
    // Rotation SHOULD have happened
    expect(mockTransaction).toHaveBeenCalled();
    expect(request.sessionId).toBe('new-session-id');
  });

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
});
