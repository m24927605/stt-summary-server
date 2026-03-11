# Security Architecture

Aligned with internal security standards.

## Authentication

Two auth models, enforced in `registerAuth` (`src/middleware/auth.ts`):

| Route | Auth | Note |
|-------|------|------|
| `GET /api/health` | Public | Strict regex, rejects `/api/healthz` etc. |
| `/api/tasks/**` | Cookie session | HttpOnly cookie + CSRF (state-changing) |
| Other `/api/*` | API key | `X-API-Key`, constant-time compare |

Route matching uses strict regex (`SESSION_PROTECTED_RE`, `HEALTH_RE`) to prevent prefix bypass.

## Session Management

Server-managed, stored in PostgreSQL. Frontend never generates session IDs.

**Lifecycle:**
1. **No cookie + safe method** → server creates session, sets `stt_session` (HttpOnly) + `csrf_token` (JS-readable) cookies
2. **Valid cookie** → validates: exists, not revoked, not expired, UA hash + IP prefix match
3. **Invalid cookie** → 401, cookie cleared, no auto-create
4. **No cookie + unsafe method** → 401 immediately

**Binding:** SHA-256(User-Agent) + IPv4 first-3-octets. Mismatch → 401.

**Scoping:** Session plugin runs only in the task/event route scope (`app.ts` scoped register), not on health or API-key routes.

### Session Rotation

Sessions rotate automatically after 24 hours (configurable via `ROTATION_THRESHOLD_MS`). TTL remains 30 days.

**Rotation flow (single Prisma `$transaction`):**
1. Create new session row with fresh CSRF token
2. Set old session `rotated_to` → new session ID
3. Mark old session `revoked = true`
4. Migrate all task ownership (`tasks.session_id`) to new session
5. Set updated `stt_session` + `csrf_token` cookies

**Ordering guarantee for unsafe methods:**
- CSRF token and Origin are validated **before** rotation executes
- If validation fails → 403, no state changes
- Safe methods (GET/HEAD/OPTIONS) rotate without CSRF check

**Frontend compatibility:**
- Frontend reads `csrf_token` from `document.cookie` on every unsafe request (not cached at init time)
- No page reload required after rotation

### Rotated Session Recovery

If a browser presents a stale `stt_session` cookie pointing to a revoked session that has a `rotated_to` value, limited recovery is available:

**Recovery scope:** `GET /api/tasks/session` only. All other routes reject revoked cookies immediately.

**Recovery flow:**
1. Session plugin detects revoked session with `rotated_to` set
2. `followRotationChain()` walks the `rotated_to` chain (max 8 hops, cycle-safe)
3. Target session must be active, not expired, and pass UA hash + IP prefix binding
4. On success: adopts target session, refreshes `stt_session` + `csrf_token` cookies
5. On failure: clears cookie, returns 401

**Security invariants preserved:**
- Unsafe methods (POST/PUT/DELETE) never follow rotation chains from revoked cookies
- Old CSRF tokens are never accepted for rotated sessions
- The browser must complete a bootstrap request before unsafe requests use the new session

## CSRF

Double-submit cookie pattern (POST/PUT/DELETE only):
- Server stores `csrfToken` in session, sets `csrf_token` cookie
- Frontend reads cookie via `getCookie()` utility and sends `X-CSRF-Token` header
- Server compares via `crypto.timingSafeEqual()`
- Origin header must match `config.corsOrigin`

## Task Ownership & SSE

All routes derive `sessionId` from cookie — never from headers or query strings.

- Ownership: `task.sessionId === request.sessionId`, else 404
- Rotation: tasks follow the session — ownership migrated atomically during rotation
- SSE: cookie-based auth (`withCredentials: true`), query string `sessionId` ignored
- SSE connection limit: max 5 per session

## Rate Limiting

Durable PostgreSQL-backed rate limiting via `rate_limit_entries` table. Survives process restarts, rolling deployments, and horizontal scaling.

| Endpoint | Limit | Window |
|----------|-------|--------|
| `GET /api/tasks/session` | 5/min | Per IP |
| `POST /api/tasks` | 10/min | Per IP |
| `GET /api/tasks` | 30/min | Per IP |
| `GET /api/tasks/:id` | 30/min | Per IP |
| `GET /api/tasks/:id/events` | 5/min | Per IP |
| `GET /api/health` | Exempt | — |

**Implementation:** Atomic upsert with fixed-window bucketing. Composite unique index on `(bucket, key, window_start)`. Probabilistic cleanup of stale rows (1% chance per check, 1h retention).

