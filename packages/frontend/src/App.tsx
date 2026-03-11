import { useState, useEffect, useCallback } from 'react';
import { UploadForm } from './components/UploadForm';
import { TaskList } from './components/TaskList';
import { TaskDetail } from './components/TaskDetail';
import { getTasks, getTask, initSession } from './api';
import './App.css';

function App() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState(false);

  useEffect(() => {
    initSession()
      .then(() => setSessionReady(true))
      .catch(() => setSessionError(true));
  }, []);

  const fetchTasks = useCallback(async () => {
    try {
      const data = await getTasks();
      setTasks(data);
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    }
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    fetchTasks();
    const interval = setInterval(fetchTasks, 5000);
    return () => clearInterval(interval);
  }, [fetchTasks, sessionReady]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedTask(null);
      return;
    }
    getTask(selectedId).then(setSelectedTask).catch(console.error);
    const interval = setInterval(() => {
      getTask(selectedId).then(setSelectedTask).catch(console.error);
    }, 3000);
    return () => clearInterval(interval);
  }, [selectedId]);

  const handleTaskCreated = (task: { id: string }) => {
    setSelectedId(task.id);
    fetchTasks();
  };

  if (sessionError) {
    return (
      <div className="app">
        <header className="app-header">
          <div className="app-title">
            <img src="/logo.svg" alt="VoiceBrief" className="app-logo" />
            <h1>VoiceBrief</h1>
          </div>
          <p>Failed to connect. Please reload the page.</p>
        </header>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">
          <img src="/logo.svg" alt="VoiceBrief" className="app-logo" />
          <h1>VoiceBrief</h1>
        </div>
        <p>Upload audio files for transcription and AI-powered summarization</p>
      </header>

      {sessionReady ? (
        <UploadForm onTaskCreated={handleTaskCreated} />
      ) : (
        <div className="loading">Initializing...</div>
      )}

      <div className="main-content">
        <div className="sidebar">
          <h2>Tasks</h2>
          <TaskList tasks={tasks} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
        <div className="detail-panel">
          <TaskDetail task={selectedTask} />
        </div>
      </div>
    </div>
  );
}

export default App;
