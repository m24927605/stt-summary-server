# Speech-to-Text Summarization Server Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a backend service that accepts audio uploads, transcribes via OpenAI Whisper, summarizes via GPT, and returns results — with SSE streaming, React frontend, and Docker Compose deployment.

**Architecture:** Monorepo with separated API Server (Fastify) and Worker (RabbitMQ consumer) as independent Docker containers. PostgreSQL for persistence, RabbitMQ for async job dispatch. React (Vite) frontend served via nginx.

**Tech Stack:** TypeScript, Fastify, Prisma, RabbitMQ (amqplib), PostgreSQL, OpenAI SDK, React (Vite), Docker Compose

---

### Task 1: Project Scaffolding & Root Config

**Files:**
- Create: `package.json` (root workspace)
- Create: `tsconfig.base.json`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `shared/types.ts`
- Create: `shared/constants.ts`

**Step 1: Initialize root workspace**

```json
// package.json
{
  "name": "stt-summary-server",
  "private": true,
  "workspaces": [
    "packages/*",
    "shared"
  ]
}
```

**Step 2: Create base TypeScript config**

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

**Step 3: Create shared types and constants**

```typescript
// shared/types.ts
export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type TaskStep = 'stt' | 'llm' | null;

export interface TaskResponse {
  id: string;
  status: TaskStatus;
  step: TaskStep;
  originalFilename: string;
  transcript: string | null;
  summary: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface TaskCreateResponse {
  id: string;
  status: TaskStatus;
  originalFilename: string;
  createdAt: string;
}

export interface SSEEvent {
  event: 'status' | 'completed' | 'failed';
  data: {
    status: TaskStatus;
    step?: TaskStep;
    message?: string;
    transcript?: string;
    summary?: string;
    error?: string;
  };
}

export interface QueueMessage {
  taskId: string;
}
```

```typescript
// shared/constants.ts
export const TASK_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export const TASK_STEP = {
  STT: 'stt',
  LLM: 'llm',
} as const;

export const QUEUE_NAME = 'task_queue';
export const DEAD_LETTER_QUEUE = 'task_queue_dlq';
export const MAX_RETRIES = 3;
export const ALLOWED_MIMETYPES = ['audio/wav', 'audio/mpeg', 'audio/mp3', 'audio/wave', 'audio/x-wav'];
export const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB (OpenAI Whisper limit)
```

```typescript
// shared/package.json
{
  "name": "shared",
  "version": "1.0.0",
  "main": "types.ts"
}
```

**Step 4: Create .env.example and .gitignore**

```bash
# .env.example
# OpenAI
OPENAI_API_KEY=sk-your-api-key-here

# PostgreSQL
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/stt_summary
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=stt_summary

# RabbitMQ
RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672

# Server
SERVER_PORT=3000
UPLOAD_DIR=/app/uploads

# OpenAI Model Config
WHISPER_MODEL=whisper-1
GPT_MODEL=gpt-4o-mini
```

```gitignore
# .gitignore
node_modules/
dist/
.env
uploads/
*.log
.DS_Store
```

**Step 5: Commit**

```bash
git init
git add -A
git commit -m "chore: initialize project scaffolding with shared types and config"
```

---

### Task 2: API Server — Package Setup & Fastify Bootstrap

**Files:**
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/server/src/config.ts`
- Create: `packages/server/src/app.ts`
- Create: `packages/server/src/server.ts`

**Step 1: Create server package.json**

```json
// packages/server/package.json
{
  "name": "server",
  "version": "1.0.0",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate deploy",
    "db:push": "prisma db push"
  },
  "dependencies": {
    "fastify": "^5.2.1",
    "@fastify/multipart": "^9.0.3",
    "@fastify/cors": "^11.0.1",
    "@fastify/static": "^8.1.0",
    "@prisma/client": "^6.4.1",
    "amqplib": "^0.10.5",
    "openai": "^4.82.0",
    "uuid": "^11.1.0"
  },
  "devDependencies": {
    "@types/amqplib": "^0.10.6",
    "@types/node": "^22.13.5",
    "@types/uuid": "^10.0.0",
    "prisma": "^6.4.1",
    "tsx": "^4.19.3",
    "typescript": "^5.7.3",
    "vitest": "^3.0.7"
  }
}
```

**Step 2: Create server tsconfig.json**

```json
// packages/server/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "paths": {
      "shared/*": ["../../shared/*"]
    }
  },
  "include": ["src/**/*"],
  "references": []
}
```

**Step 3: Create config module**

```typescript
// packages/server/src/config.ts
import { env } from 'process';

