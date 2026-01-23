#!/bin/bash

# Destroy a workspace container and optionally its data
# Usage: ./destroy_workspace.sh <workspace_id> [--clean]

WORKSPACE_ID=$1
CLEAN_DATA=$2
CONTAINER_NAME="workspace-${WORKSPACE_ID}"

if [ -z "$WORKSPACE_ID" ]; then
    echo "Error: Workspace ID required"
    echo "Usage: ./destroy_workspace.sh <workspace_id> [--clean]"
    exit 1
fi

# Stop and remove container
echo "Stopping container: $CONTAINER_NAME"
docker stop "$CONTAINER_NAME" 2>/dev/null
docker rm "$CONTAINER_NAME" 2>/dev/null

# Optionally remove workspace data
if [ "$CLEAN_DATA" == "--clean" ]; then
    WORKSPACE_DIR="/var/workspaces/${WORKSPACE_ID}"
    echo "Removing workspace data: $WORKSPACE_DIR"
    rm -rf "$WORKSPACE_DIR"
fi

echo "Workspace $WORKSPACE_ID destroyed"
