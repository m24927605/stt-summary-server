import { describe, it, expect, vi, beforeEach } from 'vitest';

// initSession uses module-level state, so we need a fresh module for each test
let initSession: () => Promise<void>;
let createTask: (file: File) => Promise<any>;
let getCookie: (name: string) => string;

beforeEach(async () => {
  vi.restoreAllMocks();
  // Reset module to clear singleton state
  vi.resetModules();
  // Reset document.cookie
  Object.defineProperty(document, 'cookie', {
    writable: true,
    value: '',
  });
  const mod = await import('../api');
  initSession = mod.initSession;
  createTask = mod.createTask;
  getCookie = mod.getCookie;
});

describe('initSession', () => {
  it('calls GET /api/tasks/session and sets session cookie', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal('fetch', mockFetch);

    await initSession();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith('/api/tasks/session', {
      credentials: 'include',
    });
  });

  it('singleton: concurrent calls share the same promise and only fetch once', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal('fetch', mockFetch);

    const [r1, r2, r3] = await Promise.all([initSession(), initSession(), initSession()]);

    expect(r1).toBeUndefined();
    expect(r2).toBeUndefined();
    expect(r3).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries once on 401 and succeeds', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'Session expired' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });
    vi.stubGlobal('fetch', mockFetch);

    await initSession();

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('singleton holds during 401 retry — no concurrent callers can start a second bootstrap', async () => {
    let resolveFetch!: (value: unknown) => void;
    const slowFetch = new Promise((resolve) => { resolveFetch = resolve; });

    const mockFetch = vi.fn()
      .mockReturnValueOnce(slowFetch)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });
    vi.stubGlobal('fetch', mockFetch);

    const p1 = initSession();
    const p2 = initSession();

    // Both should be waiting on the same promise
    resolveFetch({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'Session expired' }),
    });

    await Promise.all([p1, p2]);

    // Only 2 fetches: initial + retry, not 3 (no extra from p2)
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws and resets singleton when both attempts fail', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'Session expired' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'Session expired' }),
      });
    vi.stubGlobal('fetch', mockFetch);

    await expect(initSession()).rejects.toThrow('Failed to initialize session');

    // Singleton should be reset — a new call should start a new fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await initSession();
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('throws on non-401 error without retrying', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Internal server error' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(initSession()).rejects.toThrow('Failed to initialize session');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('getCookie', () => {
  it('reads a cookie value by name', () => {
    Object.defineProperty(document, 'cookie', {
      writable: true,
      value: 'csrf_token=abc123; other=xyz',
    });
    expect(getCookie('csrf_token')).toBe('abc123');
  });

  it('returns empty string when cookie is not present', () => {
    Object.defineProperty(document, 'cookie', {
      writable: true,
      value: 'other=xyz',
    });
    expect(getCookie('csrf_token')).toBe('');
  });
});

describe('createTask CSRF token from cookie', () => {
  it('sends CSRF token from cookie on POST after init', async () => {
    Object.defineProperty(document, 'cookie', {
      writable: true,
      value: 'csrf_token=initial-token-from-server',
    });

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) }) // initSession
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'task-1' }) }); // createTask
    vi.stubGlobal('fetch', mockFetch);

    await initSession();
    await createTask(new File(['audio'], 'test.wav'));

    const postCall = mockFetch.mock.calls[1];
    expect(postCall[1].headers['X-CSRF-Token']).toBe('initial-token-from-server');
  });

  it('picks up rotated CSRF token from cookie without page reload', async () => {
    Object.defineProperty(document, 'cookie', {
      writable: true,
      value: 'csrf_token=old-token',
    });

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) }) // initSession
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'task-1' }) }) // createTask #1
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'task-2' }) }); // createTask #2
    vi.stubGlobal('fetch', mockFetch);

    await initSession();

    // First POST with old token
    await createTask(new File(['audio'], 'test1.wav'));
    expect(mockFetch.mock.calls[1][1].headers['X-CSRF-Token']).toBe('old-token');

    // Simulate server rotation: cookie is updated (browser does this automatically via Set-Cookie)
    Object.defineProperty(document, 'cookie', {
      writable: true,
      value: 'csrf_token=new-rotated-token',
    });

    // Second POST should use the new token from cookie, not the old one
    await createTask(new File(['audio'], 'test2.wav'));
    expect(mockFetch.mock.calls[2][1].headers['X-CSRF-Token']).toBe('new-rotated-token');
  });
});
