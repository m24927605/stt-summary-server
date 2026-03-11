import { PrismaClient } from '@prisma/client';
import { sanitizeTranscript } from '../utils/transcript-sanitizer';
import { guardModelOutput } from '../utils/output-guard';
import { verifySummaryAgainstTranscript } from '../verification/summary-verifier';
import { summarizeText } from '../processors/llm';
import { logger } from '../logger';

export type FailureCategory =
  | 'stt_failed'
  | 'llm_failed'
  | 'summary_verification_failed'
  | 'processing_timeout'
  | 'processing_internal_error';

/**
 * Secure summary pipeline.
 *
 * Orchestrates:
 * 1. Transcript sanitization
 * 2. LLM summary generation
 * 3. Output guard (redaction of secrets from model output)
 * 4. Deterministic verification (numbers, URLs, secrets, length, emptiness)
 * 5. Guarded summary persistence (only if verification passes)
 */
export async function executeSecureSummaryPipeline(
  prisma: PrismaClient,
  taskId: string,
  transcript: string,
): Promise<void> {
  // Step 1: sanitize transcript
  const sanitizedTranscript = sanitizeTranscript(transcript);

  // Step 2: generate summary via LLM
  let rawSummary: string;
  try {
    rawSummary = await summarizeText(sanitizedTranscript);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await markTaskFailed(prisma, taskId, 'llm_failed', `LLM failed: ${errorMsg}`);
    throw err;
  }

  // Step 3: output guard
  const guardedSummary = guardModelOutput(rawSummary);

  // Step 4: deterministic verification
  const verification = verifySummaryAgainstTranscript(guardedSummary, sanitizedTranscript);

  if (!verification.isConsistent) {
    logger.warn(
      { taskId, issues: verification.issues },
      'Summary verification failed',
    );
    await markTaskFailed(
      prisma,
      taskId,
      'summary_verification_failed',
      `summary_verification_failed: ${verification.issues.join('; ')}`,
    );
    throw new Error(`Summary verification failed: ${verification.issues.join('; ')}`);
  }

  // Step 5: persist only guarded and verified summary
  await prisma.task.update({
    where: { id: taskId },
    data: {
      summary: guardedSummary,
      status: 'completed',
      step: null,
      completedAt: new Date(),
    },
  });

  logger.info({ taskId }, 'Task completed');
}

async function markTaskFailed(
  prisma: PrismaClient,
  taskId: string,
  category: FailureCategory,
  internalError: string,
): Promise<void> {
  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: 'failed',
      step: null,
      error: internalError,
    },
  });
}
