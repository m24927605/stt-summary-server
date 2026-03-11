# VoiceBrief Slides Design Spec

## Overview
Create a Reveal.js presentation at `packages/frontend/public/slides/index.html` showcasing the STT Summary Server (VoiceBrief) as a Backend Engineer portfolio piece. Visual style cloned from vulcanchat.xyz/slides.

## Technical Approach
- Single static HTML file in `packages/frontend/public/slides/`
- Reveal.js 5.1.0 via CDN
- Same CSS variables, fonts (Space Grotesk + Noto Sans TC), and component classes as Vulcan slides
- No build step, no React integration — Nginx serves as static file
- Dark theme (#0a0f14 bg), accent blue/cyan/amber/green palette

## Slide Structure (13 slides)

### 1. Hero
- Kicker: "Backend Engineer 作品集"
- H1: "VoiceBrief"
- Subtitle: production mindset 語音轉文字摘要服務
- Pills: Fastify + RabbitMQ, Streaming Upload, SSE Real-time, Multi-Provider Fallback
- Footer: voicebrief.xyz

### 2. 專案定位 — 我做了什麼
- grid-3, 6 cards: 大檔案上傳, 長時間處理, 即時回饋, 單點故障, Session 安全, Rate Limiting

### 3. 系統設計 — Producer-Consumer 架構
- 7-step flow: Upload → Fastify Validation → S3 Storage → RabbitMQ Queue → Worker: STT → Worker: LLM Summary → SSE Push
- Banner: shared pipeline

### 4. 串流上傳 — Streaming Upload
- grid-2: Magic byte validation / S3 streaming
- Banner: supported formats

### 5. 安全設計 — Session & Security
- summary-grid 6 items: CSRF, HttpOnly cookie, UA/IP binding, API key auth, Error sanitization, Request ID tracing

### 6. 任務隔離 — Session-Based Task Isolation
- grid-2: Scoped plugin / Atomic session rotation
- Banner: session scope enforcement

### 7. 即時串流 — Server-Sent Events
- grid-2: SSE implementation / Frontend useSSE hook
- Banner: auto-reconnect

### 8. 容錯設計 — Multi-Provider Fallback
- grid-2: STT (OpenAI→Google) / LLM (GPT→Anthropic)
- Banner: cascading trigger conditions

### 9. 資料層 — PostgreSQL + Prisma
- grid-2: Schema design / Rate limiting persistence
- Banner: Prisma migration

### 10. 基礎建設 — Infrastructure
- grid-3: Docker Compose / AWS ECS+RDS+S3 / GitHub Actions CI/CD

### 11. 技術棧 — Tech Stack
- grid-3, 6 cards: API Server, Worker, Frontend, Database, Storage, Infra

### 12. Demo — 示範情境
- grid-2, 4 cards: upload, SSE progress, results, fallback

### 13. 總結 — Summary
- grid-3: Backend Architecture, Security & Isolation, Reliability & Ops
- Hero card one-liner
- GitHub link

## CSS Components (from Vulcan reference)
All CSS classes reused: slide-shell, hero, hero-card, kicker, pill-row, pill, grid-2, grid-3, card, stat-card, flow, flow-step, compare, banner, warn, subtle, list-tight, summary-grid, summary-item, data-grid, data-list

## Reveal.js Config
```js
Reveal.initialize({
  hash: true,
  slideNumber: "c/t",
  transition: "fade",
  backgroundTransition: "fade",
  width: 1280,
  height: 760,
  margin: 0.06,
});
```
