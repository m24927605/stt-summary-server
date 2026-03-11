FROM node:20-alpine AS builder
WORKDIR /app

COPY packages/frontend/package.json ./
RUN npm install
COPY packages/frontend/ ./
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY packages/frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
ENV API_HOST=server API_PORT=3000
EXPOSE 8080
