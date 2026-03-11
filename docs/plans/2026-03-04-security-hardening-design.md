# Security Hardening Design

## Context

Security review identified 8 issues (1 Critical, 3 High, 3 Medium, 1 Low) in the STT Summary Server. This document describes the fixes.

## Fixes

### 1. Critical: .env API Key Exposure

**Action**: Manual — rotate OpenAI API key. No code changes needed. `.env` is already in `.gitignore` and was never committed.

### 2. High: API Authentication

**Approach**: API Key middleware via `X-API-Key` header.

- New file `src/middleware/auth.ts` with Fastify `onRequest` hook
- Validates `X-API-Key` header against `API_KEY` environment variable
- Excludes `/api/health` from authentication
- Returns 401 Unauthorized if missing/invalid
- API key stored in AWS Secrets Manager, passed to ECS via secrets

**Why API Key over JWT**: This is a service-to-service or demo API. A full user system with JWT is over-engineering for the current use case.

### 3. High: Upload DoS (toBuffer)

**Approach**: Stream upload to S3 + rate limiting.

- Replace `data.toBuffer()` with `data.file` (ReadableStream)
- Use `@aws-sdk/lib-storage` `Upload` class for streaming multipart upload to S3
- Install `@fastify/rate-limit`:
  - Global: 100 requests/min/IP
  - Upload route: 10 requests/min/IP

### 4. High: Health Check Error Leakage

**Approach**: Return fixed error message externally, log details internally.

- Health check returns `{ status: "error" }` on failure (no error details)
- Full error logged via `app.log.error()`

### 5. Medium: IAM Long-Lived Access Keys → ECS Task Role

**Approach**: Remove IAM user/access key, use ECS Task Role for S3 access.

- Delete IAM user, access key, and s3-credentials secret from Terraform
- Remove `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` from ECS task definitions
- S3 SDK uses default credential chain (automatically picks up Task Role in ECS)
- For local dev with MinIO, keep optional env vars in `.env`
- Update `storage.ts` to conditionally configure S3 client credentials

### 6. Medium: Missing Security Headers

**Approach**: Add `@fastify/helmet` to Fastify app.

- Adds X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security, CSP, etc.
- Default Helmet config with CSP adjusted for SPA if needed

### 7. Medium: Container Running as Root

**Approach**: Add `USER node` to Server and Worker Dockerfiles.

- `node:alpine` images include a built-in `node` user (uid 1000)
- Add `USER node` before `CMD` in both Dockerfiles

### 8. Low: Dev Environment Default Passwords

**Approach**: Add `# DEV ONLY` comments to docker-compose.yml credentials.

- No password changes (local dev convenience)
- Clear annotations prevent accidental production use

## Files Changed

| File | Change |
|------|--------|
| `packages/server/src/middleware/auth.ts` | New — API Key validation hook |
| `packages/server/src/app.ts` | Add helmet, rate-limit, auth hook, fix health error |
| `packages/server/src/routes/tasks.ts` | Stream upload to S3 |
| `packages/server/src/services/storage.ts` | Stream upload + conditional credentials |
| `packages/server/Dockerfile` | Add `USER node` |
| `packages/worker/Dockerfile` | Add `USER node` |
| `terraform/s3.tf` | Remove IAM user/access key |
| `terraform/secrets.tf` | Remove s3-credentials, add api-key secret |
| `terraform/ecs.tf` | Remove S3 credential env vars, add API_KEY secret |
| `docker-compose.yml` | Add dev-only comments |
| `packages/server/package.json` | Add @fastify/helmet, @fastify/rate-limit, @aws-sdk/lib-storage |
