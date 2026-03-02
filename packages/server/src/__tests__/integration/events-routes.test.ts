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
  config: { corsOrigin: '*' },
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
      url: '/api/tasks/non-existent/events',
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
      url: `/api/tasks/${task.id}/events`,
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
      url: `/api/tasks/${task.id}/events`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.body;
    expect(body).toContain('event: status');
    expect(body).toContain('event: failed');
    expect(body).toContain('STT failed: timeout');
  });
});
