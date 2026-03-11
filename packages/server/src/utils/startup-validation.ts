export function validateProductionConfig(cfg: { apiKey: string; corsOrigin: string }): void {
  if (!cfg.apiKey && !cfg.corsOrigin.startsWith('http://localhost')) {
    throw new Error(
      `API_KEY is required when CORS_ORIGIN=${cfg.corsOrigin} — refusing to start without authentication.`
    );
  }
}
