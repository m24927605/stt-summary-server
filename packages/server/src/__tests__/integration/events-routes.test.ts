import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    mockFindUnique.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/api/tasks/non-existent/events?sessionId=test-session-id',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toHaveProperty('error', 'Task not found');
  });

  it('sends completed event for completed task', async () => {
    const task = makeTask({
      status: 'completed',
      transcript: 'Hello world',
      summary: 'A greeting',
    });
    mockFindUnique.mockResolvedValue(task);

    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks/${task.id}/events?sessionId=test-session-id`,
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
    });
    mockFindUnique.mockResolvedValue(task);

    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks/${task.id}/events?sessionId=test-session-id`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.body;
    expect(body).toContain('event: status');
    expect(body).toContain('event: failed');
    expect(body).toContain('STT failed: timeout');
  });

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
    const task = makeTask({ status: 'completed', sessionId: 'owner-session', transcript: 'x', summary: 'y' });
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

  describe('SSE polling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('polls and sends completed event when task finishes processing', async () => {
      mockFindUnique
        .mockResolvedValueOnce(makeTask({ status: 'processing', step: 'transcribing' }))
        .mockResolvedValueOnce(makeTask({
          status: 'completed',
          transcript: 'hello',
          summary: 'a greeting',
        }));

      const responsePromise = app.inject({
        method: 'GET',
        url: '/api/tasks/test-task-id-1/events?sessionId=test-session-id',
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
      mockFindUnique
        .mockResolvedValueOnce(makeTask({ status: 'processing', step: 'transcribing' }))
        .mockResolvedValueOnce(makeTask({
          status: 'failed',
          error: 'OpenAI API timeout',
        }));

      const responsePromise = app.inject({
        method: 'GET',
        url: '/api/tasks/test-task-id-1/events?sessionId=test-session-id',
      });

      await vi.advanceTimersByTimeAsync(2000);
      const response = await responsePromise;

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('event: failed');
      expect(response.body).toContain('OpenAI API timeout');
    });

    it('polls and sends status update when step changes', async () => {
      mockFindUnique
        .mockResolvedValueOnce(makeTask({ status: 'processing', step: 'transcribing' }))
        .mockResolvedValueOnce(makeTask({ status: 'processing', step: 'summarizing' }))
        .mockResolvedValueOnce(makeTask({
          status: 'completed',
          transcript: 'hi',
          summary: 'greeting',
        }));

      const responsePromise = app.inject({
        method: 'GET',
        url: '/api/tasks/test-task-id-1/events?sessionId=test-session-id',
      });

      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(2000);
      const response = await responsePromise;

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('"step":"summarizing"');
      expect(response.body).toContain('event: completed');
    });

    it('stops polling when task is deleted during processing', async () => {
      mockFindUnique
        .mockResolvedValueOnce(makeTask({ status: 'processing', step: 'transcribing' }))
        .mockResolvedValueOnce(null);

      const responsePromise = app.inject({
        method: 'GET',
        url: '/api/tasks/test-task-id-1/events?sessionId=test-session-id',
      });

      await vi.advanceTimersByTimeAsync(2000);
      const response = await responsePromise;

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('event: status');
      expect(response.body).not.toContain('event: completed');
    });

    it('stops polling on database error', async () => {
      mockFindUnique
        .mockResolvedValueOnce(makeTask({ status: 'processing', step: 'transcribing' }))
        .mockRejectedValueOnce(new Error('DB connection lost'));

      const responsePromise = app.inject({
        method: 'GET',
        url: '/api/tasks/test-task-id-1/events?sessionId=test-session-id',
      });

      await vi.advanceTimersByTimeAsync(2000);
      const response = await responsePromise;

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('event: status');
      expect(response.body).not.toContain('event: completed');
    });

    it('ends stream after 5-minute timeout', async () => {
      mockFindUnique.mockResolvedValue(
        makeTask({ status: 'processing', step: 'transcribing' })
      );

      const responsePromise = app.inject({
        method: 'GET',
        url: '/api/tasks/test-task-id-1/events?sessionId=test-session-id',
      });

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      const response = await responsePromise;

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('event: status');
      expect(response.body).not.toContain('event: completed');
    });
  });
});
