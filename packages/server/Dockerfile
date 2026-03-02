FROM node:20-alpine AS builder
WORKDIR /app

# Copy root workspace files
COPY package.json ./
COPY shared/ ./shared/
COPY packages/server/package.json ./packages/server/

# Install all dependencies
RUN cd packages/server && npm install

# Copy server source
COPY packages/server/ ./packages/server/
COPY tsconfig.base.json ./

# Build shared module
RUN cd shared && npx tsc

# Generate Prisma client and build server
RUN cd packages/server && npx prisma generate && npx tsc

FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/packages/server/dist ./dist
COPY --from=builder /app/packages/server/node_modules ./node_modules
COPY --from=builder /app/packages/server/package.json ./
COPY --from=builder /app/packages/server/prisma ./prisma
COPY --from=builder /app/shared ./shared

# Create symlink so Node.js can resolve 'shared/*' imports at runtime
RUN mkdir -p /app/node_modules && ln -s /app/shared /app/node_modules/shared

RUN mkdir -p /app/uploads
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
