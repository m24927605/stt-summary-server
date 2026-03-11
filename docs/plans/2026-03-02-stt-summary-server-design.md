# Speech-to-Text Summarization Server - Design Document

## Overview

A backend service that accepts audio files, transcribes them using OpenAI Whisper, generates summaries using OpenAI GPT, and returns results to users. Includes real-time progress streaming via SSE and a React frontend.

## Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript (Node.js) | Type safety, code quality |
| Framework | Fastify | Modern, performant, built-in schema validation |
| Queue | RabbitMQ | Enterprise-grade message broker, demonstrates distributed systems |
| Database | PostgreSQL | Structured task data, reliable, professional |
| ORM | Prisma | Type-safe DB access, migration support |
| STT | OpenAI Whisper API | Best accuracy, simple integration |
| LLM | OpenAI GPT API | Single API key for both STT and LLM |
| Frontend | React (Vite) | Modern SPA, good developer experience |
| Deployment | Docker Compose | One-click startup as required |

## Architecture

### Monorepo + Separated Worker

API Server and Worker run as independent Docker containers, communicating through RabbitMQ. This demonstrates distributed systems thinking while keeping complexity reasonable for an interview assignment.

```
┌──────────┐     ┌───────────┐     ┌──────────┐
│ Frontend │────▶│ API Server│────▶│ RabbitMQ │
│ (React)  │ SSE │ (Fastify) │     │          │
└──────────┘◀────└─────┬─────┘     └────┬─────┘
                       │                │
                       ▼                ▼
                 ┌──────────┐     ┌──────────┐
                 │ Postgres │◀────│  Worker  │
                 │          │     │          │
                 └──────────┘     └──────────┘
                                       │
                                       ▼
                                 ┌──────────┐
                                 │ OpenAI   │
                                 │ API      │
                                 └──────────┘
```

### Docker Compose Services

| Service | Image | Port | Description |
|---------|-------|------|-------------|
| server | Custom (Node 20 Alpine) | 3000 | Fastify API server |
| worker | Custom (Node 20 Alpine) | - | RabbitMQ consumer |
| frontend | Custom (nginx) | 8080 | React SPA |
| postgres | postgres:16 | 5432 | Database |
| rabbitmq | rabbitmq:3-management | 5672/15672 | Message queue |

## Project Structure

```
stt-summary-server/
├── docker-compose.yml
├── .env.example
├── packages/
│   ├── server/
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── src/
│   │       ├── app.ts              # Fastify initialization
│   │       ├── routes/
│   │       │   ├── tasks.ts        # POST /tasks, GET /tasks, GET /tasks/:id
│   │       │   └── events.ts       # GET /tasks/:id/events (SSE)
│   │       ├── services/
│   │       │   ├── queue.ts        # RabbitMQ producer
│   │       │   └── storage.ts      # File storage
│   │       ├── plugins/
│   │       │   ├── db.ts           # PostgreSQL connection (Prisma)
│   │       │   └── rabbitmq.ts     # RabbitMQ connection
│   │       └── config.ts           # Environment variable management
│   │
│   ├── worker/
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts            # Worker entry point
│   │       ├── consumer.ts         # RabbitMQ consumer
│   │       ├── processors/
│   │       │   ├── stt.ts          # OpenAI Whisper call
│   │       │   └── llm.ts          # OpenAI GPT call
│   │       └── config.ts
│   │
│   └── frontend/
│       ├── Dockerfile
│       ├── package.json
│       └── src/
│           ├── App.tsx
│           ├── components/
│           │   ├── UploadForm.tsx   # Drag & drop upload
│           │   ├── TaskList.tsx     # Task list with status badges
│           │   └── TaskDetail.tsx   # Real-time progress + results
│           └── hooks/
│               └── useSSE.ts       # SSE connection hook
│
├── shared/
│   ├── types.ts                    # Shared types
│   └── constants.ts                # Status constants
│
└── docs/
    └── architecture.md             # Architecture diagrams (Mermaid)
```

## API Design

### Endpoints

```
POST   /api/tasks              # Upload audio, create task
GET    /api/tasks               # List all tasks
GET    /api/tasks/:id           # Get single task (with transcript, summary)
GET    /api/tasks/:id/events    # SSE real-time progress stream
```

### POST /api/tasks

- Content-Type: `multipart/form-data`
- Body: `file` (audio file .wav/.mp3)
- Response: `201 Created`

```json
{
  "id": "uuid",
  "status": "pending",
  "originalFilename": "recording.mp3",
  "createdAt": "2026-03-02T10:00:00Z"
}
```

### GET /api/tasks/:id

```json
{
  "id": "uuid",
  "status": "completed",
  "originalFilename": "recording.mp3",
  "transcript": "Today's meeting discussed...",
  "summary": "Meeting highlights: 1. ...",
  "error": null,
  "createdAt": "2026-03-02T10:00:00Z",
  "completedAt": "2026-03-02T10:01:30Z"
}
```

### GET /api/tasks/:id/events (SSE)

```
event: status
data: {"status": "processing", "step": "stt", "message": "Transcribing audio..."}

event: status
data: {"status": "processing", "step": "llm", "message": "Generating summary..."}

event: completed
data: {"status": "completed", "transcript": "...", "summary": "..."}

event: failed
data: {"status": "failed", "error": "STT service unavailable"}
```

## Data Model

```sql
CREATE TABLE tasks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status            VARCHAR(20) NOT NULL DEFAULT 'pending',
  step              VARCHAR(20),
  original_filename VARCHAR(255) NOT NULL,
  file_path         VARCHAR(500) NOT NULL,
  transcript        TEXT,
  summary           TEXT,
  error             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);
```

**Status flow:** `pending` → `processing` (step: stt) → `processing` (step: llm) → `completed` / `failed`

## Core Task Flow

```
User → [Upload Audio] → API Server
  API Server:
    1. Validate file format (.wav/.mp3)
    2. Save file to local uploads/ directory
    3. Create task record in DB (status: pending)
    4. Publish message to RabbitMQ queue
    5. Return 201 + task id

Worker (RabbitMQ Consumer):
    1. Receive message, read task from DB
    2. Update status → processing, step → stt
    3. Read audio file, call OpenAI Whisper API
    4. Save transcript to DB
    5. Update step → llm
    6. Call OpenAI GPT API to generate summary
    7. Save summary, update status → completed
    8. On error: update status → failed, record error message

User → [Query Result] → API Server → DB → Return result
User → [SSE Connection] → API Server → Poll DB changes → Push events
```

## SSE Implementation

- On client connect, start polling DB every 2 seconds for task status changes
- Push SSE event on status change
- Close connection on `completed` or `failed`
- Reasonable trade-off for interview scope (avoids additional pub/sub complexity)

## Error Handling

- STT failure → record error, status = failed, skip LLM
- LLM failure → keep transcript, status = failed, record error
- RabbitMQ consumer retry: max 3 attempts with dead letter queue
- Invalid file format → 400 rejection at API layer
- File size limit: 25MB (OpenAI Whisper limit)

## Frontend

Three main sections:
1. **Upload Area** — Drag & drop or click to upload, auto-navigate to task detail
2. **Task List** — All tasks with status badges (pending/processing/completed/failed)
3. **Task Detail** — Real-time progress via SSE, transcript text, summary text

## Docker Build Strategy

- Server & Worker: Node.js 20 Alpine + multi-stage build (minimize image size)
- Frontend: Vite build → nginx for static file serving
- Shared code via Docker COPY + TypeScript path mapping
- Audio files stored in Docker volume, shared between server and worker
