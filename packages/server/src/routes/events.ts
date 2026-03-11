import { FastifyInstance } from 'fastify';
import { getDb } from '../plugins/db';
import { config } from '../config';
import { getStepMessage } from '../utils/step-message';
import { sanitizeTaskError } from '../utils/error-sanitizer';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sseConnections = new Map<string, number>();
const MAX_SSE_PER_SESSION = 5;

export async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string }; Querystring: { sessionId?: string } }>('/api/tasks/:id/events', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const db = getDb();
    const taskId = request.params.id;
    const sessionId = request.query.sessionId || '';
    if (!sessionId || !UUID_RE.test(sessionId)) {
      return reply.status(400).send({ error: 'Invalid or missing sessionId' });
    }

    const task = await db.task.findUnique({ where: { id: taskId } });
    if (!task || task.sessionId !== sessionId) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    const currentCount = sseConnections.get(sessionId) || 0;
    if (currentCount >= MAX_SSE_PER_SESSION) {
      return reply.status(429).send({ error: 'Too many SSE connections' });
    }
    sseConnections.set(sessionId, currentCount + 1);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': config.corsOrigin,
    });

    let lastStatus = '';
    let lastStep = '';
    let closed = false;

    request.raw.on('close', () => {
      closed = true;
      const count = sseConnections.get(sessionId) || 1;
      if (count <= 1) sseConnections.delete(sessionId);
      else sseConnections.set(sessionId, count - 1);
    });

    const sendEvent = (event: string, data: object) => {
      if (closed) return;
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent('status', {
      status: task.status,
      step: task.step,
      message: getStepMessage(task.status, task.step),
    });

    if (task.status === 'completed' || task.status === 'failed') {
      if (task.status === 'completed') {
        sendEvent('completed', {
          status: 'completed',
          transcript: task.transcript,
          summary: task.summary,
        });
      } else {
        sendEvent('failed', {
          status: 'failed',
          error: sanitizeTaskError(task.error),
        });
      }
      reply.raw.end();
      return;
    }

    const interval = setInterval(async () => {
      if (closed) {
        clearInterval(interval);
        return;
      }

      try {
        const current = await db.task.findUnique({ where: { id: taskId } });
        if (!current) {
          clearInterval(interval);
          reply.raw.end();
          return;
        }

        if (current.status !== lastStatus || current.step !== lastStep) {
          lastStatus = current.status;
          lastStep = current.step || '';

          if (current.status === 'completed') {
            sendEvent('completed', {
              status: 'completed',
              transcript: current.transcript,
              summary: current.summary,
            });
            clearInterval(interval);
            reply.raw.end();
          } else if (current.status === 'failed') {
            sendEvent('failed', {
              status: 'failed',
              error: sanitizeTaskError(current.error),
            });
            clearInterval(interval);
            reply.raw.end();
          } else {
            sendEvent('status', {
              status: current.status,
              step: current.step,
              message: getStepMessage(current.status, current.step),
            });
          }
        }
      } catch {
        clearInterval(interval);
        if (!closed) reply.raw.end();
      }
    }, 2000);

    setTimeout(() => {
      clearInterval(interval);
      if (!closed) reply.raw.end();
    }, 5 * 60 * 1000);
  });
}
