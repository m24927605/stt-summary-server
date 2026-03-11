import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import Fastify, { FastifyInstance } from 'fastify';
import { makeTask } from '../helpers/fixtures';

const mockFindUnique = vi.fn();

vi.mock('../../plugins/db', () => ({
  getDb: () => ({
    task: {
      findUnique: mockFindUnique,
    },
  }),
}));

vi.mock('../../config', () => ({
  config: { corsOrigin: '*', apiKey: '' },
}));

import { eventRoutes } from '../../routes/events';

// Use unique UUIDs per test to avoid hitting SSE connection limits
// (inject() doesn't fire request.raw 'close', so connections accumulate)
const OTHER_SESSION_ID = 'b1ffcd00-ad1c-5fa9-cc7e-7ccace491b22';
const WRONG_SESSION_ID = 'c200de11-be2d-4fb0-ad8f-8ddbdf502c33';

describe('event routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    await app.register(eventRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 404 when task not found', async () => {
    const sid = randomUUID();
    mockFindUnique.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks/non-existent/events?sessionId=${sid}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toHaveProperty('error', 'Task not found');
  });

  it('sends completed event for completed task', async () => {
    const sid = randomUUID();
    const task = makeTask({
      status: 'completed',
      transcript: 'Hello world',
      summary: 'A greeting',
      sessionId: sid,
    });
    mockFindUnique.mockResolvedValue(task);

    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks/${task.id}/events?sessionId=${sid}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.body;
    expect(body).toContain('event: status');
    expect(body).toContain('event: completed');
    expect(body).toContain('"transcript":"Hello world"');
  });

  it('sends failed event for failed task', async () => {
    const sid = randomUUID();
    const task = makeTask({
      status: 'failed',
      error: 'STT failed: timeout',
      sessionId: sid,
    });
    mockFindUnique.mockResolvedValue(task);

    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks/${task.id}/events?sessionId=${sid}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.body;
    expect(body).toContain('event: status');
    expect(body).toContain('event: failed');
    expect(body).toContain('"code":"transcription_failed"');
  });

  it('returns 400 when sessionId query param is missing', async () => {
    const task = makeTask({ status: 'completed', transcript: 'hi', summary: 'greeting' });
    mockFindUnique.mockResolvedValue(task);

    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks/${task.id}/events`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toHaveProperty('error', 'Invalid or missing sessionId');
  });

  it('returns 400 when sessionId is not a valid UUID', async () => {
    const task = makeTask({ status: 'completed', transcript: 'hi', summary: 'greeting' });
    mockFindUnique.mockResolvedValue(task);

    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks/${task.id}/events?sessionId=not-a-uuid`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toHaveProperty('error', 'Invalid or missing sessionId');
  });

  it('returns 404 when sessionId does not match task', async () => {
    const task = makeTask({ status: 'completed', sessionId: OTHER_SESSION_ID, transcript: 'x', summary: 'y' });
    mockFindUnique.mockResolvedValue(task);

    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks/${task.id}/events?sessionId=${WRONG_SESSION_ID}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toHaveProperty('error', 'Task not found');
  });

  it('sends events when sessionId matches', async () => {
    const sid = randomUUID();
    const task = makeTask({
      status: 'completed',
      sessionId: sid,
      transcript: 'hello',
      summary: 'a greeting',
    });
    mockFindUnique.mockResolvedValue(task);

    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks/${task.id}/events?sessionId=${sid}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('event: completed');
  });

  describe('SSE polling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('polls and sends completed event when task finishes processing', async () => {
      const sid = randomUUID();
      mockFindUnique
        .mockResolvedValueOnce(makeTask({ status: 'processing', step: 'transcribing', sessionId: sid }))
        .mockResolvedValueOnce(makeTask({
          status: 'completed',
          transcript: 'hello',
          summary: 'a greeting',
          sessionId: sid,
        }));

      const responsePromise = app.inject({
        method: 'GET',
        url: `/api/tasks/test-task-id-1/events?sessionId=${sid}`,
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
      const sid = randomUUID();
      mockFindUnique
        .mockResolvedValueOnce(makeTask({ status: 'processing', step: 'transcribing', sessionId: sid }))
        .mockResolvedValueOnce(makeTask({
          status: 'failed',
          error: 'OpenAI API timeout',
          sessionId: sid,
        }));

      const responsePromise = app.inject({
        method: 'GET',
        url: `/api/tasks/test-task-id-1/events?sessionId=${sid}`,
      });

      await vi.advanceTimersByTimeAsync(2000);
      const response = await responsePromise;

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('event: failed');
      expect(response.body).toContain('"code":"unknown_error"');
    });

    it('polls and sends status update when step changes', async () => {
      const sid = randomUUID();
      mockFindUnique
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
        url: `/api/tasks/test-task-id-1/events?sessionId=${sid}`,
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
      mockFindUnique
        .mockResolvedValueOnce(makeTask({ status: 'processing', step: 'transcribing', sessionId: sid }))
        .mockResolvedValueOnce(null);

      const responsePromise = app.inject({
        method: 'GET',
        url: `/api/tasks/test-task-id-1/events?sessionId=${sid}`,
      });

      await vi.advanceTimersByTimeAsync(2000);
      const response = await responsePromise;

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('event: status');
      expect(response.body).not.toContain('event: completed');
    });

    it('stops polling on database error', async () => {
      const sid = randomUUID();
      mockFindUnique
        .mockResolvedValueOnce(makeTask({ status: 'processing', step: 'transcribing', sessionId: sid }))
        .mockRejectedValueOnce(new Error('DB connection lost'));

      const responsePromise = app.inject({
        method: 'GET',
        url: `/api/tasks/test-task-id-1/events?sessionId=${sid}`,
      });

      await vi.advanceTimersByTimeAsync(2000);
      const response = await responsePromise;

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('event: status');
      expect(response.body).not.toContain('event: completed');
    });

    it('ends stream after 5-minute timeout', async () => {
      const sid = randomUUID();
      mockFindUnique.mockResolvedValue(
        makeTask({ status: 'processing', step: 'transcribing', sessionId: sid })
      );

      const responsePromise = app.inject({
        method: 'GET',
        url: `/api/tasks/test-task-id-1/events?sessionId=${sid}`,
      });

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      const response = await responsePromise;

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('event: status');
      expect(response.body).not.toContain('event: completed');
    });
  });
});
