import { FallbackProvider } from '../providers/fallback';
import { OpenAILLMProvider } from '../providers/openai-llm';
import { AnthropicLLMProvider } from '../providers/anthropic-llm';
import { isRetryableError } from '../utils/retry';
import { sanitizeTranscript } from '../utils/transcript-sanitizer';
import { LLMProvider } from '../providers/types';

const llmProvider = new FallbackProvider<LLMProvider>(
  new OpenAILLMProvider(),
  new AnthropicLLMProvider(),
  isRetryableError,
);

export async function summarizeText(transcript: string): Promise<string> {
  const sanitized = sanitizeTranscript(transcript);
  return llmProvider.execute((p) => p.summarize(sanitized));
}
