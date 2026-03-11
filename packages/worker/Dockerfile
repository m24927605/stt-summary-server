FROM node:20-alpine AS builder
WORKDIR /app

# Copy shared source and base config
COPY shared/ ./shared/
COPY tsconfig.base.json ./

# Install worker dependencies (no root package.json to avoid workspace hoisting)
COPY packages/worker/package.json ./packages/worker/
RUN cd packages/worker && npm install

# Copy worker source
COPY packages/worker/ ./packages/worker/

# Build shared module using worker's installed TypeScript
RUN ./packages/worker/node_modules/.bin/tsc --project shared/tsconfig.json

# Generate Prisma client and build worker
RUN cd packages/worker && npx prisma generate && npx tsc

FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/packages/worker/dist ./dist
COPY --from=builder /app/packages/worker/node_modules ./node_modules
COPY --from=builder /app/packages/worker/package.json ./
COPY --from=builder /app/packages/worker/prisma ./prisma
COPY --from=builder /app/shared ./shared

# Create symlink so Node.js can resolve 'shared/*' imports at runtime
RUN mkdir -p /app/node_modules && ln -s /app/shared /app/node_modules/shared

CMD ["node", "dist/index.js"]
