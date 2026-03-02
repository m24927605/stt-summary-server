import { FastifyInstance } from 'fastify';
import { getDb } from '../plugins/db';
import { publishTask } from '../plugins/rabbitmq';
import { saveFile } from '../services/storage';
import { ALLOWED_MIMETYPES } from 'shared/constants';

function isValidAudioMagicBytes(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;

  // WAV: starts with "RIFF"
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
    return true;
  }

  // MP3: starts with ID3 tag
  if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
    return true;
  }

  // MP3: starts with sync word (0xFF 0xFB, 0xFF 0xF3, or 0xFF 0xF2)
  if (buffer[0] === 0xff && (buffer[1] === 0xfb || buffer[1] === 0xf3 || buffer[1] === 0xf2)) {
    return true;
  }

  return false;
}

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

    const filePath = await saveFile(buffer, data.filename);

    const db = getDb();
    const task = await db.task.create({
      data: {
        originalFilename: data.filename,
        filePath,
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

  // GET /api/tasks — List all tasks
  app.get('/api/tasks', async (_request, reply) => {
    const db = getDb();
    const tasks = await db.task.findMany({
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

  // GET /api/tasks/:id — Get single task
  app.get<{ Params: { id: string } }>('/api/tasks/:id', async (request, reply) => {
    const db = getDb();
    const task = await db.task.findUnique({
      where: { id: request.params.id },
    });

    if (!task) {
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
