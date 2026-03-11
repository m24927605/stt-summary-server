import amqplib, { Channel, ConsumeMessage } from 'amqplib';
import { PrismaClient } from '@prisma/client';
import { config } from './config';
import { logger } from './logger';
import { transcribeAudio } from './processors/stt';
import { summarizeText } from './processors/llm';
import { QUEUE_NAME, DEAD_LETTER_QUEUE, MAX_RETRIES } from 'shared/constants';
import { QueueMessage } from 'shared/types';

const prisma = new PrismaClient();

export async function startConsumer(): Promise<void> {
  const maxRetries = 10;
  let retries = 0;
  let connection: Awaited<ReturnType<typeof amqplib.connect>> | null = null;
  let channel: Channel | null = null;

  while (retries < maxRetries) {
    try {
      connection = await amqplib.connect(config.rabbitmqUrl);
      channel = await connection.createChannel();

      await channel.assertQueue(DEAD_LETTER_QUEUE, { durable: true });
      await channel.assertQueue(QUEUE_NAME, {
        durable: true,
      });

      await channel.prefetch(1);

      logger.info('Worker listening on queue: %s', QUEUE_NAME);

      channel.consume(QUEUE_NAME, async (msg: ConsumeMessage | null) => {
        if (!msg || !channel) return;

        const content: QueueMessage = JSON.parse(msg.content.toString());
        const { taskId } = content;
        const retryCount = (msg.properties.headers?.['x-retry-count'] as number) || 0;

        logger.info({ taskId, attempt: retryCount + 1 }, 'Processing task');

        try {
          await processTask(taskId);
          channel.ack(msg);
        } catch (err) {
          logger.error({ taskId, err }, 'Task failed');

          if (retryCount < MAX_RETRIES - 1) {
            channel.ack(msg);
            channel.sendToQueue(
              QUEUE_NAME,
              Buffer.from(JSON.stringify(content)),
              {
                persistent: true,
                headers: { 'x-retry-count': retryCount + 1 },
              }
            );
            logger.info({ taskId, attempt: retryCount + 2 }, 'Task re-queued');
          } else {
            channel.ack(msg);
            channel.sendToQueue(
              DEAD_LETTER_QUEUE,
              Buffer.from(JSON.stringify(content)),
              { persistent: true }
            );

            await prisma.task.update({
              where: { id: taskId },
              data: {
                status: 'failed',
                step: null,
                error: `Max retries exceeded. Last error: ${err instanceof Error ? err.message : String(err)}`,
              },
            });
          }
        }
      });

      break;
    } catch (err) {
      retries++;
      logger.warn({ attempt: retries, maxRetries }, 'RabbitMQ connection failed, retrying');
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  if (retries >= maxRetries) {
    throw new Error('Worker failed to connect to RabbitMQ after max retries');
  }

  process.on('SIGINT', async () => {
    logger.info('Worker shutting down');
    if (channel) await channel.close();
    if (connection) await connection.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}

export async function processTask(taskId: string): Promise<void> {
  await prisma.task.update({
    where: { id: taskId },
    data: { status: 'processing', step: 'stt' },
  });

  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });

  let transcript: string;
  try {
    transcript = await transcribeAudio(task.filePath);
  } catch (err) {
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'failed',
        step: null,
        error: `STT failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    });
    throw err;
  }

  await prisma.task.update({
    where: { id: taskId },
    data: { transcript },
  });

  await prisma.task.update({
    where: { id: taskId },
    data: { step: 'llm' },
  });

  let summary: string;
  try {
    summary = await summarizeText(transcript);
  } catch (err) {
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'failed',
        step: null,
        error: `LLM failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    });
    throw err;
  }

  await prisma.task.update({
    where: { id: taskId },
    data: {
      summary,
      status: 'completed',
      step: null,
      completedAt: new Date(),
    },
  });

  logger.info({ taskId }, 'Task completed');
}
