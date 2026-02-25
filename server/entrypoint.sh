#!/bin/sh
set -e

# Start Docker daemon in background
dockerd &

# Wait for Docker daemon to be ready
echo "Waiting for Docker daemon..."
while ! docker info >/dev/null 2>&1; do
  sleep 1
done
echo "Docker daemon is ready."

# Start Workshop server
exec tsx src/index.ts