export const config = {
  port: parseInt(env.SERVER_PORT || '3000', 10),
  databaseUrl: env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/stt_summary',
  rabbitmqUrl: env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
  uploadDir: env.UPLOAD_DIR || './uploads',
  openaiApiKey: env.OPENAI_API_KEY || '',
};
```

**Step 4: Create Fastify app builder**

```typescript
// packages/server/src/app.ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { MAX_FILE_SIZE } from '../../shared/constants';

export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  await app.register(cors, {
    origin: true,
  });

  await app.register(multipart, {
    limits: {
      fileSize: MAX_FILE_SIZE,
    },
  });

  app.get('/api/health', async () => {
    return { status: 'ok' };
  });

  return app;
}
```

**Step 5: Create server entry point**

```typescript
// packages/server/src/server.ts
import { buildApp } from './app';
import { config } from './config';

async function start() {
  const app = await buildApp();

  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    console.log(`Server listening on port ${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
```

**Step 6: Install dependencies and verify**

Run: `cd packages/server && npm install`
Run: `npx tsx src/server.ts` — verify it starts on port 3000, hit `GET /api/health`
Expected: `{"status":"ok"}`

**Step 7: Commit**

```bash
git add packages/server/
git commit -m "feat: bootstrap Fastify server with health endpoint"
```

---

### Task 3: Database Setup — Prisma Schema & Migration

**Files:**
- Create: `packages/server/prisma/schema.prisma`
- Create: `packages/server/src/plugins/db.ts`

**Step 1: Create Prisma schema**

```prisma
// packages/server/prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Task {
  id               String    @id @default(uuid()) @db.Uuid
  status           String    @default("pending") @db.VarChar(20)
  step             String?   @db.VarChar(20)
  originalFilename String    @map("original_filename") @db.VarChar(255)
  filePath         String    @map("file_path") @db.VarChar(500)
  transcript       String?   @db.Text
  summary          String?   @db.Text
  error            String?   @db.Text
  createdAt        DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt        DateTime  @updatedAt @map("updated_at") @db.Timestamptz()
  completedAt      DateTime? @map("completed_at") @db.Timestamptz()

  @@map("tasks")
}
```

**Step 2: Create DB plugin**

```typescript
// packages/server/src/plugins/db.ts
import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient;

export function getDb(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

export async function disconnectDb(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
  }
}
```

**Step 3: Generate Prisma client**

Run: `cd packages/server && npx prisma generate`
Expected: Prisma Client generated successfully

**Step 4: Commit**

```bash
git add packages/server/prisma/ packages/server/src/plugins/
git commit -m "feat: add Prisma schema and DB plugin for tasks table"
```

---

### Task 4: API Server — RabbitMQ Producer Plugin

**Files:**
- Create: `packages/server/src/plugins/rabbitmq.ts`

**Step 1: Create RabbitMQ connection and producer**

```typescript
// packages/server/src/plugins/rabbitmq.ts
import amqplib, { Channel, Connection } from 'amqplib';
import { config } from '../config';
import { QUEUE_NAME, DEAD_LETTER_QUEUE } from '../../../shared/constants';
import { QueueMessage } from '../../../shared/types';

let connection: Connection | null = null;
let channel: Channel | null = null;

export async function connectQueue(): Promise<void> {
  const maxRetries = 10;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      connection = await amqplib.connect(config.rabbitmqUrl);
      channel = await connection.createChannel();

      // Dead letter queue
      await channel.assertQueue(DEAD_LETTER_QUEUE, { durable: true });

      // Main queue with dead letter exchange
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
```

**Step 2: Commit**

```bash
git add packages/server/src/plugins/rabbitmq.ts
git commit -m "feat: add RabbitMQ producer plugin with retry logic"
```

---

### Task 5: API Server — File Storage Service

**Files:**
- Create: `packages/server/src/services/storage.ts`

**Step 1: Create storage service**

```typescript
// packages/server/src/services/storage.ts
import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';

export async function ensureUploadDir(): Promise<void> {
  await fs.mkdir(config.uploadDir, { recursive: true });
}

export async function saveFile(buffer: Buffer, originalFilename: string): Promise<string> {
  await ensureUploadDir();
  const ext = path.extname(originalFilename);
  const filename = `${uuidv4()}${ext}`;
  const filePath = path.join(config.uploadDir, filename);
  await fs.writeFile(filePath, buffer);
  return filePath;
}
```

**Step 2: Commit**

```bash
git add packages/server/src/services/storage.ts
git commit -m "feat: add file storage service for audio uploads"
```

---

### Task 6: API Server — Task Routes (POST & GET)

**Files:**
- Create: `packages/server/src/routes/tasks.ts`
- Modify: `packages/server/src/app.ts` — register routes

**Step 1: Create task routes**

```typescript
// packages/server/src/routes/tasks.ts
import { FastifyInstance } from 'fastify';
import { getDb } from '../plugins/db';
import { publishTask } from '../plugins/rabbitmq';
import { saveFile } from '../services/storage';
import { ALLOWED_MIMETYPES } from '../../../shared/constants';

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
```

**Step 2: Update app.ts to register routes and connect services**

```typescript
// packages/server/src/app.ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { MAX_FILE_SIZE } from '../../shared/constants';
import { taskRoutes } from './routes/tasks';
import { connectQueue, disconnectQueue } from './plugins/rabbitmq';
import { disconnectDb } from './plugins/db';

export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  await app.register(cors, {
    origin: true,
  });

  await app.register(multipart, {
    limits: {
      fileSize: MAX_FILE_SIZE,
    },
  });

  // Connect to RabbitMQ
  await connectQueue();

  // Routes
  app.get('/api/health', async () => {
    return { status: 'ok' };
  });

  await app.register(taskRoutes);

  // Graceful shutdown
  app.addHook('onClose', async () => {
    await disconnectQueue();
    await disconnectDb();
  });

  return app;
}
```

**Step 3: Commit**

```bash
git add packages/server/src/routes/tasks.ts packages/server/src/app.ts
git commit -m "feat: add task CRUD routes (POST upload, GET list, GET by id)"
```

---

### Task 7: API Server — SSE Events Endpoint

**Files:**
- Create: `packages/server/src/routes/events.ts`
- Modify: `packages/server/src/app.ts` — register events route

**Step 1: Create SSE endpoint**

```typescript
// packages/server/src/routes/events.ts
import { FastifyInstance } from 'fastify';
import { getDb } from '../plugins/db';

export async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>('/api/tasks/:id/events', async (request, reply) => {
    const db = getDb();
    const taskId = request.params.id;

    // Verify task exists
    const task = await db.task.findUnique({ where: { id: taskId } });
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
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

    // Send initial state
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

    // Poll for changes every 2 seconds
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

        // Detect status/step change
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

    // Timeout after 5 minutes
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
```

**Step 2: Register events route in app.ts**

Add to `packages/server/src/app.ts` after taskRoutes registration:

```typescript
import { eventRoutes } from './routes/events';
// ... in buildApp():
await app.register(eventRoutes);
```

**Step 3: Commit**

```bash
git add packages/server/src/routes/events.ts packages/server/src/app.ts
git commit -m "feat: add SSE endpoint for real-time task progress streaming"
```

---

### Task 8: Worker — Package Setup & Config

**Files:**
- Create: `packages/worker/package.json`
- Create: `packages/worker/tsconfig.json`
- Create: `packages/worker/src/config.ts`

**Step 1: Create worker package.json**

```json
// packages/worker/package.json
{
  "name": "worker",
  "version": "1.0.0",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@prisma/client": "^6.4.1",
    "amqplib": "^0.10.5",
    "openai": "^4.82.0"
  },
  "devDependencies": {
    "@types/amqplib": "^0.10.6",
    "@types/node": "^22.13.5",
    "prisma": "^6.4.1",
    "tsx": "^4.19.3",
    "typescript": "^5.7.3"
  }
}
```

**Step 2: Create worker tsconfig.json**

```json
// packages/worker/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "paths": {
      "shared/*": ["../../shared/*"]
    }
  },
  "include": ["src/**/*"]
}
```

**Step 3: Create worker config**

```typescript
// packages/worker/src/config.ts
import { env } from 'process';

export const config = {
  databaseUrl: env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/stt_summary',
  rabbitmqUrl: env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
  uploadDir: env.UPLOAD_DIR || './uploads',
  openaiApiKey: env.OPENAI_API_KEY || '',
  whisperModel: env.WHISPER_MODEL || 'whisper-1',
  gptModel: env.GPT_MODEL || 'gpt-4o-mini',
};
```

**Step 4: Commit**

```bash
git add packages/worker/
git commit -m "feat: scaffold worker package with config"
```

---

### Task 9: Worker — STT Processor (OpenAI Whisper)

**Files:**
- Create: `packages/worker/src/processors/stt.ts`

**Step 1: Create STT processor**

```typescript
// packages/worker/src/processors/stt.ts
import OpenAI from 'openai';
import fs from 'fs';
import { config } from '../config';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

export async function transcribeAudio(filePath: string): Promise<string> {
  const file = fs.createReadStream(filePath);

  const transcription = await openai.audio.transcriptions.create({
    file,
    model: config.whisperModel,
    response_format: 'text',
  });

  return transcription as unknown as string;
}
```

**Step 2: Commit**

```bash
git add packages/worker/src/processors/stt.ts
git commit -m "feat: add STT processor using OpenAI Whisper API"
```

---

### Task 10: Worker — LLM Processor (OpenAI GPT)

**Files:**
- Create: `packages/worker/src/processors/llm.ts`

**Step 1: Create LLM processor**

```typescript
// packages/worker/src/processors/llm.ts
import OpenAI from 'openai';
import { config } from '../config';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

export async function summarizeText(transcript: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: config.gptModel,
    messages: [
      {
        role: 'system',
        content:
          'You are a helpful assistant that creates concise summaries. Summarize the following transcript in a clear, structured format. Include key points, decisions, and action items if any. Respond in the same language as the transcript.',
      },
      {
        role: 'user',
        content: transcript,
      },
    ],
    temperature: 0.3,
    max_tokens: 1024,
  });

  return response.choices[0]?.message?.content || 'No summary generated.';
}
```

**Step 2: Commit**

```bash
git add packages/worker/src/processors/llm.ts
git commit -m "feat: add LLM processor using OpenAI GPT for summarization"
```

---

### Task 11: Worker — RabbitMQ Consumer & Main Entry

**Files:**
- Create: `packages/worker/src/consumer.ts`
- Create: `packages/worker/src/index.ts`
- Create: `packages/worker/prisma/schema.prisma` (symlink or copy from server)

**Step 1: Create consumer**

```typescript
// packages/worker/src/consumer.ts
import amqplib, { Channel, Connection, ConsumeMessage } from 'amqplib';
import { PrismaClient } from '@prisma/client';
import { config } from './config';
import { transcribeAudio } from './processors/stt';
import { summarizeText } from './processors/llm';
import { QUEUE_NAME, DEAD_LETTER_QUEUE, MAX_RETRIES } from '../../../shared/constants';
import { QueueMessage } from '../../../shared/types';

const prisma = new PrismaClient();

export async function startConsumer(): Promise<void> {
  let connection: Connection | null = null;
  let channel: Channel | null = null;
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

      // Process one task at a time
      await channel.prefetch(1);

      console.log(`Worker listening on queue: ${QUEUE_NAME}`);

      channel.consume(QUEUE_NAME, async (msg: ConsumeMessage | null) => {
        if (!msg || !channel) return;

        const content: QueueMessage = JSON.parse(msg.content.toString());
        const { taskId } = content;
        const retryCount = (msg.properties.headers?.['x-retry-count'] as number) || 0;

        console.log(`Processing task: ${taskId} (attempt ${retryCount + 1})`);

        try {
          await processTask(taskId);
          channel.ack(msg);
        } catch (err) {
          console.error(`Task ${taskId} failed:`, err);

          if (retryCount < MAX_RETRIES - 1) {
            // Retry: republish with incremented retry count
            channel.ack(msg);
            channel.sendToQueue(
              QUEUE_NAME,
              Buffer.from(JSON.stringify(content)),
              {
                persistent: true,
                headers: { 'x-retry-count': retryCount + 1 },
              }
            );
            console.log(`Task ${taskId} re-queued (attempt ${retryCount + 2})`);
          } else {
            // Max retries exceeded — move to DLQ
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
                error: `Max retries exceeded. Last error: ${err instanceof Error ? err.message : String(err)}`,
              },
            });
          }
        }
      });

      break;
    } catch (err) {
      retries++;
      console.log(`RabbitMQ connection attempt ${retries}/${maxRetries} failed, retrying in 3s...`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  if (retries >= maxRetries) {
    throw new Error('Worker failed to connect to RabbitMQ after max retries');
  }

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('Worker shutting down...');
    if (channel) await channel.close();
    if (connection) await connection.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}

async function processTask(taskId: string): Promise<void> {
  // Step 1: STT
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
        error: `STT failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    });
    throw err;
  }

  await prisma.task.update({
    where: { id: taskId },
    data: { transcript },
  });

  // Step 2: LLM
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
        error: `LLM failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    });
    throw err;
  }

  // Step 3: Complete
  await prisma.task.update({
    where: { id: taskId },
    data: {
      summary,
      status: 'completed',
      step: null,
      completedAt: new Date(),
    },
  });

  console.log(`Task ${taskId} completed successfully`);
}
```

