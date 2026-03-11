import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { makeTask } from '../helpers/fixtures';
import { SESSION_ID, CSRF_TOKEN, makeDbSession, sessionCookie } from '../helpers/session';

const mockCreate = vi.fn();
const mockFindMany = vi.fn();
const mockFindUnique = vi.fn();
const mockSessionCreate = vi.fn();
const mockSessionFindUnique = vi.fn();
const mockSessionUpdate = vi.fn();

vi.mock('../../plugins/db', () => ({
  getDb: () => ({
    task: {
      create: mockCreate,
      findMany: mockFindMany,
      findUnique: mockFindUnique,
    },
    session: {
      create: mockSessionCreate,
      findUnique: mockSessionFindUnique,
      update: mockSessionUpdate,
    },
  }),
}));

vi.mock('../../plugins/rabbitmq', () => ({
  publishTask: vi.fn(),
}));

vi.mock('../../services/storage', () => ({
  saveFile: vi.fn(() => Promise.resolve('./uploads/mock.wav')),
  saveFileStream: vi.fn(() => Promise.resolve('./uploads/mock.wav')),
}));

import { taskRoutes } from '../../routes/tasks';
import { sessionPlugin } from '../../plugins/session';

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;

describe('task response contract', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSessionFindUnique.mockResolvedValue(makeDbSession());
    mockSessionUpdate.mockResolvedValue(makeDbSession());
    mockSessionCreate.mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: SESSION_ID, ...args.data })
    );

    app = Fastify();
    await app.register(cookie);
    await app.register(multipart);
    await app.register(sessionPlugin);
    await app.register(taskRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /api/tasks response matches TaskCreateResponse shape', async () => {
    const task = makeTask({ sessionId: SESSION_ID });
    mockCreate.mockResolvedValue(task);

    const wavBuffer = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const body =
      `------boundary\r\n` +
      `Content-Disposition: form-data; name="file"; filename="test.wav"\r\n` +
      `Content-Type: audio/wav\r\n\r\n` +
      wavBuffer.toString('binary') +
      `\r\n------boundary--\r\n`;

    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: {
        'content-type': 'multipart/form-data; boundary=----boundary',
        cookie: sessionCookie(),
        'x-csrf-token': CSRF_TOKEN,
        origin: 'http://localhost:8080',
      },
      payload: body,
    });

    const json = response.json();
    expect(json).toHaveProperty('id');
    expect(json).toHaveProperty('status');
    expect(json).toHaveProperty('originalFilename');
    expect(json).toHaveProperty('createdAt');
    expect(typeof json.id).toBe('string');
    expect(typeof json.status).toBe('string');
    expect(typeof json.originalFilename).toBe('string');
    expect(json.createdAt).toMatch(ISO_DATE_REGEX);
  });

  it('GET /api/tasks response items match TaskResponse shape', async () => {
    mockFindMany.mockResolvedValue([makeTask({ sessionId: SESSION_ID })]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/tasks',
      headers: { cookie: sessionCookie() },
    });
    const items = response.json();
    const item = items[0];

    expect(item).toHaveProperty('id');
    expect(item).toHaveProperty('status');
    expect(item).toHaveProperty('step');
    expect(item).toHaveProperty('originalFilename');
    expect(item).toHaveProperty('transcript');
    expect(item).toHaveProperty('summary');
    expect(item).toHaveProperty('error');
    expect(item).toHaveProperty('createdAt');
    expect(item).toHaveProperty('updatedAt');
    expect(item).toHaveProperty('completedAt');
  });

  it('GET /api/tasks/:id response matches TaskResponse shape', async () => {
    mockFindUnique.mockResolvedValue(makeTask({ sessionId: SESSION_ID }));

    const response = await app.inject({
      method: 'GET',
      url: '/api/tasks/test-task-id-1',
      headers: { cookie: sessionCookie() },
    });
    const json = response.json();

    expect(json).toHaveProperty('id');
    expect(json).toHaveProperty('status');
    expect(json).toHaveProperty('step');
    expect(json).toHaveProperty('originalFilename');
    expect(json).toHaveProperty('transcript');
    expect(json).toHaveProperty('summary');
    expect(json).toHaveProperty('error');
    expect(json).toHaveProperty('createdAt');
    expect(json).toHaveProperty('updatedAt');
    expect(json).toHaveProperty('completedAt');
  });

  it('date fields are ISO 8601 strings', async () => {
    mockFindUnique.mockResolvedValue(makeTask({ sessionId: SESSION_ID, completedAt: new Date('2025-06-01T00:00:00Z') }));

    const response = await app.inject({
      method: 'GET',
      url: '/api/tasks/test-task-id-1',
      headers: { cookie: sessionCookie() },
    });
    const json = response.json();

    expect(json.createdAt).toMatch(ISO_DATE_REGEX);
    expect(json.updatedAt).toMatch(ISO_DATE_REGEX);
    expect(json.completedAt).toMatch(ISO_DATE_REGEX);
  });

  it('nullable fields are null not undefined', async () => {
    mockFindUnique.mockResolvedValue(makeTask({ sessionId: SESSION_ID }));

    const response = await app.inject({
      method: 'GET',
      url: '/api/tasks/test-task-id-1',
      headers: { cookie: sessionCookie() },
    });
    const json = response.json();

    expect(json.step).toBeNull();
    expect(json.transcript).toBeNull();
    expect(json.summary).toBeNull();
    expect(json.error).toBeNull();
    expect(json.completedAt).toBeNull();
  });

  it('error.code supports verification failure', async () => {
    mockFindMany.mockResolvedValue([
      makeTask({ sessionId: SESSION_ID, status: 'failed', error: 'summary_verification_failed: Number "999" not found' }),
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/tasks',
      headers: { cookie: sessionCookie() },
    });
    const items = response.json();
    expect(items[0].error).toEqual({
      code: 'summary_verification_failed',
      message: expect.any(String),
    });
  });

  it('error.code supports processing_timeout', async () => {
    mockFindMany.mockResolvedValue([
      makeTask({ sessionId: SESSION_ID, status: 'failed', error: 'Max retries exceeded. Last error: timeout' }),
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/tasks',
      headers: { cookie: sessionCookie() },
    });
    const items = response.json();
    expect(items[0].error.code).toBe('processing_timeout');
  });

  it('successful responses do not leak verifier metadata', async () => {
    mockFindMany.mockResolvedValue([
      makeTask({ sessionId: SESSION_ID, status: 'completed', summary: 'A clean summary.' }),
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/tasks',
      headers: { cookie: sessionCookie() },
    });
    const items = response.json();
    const item = items[0];
    expect(item).not.toHaveProperty('verificationResult');
    expect(item).not.toHaveProperty('guardedOutput');
    expect(item).not.toHaveProperty('rawSummary');
  });
});
