import { Readable } from 'stream';
import { FastifyInstance } from 'fastify';
import { getDb } from '../plugins/db';
import { publishTask } from '../plugins/rabbitmq';
import { saveFileStream } from '../services/storage';
import { isValidAudioMagicBytes } from '../utils/audio-validation';
import { ALLOWED_MIMETYPES } from 'shared/constants';

export async function taskRoutes(app: FastifyInstance): Promise<void> {
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

    const buffer = await data.toBuffer();

    if (!isValidAudioMagicBytes(buffer)) {
      return reply.status(400).send({
        error: 'Invalid file content: file does not appear to be a valid WAV or MP3 audio file',
      });
    }

    const filePath = await saveFileStream(Readable.from(buffer), data.filename);

    const sessionId = (request.headers['x-session-id'] as string) || '';
    if (!sessionId) {
      return reply.status(400).send({ error: 'Missing X-Session-Id header' });
    }

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
    const sessionId = (request.headers['x-session-id'] as string) || '';
    if (!sessionId) {
      return reply.status(400).send({ error: 'Missing X-Session-Id header' });
    }

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
        error: t.error,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        completedAt: t.completedAt?.toISOString() ?? null,
      }))
    );
  });

  // GET /api/tasks/:id — Get single task (scoped to session)
  app.get<{ Params: { id: string } }>('/api/tasks/:id', async (request, reply) => {
    const sessionId = (request.headers['x-session-id'] as string) || '';
    if (!sessionId) {
      return reply.status(400).send({ error: 'Missing X-Session-Id header' });
    }

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
      error: task.error,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      completedAt: task.completedAt?.toISOString() ?? null,
    });
  });
}
