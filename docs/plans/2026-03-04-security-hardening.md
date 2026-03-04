# Security Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 8 security issues identified in code review — API auth, upload DoS, error leakage, security headers, Dockerfile hardening, Terraform IAM cleanup.

**Architecture:** Add API Key middleware to all `/api/*` routes (except health). Replace buffer upload with streaming to S3. Add Helmet and rate limiting. Remove IAM user in favor of ECS Task Role. Harden Dockerfiles with non-root user.

**Tech Stack:** Fastify, @fastify/helmet, @fastify/rate-limit, @aws-sdk/lib-storage, Terraform, Docker

---

### Task 1: Add @fastify/helmet security headers

**Files:**
- Modify: `packages/server/src/app.ts:1-4` (add import)
- Modify: `packages/server/src/app.ts:16` (register helmet before cors)
- Test: `packages/server/src/__tests__/integration/health-route.test.ts`

**Step 1: Install dependency**

Run: `npm install @fastify/helmet --workspace=packages/server`

**Step 2: Write failing test**

In `packages/server/src/__tests__/integration/health-route.test.ts`, add a test:

```typescript
it('includes security headers', async () => {
  const app = await buildApp();
  const response = await app.inject({ method: 'GET', url: '/api/health' });
  expect(response.headers['x-content-type-options']).toBe('nosniff');
  expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
  await app.close();
});
```

Run: `npm run test --workspace=packages/server -- src/__tests__/integration/health-route.test.ts`
Expected: FAIL — headers not present

**Step 3: Register helmet in app.ts**

In `packages/server/src/app.ts`, add import and register:

```typescript
import helmet from '@fastify/helmet';
```

Register before CORS (after line 14):
```typescript
await app.register(helmet, {
  contentSecurityPolicy: false, // SPA handles its own CSP
});
```

**Step 4: Run test to verify pass**

Run: `npm run test --workspace=packages/server -- src/__tests__/integration/health-route.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/app.ts packages/server/package.json package-lock.json packages/server/src/__tests__/integration/health-route.test.ts
git commit -m "security: add @fastify/helmet for security headers"
```

---

### Task 2: Fix health check error leakage

**Files:**
- Modify: `packages/server/src/app.ts:39-43`
- Test: `packages/server/src/__tests__/integration/health-route.test.ts`

**Step 1: Write failing test**

In `health-route.test.ts`, add:

```typescript
it('does not leak error details when DB is down', async () => {
  mockQueryRaw.mockRejectedValueOnce(new Error('FATAL: password authentication failed'));
  const app = await buildApp();
  const response = await app.inject({ method: 'GET', url: '/api/health' });
  expect(response.statusCode).toBe(503);
  const body = response.json();
  expect(body.status).toBe('error');
  expect(body).not.toHaveProperty('error');
  expect(JSON.stringify(body)).not.toContain('FATAL');
  await app.close();
});
```

Run: `npm run test --workspace=packages/server -- src/__tests__/integration/health-route.test.ts`
Expected: FAIL — currently returns `{ status: 'degraded', error: '...' }`

**Step 2: Fix health check in app.ts**

Replace lines 39-44 in `app.ts`:

```typescript
    } catch (err) {
      app.log.error(err, 'Health check failed');
      return reply.status(503).send({ status: 'error' });
    }
```

**Step 3: Run test**

Run: `npm run test --workspace=packages/server -- src/__tests__/integration/health-route.test.ts`
Expected: PASS

**Step 4: Update existing test if needed**

If the existing test checks for `status: 'degraded'`, update it to `status: 'error'`.

**Step 5: Commit**

```bash
git add packages/server/src/app.ts packages/server/src/__tests__/integration/health-route.test.ts
git commit -m "security: remove error details from health check response"
```

---

### Task 3: Add API Key authentication middleware

**Files:**
- Create: `packages/server/src/middleware/auth.ts`
- Modify: `packages/server/src/app.ts` (register auth hook)
- Modify: `packages/server/src/config.ts` (add apiKey)
- Test: `packages/server/src/__tests__/unit/auth.test.ts`

**Step 1: Write failing test**

