import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import Fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { makeTask } from '../helpers/fixtures';
import { SESSION_ID, CSRF_TOKEN, DEFAULT_UA_HASH, DEFAULT_IP_PREFIX, makeDbSession, sessionCookie } from '../helpers/session';

const mockTaskFindUnique = vi.fn();
const mockSessionFindUnique = vi.fn();
const mockSessionCreate = vi.fn();
const mockSessionUpdate = vi.fn();

vi.mock('../../plugins/db', () => ({
  getDb: () => ({
    task: {
      findUnique: mockTaskFindUnique,
    },
    session: {
      create: mockSessionCreate,
      findUnique: mockSessionFindUnique,
      update: mockSessionUpdate,
    },
  }),
}));

vi.mock('../../config', () => ({
  config: { corsOrigin: 'http://localhost:8080', apiKey: '' },
}));

import { eventRoutes } from '../../routes/events';
import { sessionPlugin } from '../../plugins/session';

const OTHER_SESSION_ID = 'b1ffcd00-ad1c-5fa9-cc7e-7ccace491b22';

describe('event routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSessionFindUnique.mockImplementation((args: { where: { id: string } }) => {
      if (args.where.id === SESSION_ID) return Promise.resolve(makeDbSession());
      if (args.where.id === OTHER_SESSION_ID) return Promise.resolve(makeDbSession({ id: OTHER_SESSION_ID }));
      return Promise.resolve(null);
    });
    mockSessionUpdate.mockResolvedValue(makeDbSession());
    mockSessionCreate.mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: randomUUID(), ...args.data })
    );

    app = Fastify();
    await app.register(cookie);
    await app.register(sessionPlugin);
    await app.register(eventRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 404 when task not found', async () => {
    mockTaskFindUnique.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks/non-existent/events`,
      headers: { cookie: sessionCookie() },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toHaveProperty('error', 'Task not found');
  });

  it('sends completed event for completed task', async () => {
    const task = makeTask({
      status: 'completed',
      transcript: 'Hello world',
      summary: 'A greeting',
      sessionId: SESSION_ID,
    });
    mockTaskFindUnique.mockResolvedValue(task);

    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks/${task.id}/events`,
      headers: { cookie: sessionCookie() },
    });

    expect(response.statusCode).toBe(200);
    const body = response.body;
    expect(body).toContain('event: status');
    expect(body).toContain('event: completed');
    expect(body).toContain('"transcript":"Hello world"');
  });

  it('sends failed event for failed task', async () => {
    const task = makeTask({
      status: 'failed',
      error: 'STT failed: timeout',
      sessionId: SESSION_ID,
    });
    mockTaskFindUnique.mockResolvedValue(task);

    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks/${task.id}/events`,
      headers: { cookie: sessionCookie() },
    });

    expect(response.statusCode).toBe(200);
    const body = response.body;
    expect(body).toContain('event: status');
    expect(body).toContain('event: failed');
    expect(body).toContain('"code":"transcription_failed"');
  });

  it('ignores query string sessionId — uses cookie session for ownership', async () => {
    const task = makeTask({
      status: 'completed',
      transcript: 'hi',
      summary: 'greeting',
      sessionId: SESSION_ID,
    });
    mockTaskFindUnique.mockResolvedValue(task);

    // Cookie session is OTHER_SESSION_ID, query string has matching SESSION_ID
    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks/${task.id}/events?sessionId=${SESSION_ID}`,
      headers: { cookie: sessionCookie(OTHER_SESSION_ID) },
    });

    // Cookie session doesn't match task → 404
    expect(response.statusCode).toBe(404);
    expect(response.json()).toHaveProperty('error', 'Task not found');
  });

  it('uses cookie session correctly when query string is absent', async () => {
    const task = makeTask({
      status: 'completed',
      sessionId: SESSION_ID,
      transcript: 'hello',
      summary: 'a greeting',
    });
    mockTaskFindUnique.mockResolvedValue(task);

    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks/${task.id}/events`,
      headers: { cookie: sessionCookie() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('event: completed');
  });

  it('returns 404 when cookie session does not match task', async () => {
    const task = makeTask({ status: 'completed', sessionId: SESSION_ID, transcript: 'x', summary: 'y' });
    mockTaskFindUnique.mockResolvedValue(task);

    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks/${task.id}/events`,
      headers: { cookie: sessionCookie(OTHER_SESSION_ID) },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toHaveProperty('error', 'Task not found');
  });

  describe('SSE polling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('polls and sends completed event when task finishes processing', async () => {
      mockTaskFindUnique
        .mockResolvedValueOnce(makeTask({ status: 'processing', step: 'transcribing', sessionId: SESSION_ID }))
        .mockResolvedValueOnce(makeTask({
          status: 'completed',
          transcript: 'hello',
          summary: 'a greeting',
          sessionId: SESSION_ID,
        }));

      const responsePromise = app.inject({
        method: 'GET',
        url: `/api/tasks/test-task-id-1/events`,
        headers: { cookie: sessionCookie() },
      });

      await vi.advanceTimersByTimeAsync(2000);
      const response = await responsePromise;

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('event: status');
      expect(response.body).toContain('event: completed');
      expect(response.body).toContain('"transcript":"hello"');
      expect(response.body).toContain('"summary":"a greeting"');
    });

    it('polls and sends failed event when task fails during processing', async () => {
      mockTaskFindUnique
        .mockResolvedValueOnce(makeTask({ status: 'processing', step: 'transcribing', sessionId: SESSION_ID }))
        .mockResolvedValueOnce(makeTask({
          status: 'failed',
          error: 'OpenAI API timeout',
          sessionId: SESSION_ID,
        }));

      const responsePromise = app.inject({
        method: 'GET',
        url: `/api/tasks/test-task-id-1/events`,
        headers: { cookie: sessionCookie() },
      });

      await vi.advanceTimersByTimeAsync(2000);
      const response = await responsePromise;

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('event: failed');
      expect(response.body).toContain('"code":"unknown_error"');
    });

    it('polls and sends status update when step changes', async () => {
      const sid = randomUUID();
      mockSessionFindUnique.mockImplementation((args: { where: { id: string } }) => {
        if (args.where.id === sid) return Promise.resolve(makeDbSession({ id: sid }));
        return Promise.resolve(null);
      });
      mockTaskFindUnique
        .mockResolvedValueOnce(makeTask({ status: 'processing', step: 'transcribing', sessionId: sid }))
        .mockResolvedValueOnce(makeTask({ status: 'processing', step: 'summarizing', sessionId: sid }))
        .mockResolvedValueOnce(makeTask({
          status: 'completed',
          transcript: 'hi',
          summary: 'greeting',
          sessionId: sid,
        }));

      const responsePromise = app.inject({
        method: 'GET',
        url: `/api/tasks/test-task-id-1/events`,
        headers: { cookie: sessionCookie(sid) },
      });

      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(2000);
      const response = await responsePromise;

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('"step":"summarizing"');
      expect(response.body).toContain('event: completed');
    });

    it('stops polling when task is deleted during processing', async () => {
      const sid = randomUUID();
      mockSessionFindUnique.mockImplementation((args: { where: { id: string } }) => {
        if (args.where.id === sid) return Promise.resolve(makeDbSession({ id: sid }));
        return Promise.resolve(null);
      });
      mockTaskFindUnique
        .mockResolvedValueOnce(makeTask({ status: 'processing', step: 'transcribing', sessionId: sid }))
        .mockResolvedValueOnce(null);

      const responsePromise = app.inject({
        method: 'GET',
        url: `/api/tasks/test-task-id-1/events`,
        headers: { cookie: sessionCookie(sid) },
      });

      await vi.advanceTimersByTimeAsync(2000);
      const response = await responsePromise;

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('event: status');
      expect(response.body).not.toContain('event: completed');
    });

    it('stops polling on database error', async () => {
      const sid = randomUUID();
      mockSessionFindUnique.mockImplementation((args: { where: { id: string } }) => {
        if (args.where.id === sid) return Promise.resolve(makeDbSession({ id: sid }));
        return Promise.resolve(null);
      });
      mockTaskFindUnique
        .mockResolvedValueOnce(makeTask({ status: 'processing', step: 'transcribing', sessionId: sid }))
        .mockRejectedValueOnce(new Error('DB connection lost'));

      const responsePromise = app.inject({
        method: 'GET',
        url: `/api/tasks/test-task-id-1/events`,
        headers: { cookie: sessionCookie(sid) },
      });

      await vi.advanceTimersByTimeAsync(2000);
      const response = await responsePromise;

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('event: status');
      expect(response.body).not.toContain('event: completed');
    });

    it('ends stream after 5-minute timeout', async () => {
      const sid = randomUUID();
      mockSessionFindUnique.mockImplementation((args: { where: { id: string } }) => {
        if (args.where.id === sid) return Promise.resolve(makeDbSession({ id: sid }));
        return Promise.resolve(null);
      });
      mockTaskFindUnique.mockResolvedValue(
        makeTask({ status: 'processing', step: 'transcribing', sessionId: sid })
      );

      const responsePromise = app.inject({
        method: 'GET',
        url: `/api/tasks/test-task-id-1/events`,
        headers: { cookie: sessionCookie(sid) },
      });

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      const response = await responsePromise;

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('event: status');
      expect(response.body).not.toContain('event: completed');
    });
  });
});