**IP source:** Direct connection IP only (`request.ip`). `X-Forwarded-For` is not trusted as a rate limit key.

## Upload Hardening

- No `toBuffer()` — stream-based processing only
- 16-byte head read for magic byte validation (WAV/MP3)
- Head prepended back via `PassThrough`, composite stream piped to S3
- File size limit enforced by `@fastify/multipart`

## Secure Summary Pipeline

Worker output is treated as untrusted. The summary pipeline (`packages/worker/src/pipelines/secure-summary.ts`) enforces:

1. **Transcript sanitization** — strip prompt injection patterns, truncate length
2. **LLM generation** — primary/fallback provider with timeout
3. **Output guard** (`packages/worker/src/utils/output-guard.ts`) — redacts API keys, Bearer tokens, session tokens, base64 blobs, query-string secrets. Replacement: `[REDACTED: sensitive content removed]`
4. **Deterministic verification** (`packages/worker/src/verification/summary-verifier.ts`) — checks:
   - Numbers in summary exist in transcript
   - No URLs absent from transcript
   - No secret-like patterns after guard
   - Not empty, not exceeding max length
5. **Persistence** — only guarded + verified summary is stored

**Failure handling:** Verification failure → task marked `failed` with machine-readable code (`summary_verification_failed`). Raw LLM output is never persisted.

## Worker Memory Safety

S3 downloads use a temp-file path, not whole-buffer:

1. `downloadToTempFile()` streams S3 object to OS temp directory (random filename)
2. STT providers receive file path, not Buffer
3. OpenAI provider: `createReadStream()` → `toFile()` (no full buffer)
4. Google provider: reads file to base64 within provider scope only (API requirement)
5. Temp file cleaned up in `finally` block (success and failure)
6. `downloadToTempFile()` self-cleans on download failure before re-throwing

## Log Redaction

Shared deep redaction (`shared/security/redaction.ts` + `shared/security/secret-patterns.ts`) used by both server and worker:
- Patterns: `sk-*` keys, Bearer tokens, `api_key=`, `sess-*`, sensitive query params
- Recursive traversal of nested objects, arrays, and serialized error objects
- Circular reference safe
- `app.ts` / worker logger both use `loggerOptions` with `redactDeep()`

## IAM Least Privilege

Server and worker run with separate ECS task roles:

| Role | Permissions |
|------|-------------|
| Server runtime | `s3:PutObject` on uploads bucket only |
| Worker runtime | `s3:GetObject` on uploads bucket only |
| Execution (shared) | ECR pull, Secrets Manager read, CloudWatch logs |

No wildcard S3 permissions. Runtime S3 access is not in the execution role.

## Error Sanitization

`sanitizeTaskError()` maps internal error strings to safe external codes:

| Internal pattern | External code |
|-----------------|---------------|
| STT failure | `transcription_failed` |
| LLM failure | `summarization_failed` |
| Verification failure | `summary_verification_failed` |
| Timeout | `processing_timeout` |
| Other | `processing_failed` |

Raw provider error strings are never exposed to clients via REST or SSE.

## Other Defenses

| Layer | Detail |
|-------|--------|
| Security headers | Helmet: CSP (`default-src 'self'`, `frame-ancestors 'none'`), `nosniff`, `strict-origin-when-cross-origin` |
| Request tracing | `X-Request-ID` forwarded or auto-generated |
| Frontend | No API key in build; `credentials: 'include'` on all fetch; CSRF token read from cookie on each mutation |

## Test Coverage

Integration tests (`security-stack.test.ts`) and unit tests verify the full security stack:

- Session cookie creation (HttpOnly) and CSRF cookie (JS-readable)
- Session rotation after 24h with atomic task migration
- Rotation blocked on CSRF/Origin failure for unsafe methods (no state change on 403)
- Safe methods rotate without CSRF check
- CSRF rejection: missing token, wrong token, wrong Origin → 403
- Session rejection: forged, revoked, expired, binding mismatch → 401
- POST without cookie → 401 (no session creation)
- Task isolation by session; SSE ignores query string
- Upload streaming (no `toBuffer()`, byte-identical content)
- Durable rate limiter: increment, reject, window alignment, per-key isolation
- Output guard redacts all required patterns
- Summary verifier rejects number drift, empty output, secret-like patterns
- Secure summary pipeline persists only guarded output; fails task on verification failure
- Temp file cleanup on success and failure paths
- Log redaction on nested objects (server and worker)
- Strict route matching (prefix bypass attempts rejected)
- Error sanitizer maps new failure categories correctly
- Frontend CSRF token updates after rotation without page reload