Create `packages/server/src/__tests__/unit/auth.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

vi.mock('../../plugins/db', () => ({
  getDb: () => ({ $queryRaw: vi.fn().mockResolvedValue([1]), task: {} }),
  disconnectDb: vi.fn(),
}));

vi.mock('../../plugins/rabbitmq', () => ({
  connectQueue: vi.fn(async () => undefined),
  disconnectQueue: vi.fn(async () => undefined),
  publishTask: vi.fn(),
}));

vi.mock('../../config', () => ({
  config: {
    corsOrigin: '*',
    apiKey: 'test-secret-key',
    s3Endpoint: '',
    s3Bucket: 'test',
    s3Region: 'auto',
    s3AccessKeyId: '',
    s3SecretAccessKey: '',
  },
}));

import { registerAuth } from '../../middleware/auth';

describe('API Key auth middleware', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    registerAuth(app);
    app.get('/api/test', async () => ({ ok: true }));
    app.get('/api/health', async () => ({ status: 'ok' }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('allows requests with valid API key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/test',
      headers: { 'x-api-key': 'test-secret-key' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects requests without API key', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/test' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Missing or invalid API key' });
  });

  it('rejects requests with wrong API key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/test',
      headers: { 'x-api-key': 'wrong-key' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('allows health check without API key', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
  });
});
```

Run: `npm run test --workspace=packages/server -- src/__tests__/unit/auth.test.ts`
Expected: FAIL — module not found

**Step 2: Implement auth middleware**

Create `packages/server/src/middleware/auth.ts`:

```typescript
import { FastifyInstance } from 'fastify';
import { config } from '../config';

export function registerAuth(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/api/health') return;
    if (!config.apiKey) return; // skip auth if no key configured (dev mode)

    const key = request.headers['x-api-key'];
    if (key !== config.apiKey) {
      return reply.status(401).send({ error: 'Missing or invalid API key' });
    }
  });
}
```

**Step 3: Add apiKey to config.ts**

In `packages/server/src/config.ts`, add:

```typescript
apiKey: env.API_KEY || '',
```

**Step 4: Register in app.ts**

In `packages/server/src/app.ts`, import and call after helmet:

```typescript
import { registerAuth } from './middleware/auth';
```

After the multipart registration:
```typescript
registerAuth(app);
```

**Step 5: Run all tests**

Run: `npm run test --workspace=packages/server`
Expected: PASS (existing tests use inject which bypasses auth, or mock config with no apiKey)

**Step 6: Commit**

```bash
git add packages/server/src/middleware/auth.ts packages/server/src/config.ts packages/server/src/app.ts packages/server/src/__tests__/unit/auth.test.ts
git commit -m "security: add API Key authentication middleware"
```

---

### Task 4: Add rate limiting

**Files:**
- Modify: `packages/server/src/app.ts` (register rate-limit)

**Step 1: Install dependency**

Run: `npm install @fastify/rate-limit --workspace=packages/server`

**Step 2: Register in app.ts**

```typescript
import rateLimit from '@fastify/rate-limit';
```

Register after helmet:
```typescript
await app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
});
```

**Step 3: Run tests**

Run: `npm run test --workspace=packages/server`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/server/src/app.ts packages/server/package.json package-lock.json
git commit -m "security: add rate limiting (100 req/min/IP)"
```

---

### Task 5: Stream upload to S3 (fix toBuffer DoS)

**Files:**
- Modify: `packages/server/src/routes/tasks.ts:24,32` (use stream)
- Modify: `packages/server/src/services/storage.ts` (accept stream, use Upload)
- Test: `packages/server/src/__tests__/unit/storage.test.ts`
- Test: `packages/server/src/__tests__/integration/tasks-routes.test.ts`

**Step 1: Install dependency**

Run: `npm install @aws-sdk/lib-storage --workspace=packages/server`

**Step 2: Write failing test for stream saveFile**

In `packages/server/src/__tests__/unit/storage.test.ts`, add test for stream upload:

```typescript
it('saveFileStream uploads a readable stream to S3', async () => {
  const { Readable } = await import('stream');
  const stream = Readable.from(Buffer.from('audio data'));
  const key = await saveFileStream(stream, 'test.wav');
  expect(key).toMatch(/^uploads\/.*\.wav$/);
});
```

Run: `npm run test --workspace=packages/server -- src/__tests__/unit/storage.test.ts`
Expected: FAIL — saveFileStream not found

**Step 3: Implement saveFileStream in storage.ts**

```typescript
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';

