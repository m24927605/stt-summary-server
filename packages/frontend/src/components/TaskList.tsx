interface Task {
  id: string;
  status: string;
  step: string | null;
  originalFilename: string;
  createdAt: string;
}

interface Props {
  tasks: Task[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  processing: '#3b82f6',
  completed: '#10b981',
  failed: '#ef4444',
};

export function TaskList({ tasks, selectedId, onSelect }: Props) {
  if (tasks.length === 0) {
    return <p className="empty">No tasks yet. Upload an audio file to get started.</p>;
  }

  return (
    <div className="task-list">
      {tasks.map((task) => (
        <div
          key={task.id}
          className={`task-item ${task.id === selectedId ? 'selected' : ''}`}
          onClick={() => onSelect(task.id)}
        >
          <div className="task-item-header">
            <span className="filename">{task.originalFilename}</span>
            <span
              className="status-badge"
              style={{ backgroundColor: STATUS_COLORS[task.status] || '#6b7280' }}
            >
              {task.status}{task.step ? ` (${task.step})` : ''}
            </span>
          </div>
          <span className="timestamp">
            {new Date(task.createdAt).toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}
