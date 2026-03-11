import crypto from 'crypto';

const SESSION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const CSRF_TOKEN = 'a'.repeat(64);

// Fastify inject() sends user-agent 'lightMyRequest' by default
const DEFAULT_UA = 'lightMyRequest';
const DEFAULT_UA_HASH = crypto.createHash('sha256').update(DEFAULT_UA).digest('hex');
const DEFAULT_IP_PREFIX = '127.0.0';

export { SESSION_ID, CSRF_TOKEN, DEFAULT_UA_HASH, DEFAULT_IP_PREFIX };

export function makeDbSession(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    uaHash: DEFAULT_UA_HASH,
    ipPrefix: DEFAULT_IP_PREFIX,
    csrfToken: CSRF_TOKEN,
    expiresAt: new Date(Date.now() + 86400000),
    rotatedTo: null,
    revoked: false,
    createdAt: new Date(),
    lastSeenAt: new Date(),
    ...overrides,
  };
}

export function sessionCookie(id: string = SESSION_ID): string {
  return `stt_session=${id}`;
}
