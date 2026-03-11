import crypto from 'crypto';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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