export async function saveFileStream(stream: Readable, originalFilename: string): Promise<string> {
  const ext = path.extname(originalFilename);
  const key = `uploads/${uuidv4()}${ext}`;
  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: config.s3Bucket,
      Key: key,
      Body: stream,
    },
  });
  await upload.done();
  return key;
}
```

**Step 4: Update tasks.ts to use stream**

Replace the buffer-based flow in `tasks.ts`. The magic bytes validation needs a small prefix read:

```typescript
import { Readable } from 'stream';

// Inside POST handler, replace lines 24-32:
const chunks: Buffer[] = [];
let totalSize = 0;
const HEADER_SIZE = 12; // enough for magic bytes

for await (const chunk of data.file) {
  chunks.push(chunk);
  totalSize += chunk.length;
  if (totalSize >= HEADER_SIZE) break;
}

const headerBuffer = Buffer.concat(chunks).subarray(0, HEADER_SIZE);
if (!isValidAudioMagicBytes(headerBuffer)) {
  return reply.status(400).send({
    error: 'Invalid file content: file does not appear to be a valid WAV or MP3 audio file',
  });
}

// Re-assemble stream: header chunks + remaining file stream
const fullStream = Readable.from(
  (async function* () {
    for (const chunk of chunks) yield chunk;
    for await (const chunk of data.file) yield chunk;
  })()
);

const filePath = await saveFileStream(fullStream, data.filename);
```

**Step 5: Run all tests**

Run: `npm run test --workspace=packages/server`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/server/src/routes/tasks.ts packages/server/src/services/storage.ts packages/server/package.json package-lock.json packages/server/src/__tests__/unit/storage.test.ts
git commit -m "security: stream file uploads to S3 instead of buffering"
```

---

### Task 6: S3 credential chain (remove hardcoded credentials)

**Files:**
- Modify: `packages/server/src/config.ts` (make S3 keys optional)
- Modify: `packages/server/src/services/storage.ts` (conditional credentials)
- Modify: `packages/worker/src/config.ts` (make S3 keys optional)
- Modify: `packages/worker/src/services/storage.ts` (conditional credentials)

**Step 1: Update server storage.ts**

Replace the S3 client initialization:

```typescript
const s3Client = new S3Client({
  region: config.s3Region,
  ...(config.s3Endpoint && { endpoint: config.s3Endpoint, forcePathStyle: true }),
  ...(config.s3AccessKeyId && config.s3SecretAccessKey && {
    credentials: {
      accessKeyId: config.s3AccessKeyId,
      secretAccessKey: config.s3SecretAccessKey,
    },
  }),
});
```

This uses explicit credentials only when provided (local MinIO). On AWS ECS, SDK auto-discovers Task Role credentials.

**Step 2: Update worker storage.ts**

Same change as server.

**Step 3: Run all tests**

Run: `npm test`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/server/src/services/storage.ts packages/worker/src/services/storage.ts
git commit -m "security: use credential chain for S3, support Task Role"
```

---

### Task 7: Harden Dockerfiles (non-root user)

**Files:**
- Modify: `packages/server/Dockerfile:33-35`
- Modify: `packages/worker/Dockerfile:33`

**Step 1: Update server Dockerfile**

Before the `CMD` line, add:
```dockerfile
USER node
```

Also change the uploads dir ownership:
```dockerfile
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
```

**Step 2: Update worker Dockerfile**

Before the `CMD` line, add:
```dockerfile
USER node
```

**Step 3: Verify docker build**

Run: `docker build -f packages/server/Dockerfile -t test-server . && docker build -f packages/worker/Dockerfile -t test-worker .`
Expected: Both build successfully

**Step 4: Commit**

```bash
git add packages/server/Dockerfile packages/worker/Dockerfile
git commit -m "security: run containers as non-root user"
```

---

### Task 8: Terraform — remove IAM user, add API key secret

**Files:**
- Modify: `terraform/s3.tf` (remove IAM user/key resources)
- Modify: `terraform/secrets.tf` (remove s3-credentials, add api-key)
- Modify: `terraform/ecs.tf` (remove S3 credential env vars, add API_KEY)
- Modify: `terraform/iam.tf` (if needed)
- Modify: `terraform/variables.tf` (add api_key variable)

**Step 1: Remove IAM user from s3.tf**

Delete resources: `aws_iam_user.s3_user`, `aws_iam_user_policy.s3_user`, `aws_iam_access_key.s3_user` (lines 47-73).

**Step 2: Update secrets.tf**

Remove `aws_secretsmanager_secret.s3_credentials` and its version.

Add API key secret:
```hcl
resource "aws_secretsmanager_secret" "api_key" {
  name = "${var.project_name}/api-key"
  tags = { Name = "${var.project_name}-api-key" }
}

