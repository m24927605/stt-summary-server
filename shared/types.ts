export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type TaskStep = 'stt' | 'llm' | null;

export interface TaskResponse {
  id: string;
  status: TaskStatus;
  step: TaskStep;
  originalFilename: string;
  transcript: string | null;
  summary: string | null;
  error: string | null;
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
    error?: string;
  };
}

export interface QueueMessage {
  taskId: string;
}
