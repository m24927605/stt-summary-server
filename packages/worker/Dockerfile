FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json ./
COPY shared/ ./shared/
COPY packages/worker/package.json ./packages/worker/

RUN cd packages/worker && npm install

COPY packages/worker/ ./packages/worker/
COPY tsconfig.base.json ./

# Build shared module
RUN cd shared && npx tsc

# Generate Prisma client and build worker
RUN cd packages/worker && npx prisma generate && npx tsc

FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/packages/worker/dist ./dist
COPY --from=builder /app/packages/worker/node_modules ./node_modules
COPY --from=builder /app/packages/worker/package.json ./
COPY --from=builder /app/packages/worker/prisma ./prisma
COPY --from=builder /app/shared ./shared

CMD ["node", "dist/index.js"]
