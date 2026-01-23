#!/bin/bash

# Execute a command inside a workspace container
# Usage: ./run_command.sh <workspace_id> <command>

WORKSPACE_ID=$1
shift
COMMAND="$@"
CONTAINER_NAME="workspace-${WORKSPACE_ID}"

if [ -z "$WORKSPACE_ID" ] || [ -z "$COMMAND" ]; then
    echo "Error: Workspace ID and command required"
    echo "Usage: ./run_command.sh <workspace_id> <command>"
    exit 1
fi

# Check if container exists and is running
if ! docker ps -q -f name="$CONTAINER_NAME" | grep -q .; then
    echo "Error: Container $CONTAINER_NAME not running"
    exit 1
fi

# Execute command
docker exec -w /workspace "$CONTAINER_NAME" sh -c "$COMMAND"
