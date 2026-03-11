# LLM & STT Fallback Provider Design

## Goal

When OpenAI API fails (timeout, 5xx, 429), automatically fall back to alternative providers: Anthropic for LLM summarization, Google Cloud Speech-to-Text for STT.

## Approach

Abstract Provider layer with generic FallbackProvider wrapper. Each capability (STT, LLM) has a typed interface, with OpenAI as primary and Anthropic/Google as fallback.

## Architecture

```
FallbackSTTProvider
  ├── OpenAISTTProvider (primary)
  └── GoogleSTTProvider (fallback)

FallbackLLMProvider
  ├── OpenAILLMProvider (primary)
  └── AnthropicLLMProvider (fallback)
```

## Interfaces

```typescript
interface STTProvider {
  name: string;
  transcribe(buffer: Buffer, filename: string): Promise<string>;
}

interface LLMProvider {
  name: string;
  summarize(transcript: string): Promise<string>;
}
```

## FallbackProvider

Generic wrapper that tries primary, then fallback on retryable errors:

```typescript
class FallbackProvider<T extends { name: string }> {
  constructor(
    private primary: T,
    private fallback: T,
    private isRetryableError: (err: unknown) => boolean
  ) {}

  async execute<R>(fn: (provider: T) => Promise<R>): Promise<R> {
    try {
      return await fn(this.primary);
    } catch (err) {
      if (this.isRetryableError(err)) {
        logger.warn({ provider: this.primary.name, err }, 'Primary provider failed, falling back');
        return await fn(this.fallback);
      }
      throw err;
    }
  }
}
```

## Fallback Trigger Conditions

Reuse existing `isRetryableError()` from `utils/retry.ts`:
- AbortError (timeout)
- HTTP 5xx
- HTTP 429 (rate limit)

4xx client errors (401, 400) do NOT trigger fallback — they throw immediately.

## Provider Implementations

### OpenAISTTProvider
- Uses `openai.audio.transcriptions.create()` with 60s timeout
- Existing logic from current `stt.ts`

### GoogleSTTProvider
- Uses Google Cloud Speech-to-Text REST API via API key
- Sends audio buffer as base64 encoded content
- Configurable language via `GOOGLE_STT_LANGUAGE` (default: `zh-TW`)

### OpenAILLMProvider
- Uses `openai.chat.completions.create()` with 30s timeout
- Existing logic from current `llm.ts`
- Includes transcript sanitization

### AnthropicLLMProvider
- Uses `@anthropic-ai/sdk` with `claude-sonnet-4-6`
- 30s timeout
- Same system prompt and transcript sanitization as OpenAI

## New File Structure

```
packages/worker/src/
  providers/
    types.ts              — STTProvider, LLMProvider interfaces
    fallback.ts           — FallbackProvider<T> generic class
    openai-stt.ts         — OpenAISTTProvider
    google-stt.ts         — GoogleSTTProvider
    openai-llm.ts         — OpenAILLMProvider
    anthropic-llm.ts      — AnthropicLLMProvider
```

## Modified Files

- `processors/stt.ts` — use FallbackProvider<STTProvider>
- `processors/llm.ts` — use FallbackProvider<LLMProvider>
- `config.ts` — add new env vars
- `package.json` — add @anthropic-ai/sdk dependency

## New Environment Variables

```
ANTHROPIC_API_KEY=           # Required for LLM fallback
ANTHROPIC_MODEL=claude-sonnet-4-6  # Default model
GOOGLE_API_KEY=              # Required for STT fallback
GOOGLE_STT_LANGUAGE=zh-TW   # Default language code
```

## Fallback Flow

```
STT: OpenAI Whisper → fail (timeout/5xx/429) → Google Cloud STT → fail → throw error → worker retry
LLM: OpenAI GPT-4o → fail (timeout/5xx/429) → Anthropic Claude → fail → throw error → worker retry
```

Each attempt tries at most 2 providers. If both fail, the error propagates to the existing worker retry mechanism (exponential backoff, max 3 attempts).
