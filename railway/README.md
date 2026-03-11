# Railway Deployment Guide

Deploy the STT Summary Server on [Railway](https://railway.app) with managed PostgreSQL, CloudAMQP for RabbitMQ, and Cloudflare R2 for object storage.

## Architecture

```
Railway Project
├── PostgreSQL          (Railway Plugin — managed)
├── RabbitMQ            (CloudAMQP Plugin — managed)
├── Server              (ghcr.io Docker image, port 3000)
├── Worker              (ghcr.io Docker image, no port)
└── Frontend            (ghcr.io Docker image, port 8080)

External:
└── Cloudflare R2       (S3-compatible object storage)
```

## Prerequisites

- Railway account (Hobby plan, $5/month)
- GitHub account with access to `ghcr.io/m24927605/stt-summary-server/*` images
- Cloudflare account (R2 free tier: 10 GB storage, 10M reads/month)
- OpenAI API key

---

## Step 1: Create Railway Project

1. Go to [railway.app](https://railway.app) and sign in
2. Click **"New Project"** → **"Empty Project"**
3. Name it `stt-summary-server`

## Step 2: Add PostgreSQL

1. In the project, click **"New"** → **"Database"** → **"PostgreSQL"**
2. Railway auto-provisions PostgreSQL and provides `DATABASE_URL` as a reference variable
3. No further configuration needed

## Step 3: Add RabbitMQ (CloudAMQP)

**Option A — CloudAMQP Plugin (recommended):**
1. Click **"New"** → **"Add a Plugin"** → search **"CloudAMQP"**
2. Select the **"Little Lemur"** free plan (1M messages/month)
3. The plugin provides `CLOUDAMQP_URL` — this maps to `RABBITMQ_URL`

**Option B — Self-hosted Docker:**
1. Click **"New"** → **"Docker Image"**
2. Image: `rabbitmq:3-management-alpine`
3. Use the service's internal domain as `RABBITMQ_URL`:
   ```
   amqp://guest:guest@<rabbitmq-service>.railway.internal:5672
   ```

## Step 4: Set Up Cloudflare R2

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Go to **R2 Object Storage** → **Create Bucket**
3. Bucket name: `stt-uploads`
4. Go to **R2** → **Manage R2 API Tokens** → **Create API Token**
   - Permissions: **Object Read & Write**
   - Specify bucket: `stt-uploads`
5. Note the following values:
   - **S3 API Endpoint**: `https://<account-id>.r2.cloudflarestorage.com`
   - **Access Key ID**
   - **Secret Access Key**

## Step 5: Deploy Server

1. Click **"New"** → **"Docker Image"**
2. Image: `ghcr.io/m24927605/stt-summary-server/server:latest`
3. Since the image is **private**, configure GHCR credentials:
   - Go to service **Settings** → **Source** → set registry credentials
   - Username: your GitHub username
   - Password: GitHub PAT with `read:packages` scope
4. Add **environment variables**:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `RABBITMQ_URL` | `${{CloudAMQP.CLOUDAMQP_URL}}` |
| `SERVER_PORT` | `3000` |
| `CORS_ORIGIN` | `https://<frontend-domain>.up.railway.app` (update after Step 7) |
| `S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `S3_BUCKET` | `stt-uploads` |
| `S3_REGION` | `auto` |
| `S3_ACCESS_KEY_ID` | `<r2-access-key>` |
| `S3_SECRET_ACCESS_KEY` | `<r2-secret-key>` |

5. Go to **Settings** → **Networking** → **Generate Domain**
6. Note the generated URL (e.g., `server-xxxx.up.railway.app`)

> The server runs `npx prisma migrate deploy` on startup, so database migration is automatic.

## Step 6: Deploy Worker

1. Click **"New"** → **"Docker Image"**
2. Image: `ghcr.io/m24927605/stt-summary-server/worker:latest`
3. Configure GHCR credentials (same as Step 5)
4. Add **environment variables**:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `RABBITMQ_URL` | `${{CloudAMQP.CLOUDAMQP_URL}}` |
| `OPENAI_API_KEY` | `sk-...` |
| `WHISPER_MODEL` | `whisper-1` |
| `GPT_MODEL` | `gpt-4o` |
| `S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `S3_BUCKET` | `stt-uploads` |
| `S3_REGION` | `auto` |
| `S3_ACCESS_KEY_ID` | `<r2-access-key>` |
| `S3_SECRET_ACCESS_KEY` | `<r2-secret-key>` |

5. **Do NOT** generate a public domain — the worker has no HTTP port

## Step 7: Deploy Frontend

1. Click **"New"** → **"Docker Image"**
2. Image: `ghcr.io/m24927605/stt-summary-server/frontend:latest`
3. Configure GHCR credentials (same as Step 5)
4. Add **environment variables**:

| Variable | Value |
|----------|-------|
| `API_HOST` | `<server-service>.railway.internal` |
| `API_PORT` | `3000` |

> The frontend uses Railway's private networking to proxy `/api` requests to the server.

5. Go to **Settings** → **Networking** → **Generate Domain**
6. Note the generated URL (e.g., `frontend-xxxx.up.railway.app`)

## Step 8: Update CORS

Go back to the **Server** service and update:
```
CORS_ORIGIN=https://<frontend-domain>.up.railway.app
```

## Step 9: Verify

1. Open the frontend URL in your browser
2. Upload an audio file (WAV or MP3, < 25 MB)
3. Watch the real-time SSE progress:
   - "Transcribing audio..."
   - "Generating summary..."
   - "Task completed"
4. Verify the transcript and summary are displayed

## Troubleshooting

- **502 Bad Gateway**: Check that the server service is running and the domain is generated
- **CORS errors**: Verify `CORS_ORIGIN` matches the frontend URL exactly (including `https://`)
- **Worker not processing**: Check worker logs — verify `RABBITMQ_URL` and `OPENAI_API_KEY` are set
- **S3 upload fails**: Verify R2 credentials and that the bucket name matches `S3_BUCKET`

## Estimated Cost

| Service | Cost |
|---------|------|
| Railway Hobby Plan | $5/month + usage |
| PostgreSQL | ~$5/month |
| CloudAMQP (Little Lemur) | Free |
| Cloudflare R2 | Free tier (10 GB) |
| OpenAI API | Pay per use |
| **Total** | **~$10-20/month** |
