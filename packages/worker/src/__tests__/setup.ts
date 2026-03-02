import { vi } from 'vitest';

// Global mocks for external services — individual tests can override as needed
vi.mock('@prisma/client');
vi.mock('amqplib');
vi.mock('openai');
