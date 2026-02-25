FROM docker:27-dind

# Install Node.js 22
RUN apk add --no-cache nodejs npm git

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm ci --production

# Copy source and Craftsman Dockerfile
COPY tsconfig.json ./
COPY src/ ./src/
COPY Dockerfile.craftsman ./

# Install tsx for running TypeScript
RUN npm install -g tsx

EXPOSE 7424

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
