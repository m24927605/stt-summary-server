import pino from 'pino';
import { redactDeep } from '../../../shared/security/redaction';

export const loggerOptions: pino.LoggerOptions = {
  formatters: {
    log(obj: Record<string, unknown>) {
      return redactDeep(obj) as Record<string, unknown>;
    },
  },
};

export const logger = pino(loggerOptions);
