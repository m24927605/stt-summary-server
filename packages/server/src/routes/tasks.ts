import { Readable, PassThrough } from 'stream';
import { FastifyInstance } from 'fastify';
import { getDb } from '../plugins/db';
import { publishTask } from '../plugins/rabbitmq';
import { saveFileStream } from '../services/storage';
import { isValidAudioMagicBytes } from '../utils/audio-validation';
import { sanitizeTaskError } from '../utils/error-sanitizer';
import { ALLOWED_MIMETYPES } from 'shared/constants';

const MAGIC_BYTE_READ_SIZE = 16;

function readStreamHead(stream: Readable, size: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytesRead = 0;
    let resolved = false;

    const onData = (chunk: Buffer) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buf);
      bytesRead += buf.length;
      if (bytesRead >= size) {
        resolved = true;
        stream.removeListener('data', onData);
        stream.removeListener('end', onEnd);
        stream.pause();
        const combined = Buffer.concat(chunks);
        const head = combined.subarray(0, size);
        const leftover = combined.subarray(size);
        if (leftover.length > 0) {
          stream.unshift(leftover);
        }
        resolve(head);
      }
    };

    const onEnd = () => {
      if (!resolved) {
        resolved = true;
        resolve(Buffer.concat(chunks));
      }
    };

    stream.on('data', onData);
    stream.on('error', reject);
    stream.on('end', onEnd);
  });
}

function prependToStream(head: Buffer, remaining: Readable): Readable {
  const passThrough = new PassThrough();
  passThrough.write(head);
  remaining.pipe(passThrough);
  remaining.on('error', (err) => passThrough.destroy(err));
  return passThrough;
}

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/tasks/session — Bootstrap session and return CSRF token
  app.get('/api/tasks/session', async (request, reply) => {
    void reply.header('Cache-Control', 'no-store, private');
    return { csrfToken: request.csrfToken };
  });

  // POST /api/tasks — Upload audio and create task
  app.post('/api/tasks', async (request, reply) => {
    const data = await request.file();

    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    const mimetype = data.mimetype;
    if (!ALLOWED_MIMETYPES.includes(mimetype)) {
      return reply.status(400).send({
        error: `Invalid file type: ${mimetype}. Allowed: .wav, .mp3`,
      });
    }

    // Read only the first 16 bytes for magic byte validation (no toBuffer)
    const headBytes = await readStreamHead(data.file, MAGIC_BYTE_READ_SIZE);

    if (!isValidAudioMagicBytes(headBytes)) {
      // Drain remaining stream to avoid backpressure
      data.file.resume();
      return reply.status(400).send({
        error: 'Invalid file content: file does not appear to be a valid WAV or MP3 audio file',
      });
    }

    // Prepend validated head bytes back and stream remainder to S3
    const compositeStream = prependToStream(headBytes, data.file);
    const filePath = await saveFileStream(compositeStream, data.filename);

    const sessionId = request.sessionId;

    const db = getDb();
    const task = await db.task.create({
      data: {
        originalFilename: data.filename,
        filePath,
        sessionId,
      },
    });

    publishTask({ taskId: task.id });

    return reply.status(201).send({
      id: task.id,
      status: task.status,
      originalFilename: task.originalFilename,
      createdAt: task.createdAt.toISOString(),
    });
  });

  // GET /api/tasks — List tasks for current session
  app.get('/api/tasks', async (request, reply) => {
    const sessionId = request.sessionId;

    const db = getDb();
    const tasks = await db.task.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send(
      tasks.map((t) => ({
        id: t.id,
        status: t.status,
        step: t.step,
        originalFilename: t.originalFilename,
        transcript: t.transcript,
        summary: t.summary,
        error: t.error ? sanitizeTaskError(t.error) : null,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        completedAt: t.completedAt?.toISOString() ?? null,
      }))
    );
  });

  // GET /api/tasks/:id — Get single task (scoped to session)
  app.get<{ Params: { id: string } }>('/api/tasks/:id', async (request, reply) => {
    const sessionId = request.sessionId;

    const db = getDb();
    const task = await db.task.findUnique({
      where: { id: request.params.id },
    });

    if (!task || task.sessionId !== sessionId) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    return reply.send({
      id: task.id,
      status: task.status,
      step: task.step,
      originalFilename: task.originalFilename,
      transcript: task.transcript,
      summary: task.summary,
      error: task.error ? sanitizeTaskError(task.error) : null,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      completedAt: task.completedAt?.toISOString() ?? null,
    });
  });
}
