export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type TaskStep = 'stt' | 'llm' | null;

export interface SanitizedError {
  code: string;
  message: string;
}

export interface TaskResponse {
  id: string;
  status: TaskStatus;
  step: TaskStep;
  originalFilename: string;
  transcript: string | null;
  summary: string | null;
  error: SanitizedError | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface TaskCreateResponse {
  id: string;
  status: TaskStatus;
  originalFilename: string;
  createdAt: string;
}

export interface SSEEvent {
  event: 'status' | 'completed' | 'failed';
  data: {
    status: TaskStatus;
    step?: TaskStep;
    message?: string;
    transcript?: string;
    summary?: string;
    error?: SanitizedError;
  };
}

export interface QueueMessage {
  taskId: string;
}