**Step 2: Create worker entry point**

```typescript
// packages/worker/src/index.ts
import { startConsumer } from './consumer';

async function main() {
  console.log('Starting worker...');
  await startConsumer();
}

main().catch((err) => {
  console.error('Worker fatal error:', err);
  process.exit(1);
});
```

**Step 3: Create worker prisma schema (same as server)**

Copy `packages/server/prisma/schema.prisma` to `packages/worker/prisma/schema.prisma` (identical file).

**Step 4: Commit**

```bash
git add packages/worker/
git commit -m "feat: add RabbitMQ consumer with STT→LLM pipeline and retry logic"
```

---

### Task 12: Frontend — React App Setup

**Files:**
- Create: `packages/frontend/` (via Vite scaffolding)
- Modify generated files

**Step 1: Scaffold React app with Vite**

Run:
```bash
cd packages
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
```

**Step 2: Clean up and configure**

Remove default boilerplate (App.css content, default logo, etc.). Update `vite.config.ts`:

```typescript
// packages/frontend/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 8080,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
```

**Step 3: Commit**

```bash
git add packages/frontend/
git commit -m "feat: scaffold React frontend with Vite"
```

---

### Task 13: Frontend — SSE Hook & API Client

**Files:**
- Create: `packages/frontend/src/hooks/useSSE.ts`
- Create: `packages/frontend/src/api.ts`

