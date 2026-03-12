# STT Summary Server

A full-stack speech-to-text summarization service that accepts audio files, transcribes them via OpenAI Whisper with Google STT fallback, generates summaries via OpenAI with Anthropic fallback, and streams real-time progress to a React frontend using Server-Sent Events (SSE). Summary output is hardened by a secure summary pipeline before persistence.

**Live Demo:** [https://voicebrief.xyz](https://voicebrief.xyz)
**Slides:** [https://voicebrief.xyz/slides/](https://voicebrief.xyz/slides/)

## Architecture

Producer-consumer architecture with five main components:

- **Fastify API Server** — File uploads, REST endpoints, SSE streaming
- **RabbitMQ Worker** — Async transcription + summarization
- **PostgreSQL** — Task state, transcripts, summaries (Prisma ORM)
- **MinIO (S3)** — Audio file storage
- **React Frontend** — Upload UI with real-time SSE progress

For diagrams and data flow, see [docs/architecture.md](docs/architecture.md).

## Quick Start

**Prerequisites:** Docker + Docker Compose v2+, OpenAI API key

```bash
cp .env.example .env   # add your OPENAI_API_KEY
docker compose up --build
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:8080 |
| API Server | http://localhost:3000 |
| RabbitMQ | http://localhost:15672 (guest/guest) |
| MinIO | http://localhost:9001 (minioadmin/minioadmin) |

## API

### Authentication

Two auth models depending on route:

| Route | Auth | Description |
|-------|------|-------------|
| `GET /api/health` | Public | Health check |
| `/api/tasks/**` | Cookie session | Server-managed HttpOnly cookie + CSRF |
| Other `/api/*` | API key | `X-API-Key` header (required when `API_KEY` is set) |

Session management is automatic — the server creates and validates sessions via HttpOnly `stt_session` cookie. State-changing requests (POST/PUT/DELETE) also require `X-CSRF-Token` header matching the `csrf_token` cookie.

For details, see [docs/security.md](docs/security.md).

### Endpoints

#### `GET /api/tasks/session` — Bootstrap session

Initializes a session for browser clients and returns the current CSRF token. If a valid session already exists, it reuses it; if an invalid cookie is present, the server clears it and returns `401`.

```bash
curl -i http://localhost:3000/api/tasks/session
```

Returns `200`:

```json
{ "csrfToken": "..." }
```

#### `POST /api/tasks` — Upload audio

Call `GET /api/tasks/session` first to obtain the session cookie and CSRF token, then upload:

```bash
curl -X POST http://localhost:3000/api/tasks \
  -b "stt_session=YOUR_SESSION_COOKIE" \
  -H "X-CSRF-Token: YOUR_CSRF_TOKEN" \
  -F "file=@recording.wav"
```

Returns `201`:
```json
{ "id": "uuid", "status": "pending", "originalFilename": "recording.wav", "createdAt": "..." }
```

#### `GET /api/tasks` — List tasks (scoped to session)

Returns `200` with array of tasks ordered by creation date (newest first).

#### `GET /api/tasks/:id` — Get single task

Returns `200` with task detail (transcript, summary) or `404` if not found / not owned.

#### `GET /api/tasks/:id/events` — SSE stream

Real-time progress via Server-Sent Events. Auth via cookie (same-origin).

| Event | Data |
|-------|------|
| `status` | `{ status, step, message }` |
| `completed` | `{ status, transcript, summary }` |
| `failed` | `{ status, error }` |

#### `GET /api/health`

Returns `200 { status: "ok", uptime, timestamp }` or `503 { status: "error" }`.

## Security

See [docs/security.md](docs/security.md) for full details. Key layers:

- **Server-managed sessions** — HttpOnly cookie, bound to UA hash + IP prefix, 24h auto-rotation with atomic task ownership migration
- **Proxy-aware session binding** — In ECS/ALB deployments, Fastify trusts the ALB proxy so session IP binding tracks the real client IP instead of the load balancer node
- **CSRF double-submit** — `csrf_token` cookie + `X-CSRF-Token` header, constant-time compare, survives rotation
- **Streaming uploads** — No `toBuffer()`, 16-byte magic byte validation, stream to S3
- **Secure summary pipeline** — Output guard + deterministic verifier; raw LLM output never persisted
- **Log redaction** — Shared deep recursive redaction across server and worker (nested objects, arrays, error objects)
- **Security headers** — CSP, X-Content-Type-Options, Referrer-Policy via Helmet
- **Durable rate limiting** — PostgreSQL-backed, survives restarts and horizontal scaling (session bootstrap: 5/min, upload: 10/min, list/detail: 30/min, SSE: 5/min)
- **Worker memory safety** — Temp-file path instead of whole-buffer; cleanup on success and failure
- **IAM least privilege** — Separate server/worker ECS task roles with scoped S3 access
- **Error sanitization** — Internal details never exposed; structured failure codes for verification/timeout
- **Provider fallback** — OpenAI → Anthropic (LLM), OpenAI → Google (STT)

## Environment Variables

Configured in `.env` (copy from `.env.example`):

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key (required) | — |
| `API_KEY` | API key for non-task endpoints | — |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@postgres:5432/stt_summary` |
| `RABBITMQ_URL` | RabbitMQ connection string | `amqp://guest:guest@rabbitmq:5672` |
| `S3_ENDPOINT` | S3/MinIO endpoint | `http://localhost:9000` |
| `S3_BUCKET` | Audio upload bucket | `stt-uploads` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | S3 credentials (local dev) | `minioadmin` |
| `CORS_ORIGIN` | Allowed CORS origin | `http://localhost:8080` |
| `ANTHROPIC_API_KEY` | Anthropic fallback key | — |
| `GOOGLE_API_KEY` | Google STT fallback key | — |

See `.env.example` for the complete list.

## Processing Flow

1. Frontend calls `GET /api/tasks/session` to initialize or refresh the session and CSRF token.
2. Client uploads audio via `POST /api/tasks`; API validates session, CSRF, MIME type, and magic bytes while streaming to S3/MinIO.
3. API creates a pending task in PostgreSQL and publishes `{taskId}` to RabbitMQ.
4. Worker downloads the audio, runs STT with OpenAI primary and Google fallback, then stores the transcript.
5. Worker runs the secure summary pipeline: sanitize transcript, summarize via primary/fallback LLM, guard output, verify deterministically, then persist only guarded and verified summary text.
6. Frontend listens on `GET /api/tasks/:id/events` and receives `status`, `completed`, or sanitized `failed` events.

## Development

```bash
npm install

# Prisma setup
cd packages/server && npx prisma generate && npx prisma migrate deploy && cd ../..

# Run each in a separate terminal
npm run --workspace=packages/server dev
npm run --workspace=packages/worker dev
npm run --workspace=packages/frontend dev
```

## Project Structure

```
stt-summary-server/
├── docs/
│   ├── architecture.md        # Architecture diagrams
│   └── security.md            # Security architecture
├── packages/
│   ├── server/                # Fastify API server
│   │   ├── prisma/            # Schema & migrations
│   │   └── src/
│   │       ├── app.ts         # App builder (plugins, middleware, routes)
│   │       ├── logger.ts      # Pino logger with deep secret redaction
│   │       ├── middleware/auth.ts   # API key auth (strict regex routing)
│   │       ├── plugins/
│   │       │   ├── session.ts # Server-managed session + CSRF plugin
│   │       │   ├── csrf.ts    # CSRF constant-time validation
│   │       │   ├── db.ts      # Prisma database plugin
│   │       │   └── rabbitmq.ts
│   │       ├── routes/
│   │       │   ├── tasks.ts   # Task CRUD (streaming upload)
│   │       │   └── events.ts  # SSE streaming (cookie auth)
│   │       ├── services/
│   │       │   ├── storage.ts # S3 streaming upload
│   │       │   └── rate-limit.ts # Durable PostgreSQL rate limiter
│   │       └── utils/         # Audio validation, error sanitizer, etc.
│   ├── worker/                # Background task processor
│   │   └── src/
│   │       ├── consumer.ts    # RabbitMQ consumer
│   │       ├── providers/     # STT/LLM providers with fallback
│   │       ├── processors/    # STT & LLM orchestration
│   │       ├── pipelines/secure-summary.ts  # Guarded summary pipeline
│   │       ├── verification/summary-verifier.ts # Deterministic verifier
│   │       └── utils/output-guard.ts  # LLM output redaction
│   └── frontend/              # React SPA (Vite)
│       └── src/
│           ├── api.ts         # API client (cookie + CSRF from cookie)
│           └── hooks/useSSE.ts
├── shared/
│   ├── constants.ts           # Shared types & constants
│   └── security/              # Shared redaction & secret patterns
├── docker-compose.yml
└── .env.example
```
