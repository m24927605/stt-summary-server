import amqplib, { Channel, ChannelModel } from 'amqplib';
import { config } from '../config';
import { QUEUE_NAME, DEAD_LETTER_QUEUE } from 'shared/constants';
import { QueueMessage } from 'shared/types';

let connection: ChannelModel | null = null;
let channel: Channel | null = null;

export async function connectQueue(): Promise<void> {
  const maxRetries = 10;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      connection = await amqplib.connect(config.rabbitmqUrl);
      channel = await connection.createChannel();

      await channel.assertQueue(DEAD_LETTER_QUEUE, { durable: true });
      await channel.assertQueue(QUEUE_NAME, {
        durable: true,
        arguments: {
          'x-dead-letter-routing-key': DEAD_LETTER_QUEUE,
        },
      });

      console.log('Connected to RabbitMQ');
      return;
    } catch (err) {
      retries++;
      console.log(`RabbitMQ connection attempt ${retries}/${maxRetries} failed, retrying in 3s...`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  throw new Error('Failed to connect to RabbitMQ after max retries');
}

export function publishTask(message: QueueMessage): boolean {
  if (!channel) {
    throw new Error('RabbitMQ channel not initialized');
  }
  return channel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(message)), {
    persistent: true,
  });
}

export async function disconnectQueue(): Promise<void> {
  if (channel) await channel.close();
  if (connection) await connection.close();
}
