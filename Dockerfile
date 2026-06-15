# Dockerfile for QVAC-Pear Miner Node with centralized inference
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apk add --no-cache \
    git \
    python3 \
    py3-pip \
    build-base

# Copy root package files
COPY package*.json ./
RUN npm ci --only=production

# Copy and build frontend
COPY frontend/package*.json ./frontend/
WORKDIR /app/frontend
RUN npm ci
COPY frontend/ ./
RUN npx vite build
WORKDIR /app

# Copy source code
COPY src/ ./src/
COPY config.json ./

# Create data directory
RUN mkdir -p /app/data

# Expose API port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/status', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["node", "src/index.js"]
