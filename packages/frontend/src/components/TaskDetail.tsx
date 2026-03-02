import Markdown from 'react-markdown';
import { useSSE } from '../hooks/useSSE';

interface Task {
  id: string;
  status: string;
  step: string | null;
  originalFilename: string;
  transcript: string | null;
  summary: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface Props {
  task: Task | null;
}

export function TaskDetail({ task }: Props) {
  const needsSSE = task && (task.status === 'pending' || task.status === 'processing');
  const { data: sseData, isConnected } = useSSE(needsSSE ? task.id : null);

  if (!task) {
    return <div className="task-detail empty">Select a task to view details</div>;
  }

  const isTerminal = task.status === 'completed' || task.status === 'failed';
  const displayStatus = isTerminal ? task.status : (sseData?.status || task.status);
  const displayTranscript = sseData?.transcript || task.transcript;
  const displaySummary = sseData?.summary || task.summary;
  const displayError = isTerminal ? task.error : (sseData?.error || task.error);

  return (
    <div className="task-detail">
      <h2>{task.originalFilename}</h2>

      <div className="status-section">
        <span className={`status ${displayStatus}`}>{displayStatus}</span>
        {sseData?.message && <span className="step-message">{sseData.message}</span>}
        {isConnected && <span className="live-badge">LIVE</span>}
      </div>

      {displayError && (
        <div className="section error-section">
          <h3>Error</h3>
          <p>{displayError}</p>
        </div>
      )}

      {displayTranscript && (
        <div className="section">
          <h3>Transcript</h3>
          <pre className="content-block">{displayTranscript}</pre>
        </div>
      )}

      {displaySummary && (
        <div className="section">
          <h3>Summary</h3>
          <div className="content-block markdown"><Markdown>{displaySummary}</Markdown></div>
        </div>
      )}

      <div className="meta">
        <p>Created: {new Date(task.createdAt).toLocaleString()}</p>
        {task.completedAt && <p>Completed: {new Date(task.completedAt).toLocaleString()}</p>}
        <p className="task-id">ID: {task.id}</p>
      </div>
    </div>
  );
}
