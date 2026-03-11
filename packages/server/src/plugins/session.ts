import crypto from 'crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { PrismaClient } from '@prisma/client';
import { getDb } from './db';
import { validateCsrf } from './csrf';
import { config } from '../config';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ROTATION_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
const SESSION_COOKIE = 'stt_session';
const CSRF_COOKIE = 'csrf_token';

export function hashUserAgent(ua: string): string {
  return crypto.createHash('sha256').update(ua).digest('hex');
}

export function extractIpPrefix(ip: string): string {
  if (ip.includes('.')) {
    return ip.split('.').slice(0, 3).join('.');
  }
  const groups = ip.split(':');
  if (groups.length <= 3) return ip;
  return groups.slice(0, 3).join(':');
}

export function validateSessionBinding(
  session: { uaHash: string; ipPrefix: string },
  currentUaHash: string,
  currentIpPrefix: string
): boolean {
  return session.uaHash === currentUaHash && session.ipPrefix === currentIpPrefix;
}

export function createSessionData(userAgent: string, clientIp: string) {
  return {
    uaHash: hashUserAgent(userAgent),
    ipPrefix: extractIpPrefix(clientIp),
    csrfToken: crypto.randomBytes(32).toString('hex'),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  };
}

export function shouldRotateSession(sessionCreatedAt: Date): boolean {
  return Date.now() - sessionCreatedAt.getTime() >= ROTATION_THRESHOLD_MS;
}

export interface RotationResult {
  newSessionId: string;
  newCsrfToken: string;
}

/**
 * Atomically rotates a session: creates a new session, revokes the old one,
 * sets rotated_to, and migrates all task ownership — all in a single transaction.
 */
export async function rotateSession(
  db: PrismaClient,
  oldSessionId: string,
  sessionData: { uaHash: string; ipPrefix: string; csrfToken: string; expiresAt: Date },
): Promise<RotationResult> {
  const result = await db.$transaction(async (tx) => {
    // Create new session
    const newSession = await tx.session.create({
      data: {
        uaHash: sessionData.uaHash,
        ipPrefix: sessionData.ipPrefix,
        csrfToken: sessionData.csrfToken,
        expiresAt: sessionData.expiresAt,
      },
    });

    // Set rotated_to and revoke old session
    await tx.session.update({
      where: { id: oldSessionId },
      data: {
        rotatedTo: newSession.id,
        revoked: true,
      },
    });

    // Migrate task ownership atomically
    await tx.task.updateMany({
      where: { sessionId: oldSessionId },
      data: { sessionId: newSession.id },
    });

    return { newSessionId: newSession.id, newCsrfToken: newSession.csrfToken };
  });

  return result;
}

/**
 * Walks the rotatedTo chain from a starting session ID until it finds
 * an active (non-revoked) session or exhausts the chain.
 *
 * Returns the active session or null if the chain is broken, cyclic,
 * exceeds maxHops, or leads to a missing/revoked-without-successor session.
 */
export async function followRotationChain(
  db: PrismaClient,
  startSessionId: string,
  maxHops: number = 8,
): Promise<{
  id: string;
  uaHash: string;
  ipPrefix: string;
  csrfToken: string;
  expiresAt: Date;
  rotatedTo: string | null;
  revoked: boolean;
  createdAt: Date;
  lastSeenAt: Date;
} | null> {
  const visited = new Set<string>();
  let currentId: string | null = startSessionId;

  for (let hop = 0; hop <= maxHops; hop++) {
    if (!currentId) return null;
    if (visited.has(currentId)) return null; // cycle detected
    visited.add(currentId);

    const session = await db.session.findUnique({ where: { id: currentId } });
    if (!session) return null;

    if (!session.revoked) return session;

    // Revoked — follow the chain
    currentId = session.rotatedTo;
  }

  return null; // exceeded maxHops
}

function getClientIp(request: FastifyRequest): string {
  return request.ip || '127.0.0.1';
}

function setCookies(reply: FastifyReply, sessionId: string, csrfToken: string): void {
  const isSecure = !config.corsOrigin.startsWith('http://localhost');
  void reply.setCookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isSecure,
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });
  void reply.setCookie(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    sameSite: 'strict',
    secure: isSecure,
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });
}

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

