# STT Summary Server

A full-stack speech-to-text summarization service that accepts audio files, transcribes them via OpenAI Whisper, generates summaries via GPT, and streams real-time progress to a React frontend using Server-Sent Events (SSE).

**Live Demo:** [https://voicebrief.xyz](https://voicebrief.xyz)

## Architecture

The system follows a producer-consumer architecture with five main components:

- **Fastify API Server** -- Handles file uploads, REST endpoints, and SSE streaming
- **RabbitMQ Worker** -- Asynchronously processes tasks (transcription + summarization)
- **PostgreSQL** -- Stores task state, transcripts, and summaries (via Prisma ORM)
- **MinIO (S3-compatible)** -- Stores uploaded audio files used by the worker
- **React Frontend** -- Single-page app for uploading audio and viewing results in real-time
- **Docker Compose** -- Orchestrates all services with health checks and shared volumes

For detailed diagrams and data flow, see [docs/architecture.md](docs/architecture.md).

## Tech Stack

| Technology | Purpose |
|------------|---------|
| TypeScript | Language for all packages (server, worker, shared) |
| Fastify | High-performance HTTP server with plugin system |
| Prisma | Type-safe ORM for PostgreSQL |
| RabbitMQ | Message broker for async task processing |
| PostgreSQL | Relational database for task persistence |
| OpenAI Whisper | Speech-to-text transcription |
| OpenAI GPT | Text summarization |
| React (Vite) | Frontend SPA with real-time SSE updates |
| Docker Compose | Container orchestration for all services |

## Prerequisites

- **Docker** and **Docker Compose** (v2+)
- **OpenAI API key** with access to Whisper and GPT models

## Quick Start

```bash
# Clone the repo
git clone <repo-url>
cd stt-summary-server

# Create .env from example
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY

# Start all services
docker compose up --build
```

Once running, access:

| Service | URL |
|---------|-----|
| Frontend | [http://localhost:8080](http://localhost:8080) |
| API Server | [http://localhost:3000](http://localhost:3000) |
| RabbitMQ Management | [http://localhost:15672](http://localhost:15672) (guest/guest) |
| MinIO Console | [http://localhost:9001](http://localhost:9001) (minioadmin/minioadmin) |

## API Documentation

### Authentication

All API endpoints (except `/api/health` and SSE `/api/tasks/:id/events`) require an API key via the `X-API-Key` header.

```bash
curl -H "X-API-Key: YOUR_API_KEY" http://localhost:3000/api/tasks
```

When `API_KEY` is not set (local development), authentication is disabled.

**Error** -- `401 Unauthorized` (missing or invalid key):

```json
{
  "error": "Missing or invalid API key"
}
```

### `POST /api/tasks`

Upload an audio file for transcription and summarization.

- **Content-Type**: `multipart/form-data`
- **Field**: `file` (required) -- audio file (`.wav` or `.mp3`, max 25 MB)

```bash
curl -X POST http://localhost:3000/api/tasks \
  -H "X-API-Key: YOUR_API_KEY" \
  -F "file=@recording.wav"
```

**Success** — `201 Created`:

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "pending",
  "originalFilename": "recording.wav",
  "createdAt": "2026-03-02T12:00:00.000Z"
}
```

**Error** — `400 Bad Request` (no file):

```json
{
  "error": "No file uploaded"
}
```

**Error** — `400 Bad Request` (invalid file type):

```json
{
  "error": "Invalid file type: audio/ogg. Allowed: .wav, .mp3"
}
```

### `GET /api/tasks`

List all tasks, ordered by creation date (newest first).

```bash
curl -H "X-API-Key: YOUR_API_KEY" http://localhost:3000/api/tasks
```

**Success** -- `200 OK`:

```json
[
  {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "completed",
    "step": null,
    "originalFilename": "recording.wav",
    "transcript": "Hello, this is a test recording...",
    "summary": "A brief test recording greeting.",
    "error": null,
    "createdAt": "2026-03-02T12:00:00.000Z",
    "updatedAt": "2026-03-02T12:01:00.000Z",
    "completedAt": "2026-03-02T12:01:00.000Z"
  },
  {
    "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "status": "processing",
    "step": "stt",
    "originalFilename": "meeting.mp3",
    "transcript": null,
    "summary": null,
    "error": null,
    "createdAt": "2026-03-02T12:05:00.000Z",
    "updatedAt": "2026-03-02T12:05:30.000Z",
    "completedAt": null
  }
]
```

### `GET /api/tasks/:id`

Get a single task by ID, including transcript and summary.

```bash
curl -H "X-API-Key: YOUR_API_KEY" http://localhost:3000/api/tasks/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

**Success** — `200 OK`:

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "completed",
  "step": null,
  "originalFilename": "recording.wav",
  "transcript": "Hello, this is a test recording...",
  "summary": "A brief test recording greeting.",
  "error": null,
  "createdAt": "2026-03-02T12:00:00.000Z",
  "updatedAt": "2026-03-02T12:01:00.000Z",
  "completedAt": "2026-03-02T12:01:00.000Z"
}
```

**Error** — `404 Not Found`:

```json
{
  "error": "Task not found"
}
```

**Failed task example** — `200 OK`:

```json
{
  "id": "c3d4e5f6-a7b8-9012-cdef-123456789012",
  "status": "failed",
  "step": null,
  "originalFilename": "corrupted.wav",
  "transcript": null,
  "summary": null,
  "error": "Transcription failed: Invalid audio format",
  "createdAt": "2026-03-02T12:10:00.000Z",
  "updatedAt": "2026-03-02T12:10:15.000Z",
  "completedAt": null
}
```

### `GET /api/tasks/:id/events`

Server-Sent Events stream for real-time task progress.

```bash
curl -N http://localhost:3000/api/tasks/a1b2c3d4-e5f6-7890-abcd-ef1234567890/events
```

Events emitted:

| Event | When | Data |
|-------|------|------|
| `status` | Status or step changes | `{ status, step, message }` |
| `completed` | Task finishes successfully | `{ status, transcript, summary }` |
| `failed` | Task fails | `{ status, error }` |

**SSE stream example** (successful task):

```
event: status
data: {"status":"processing","step":"stt","message":"Transcribing audio..."}

event: status
data: {"status":"processing","step":"llm","message":"Generating summary..."}

event: completed
data: {"status":"completed","transcript":"Hello, this is a test recording...","summary":"A brief test recording greeting."}
```

**SSE stream example** (failed task):

```
event: status
data: {"status":"processing","step":"stt","message":"Transcribing audio..."}

event: failed
data: {"status":"failed","error":"Transcription failed: Invalid audio format"}
```

### `GET /api/health`

Health check endpoint.

```bash
curl http://localhost:3000/api/health
```

**Success** — `200 OK`:

```json
{
  "status": "ok",
  "uptime": 123.456,
  "timestamp": "2026-03-02T12:00:00.000Z"
}
```

## Security

- **API Key Authentication** -- All endpoints (except health check and SSE) require `X-API-Key` header. Disabled when `API_KEY` is unset (local development).
- **Helmet** -- Security headers via `@fastify/helmet` (X-Content-Type-Options, X-Frame-Options, etc.)
- **Rate Limiting** -- 100 requests/min per IP via `@fastify/rate-limit`
- **File Validation** -- Mimetype allowlist + magic byte verification for WAV/MP3
- **Non-root Containers** -- Server and worker run as `node` user inside Docker
- **Timing-safe Comparison** -- API key validation uses `crypto.timingSafeEqual`

## Environment Variables

All variables are configured in `.env` (copy from `.env.example`):

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key (required) | -- |
| `API_KEY` | API key for endpoint authentication (optional, disabled if unset) | -- |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@postgres:5432/stt_summary` |
| `POSTGRES_USER` | PostgreSQL username | `postgres` |
| `POSTGRES_PASSWORD` | PostgreSQL password | `postgres` |
| `POSTGRES_DB` | PostgreSQL database name | `stt_summary` |
| `RABBITMQ_URL` | RabbitMQ connection string | `amqp://guest:guest@rabbitmq:5672` |
| `SERVER_PORT` | API server port | `3000` |
| `S3_ENDPOINT` | S3 endpoint URL (MinIO in local Docker) | `http://localhost:9000` |
| `S3_BUCKET` | Bucket name for uploaded audio | `stt-uploads` |
| `S3_REGION` | S3 region | `auto` |
| `S3_ACCESS_KEY_ID` | S3 access key | `minioadmin` |
| `S3_SECRET_ACCESS_KEY` | S3 secret key | `minioadmin` |
| `WHISPER_MODEL` | OpenAI Whisper model name | `whisper-1` |
| `GPT_MODEL` | OpenAI GPT model name | `gpt-4o` |
| `CORS_ORIGIN` | Allowed CORS origin for API requests | `http://localhost:8080` |

## Development

To run services locally without Docker, you need PostgreSQL and RabbitMQ running on your machine.

```bash
# Install dependencies
npm install

# Set up environment (point to local PostgreSQL and RabbitMQ)
cp .env.example .env
# Edit .env:
#   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/stt_summary
#   RABBITMQ_URL=amqp://guest:guest@localhost:5672
#   S3_ENDPOINT=http://localhost:9000
#   S3_BUCKET=stt-uploads
#   S3_ACCESS_KEY_ID=minioadmin
#   S3_SECRET_ACCESS_KEY=minioadmin

# Generate Prisma client and run migrations
cd packages/server
npx prisma generate
npx prisma migrate deploy
cd ../..

# Start the API server (with hot reload)
npm run --workspace=packages/server dev

# In a separate terminal, start the worker
npm run --workspace=packages/worker dev

# In a separate terminal, start the frontend
npm run --workspace=packages/frontend dev
```

## Project Structure

```
stt-summary-server/
├── docs/
│   └── architecture.md          # Architecture diagrams (Mermaid)
├── packages/
│   ├── server/                   # Fastify API server
│   │   ├── prisma/
│   │   │   ├── schema.prisma     # Database schema
│   │   │   └── migrations/       # SQL migrations
│   │   ├── src/
│   │   │   ├── app.ts            # Fastify app builder (helmet, rate-limit, CORS)
│   │   │   ├── server.ts         # Entry point
│   │   │   ├── config.ts         # Environment config
│   │   │   ├── middleware/
│   │   │   │   └── auth.ts       # API Key authentication middleware
│   │   │   ├── plugins/
│   │   │   │   ├── db.ts         # Prisma database plugin
│   │   │   │   └── rabbitmq.ts   # RabbitMQ producer plugin
│   │   │   ├── routes/
│   │   │   │   ├── tasks.ts      # Task CRUD endpoints
│   │   │   │   └── events.ts     # SSE streaming endpoint
│   │   │   ├── services/
│   │   │   │   └── storage.ts    # S3 file storage service
│   │   │   └── utils/
│   │   │       ├── audio-validation.ts  # WAV/MP3 magic byte validation
│   │   │       └── step-message.ts      # Human-readable step messages
│   │   ├── Dockerfile
│   │   └── package.json
│   ├── worker/                   # Background task processor
│   │   ├── src/
│   │   │   ├── index.ts          # Entry point
│   │   │   ├── config.ts         # Environment config
│   │   │   ├── consumer.ts       # RabbitMQ consumer + task orchestration
│   │   │   ├── processors/
│   │   │   │   ├── stt.ts        # OpenAI Whisper integration
│   │   │   │   └── llm.ts        # OpenAI GPT integration
│   │   │   └── services/
│   │   │       └── storage.ts    # S3 file download service
│   │   ├── Dockerfile
│   │   └── package.json
│   └── frontend/                 # React SPA
│       ├── src/
│       │   ├── main.tsx          # Entry point
│       │   ├── App.tsx           # Root component
│       │   ├── api.ts            # API client
│       │   ├── hooks/
│       │   │   └── useSSE.ts     # SSE hook for real-time updates
│       │   └── components/
│       │       ├── UploadForm.tsx # Audio file upload form
│       │       ├── TaskList.tsx   # Task list with status indicators
│       │       └── TaskDetail.tsx # Task detail with live progress
│       ├── Dockerfile
│       └── package.json
├── shared/                       # Shared types and constants
│   ├── types.ts                  # TypeScript interfaces
│   ├── constants.ts              # Status codes, queue names, limits
│   └── package.json
├── docker-compose.yml            # Container orchestration
├── .env.example                  # Environment variable template
├── package.json                  # Root workspace config
└── tsconfig.base.json            # Shared TypeScript config
```
