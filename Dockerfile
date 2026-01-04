# Multi-stage Dockerfile for claude-run

# Stage 1: Dependencies
FROM node:22-alpine AS deps
WORKDIR /app

# Install build dependencies for native modules (node-pty)
RUN apk add --no-cache python3 make g++

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy package files
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

# Stage 2: Builder
FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build the application
RUN pnpm run build

# Stage 3: Production dependencies
FROM node:22-alpine AS prod-deps
WORKDIR /app

# Install build dependencies for native modules (node-pty)
RUN apk add --no-cache python3 make g++

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod

# Stage 4: Runner
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Install openssh-client for SSH host connections
RUN apk add --no-cache openssh-client

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 claude-run

# Copy production dependencies
COPY --from=prod-deps --chown=claude-run:nodejs /app/node_modules ./node_modules

# Copy built files
COPY --from=builder --chown=claude-run:nodejs /app/dist ./dist
COPY --from=builder --chown=claude-run:nodejs /app/package.json ./

# Create .claude-run config directory
RUN mkdir -p /home/claude-run/.claude-run && \
    chown -R claude-run:nodejs /home/claude-run

# Switch to non-root user
USER claude-run

# Expose the port
EXPOSE 12001

ENV PORT=12001
ENV HOSTNAME="0.0.0.0"
ENV CLAUDE_RUN_DOCKER=true

# Start the server
CMD ["node", "dist/index.js", "--no-open"]
