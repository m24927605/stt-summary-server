import { describe, it, expect } from 'vitest';
import { validateProductionConfig } from '../../utils/startup-validation';

describe('validateProductionConfig', () => {
  it('throws when API_KEY is empty and CORS_ORIGIN is not localhost', () => {
    expect(() =>
      validateProductionConfig({ apiKey: '', corsOrigin: 'https://app.example.com' })
    ).toThrow('API_KEY is required');
  });

  it('does not throw when API_KEY is set', () => {
    expect(() =>
      validateProductionConfig({ apiKey: 'my-key', corsOrigin: 'https://app.example.com' })
    ).not.toThrow();
  });

  it('does not throw when CORS_ORIGIN is localhost (port 8080)', () => {
    expect(() =>
      validateProductionConfig({ apiKey: '', corsOrigin: 'http://localhost:8080' })
    ).not.toThrow();
  });

  it('does not throw when CORS_ORIGIN is localhost (port 3000)', () => {
    expect(() =>
      validateProductionConfig({ apiKey: '', corsOrigin: 'http://localhost:3000' })
    ).not.toThrow();
  });
});