**Step 1: Create API client**

```typescript
// packages/frontend/src/api.ts
const API_BASE = '/api';

export async function createTask(file: File) {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API_BASE}/tasks`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Upload failed');
  }

  return res.json();
}

export async function getTasks() {
  const res = await fetch(`${API_BASE}/tasks`);
  if (!res.ok) throw new Error('Failed to fetch tasks');
  return res.json();
}

export async function getTask(id: string) {
  const res = await fetch(`${API_BASE}/tasks/${id}`);
  if (!res.ok) throw new Error('Failed to fetch task');
  return res.json();
}
```

**Step 2: Create SSE hook**

```typescript
// packages/frontend/src/hooks/useSSE.ts
import { useEffect, useRef, useState } from 'react';

interface SSEData {
  status: string;
  step?: string;
  message?: string;
  transcript?: string;
  summary?: string;
  error?: string;
}

export function useSSE(taskId: string | null) {
  const [data, setData] = useState<SSEData | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!taskId) return;

    const es = new EventSource(`/api/tasks/${taskId}/events`);
    eventSourceRef.current = es;

    es.onopen = () => setIsConnected(true);

    es.addEventListener('status', (e) => {
      setData(JSON.parse(e.data));
    });

    es.addEventListener('completed', (e) => {
      setData(JSON.parse(e.data));
      es.close();
      setIsConnected(false);
    });

    es.addEventListener('failed', (e) => {
      setData(JSON.parse(e.data));
      es.close();
      setIsConnected(false);
    });

    es.onerror = () => {
      es.close();
      setIsConnected(false);
    };

    return () => {
      es.close();
      setIsConnected(false);
    };
  }, [taskId]);

  return { data, isConnected };
}
```

**Step 3: Commit**

```bash
git add packages/frontend/src/api.ts packages/frontend/src/hooks/
git commit -m "feat: add API client and SSE hook for real-time updates"
```

---

### Task 14: Frontend — Components (Upload, TaskList, TaskDetail)

**Files:**
- Create: `packages/frontend/src/components/UploadForm.tsx`
- Create: `packages/frontend/src/components/TaskList.tsx`
- Create: `packages/frontend/src/components/TaskDetail.tsx`
- Modify: `packages/frontend/src/App.tsx`
- Modify: `packages/frontend/src/App.css`
- Modify: `packages/frontend/src/index.css`

**Step 1: Create UploadForm component**

```tsx
// packages/frontend/src/components/UploadForm.tsx
import { useState, useRef } from 'react';
import { createTask } from '../api';

