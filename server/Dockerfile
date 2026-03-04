# Stage 1: Build the React client
FROM node:22-alpine AS client-builder

WORKDIR /build/client
COPY client/package.json client/package-lock.json ./
RUN npm ci

COPY client/ ./
# vite.config.ts sets outDir: '../server/public' which from /build/client resolves to /build/server/public
RUN mkdir -p /build/server/public && npm run build

# Stage 2: Workshop server (Docker-in-Docker)
FROM docker:27-dind

# Install Node.js 22
RUN apk add --no-cache nodejs npm git

WORKDIR /app

# Copy package files and install dependencies
COPY server/package.json server/package-lock.json ./
RUN npm ci --production

# Copy source and Craftsman Dockerfile
COPY server/tsconfig.json ./
COPY server/src/ ./src/
COPY server/Dockerfile.craftsman ./
COPY server/mcp/ ./mcp/

# Copy built React app into public/ (served by Hono's serveStatic)
COPY --from=client-builder /build/server/public ./public/

# Install tsx for running TypeScript
RUN npm install -g tsx

EXPOSE 7424

COPY server/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
