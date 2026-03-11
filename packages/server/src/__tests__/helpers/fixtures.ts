export function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test-task-id-1',
    status: 'pending',
    step: null,
    originalFilename: 'recording.wav',
    sessionId: 'test-session-id',
    filePath: './uploads/abc-123.wav',
    transcript: null,
    summary: null,
    error: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    completedAt: null,
    ...overrides,
  };
}
