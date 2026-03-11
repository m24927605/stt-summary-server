export const TASK_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export const TASK_STEP = {
  STT: 'stt',
  LLM: 'llm',
} as const;

export const QUEUE_NAME = 'task_queue';
export const DEAD_LETTER_QUEUE = 'task_queue_dlq';
export const MAX_RETRIES = 3;
export const ALLOWED_MIMETYPES = ['audio/wav', 'audio/mpeg', 'audio/mp3', 'audio/wave', 'audio/x-wav'];
export const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB (OpenAI Whisper limit)
