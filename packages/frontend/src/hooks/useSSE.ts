import { useEffect, useRef, useState } from 'react';
import { getSessionId } from '../api';

interface SSEData {
  status: string;
  step?: string;
  message?: string;
  transcript?: string;
  summary?: string;
  error?: string;
}

export function useSSE(taskId: string | null) {
  const [data, setData] = useState<SSEData | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!taskId) {
      setData(null);
      return;
    }

    const es = new EventSource(`/api/tasks/${taskId}/events?sessionId=${encodeURIComponent(getSessionId())}`);
    eventSourceRef.current = es;

    es.onopen = () => setIsConnected(true);

    es.addEventListener('status', (e) => {
      setData(JSON.parse(e.data));
    });

    es.addEventListener('completed', (e) => {
      setData(JSON.parse(e.data));
      es.close();
      setIsConnected(false);
    });

    es.addEventListener('failed', (e) => {
      setData(JSON.parse(e.data));
      es.close();
      setIsConnected(false);
    });

    es.onerror = () => {
      es.close();
      setIsConnected(false);
    };

    return () => {
      es.close();
      setIsConnected(false);
    };
  }, [taskId]);

  return { data, isConnected };
}
