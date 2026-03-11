import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { makeTask } from '../helpers/fixtures';
import { SESSION_ID, CSRF_TOKEN, makeDbSession, sessionCookie } from '../helpers/session';

// Mock dependencies before importing routes
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
  saveFile: vi.fn(() => Promise.resolve('./uploads/mock-uuid.wav')),
  saveFileStream: vi.fn(() => Promise.resolve('./uploads/mock-uuid.wav')),
}));

import { taskRoutes } from '../../routes/tasks';
import { sessionPlugin } from '../../plugins/session';

describe('task routes', () => {
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

  // --- POST /api/tasks ---

  it('POST /api/tasks with valid WAV file returns 201', async () => {
    const task = makeTask({ status: 'pending', sessionId: SESSION_ID });
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
        'content-type': `multipart/form-data; boundary=----boundary`,
        cookie: sessionCookie(),
        'x-csrf-token': CSRF_TOKEN,
        origin: 'http://localhost:8080',
      },
      payload: body,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toHaveProperty('id');
    expect(response.json()).toHaveProperty('status', 'pending');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sessionId: SESSION_ID }) }),
    );
  });

  it('POST /api/tasks without session cookie is rejected and no session created', async () => {
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
        'content-type': `multipart/form-data; boundary=----boundary`,
        'x-csrf-token': CSRF_TOKEN,
        origin: 'http://localhost:8080',
      },
      payload: body,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('Session required');
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it('POST /api/tasks with no file returns 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: {
        'content-type': 'multipart/form-data; boundary=----boundary',
        cookie: sessionCookie(),
        'x-csrf-token': CSRF_TOKEN,
        origin: 'http://localhost:8080',
      },
      payload: '------boundary--\r\n',
    });

    expect(response.statusCode).toBe(400);
  });

  it('POST /api/tasks with invalid mimetype returns 400', async () => {
    const body =
      `------boundary\r\n` +
      `Content-Disposition: form-data; name="file"; filename="test.txt"\r\n` +
      `Content-Type: text/plain\r\n\r\n` +
      `hello world` +
      `\r\n------boundary--\r\n`;

    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: {
        'content-type': `multipart/form-data; boundary=----boundary`,
        cookie: sessionCookie(),
        'x-csrf-token': CSRF_TOKEN,
        origin: 'http://localhost:8080',
      },
      payload: body,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('Invalid file type');
  });

  it('POST /api/tasks with invalid magic bytes returns 400', async () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const body =
      `------boundary\r\n` +
      `Content-Disposition: form-data; name="file"; filename="fake.wav"\r\n` +
      `Content-Type: audio/wav\r\n\r\n` +
      pngBuffer.toString('binary') +
      `\r\n------boundary--\r\n`;

    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: {
        'content-type': `multipart/form-data; boundary=----boundary`,
        cookie: sessionCookie(),
        'x-csrf-token': CSRF_TOKEN,
        origin: 'http://localhost:8080',
      },
      payload: body,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('Invalid file content');
  });

  // --- GET /api/tasks ---

  it('GET /api/tasks returns 200 with array of tasks', async () => {
    const tasks = [
      makeTask({ id: 'task-1', sessionId: SESSION_ID }),
      makeTask({ id: 'task-2', status: 'completed', sessionId: SESSION_ID }),
    ];
    mockFindMany.mockResolvedValue(tasks);

    const response = await app.inject({
      method: 'GET',
      url: '/api/tasks',
      headers: { cookie: sessionCookie() },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveLength(2);
    expect(body[0]).toHaveProperty('id', 'task-1');
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sessionId: SESSION_ID } }),
    );
  });

  it('GET /api/tasks without session cookie creates session and returns tasks', async () => {
    mockSessionFindUnique.mockResolvedValue(null);
    mockFindMany.mockResolvedValue([]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/tasks',
    });

    expect(response.statusCode).toBe(200);
    const cookies = response.cookies;
    const sessionCookieObj = cookies.find((c: { name: string }) => c.name === 'stt_session');
    expect(sessionCookieObj).toBeDefined();
    expect(sessionCookieObj!.httpOnly).toBe(true);
  });

  // --- GET /api/tasks/:id ---

  it('GET /api/tasks/:id returns 200 for matching session task', async () => {
    const task = makeTask({ id: 'task-1', sessionId: SESSION_ID });
    mockFindUnique.mockResolvedValue(task);

    const response = await app.inject({
      method: 'GET',
      url: '/api/tasks/task-1',
      headers: { cookie: sessionCookie() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty('id', 'task-1');
  });

  it('GET /api/tasks/:id returns 404 for non-existent task', async () => {
    mockFindUnique.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/api/tasks/non-existent',
      headers: { cookie: sessionCookie() },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toHaveProperty('error', 'Task not found');
  });

  it('GET /api/tasks/:id returns 404 for task belonging to different session', async () => {
    const task = makeTask({ id: 'task-1', sessionId: 'other-session' });
    mockFindUnique.mockResolvedValue(task);

    const response = await app.inject({
      method: 'GET',
      url: '/api/tasks/task-1',
      headers: { cookie: sessionCookie() },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toHaveProperty('error', 'Task not found');
  });

  // --- GET /api/tasks/session ---

  it('GET /api/tasks/session without cookie creates session and returns csrfToken', async () => {
    mockSessionFindUnique.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/api/tasks/session',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty('csrfToken');
    expect(typeof response.json().csrfToken).toBe('string');

    const sttCookie = response.cookies.find((c: { name: string }) => c.name === 'stt_session');
    expect(sttCookie).toBeDefined();
    expect(sttCookie!.httpOnly).toBe(true);

    const csrfCookie = response.cookies.find((c: { name: string }) => c.name === 'csrf_token');
    expect(csrfCookie).toBeDefined();

    expect(mockSessionCreate).toHaveBeenCalledTimes(1);
  });

  it('GET /api/tasks/session with valid session returns existing csrfToken without creating new session', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/tasks/session',
      headers: { cookie: sessionCookie() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ csrfToken: CSRF_TOKEN });
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it('GET /api/tasks/session with invalid cookie returns 401', async () => {
    mockSessionFindUnique.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/api/tasks/session',
      headers: { cookie: 'stt_session=nonexistent-id' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('Invalid session');
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it('GET /api/tasks/session returns Cache-Control no-store', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/tasks/session',
      headers: { cookie: sessionCookie() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store, private');
  });

  it('GET /api/tasks/session does not conflict with GET /api/tasks/:id', async () => {
    // Ensure /api/tasks/session hits the session endpoint, not the :id handler
    mockSessionFindUnique.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/api/tasks/session',
    });

    // Should return csrfToken, not a 404 from the :id handler
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty('csrfToken');
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});
