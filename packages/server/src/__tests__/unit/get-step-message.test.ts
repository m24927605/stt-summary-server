import { describe, it, expect } from 'vitest';
import { getStepMessage } from '../../utils/step-message';

describe('getStepMessage', () => {
  it('returns queued message for pending status', () => {
    expect(getStepMessage('pending', null)).toBe('Task queued, waiting to be processed...');
  });

  it('returns transcribing message for processing/stt', () => {
    expect(getStepMessage('processing', 'stt')).toBe('Transcribing audio...');
  });

  it('returns generating summary message for processing/llm', () => {
    expect(getStepMessage('processing', 'llm')).toBe('Generating summary...');
  });

  it('returns completed message', () => {
    expect(getStepMessage('completed', null)).toBe('Task completed');
  });

  it('returns failed message', () => {
    expect(getStepMessage('failed', null)).toBe('Task failed');
  });

  it('returns generic processing message when processing with no step', () => {
    expect(getStepMessage('processing', null)).toBe('Processing...');
  });

  it('returns generic processing message for unknown step', () => {
    expect(getStepMessage('processing', 'unknown')).toBe('Processing...');
  });
});
