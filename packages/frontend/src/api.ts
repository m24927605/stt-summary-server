const API_BASE = '/api';

let sessionInitPromise: Promise<void> | null = null;

/**
 * Read a cookie value by name from document.cookie.
 * Returns empty string if not found.
 */
export function getCookie(name: string): string {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

export async function initSession(): Promise<void> {
  if (sessionInitPromise) return sessionInitPromise;

  sessionInitPromise = (async () => {
    const res = await fetch(`${API_BASE}/tasks/session`, {
      credentials: 'include',
    });

    if (res.ok) {
      return;
    }

    // 401 means invalid/expired cookie was cleared by server — retry once within the same promise
    if (res.status === 401) {
      const retryRes = await fetch(`${API_BASE}/tasks/session`, {
        credentials: 'include',
      });
      if (retryRes.ok) {
        return;
      }
    }

    // Both attempts failed — reset so a future call (e.g. page reload) can try again
    sessionInitPromise = null;
    throw new Error('Failed to initialize session');
  })();

  return sessionInitPromise;
}

function headers(method: string = 'GET'): HeadersInit {
  const h: Record<string, string> = {};
  if (method !== 'GET' && method !== 'HEAD') {
    h['X-CSRF-Token'] = getCookie('csrf_token');
  }
  return h;
}

export async function createTask(file: File) {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API_BASE}/tasks`, {
    method: 'POST',
    body: formData,
    headers: headers('POST'),
    credentials: 'include',
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Upload failed');
  }

  return res.json();
}

export async function getTasks() {
  const res = await fetch(`${API_BASE}/tasks`, {
    headers: headers(),
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to fetch tasks');
  return res.json();
}

export async function getTask(id: string) {
  const res = await fetch(`${API_BASE}/tasks/${id}`, {
    headers: headers(),
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to fetch task');
  return res.json();
}