interface Props {
  onTaskCreated: (task: { id: string }) => void;
}

export function UploadForm({ onTaskCreated }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setIsUploading(true);
    try {
      const task = await createTask(file);
      onTaskCreated(task);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  return (
    <div className="upload-form">
      <div
        className={`drop-zone ${isDragging ? 'dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        {isUploading ? (
          <p>Uploading...</p>
        ) : (
          <>
            <p>Drag & drop audio file here</p>
            <p className="hint">or click to select (.wav, .mp3)</p>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".wav,.mp3,audio/wav,audio/mpeg"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
```

**Step 2: Create TaskList component**

```tsx
// packages/frontend/src/components/TaskList.tsx
interface Task {
  id: string;
  status: string;
  step: string | null;
  originalFilename: string;
  createdAt: string;
}

interface Props {
  tasks: Task[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  processing: '#3b82f6',
  completed: '#10b981',
  failed: '#ef4444',
};

export function TaskList({ tasks, selectedId, onSelect }: Props) {
  if (tasks.length === 0) {
    return <p className="empty">No tasks yet. Upload an audio file to get started.</p>;
  }

  return (
    <div className="task-list">
      {tasks.map((task) => (
        <div
          key={task.id}
          className={`task-item ${task.id === selectedId ? 'selected' : ''}`}
          onClick={() => onSelect(task.id)}
        >
          <div className="task-item-header">
            <span className="filename">{task.originalFilename}</span>
            <span
              className="status-badge"
              style={{ backgroundColor: STATUS_COLORS[task.status] || '#6b7280' }}
            >
              {task.status}{task.step ? ` (${task.step})` : ''}
            </span>
          </div>
          <span className="timestamp">
            {new Date(task.createdAt).toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}
```

**Step 3: Create TaskDetail component**

```tsx
// packages/frontend/src/components/TaskDetail.tsx
import { useSSE } from '../hooks/useSSE';

interface Task {
  id: string;
  status: string;
  step: string | null;
  originalFilename: string;
  transcript: string | null;
  summary: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface Props {
  task: Task | null;
}

export function TaskDetail({ task }: Props) {
  const needsSSE = task && (task.status === 'pending' || task.status === 'processing');
  const { data: sseData, isConnected } = useSSE(needsSSE ? task.id : null);

  if (!task) {
    return <div className="task-detail empty">Select a task to view details</div>;
  }

  const displayStatus = sseData?.status || task.status;
  const displayTranscript = sseData?.transcript || task.transcript;
  const displaySummary = sseData?.summary || task.summary;
  const displayError = sseData?.error || task.error;

  return (
    <div className="task-detail">
      <h2>{task.originalFilename}</h2>

      <div className="status-section">
        <span className={`status ${displayStatus}`}>{displayStatus}</span>
        {sseData?.message && <span className="step-message">{sseData.message}</span>}
        {isConnected && <span className="live-badge">LIVE</span>}
      </div>

      {displayError && (
        <div className="section error-section">
          <h3>Error</h3>
          <p>{displayError}</p>
        </div>
      )}

      {displayTranscript && (
        <div className="section">
          <h3>Transcript</h3>
          <pre className="content-block">{displayTranscript}</pre>
        </div>
      )}

      {displaySummary && (
        <div className="section">
          <h3>Summary</h3>
          <pre className="content-block">{displaySummary}</pre>
        </div>
      )}

      <div className="meta">
        <p>Created: {new Date(task.createdAt).toLocaleString()}</p>
        {task.completedAt && <p>Completed: {new Date(task.completedAt).toLocaleString()}</p>}
        <p className="task-id">ID: {task.id}</p>
      </div>
    </div>
  );
}
```

**Step 4: Create App.tsx**

```tsx
// packages/frontend/src/App.tsx
import { useState, useEffect, useCallback } from 'react';
import { UploadForm } from './components/UploadForm';
import { TaskList } from './components/TaskList';
import { TaskDetail } from './components/TaskDetail';
import { getTasks, getTask } from './api';
import './App.css';

function App() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<any>(null);

  const fetchTasks = useCallback(async () => {
    try {
      const data = await getTasks();
      setTasks(data);
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 5000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedTask(null);
      return;
    }
    getTask(selectedId).then(setSelectedTask).catch(console.error);
    const interval = setInterval(() => {
      getTask(selectedId).then(setSelectedTask).catch(console.error);
    }, 3000);
    return () => clearInterval(interval);
  }, [selectedId]);

  const handleTaskCreated = (task: { id: string }) => {
    setSelectedId(task.id);
    fetchTasks();
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>STT Summary Server</h1>
        <p>Upload audio files for transcription and AI-powered summarization</p>
      </header>

      <UploadForm onTaskCreated={handleTaskCreated} />

      <div className="main-content">
        <div className="sidebar">
          <h2>Tasks</h2>
          <TaskList tasks={tasks} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
        <div className="detail-panel">
          <TaskDetail task={selectedTask} />
        </div>
      </div>
    </div>
  );
}

export default App;
```

**Step 5: Create CSS styles** — Write `App.css` and `index.css` with clean, professional styling (dark theme, card layout, status badges, responsive layout).

**Step 6: Commit**

```bash
git add packages/frontend/src/
git commit -m "feat: add React frontend with upload, task list, and real-time detail view"
```

---

### Task 15: Docker — Dockerfiles for All Services

**Files:**
- Create: `packages/server/Dockerfile`
- Create: `packages/worker/Dockerfile`
- Create: `packages/frontend/Dockerfile`
- Create: `packages/frontend/nginx.conf`

**Step 1: Server Dockerfile (multi-stage)**

```dockerfile
# packages/server/Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
COPY packages/server/package.json ./packages/server/
COPY shared/ ./shared/
RUN cd packages/server && npm install
COPY packages/server/ ./packages/server/
RUN cd packages/server && npx prisma generate && npx tsc

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/packages/server/dist ./dist
COPY --from=builder /app/packages/server/node_modules ./node_modules
COPY --from=builder /app/packages/server/package.json ./
COPY --from=builder /app/packages/server/prisma ./prisma
COPY --from=builder /app/shared ./shared
RUN mkdir -p /app/uploads
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
```

**Step 2: Worker Dockerfile (multi-stage)**

```dockerfile
# packages/worker/Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
COPY packages/worker/package.json ./packages/worker/
COPY shared/ ./shared/
RUN cd packages/worker && npm install
COPY packages/worker/ ./packages/worker/
RUN cd packages/worker && npx prisma generate && npx tsc

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/packages/worker/dist ./dist
COPY --from=builder /app/packages/worker/node_modules ./node_modules
COPY --from=builder /app/packages/worker/package.json ./
COPY --from=builder /app/packages/worker/prisma ./prisma
COPY --from=builder /app/shared ./shared
CMD ["node", "dist/index.js"]
```

**Step 3: Frontend Dockerfile**

```dockerfile
# packages/frontend/Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY packages/frontend/package.json ./
RUN npm install
COPY packages/frontend/ ./
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY packages/frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
```

```nginx
# packages/frontend/nginx.conf
server {
    listen 8080;
    root /usr/share/nginx/html;
    index index.html;

    location /api {
        proxy_pass http://server:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection '';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_buffering off;
        proxy_read_timeout 300s;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

**Step 4: Commit**

```bash
git add packages/server/Dockerfile packages/worker/Dockerfile packages/frontend/Dockerfile packages/frontend/nginx.conf
git commit -m "feat: add multi-stage Dockerfiles for server, worker, and frontend"
```

---

### Task 16: Docker Compose — Full Stack Orchestration

**Files:**
- Create: `docker-compose.yml`

**Step 1: Create docker-compose.yml**

```yaml
# docker-compose.yml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
      POSTGRES_DB: ${POSTGRES_DB:-stt_summary}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  rabbitmq:
    image: rabbitmq:3-management-alpine
    ports:
      - "5672:5672"
      - "15672:15672"
    volumes:
      - rabbitmq_data:/var/lib/rabbitmq
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "check_running"]
      interval: 10s
      timeout: 10s
      retries: 5

  server:
    build:
      context: .
      dockerfile: packages/server/Dockerfile
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD:-postgres}@postgres:5432/${POSTGRES_DB:-stt_summary}
      RABBITMQ_URL: amqp://guest:guest@rabbitmq:5672
      SERVER_PORT: 3000
      UPLOAD_DIR: /app/uploads
      OPENAI_API_KEY: ${OPENAI_API_KEY}
    volumes:
      - uploads_data:/app/uploads
    depends_on:
      postgres:
        condition: service_healthy
      rabbitmq:
        condition: service_healthy

  worker:
    build:
      context: .
      dockerfile: packages/worker/Dockerfile
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD:-postgres}@postgres:5432/${POSTGRES_DB:-stt_summary}
      RABBITMQ_URL: amqp://guest:guest@rabbitmq:5672
      UPLOAD_DIR: /app/uploads
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      WHISPER_MODEL: ${WHISPER_MODEL:-whisper-1}
      GPT_MODEL: ${GPT_MODEL:-gpt-4o-mini}
    volumes:
      - uploads_data:/app/uploads
    depends_on:
      postgres:
        condition: service_healthy
      rabbitmq:
        condition: service_healthy

  frontend:
    build:
      context: .
      dockerfile: packages/frontend/Dockerfile
    ports:
      - "8080:8080"
    depends_on:
      - server

volumes:
  postgres_data:
  rabbitmq_data:
  uploads_data:
```

**Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add docker-compose.yml for full stack orchestration"
```

---

### Task 17: Prisma Migrations

**Files:**
- Create: `packages/server/prisma/migrations/` (via prisma migrate)

**Step 1: Generate initial migration**

Requires a running PostgreSQL. Either run locally or use docker-compose for just postgres:

```bash
cd packages/server
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/stt_summary" npx prisma migrate dev --name init
```

**Step 2: Copy migration to worker**

```bash
cp -r packages/server/prisma/migrations packages/worker/prisma/
```

**Step 3: Commit**

```bash
git add packages/server/prisma/migrations packages/worker/prisma/
git commit -m "feat: add initial Prisma migration for tasks table"
```

---

### Task 18: Architecture Documentation

**Files:**
- Create: `docs/architecture.md`

**Step 1: Create architecture doc with Mermaid diagrams**

```markdown
# Architecture Documentation

## System Architecture

\```mermaid
graph TB
    Client[React Frontend<br/>:8080]
    API[Fastify API Server<br/>:3000]
    RMQ[RabbitMQ<br/>:5672]
    Worker[Background Worker]
    DB[(PostgreSQL<br/>:5432)]
    OpenAI[OpenAI API]

    Client -->|Upload Audio| API
    Client -->|SSE| API
    Client -->|Query Results| API
    API -->|Publish Task| RMQ
    API -->|Read/Write| DB
    RMQ -->|Consume Task| Worker
    Worker -->|Update Status| DB
    Worker -->|Whisper STT| OpenAI
    Worker -->|GPT Summary| OpenAI
\```

## Sequence Diagram

\```mermaid
sequenceDiagram
    actor User
    participant FE as Frontend
    participant API as API Server
    participant RMQ as RabbitMQ
    participant DB as PostgreSQL
    participant W as Worker
    participant AI as OpenAI

    User->>FE: Upload audio file
    FE->>API: POST /api/tasks (multipart)
    API->>API: Validate & save file
    API->>DB: Create task (pending)
    API->>RMQ: Publish task message
    API-->>FE: 201 {id, status: pending}
    FE->>API: GET /api/tasks/:id/events (SSE)

    RMQ->>W: Deliver task message
    W->>DB: Update status → processing (stt)
    API-->>FE: SSE: {status: processing, step: stt}
    W->>AI: Whisper API (audio → text)
    AI-->>W: Transcript
    W->>DB: Save transcript, step → llm
    API-->>FE: SSE: {status: processing, step: llm}
    W->>AI: GPT API (transcript → summary)
    AI-->>W: Summary
    W->>DB: Save summary, status → completed
    API-->>FE: SSE: {status: completed, transcript, summary}
\```

## Task Status Flow

\```mermaid
stateDiagram-v2
    [*] --> pending: Upload audio
    pending --> processing: Worker picks up
    processing --> completed: Success
    processing --> failed: Error (after retries)
    completed --> [*]
    failed --> [*]
\```
```

**Step 2: Commit**

```bash
git add docs/architecture.md
git commit -m "docs: add architecture diagrams with Mermaid"
```

---

### Task 19: README

**Files:**
- Create: `README.md`

**Step 1: Write comprehensive README**

Include:
- Project introduction
- Architecture overview
- Tech stack
- Prerequisites
- Quick start (`docker-compose up`)
- Environment variables
- API documentation (all endpoints with examples using curl)
- Frontend usage
- Development setup

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add comprehensive README with API docs and setup instructions"
```

---

### Task 20: Final Verification

**Step 1: Full stack test**

```bash
cp .env.example .env
# Edit .env with real OPENAI_API_KEY
docker-compose up --build
```

**Step 2: Verify all services start**

- PostgreSQL: healthy
- RabbitMQ: healthy, management UI at http://localhost:15672
- Server: http://localhost:3000/api/health → `{"status":"ok"}`
- Frontend: http://localhost:8080

**Step 3: End-to-end test**

```bash
# Upload audio
curl -X POST http://localhost:3000/api/tasks \
  -F "file=@test-audio.mp3"

# Check task status
curl http://localhost:3000/api/tasks/{id}

# Test SSE
curl -N http://localhost:3000/api/tasks/{id}/events
```

**Step 4: Verify frontend**

- Upload audio file via drag & drop
- See task appear in task list
- See real-time progress via SSE
- See completed transcript and summary

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: final cleanup and verification"
```
