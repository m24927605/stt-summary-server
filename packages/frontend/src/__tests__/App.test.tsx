import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Mock the api module
vi.mock('../api', () => ({
  initSession: vi.fn(),
  getTasks: vi.fn().mockResolvedValue([]),
  getTask: vi.fn().mockResolvedValue(null),
}));

import App from '../App';
import { initSession, getTasks } from '../api';

const mockInitSession = vi.mocked(initSession);
const mockGetTasks = vi.mocked(getTasks);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetTasks.mockResolvedValue([]);
});

describe('App session gating', () => {
  it('shows "Initializing..." while session bootstrap is in progress', () => {
    // Never resolve — keep session pending
    mockInitSession.mockReturnValue(new Promise(() => {}));

    render(<App />);

    expect(screen.getByText('Initializing...')).toBeInTheDocument();
    expect(screen.queryByText(/Drag & drop/)).not.toBeInTheDocument();
  });

  it('shows UploadForm after session bootstrap succeeds', async () => {
    mockInitSession.mockResolvedValue(undefined);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Drag & drop audio file here/)).toBeInTheDocument();
    });

    expect(screen.queryByText('Initializing...')).not.toBeInTheDocument();
  });

  it('shows error message when session bootstrap fails', async () => {
    mockInitSession.mockRejectedValue(new Error('Failed to initialize session'));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to connect/)).toBeInTheDocument();
    });

    expect(screen.queryByText(/Drag & drop/)).not.toBeInTheDocument();
    expect(screen.queryByText('Initializing...')).not.toBeInTheDocument();
  });

  it('does not fetch tasks until session is ready', async () => {
    let resolveSession!: () => void;
    mockInitSession.mockReturnValue(new Promise<void>((resolve) => { resolveSession = resolve; }));

    render(<App />);

    // While session is pending, getTasks should not be called
    expect(mockGetTasks).not.toHaveBeenCalled();

    // Now resolve session
    resolveSession();

    await waitFor(() => {
      expect(mockGetTasks).toHaveBeenCalled();
    });
  });

  it('calls initSession exactly once on mount', async () => {
    mockInitSession.mockResolvedValue(undefined);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Drag & drop/)).toBeInTheDocument();
    });

    expect(mockInitSession).toHaveBeenCalledTimes(1);
  });
});
