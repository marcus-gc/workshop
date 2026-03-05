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

# Skip iptables DNAT for traffic arriving on eth0 so docker-proxy handles it.
# In DinD, conntrack does not reliably reverse-DNAT responses, causing external
# traffic forwarded to craftsman containers to time out.
iptables -t nat -I DOCKER -i eth0 -j RETURN 2>/dev/null || true

# Start Workshop server
exec tsx src/index.ts
