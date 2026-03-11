import { timingSafeEqual } from 'crypto';

export function validateCsrf(cookieToken: string, headerToken: string): boolean {
  if (!cookieToken || !headerToken) return false;
  if (cookieToken.length !== headerToken.length) return false;
  return timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken));
}