resource "aws_secretsmanager_secret_version" "api_key" {
  secret_id     = aws_secretsmanager_secret.api_key.id
  secret_string = var.api_key
}
```

**Step 3: Add api_key variable to variables.tf**

```hcl
variable "api_key" {
  description = "API key for authenticating requests"
  type        = string
  sensitive   = true
}
```

**Step 4: Update ecs.tf**

Remove from server and worker secrets:
```
{ name = "S3_ACCESS_KEY_ID", valueFrom = "..." },
{ name = "S3_SECRET_ACCESS_KEY", valueFrom = "..." },
```

Add to server secrets:
```hcl
{ name = "API_KEY", valueFrom = aws_secretsmanager_secret.api_key.arn },
```

**Step 5: Update IAM execution role in iam.tf**

Add the new api-key secret ARN to the secrets access policy. Remove s3-credentials ARN.

**Step 6: Validate**

Run: `cd terraform && terraform validate`
Expected: Success

**Step 7: Commit**

```bash
git add terraform/s3.tf terraform/secrets.tf terraform/ecs.tf terraform/variables.tf terraform/iam.tf
git commit -m "security: remove IAM user, use Task Role for S3, add API key secret"
```

---

### Task 9: Add dev-only comments to docker-compose.yml

**Files:**
- Modify: `docker-compose.yml`

**Step 1: Add comments**

Add `# DEV ONLY — do not use in production` before each credentials section:
- Line 4-6 (postgres credentials)
- Line 38-39 (minio credentials)
- Line 55 (minio-init credentials)
- Line 67 (rabbitmq URL with guest:guest)
- Line 74-75 (S3 access keys)
- Line 90 (rabbitmq URL)
- Line 97-98 (S3 access keys)

**Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: add dev-only annotations to docker-compose credentials"
```

---

### Task 10: Run full test suite and verify

**Step 1: Run all tests**

Run: `npm test`
Expected: All 84+ tests pass

**Step 2: Terraform validate**

Run: `cd terraform && terraform validate`
Expected: Success

**Step 3: Docker build test**

Run: `docker build -f packages/server/Dockerfile -t test-server . && docker build -f packages/worker/Dockerfile -t test-worker .`
Expected: Both build successfully

**Step 4: Final commit if any fixups needed**

---

### Task 11: Terraform apply and redeploy

**Step 1: Generate API key**

Run: `openssl rand -hex 32` — save this to `terraform.tfvars` as `api_key`.

**Step 2: Terraform apply**

Run: `cd terraform && terraform apply -auto-approve`

Note: This will destroy the IAM user/access key and s3-credentials secret. ECS tasks will use Task Role for S3 access instead.

**Step 3: Force new ECS deployment**

```bash
aws ecs update-service --cluster stt-summary-cluster --service stt-summary-server --force-new-deployment
aws ecs update-service --cluster stt-summary-cluster --service stt-summary-worker --force-new-deployment
```

**Step 4: Verify**

```bash
# Without API key — should get 401
curl -s https://voicebrief.xyz/api/tasks

# With API key — should get 200
curl -s -H "X-API-Key: <your-key>" https://voicebrief.xyz/api/tasks

# Health check — should work without key
curl -s https://voicebrief.xyz/api/health
```