export const sessionPlugin = fp(async function sessionPlugin(app: FastifyInstance): Promise<void> {
  app.decorateRequest('sessionId', '');
  app.decorateRequest('csrfToken', '');

  app.addHook('onRequest', async (request, reply) => {
    const db = getDb();
    const cookieSessionId = request.cookies[SESSION_COOKIE];
    const ua = (request.headers['user-agent'] as string) || '';
    const clientIp = getClientIp(request);
    const currentUaHash = hashUserAgent(ua);
    const currentIpPrefix = extractIpPrefix(clientIp);

    // --- Case 1: Cookie present → validate strictly, reject on any failure ---
    if (cookieSessionId) {
      const session = await db.session.findUnique({ where: { id: cookieSessionId } });

      if (!session) {
        void reply.clearCookie(SESSION_COOKIE, { path: '/' });
        return reply.status(401).send({ error: 'Invalid session' });
      }

      if (session.revoked) {
        void reply.clearCookie(SESSION_COOKIE, { path: '/' });
        return reply.status(401).send({ error: 'Session revoked' });
      }

      if (session.expiresAt <= new Date()) {
        void reply.clearCookie(SESSION_COOKIE, { path: '/' });
        return reply.status(401).send({ error: 'Session expired' });
      }

      if (!validateSessionBinding(session, currentUaHash, currentIpPrefix)) {
        void reply.clearCookie(SESSION_COOKIE, { path: '/' });
        return reply.status(401).send({ error: 'Session binding mismatch' });
      }

      // Check if session needs rotation (older than 24 hours)
      if (shouldRotateSession(session.createdAt)) {
        // For unsafe methods, validate CSRF and Origin BEFORE rotation
        // to prevent state changes on invalid requests
        if (!SAFE_METHODS.includes(request.method)) {
          const headerToken = request.headers['x-csrf-token'] as string || '';
          if (!validateCsrf(session.csrfToken, headerToken)) {
            return reply.status(403).send({ error: 'CSRF token validation failed' });
          }

          const origin = request.headers['origin'] as string || '';
          if (origin !== config.corsOrigin) {
            return reply.status(403).send({ error: 'Origin validation failed' });
          }
        }

        const newSessionData = createSessionData(ua, clientIp);
        const rotation = await rotateSession(db, session.id, newSessionData);

        request.sessionId = rotation.newSessionId;
        request.csrfToken = rotation.newCsrfToken;
        setCookies(reply, rotation.newSessionId, rotation.newCsrfToken);

        return;
      }

      // Session valid, no rotation needed
      request.sessionId = session.id;
      request.csrfToken = session.csrfToken;

      // Update lastSeenAt (fire-and-forget)
      db.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      }).catch(() => {});

      // Enforce CSRF for state-changing methods
      if (!SAFE_METHODS.includes(request.method)) {
        const headerToken = request.headers['x-csrf-token'] as string || '';
        if (!validateCsrf(session.csrfToken, headerToken)) {
          return reply.status(403).send({ error: 'CSRF token validation failed' });
        }

        const origin = request.headers['origin'] as string || '';
        if (origin !== config.corsOrigin) {
          return reply.status(403).send({ error: 'Origin validation failed' });
        }
      }

      return;
    }

    // --- Case 2: No cookie ---

    // State-changing requests without session → reject immediately, no session creation
    if (!SAFE_METHODS.includes(request.method)) {
      return reply.status(401).send({ error: 'Session required' });
    }

    // Safe methods → create new session
    const sessionData = createSessionData(ua, clientIp);
    const newSession = await db.session.create({
      data: {
        uaHash: sessionData.uaHash,
        ipPrefix: sessionData.ipPrefix,
        csrfToken: sessionData.csrfToken,
        expiresAt: sessionData.expiresAt,
      },
    });

    request.sessionId = newSession.id;
    request.csrfToken = newSession.csrfToken;

    setCookies(reply, newSession.id, newSession.csrfToken);
  });
});
