#!/usr/bin/env bash

# Deployment script for claude-run
# Builds Docker image, transfers to PiNAS, and restarts container
#
# Usage:
#   ./scripts/deploy/deploy.sh

set -e

# Add Docker Desktop to PATH (in case system symlinks are broken)
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"

# Output formatting
PREFIX="[DEPLOY]"
MAGENTA='\033[0;35m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

timestamp() { date '+[%H:%M:%S]'; }
log() { echo -e "$(timestamp) ${MAGENTA}${PREFIX}${NC} $1"; }
log_success() { echo -e "$(timestamp) ${GREEN}${PREFIX}${NC} $1"; }
log_warn() { echo -e "$(timestamp) ${YELLOW}${PREFIX}${NC} $1"; }
log_error() { echo -e "$(timestamp) ${RED}${PREFIX}${NC} $1"; }

# Configuration
IMAGE_NAME=claude-run
CONTAINER_NAME=claude-run
DOCKER_BIN="${DOCKER_BIN:-$(command -v docker || echo /Applications/Docker.app/Contents/Resources/bin/docker)}"

# Remote Configuration (PiNAS)
REMOTE_HOST="${REMOTE_HOST:-192.168.1.31}"
REMOTE_USER="${REMOTE_USER:-bogdan}"
REMOTE_PORT="${REMOTE_PORT:-12001}"
BUILD_PLATFORM="linux/arm64"

# Get project root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "${SCRIPT_DIR}")")"
TEMP_IMAGE="/tmp/${IMAGE_NAME}.tar.gz"

# SSH options to suppress MOTD and banners
SSH_OPTS=(-q -o "BatchMode=yes" -o "LogLevel=ERROR" -o "StrictHostKeyChecking=accept-new")

# Check if Docker is running
if ! ${DOCKER_BIN} info >/dev/null 2>&1; then
  log_error "Docker is not running. Please start Docker Desktop."
  exit 1
fi

log "Deploy: ${IMAGE_NAME} -> PiNAS (${REMOTE_HOST}:${REMOTE_PORT})"

# Step 1: Build Docker image
log "[1/5] Building Docker image..."
cd "${PROJECT_ROOT}"
BUILD_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

${DOCKER_BIN} build -t ${IMAGE_NAME} \
  --platform "${BUILD_PLATFORM}" \
  . --quiet
log "       Build complete (${BUILD_COMMIT})"

# Step 2: Archive image
log "[2/5] Archiving image..."
${DOCKER_BIN} save ${IMAGE_NAME} 2>/dev/null | gzip > "${TEMP_IMAGE}"
IMAGE_SIZE=$(du -h "${TEMP_IMAGE}" | cut -f1)
log "       Archive created (${IMAGE_SIZE})"

# Step 3: Transfer to remote
log "[3/5] Transferring image to remote..."
scp "${SSH_OPTS[@]}" "${TEMP_IMAGE}" "${REMOTE_USER}@${REMOTE_HOST}:/tmp/"
log "       Transfer complete"

# Step 4: Load image and restart container on remote
log "[4/5] Loading image and restarting container..."
# shellcheck disable=SC2087  # We intentionally want client-side variable expansion
ssh "${SSH_OPTS[@]}" -T "${REMOTE_USER}@${REMOTE_HOST}" bash -s <<REMOTE_SCRIPT
set -e

# Create config directory if needed
mkdir -p ~/.claude-run

# Capture old image ID before loading new one
OLD_IMAGE_ID=\$(docker images -q ${IMAGE_NAME} 2>/dev/null || true)

# Load the new image
gunzip -c /tmp/${IMAGE_NAME}.tar.gz | docker load --quiet >/dev/null

# Get new image ID
NEW_IMAGE_ID=\$(docker images -q ${IMAGE_NAME} 2>/dev/null || true)

# Stop and remove existing container (if exists)
docker stop ${CONTAINER_NAME} >/dev/null 2>&1 || true
docker rm ${CONTAINER_NAME} >/dev/null 2>&1 || true

# Start new container
docker run -d \
  --name ${CONTAINER_NAME} \
  --restart unless-stopped \
  -p ${REMOTE_PORT}:12001 \
  -v ~/.ssh:/home/claude-run/.ssh:ro \
  -v ~/.claude-run:/home/claude-run/.claude-run:ro \
  ${IMAGE_NAME} >/dev/null

# Cleanup old image if different from new one
if [ -n "\${OLD_IMAGE_ID}" ] && [ "\${OLD_IMAGE_ID}" != "\${NEW_IMAGE_ID}" ]; then
  docker rmi "\${OLD_IMAGE_ID}" >/dev/null 2>&1 || true
fi

# Cleanup temp file
rm -f /tmp/${IMAGE_NAME}.tar.gz

# Prune dangling images to free space
docker image prune -f >/dev/null 2>&1 || true
REMOTE_SCRIPT
log "       Container restarted"

# Step 5: Verify deployment
log "[5/5] Verifying health check..."
sleep 2
HEALTH_STATUS=$(curl -s "http://${REMOTE_HOST}:${REMOTE_PORT}/api/hosts" | grep -o '"status":"online"' || echo "failed")

if [[ "${HEALTH_STATUS}" == '"status":"online"' ]]; then
  log "       Health check passed"
else
  log_warn "       Health check failed!"
  log_warn "       Check logs: ssh ${REMOTE_USER}@${REMOTE_HOST} docker logs ${CONTAINER_NAME}"
fi

# Cleanup local temp file
rm -f "${TEMP_IMAGE}"

log_success "Deployment complete! App: http://${REMOTE_HOST}:${REMOTE_PORT}"

exit 0
