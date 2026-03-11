import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { SESSION_ID, CSRF_TOKEN, makeDbSession, sessionCookie } from '../helpers/session';

const mockCreate = vi.fn();
const mockSessionFindUnique = vi.fn();
const mockSessionCreate = vi.fn();
const mockSessionUpdate = vi.fn();
const mockSaveFileStream = vi.fn((..._args: unknown[]) => Promise.resolve('./uploads/mock-uuid.wav'));

vi.mock('../../plugins/db', () => ({
  getDb: () => ({
    task: {
      create: mockCreate,
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
  saveFileStream: (...args: unknown[]) => mockSaveFileStream(...args),
}));

import { taskRoutes } from '../../routes/tasks';
import { sessionPlugin } from '../../plugins/session';

describe('upload streaming hardening', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSessionFindUnique.mockResolvedValue(makeDbSession());
    mockSessionUpdate.mockResolvedValue(makeDbSession());
    mockCreate.mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve({
        id: 'task-1',
        status: 'pending',
        originalFilename: args.data.originalFilename,
        createdAt: new Date(),
        ...args.data,
      })
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

  it('source code does not contain toBuffer()', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../routes/tasks.ts'),
      'utf-8'
    );
    expect(source).not.toContain('.toBuffer(');
  });

  it('saveFileStream receives byte-identical content to the original file', async () => {
    // Build a deterministic binary payload: WAV RIFF header + 200 bytes of known pattern
    const wavHeader = Buffer.from([0x52, 0x49, 0x46, 0x46]); // RIFF
    const payload = Buffer.alloc(200);
    for (let i = 0; i < payload.length; i++) payload[i] = i % 256;
    const fullContent = Buffer.concat([wavHeader, payload]);

    // Use raw Buffer payload to avoid any encoding issues.
    // Build the multipart body as Buffer, not string.
    const headerPart = Buffer.from(
      `------boundary\r\nContent-Disposition: form-data; name="file"; filename="test.wav"\r\nContent-Type: audio/wav\r\n\r\n`
    );
    const trailerPart = Buffer.from(`\r\n------boundary--\r\n`);
    const rawBody = Buffer.concat([headerPart, fullContent, trailerPart]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: {
        'content-type': `multipart/form-data; boundary=----boundary`,
        cookie: sessionCookie(),
        'x-csrf-token': CSRF_TOKEN,
        origin: 'http://localhost:8080',
      },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(201);
    expect(mockSaveFileStream).toHaveBeenCalledTimes(1);

    // Read the stream that was passed to saveFileStream
    const [stream] = mockSaveFileStream.mock.calls[0] as unknown as [NodeJS.ReadableStream, string];
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    const savedContent = Buffer.concat(chunks);

    // Strict byte equality — no duplication, no truncation, no mutation
    expect(savedContent.equals(fullContent)).toBe(true);
  });

  it('does not call toBuffer on the multipart file data', async () => {
    const wavBuffer = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const boundary = '----boundary';
    const body =
      `------boundary\r\n` +
      `Content-Disposition: form-data; name="file"; filename="test.wav"\r\n` +
      `Content-Type: audio/wav\r\n\r\n` +
      wavBuffer.toString('binary') +
      `\r\n------boundary--\r\n`;

    // Spy on the multipart data object - we can verify via the source code check
    // and by confirming saveFileStream receives a stream, not a buffer
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

    // Verify saveFileStream received a readable stream (not a buffer)
    const [streamArg] = mockSaveFileStream.mock.calls[0] as unknown as [unknown, string];
    expect(streamArg).toBeDefined();
    expect(typeof (streamArg as Record<string, unknown>).pipe).toBe('function'); // It's a stream
    expect(Buffer.isBuffer(streamArg)).toBe(false); // It's not a buffer
  });
});
