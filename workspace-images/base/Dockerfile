FROM node:20-alpine

WORKDIR /workspace

# Install common development tools
RUN npm install -g serve nodemon typescript ts-node vite create-vite

# Install additional utilities (procps for ps command, shadow for user management)
RUN apk add --no-cache git curl bash procps

# Create workspace directory with proper permissions
RUN mkdir -p /workspace && chmod 777 /workspace

# Expose port for dev server
EXPOSE 3000

# Default command keeps container running
CMD ["tail", "-f", "/dev/null"]
