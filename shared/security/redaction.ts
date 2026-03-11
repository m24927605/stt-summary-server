import { SECRET_PATTERNS } from './secret-patterns';

export function redact(value: string, replacement = '[REDACTED]'): string {
  let result = value;
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function redactDeep(
  obj: unknown,
  seen: WeakSet<object> = new WeakSet(),
  replacement = '[REDACTED]',
): unknown {
  if (typeof obj === 'string') return redact(obj, replacement);
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (seen.has(obj as object)) return '[Circular]';
  seen.add(obj as object);
  if (Array.isArray(obj)) return obj.map((item) => redactDeep(item, seen, replacement));
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    cleaned[k] = redactDeep(v, seen, replacement);
  }
  return cleaned;
}
