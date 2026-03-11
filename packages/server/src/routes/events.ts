import { FastifyInstance } from 'fastify';
import { getDb } from '../plugins/db';
import { config } from '../config';

export async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>('/api/tasks/:id/events', async (request, reply) => {
    const db = getDb();
    const taskId = request.params.id;

    const task = await db.task.findUnique({ where: { id: taskId } });
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

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
          error: task.error,
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
              error: current.error,
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

function getStepMessage(status: string, step: string | null): string {
  if (status === 'pending') return 'Task queued, waiting to be processed...';
  if (status === 'processing' && step === 'stt') return 'Transcribing audio...';
  if (status === 'processing' && step === 'llm') return 'Generating summary...';
  if (status === 'completed') return 'Task completed';
  if (status === 'failed') return 'Task failed';
  return 'Processing...';
}
