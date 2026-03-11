const API_BASE = '/api';

function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
  return match?.[1] || '';
}

export function getSessionId(): string {
  let id = localStorage.getItem('sessionId');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('sessionId', id);
  }
  return id;
}

function headers(method: string = 'GET'): HeadersInit {
  const h: Record<string, string> = {
    'X-Session-Id': getSessionId(),
  };
  if (method !== 'GET' && method !== 'HEAD') {
    h['X-CSRF-Token'] = getCsrfToken();
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
