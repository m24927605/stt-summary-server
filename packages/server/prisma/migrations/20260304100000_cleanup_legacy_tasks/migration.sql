-- Delete tasks that were created before session isolation was added
DELETE FROM tasks WHERE session_id = 'legacy';
