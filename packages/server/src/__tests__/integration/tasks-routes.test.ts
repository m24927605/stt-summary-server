import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { makeTask } from '../helpers/fixtures';

// Mock dependencies before importing routes
const mockCreate = vi.fn();
const mockFindMany = vi.fn();
const mockFindUnique = vi.fn();

vi.mock('../../plugins/db', () => ({
  getDb: () => ({
    task: {
      create: mockCreate,
      findMany: mockFindMany,
      findUnique: mockFindUnique,
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

const SESSION_ID = 'test-session-id';
const sessionHeader = { 'x-session-id': SESSION_ID };

describe('task routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    await app.register(multipart);
    await app.register(taskRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // --- POST /api/tasks ---

  it('POST /api/tasks with valid WAV file returns 201', async () => {
    const task = makeTask({ status: 'pending' });
    mockCreate.mockResolvedValue(task);

    // WAV magic bytes: RIFF
    const wavBuffer = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00]);
    const boundary = '----boundary';
    const body =
      `------boundary\r\n` +
      `Content-Disposition: form-data; name="file"; filename="test.wav"\r\n` +
      `Content-Type: audio/wav\r\n\r\n` +
      wavBuffer.toString('binary') +
      `\r\n------boundary--\r\n`;

    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { 'content-type': `multipart/form-data; boundary=----boundary`, ...sessionHeader },
      payload: body,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toHaveProperty('id');
    expect(response.json()).toHaveProperty('status', 'pending');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sessionId: SESSION_ID }) }),
    );
  });

  it('POST /api/tasks without X-Session-Id returns 400', async () => {
    const wavBuffer = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00]);
    const body =
      `------boundary\r\n` +
      `Content-Disposition: form-data; name="file"; filename="test.wav"\r\n` +
      `Content-Type: audio/wav\r\n\r\n` +
      wavBuffer.toString('binary') +
      `\r\n------boundary--\r\n`;

    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { 'content-type': `multipart/form-data; boundary=----boundary` },
      payload: body,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('Missing X-Session-Id');
  });

  it('POST /api/tasks with no file returns 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { 'content-type': 'multipart/form-data; boundary=----boundary', ...sessionHeader },
      payload: '------boundary--\r\n',
    });

    expect(response.statusCode).toBe(400);
  });

  it('POST /api/tasks with invalid mimetype returns 400', async () => {
    const boundary = '----boundary';
    const body =
      `------boundary\r\n` +
      `Content-Disposition: form-data; name="file"; filename="test.txt"\r\n` +
      `Content-Type: text/plain\r\n\r\n` +
      `hello world` +
      `\r\n------boundary--\r\n`;

    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { 'content-type': `multipart/form-data; boundary=----boundary`, ...sessionHeader },
      payload: body,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('Invalid file type');
  });

  it('POST /api/tasks with invalid magic bytes returns 400', async () => {
    // PNG header with audio mimetype
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const boundary = '----boundary';
    const body =
      `------boundary\r\n` +
      `Content-Disposition: form-data; name="file"; filename="fake.wav"\r\n` +
      `Content-Type: audio/wav\r\n\r\n` +
      pngBuffer.toString('binary') +
      `\r\n------boundary--\r\n`;

    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { 'content-type': `multipart/form-data; boundary=----boundary`, ...sessionHeader },
      payload: body,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('Invalid file content');
  });

  // --- GET /api/tasks ---

  it('GET /api/tasks returns 200 with array of tasks', async () => {
    const tasks = [
      makeTask({ id: 'task-1' }),
      makeTask({ id: 'task-2', status: 'completed' }),
    ];
    mockFindMany.mockResolvedValue(tasks);

    const response = await app.inject({
      method: 'GET',
      url: '/api/tasks',
      headers: sessionHeader,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveLength(2);
    expect(body[0]).toHaveProperty('id', 'task-1');
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sessionId: SESSION_ID } }),
    );
  });

  it('GET /api/tasks without X-Session-Id returns 400', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/tasks',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('Missing X-Session-Id');
  });

  // --- GET /api/tasks/:id ---

  it('GET /api/tasks/:id returns 200 for matching session task', async () => {
    const task = makeTask({ id: 'task-1', sessionId: SESSION_ID });
    mockFindUnique.mockResolvedValue(task);

    const response = await app.inject({
      method: 'GET',
      url: '/api/tasks/task-1',
      headers: sessionHeader,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty('id', 'task-1');
  });

  it('GET /api/tasks/:id returns 404 for non-existent task', async () => {
    mockFindUnique.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/api/tasks/non-existent',
      headers: sessionHeader,
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
      headers: sessionHeader,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toHaveProperty('error', 'Task not found');
  });
});
