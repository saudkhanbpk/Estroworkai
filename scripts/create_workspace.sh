#!/bin/bash

# Create a new isolated workspace container
# Usage: ./create_workspace.sh <workspace_id>

WORKSPACE_ID=$1
IMAGE_NAME="estro-ai-workspace:latest"
CONTAINER_NAME="workspace-${WORKSPACE_ID}"

if [ -z "$WORKSPACE_ID" ]; then
    echo "Error: Workspace ID required"
    echo "Usage: ./create_workspace.sh <workspace_id>"
    exit 1
fi

# Create workspace directory on host
WORKSPACE_DIR="/var/workspaces/${WORKSPACE_ID}"
mkdir -p "$WORKSPACE_DIR"

# Run container with resource limits
docker run -d \
    --name "$CONTAINER_NAME" \
    --hostname "$CONTAINER_NAME" \
    --memory="512m" \
    --cpus="0.5" \
    --network="workspace-network" \
    -v "${WORKSPACE_DIR}:/workspace" \
    -p "0:3000" \
    --restart="unless-stopped" \
    "$IMAGE_NAME"

# Get assigned port
PORT=$(docker port "$CONTAINER_NAME" 3000 | cut -d: -f2)

echo "Container: $CONTAINER_NAME"
echo "Port: $PORT"
echo "Workspace: $WORKSPACE_DIR"
