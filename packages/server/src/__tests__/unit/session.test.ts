import { describe, it, expect, vi } from 'vitest';
import crypto from 'crypto';

vi.mock('../../plugins/db', () => ({
  getDb: () => ({}),
}));

vi.mock('../../config', () => ({
  config: { corsOrigin: 'http://localhost:8080', apiKey: '' },
}));

import {
  hashUserAgent,
  extractIpPrefix,
  validateSessionBinding,
  createSessionData,
  shouldRotateSession,
  rotateSession,
  followRotationChain,
} from '../../plugins/session';

describe('session helpers', () => {
  describe('hashUserAgent', () => {
    it('returns SHA-256 hex of User-Agent string', () => {
      const result = hashUserAgent('Mozilla/5.0 Test');
      const expected = crypto.createHash('sha256').update('Mozilla/5.0 Test').digest('hex');
      expect(result).toBe(expected);
    });

    it('returns consistent hash for same input', () => {
      expect(hashUserAgent('test')).toBe(hashUserAgent('test'));
    });

    it('returns different hash for different input', () => {
      expect(hashUserAgent('a')).not.toBe(hashUserAgent('b'));
    });
  });

  describe('extractIpPrefix', () => {
    it('extracts /24 prefix from IPv4', () => {
      expect(extractIpPrefix('192.168.1.100')).toBe('192.168.1');
    });

    it('extracts /24 prefix from different IPv4', () => {
      expect(extractIpPrefix('10.0.5.23')).toBe('10.0.5');
    });

    it('extracts first 3 groups from IPv6', () => {
      expect(extractIpPrefix('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe('2001:0db8:85a3');
    });

    it('handles ::1 loopback', () => {
      expect(extractIpPrefix('::1')).toBe('::1');
    });
  });

  describe('validateSessionBinding', () => {
    it('returns true when UA hash and IP prefix match', () => {
      expect(validateSessionBinding(
        { uaHash: 'abc123', ipPrefix: '192.168.1' },
        'abc123', '192.168.1'
      )).toBe(true);
    });

    it('returns false when UA hash differs', () => {
      expect(validateSessionBinding(
        { uaHash: 'abc123', ipPrefix: '192.168.1' },
        'different', '192.168.1'
      )).toBe(false);
    });

    it('returns false when IP prefix differs', () => {
      expect(validateSessionBinding(
        { uaHash: 'abc123', ipPrefix: '192.168.1' },
        'abc123', '10.0.0'
      )).toBe(false);
    });
  });

  describe('createSessionData', () => {
    it('generates session with correct fields', () => {
      const data = createSessionData('Mozilla/5.0', '192.168.1.100');
      expect(data.uaHash).toBe(hashUserAgent('Mozilla/5.0'));
      expect(data.ipPrefix).toBe('192.168.1');
      expect(data.csrfToken).toHaveLength(64);
      expect(data.expiresAt).toBeInstanceOf(Date);
      expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('shouldRotateSession', () => {
    it('returns false for session created less than 24 hours ago', () => {
      const recentDate = new Date(Date.now() - 23 * 60 * 60 * 1000); // 23 hours ago
      expect(shouldRotateSession(recentDate)).toBe(false);
    });

    it('returns true for session created 24 hours ago', () => {
      const oldDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // exactly 24 hours
      expect(shouldRotateSession(oldDate)).toBe(true);
    });

    it('returns true for session created 48 hours ago', () => {
      const veryOld = new Date(Date.now() - 48 * 60 * 60 * 1000);
      expect(shouldRotateSession(veryOld)).toBe(true);
    });

    it('returns false for session created just now', () => {
      expect(shouldRotateSession(new Date())).toBe(false);
    });
  });

  describe('rotateSession', () => {
    it('creates new session, revokes old, and migrates tasks atomically', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        id: 'new-session-id',
        csrfToken: 'new-csrf-token',
      });
      const mockUpdate = vi.fn().mockResolvedValue({});
      const mockUpdateMany = vi.fn().mockResolvedValue({ count: 3 });

      const mockDb = {
        $transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => {
          return fn({
            session: { create: mockCreate, update: mockUpdate },
            task: { updateMany: mockUpdateMany },
          });
        }),
      } as unknown as any;

      const result = await rotateSession(mockDb, 'old-session-id', {
        uaHash: 'hash',
        ipPrefix: '192.168.1',
        csrfToken: 'new-csrf-token',
        expiresAt: new Date(),
      });

      expect(result.newSessionId).toBe('new-session-id');
      expect(result.newCsrfToken).toBe('new-csrf-token');

      // Verify old session was revoked
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'old-session-id' },
          data: { rotatedTo: 'new-session-id', revoked: true },
        }),
      );

      // Verify tasks were migrated
      expect(mockUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sessionId: 'old-session-id' },
          data: { sessionId: 'new-session-id' },
        }),
      );
    });

    it('new session gets a new CSRF token', async () => {
      const mockDb = {
        $transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => {
          return fn({
            session: {
              create: vi.fn().mockResolvedValue({ id: 'new-id', csrfToken: 'brand-new-token' }),
              update: vi.fn().mockResolvedValue({}),
            },
            task: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
          });
        }),
      } as unknown as any;

      const result = await rotateSession(mockDb, 'old-id', {
        uaHash: 'h',
        ipPrefix: '10.0.0',
        csrfToken: 'brand-new-token',
        expiresAt: new Date(),
      });

      expect(result.newCsrfToken).toBe('brand-new-token');
      expect(result.newCsrfToken).not.toBe('old-csrf-token');
    });
  });

  describe('followRotationChain', () => {
    function mockDb(sessions: Record<string, any>) {
      return {
        session: {
          findUnique: vi.fn(({ where }: { where: { id: string } }) =>
            Promise.resolve(sessions[where.id] ?? null),
          ),
        },
      } as unknown as any;
    }

    function makeSession(id: string, overrides: Record<string, any> = {}) {
      return {
        id,
        uaHash: 'hash',
        ipPrefix: '192.168.1',
        csrfToken: 'tok-' + id,
        expiresAt: new Date(Date.now() + 86400000),
        rotatedTo: null,
        revoked: false,
        createdAt: new Date(),
        lastSeenAt: new Date(),
        ...overrides,
      };
    }

    it('returns the session itself when it is active', async () => {
      const active = makeSession('s1');
      const db = mockDb({ s1: active });
      const result = await followRotationChain(db, 's1');
      expect(result).toEqual(active);
    });

    it('follows a one-hop chain to the active session', async () => {
      const revoked = makeSession('s1', { revoked: true, rotatedTo: 's2' });
      const active = makeSession('s2');
      const db = mockDb({ s1: revoked, s2: active });
      const result = await followRotationChain(db, 's1');
      expect(result).toEqual(active);
    });

    it('follows a multi-hop chain to the active session', async () => {
      const s1 = makeSession('s1', { revoked: true, rotatedTo: 's2' });
      const s2 = makeSession('s2', { revoked: true, rotatedTo: 's3' });
      const s3 = makeSession('s3', { revoked: true, rotatedTo: 's4' });
      const s4 = makeSession('s4');
      const db = mockDb({ s1, s2, s3, s4 });
      const result = await followRotationChain(db, 's1');
      expect(result).toEqual(s4);
    });

    it('returns null when session does not exist', async () => {
      const db = mockDb({});
      const result = await followRotationChain(db, 'nonexistent');
      expect(result).toBeNull();
    });

    it('returns null for a revoked session with rotatedTo = null', async () => {
      const revoked = makeSession('s1', { revoked: true, rotatedTo: null });
      const db = mockDb({ s1: revoked });
      const result = await followRotationChain(db, 's1');
      expect(result).toBeNull();
    });

    it('returns null when hop count exceeds maxHops', async () => {
      const sessions: Record<string, any> = {};
      for (let i = 1; i <= 10; i++) {
        sessions[`s${i}`] = makeSession(`s${i}`, {
          revoked: true,
          rotatedTo: i < 10 ? `s${i + 1}` : null,
        });
      }
      sessions['s10'] = makeSession('s10');
      const db = mockDb(sessions);
      const result = await followRotationChain(db, 's1');
      expect(result).toBeNull();
    });

    it('returns null when a cycle is detected', async () => {
      const s1 = makeSession('s1', { revoked: true, rotatedTo: 's2' });
      const s2 = makeSession('s2', { revoked: true, rotatedTo: 's1' });
      const db = mockDb({ s1, s2 });
      const result = await followRotationChain(db, 's1');
      expect(result).toBeNull();
    });

    it('returns null when chain leads to a missing session', async () => {
      const s1 = makeSession('s1', { revoked: true, rotatedTo: 's2' });
      const db = mockDb({ s1 });
      const result = await followRotationChain(db, 's1');
      expect(result).toBeNull();
    });
  });
});
