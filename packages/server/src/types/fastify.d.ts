import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    sessionId: string;
    csrfToken: string;
  }
}
