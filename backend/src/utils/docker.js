const Docker = require('dockerode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const logger = require('./logger');

// Windows uses named pipe, Linux/Mac uses socket file
const isWindows = process.platform === 'win32';

// For Docker Desktop on Linux, the socket is in ~/.docker/desktop/docker.sock
// For standard Docker, it's /var/run/docker.sock
function getDockerSocketPath() {
  if (isWindows) {
    return '//./pipe/docker_engine';
  }

  // Check environment variable first
  if (process.env.DOCKER_SOCKET && fs.existsSync(process.env.DOCKER_SOCKET)) {
    return process.env.DOCKER_SOCKET;
  }

  // Try Docker Desktop socket (common on Fedora/Ubuntu with Docker Desktop)
  const desktopSocket = path.join(os.homedir(), '.docker', 'desktop', 'docker.sock');
  if (fs.existsSync(desktopSocket)) {
    logger.info(`Using Docker Desktop socket: ${desktopSocket}`);
    return desktopSocket;
  }

  // Fall back to standard Docker socket
  const defaultSocket = '/var/run/docker.sock';
  if (fs.existsSync(defaultSocket)) {
    return defaultSocket;
  }

  // Return default even if not exists (will fail later with clearer error)
  return process.env.DOCKER_SOCKET || defaultSocket;
}

const dockerOptions = isWindows
  ? { socketPath: '//./pipe/docker_engine' }
  : { socketPath: getDockerSocketPath() };

let docker;
try {
  docker = new Docker(dockerOptions);
  // Test connection
  docker.ping().then(() => {
    logger.info('Docker connection established');
  }).catch((err) => {
    logger.error('Docker connection failed:', err.message);
    logger.info('Make sure Docker is running and accessible');
  });
} catch (err) {
  logger.error('Failed to initialize Docker client:', err.message);
  docker = new Docker(dockerOptions); // Create anyway for error handling
}

const WORKSPACE_IMAGE = process.env.WORKSPACE_IMAGE || 'estro-ai-workspace:latest';
const WORKSPACE_NETWORK = process.env.WORKSPACE_NETWORK || 'workspace-network';
const CONTAINER_MEMORY_LIMIT = parseInt(process.env.CONTAINER_MEMORY_LIMIT) || 512 * 1024 * 1024; // 512MB default

/**
 * Get or create workspace base path
 */
function getWorkspaceBasePath() {
  if (isWindows) {
    // Use a path in user's temp or a dedicated folder
    return process.env.WORKSPACE_BASE_PATH || 'C:/estro-workspaces';
  }
  return process.env.WORKSPACE_BASE_PATH || '/var/workspaces';
}

/**
 * Create a new workspace container
 */
async function createContainer(workspaceId, options = {}) {
  const containerName = `workspace-${workspaceId}`;
  const basePath = getWorkspaceBasePath();
  const workspacePath = `${basePath}/${workspaceId}`;

  try {
    // Ensure base directory exists (for Windows)
    const fs = require('fs');
    const fullPath = isWindows ? workspacePath.replace(/\//g, '\\') : workspacePath;
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }

    // Check if network exists, create if not
    try {
      await docker.getNetwork(WORKSPACE_NETWORK).inspect();
    } catch (e) {
      logger.info(`Creating network: ${WORKSPACE_NETWORK}`);
      await docker.createNetwork({ Name: WORKSPACE_NETWORK });
    }

    const container = await docker.createContainer({
      Image: WORKSPACE_IMAGE,
      name: containerName,
      Hostname: containerName,
      Tty: true,
      Cmd: ['tail', '-f', '/dev/null'], // Keep container running
      HostConfig: {
        Memory: options.memory || CONTAINER_MEMORY_LIMIT,
        MemorySwap: (options.memory || CONTAINER_MEMORY_LIMIT) * 2, // Allow swap
        CpuPeriod: 100000,
        CpuQuota: 50000, // 50% CPU limit
        Binds: [`${workspacePath}:/workspace`],
        NetworkMode: WORKSPACE_NETWORK,
        PortBindings: {
          '3000/tcp': [{ HostPort: '0' }], // Dynamic port assignment
        },
        // Security options for production
        SecurityOpt: process.env.NODE_ENV === 'production' ? ['no-new-privileges'] : [],
        // Auto-remove stopped containers
        AutoRemove: false,
      },
      ExposedPorts: {
        '3000/tcp': {},
      },
      // Labels for container management
      Labels: {
        'estro-ai': 'workspace',
        'workspace-id': workspaceId,
      },
    });

    await container.start();

    const info = await container.inspect();
    const port = info.NetworkSettings.Ports['3000/tcp']?.[0]?.HostPort;

    logger.info(`Container created: ${containerName}, port: ${port}`);

    return {
      containerId: container.id,
      containerName,
      port,
    };
  } catch (error) {
    logger.error('Error creating container:', error);
    throw error;
  }
}

/**
 * Execute a command inside a container with timeout
 */
/**
 * Execute a command inside a container with timeout
 */
async function execCommand(containerId, command, options = {}) {
  const timeout = options.timeout || 30000; // 30 second default timeout
  const onData = options.onData;

  try {
    const container = docker.getContainer(containerId);

    const exec = await container.exec({
      Cmd: ['sh', '-c', command],
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: options.workingDir || '/workspace',
    });

    const stream = await exec.start({ hijack: true, stdin: false });

    return new Promise((resolve, reject) => {
      let output = '';
      let errorOutput = '';
      let resolved = false;

      // Timeout handler
      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          stream.destroy();
          resolve({
            output: output.trim(),
            error: 'Command timed out',
            exitCode: -1,
          });
        }
      }, timeout);

      stream.on('data', (chunk) => {
        // Docker multiplexes stdout/stderr, first 8 bytes are header
        const rawData = chunk.slice(8);
        const data = rawData.toString();
        output += data;

        // Stream data if callback provided
        if (onData) {
          onData(data);
        }
      });

      stream.on('error', (err) => {
        errorOutput += err.message;
      });

      stream.on('end', async () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeoutId);
        try {
          const execInfo = await exec.inspect();
          resolve({
            output: output.trim(),
            error: errorOutput,
            exitCode: execInfo.ExitCode,
          });
        } catch (e) {
          resolve({
            output: output.trim(),
            error: errorOutput || e.message,
            exitCode: -1,
          });
        }
      });
    });
  } catch (error) {
    logger.error('Error executing command:', error);
    throw error;
  }
}

/**
 * Stop and remove a container
 */
async function destroyContainer(containerId) {
  try {
    const container = docker.getContainer(containerId);
    await container.stop();
    await container.remove();
    logger.info(`Container destroyed: ${containerId}`);
  } catch (error) {
    logger.error('Error destroying container:', error);
    throw error;
  }
}

/**
 * Write file inside container
 */
async function writeFile(containerId, filePath, content) {
  // Ensure content has actual newlines, not escaped \n characters
  // GPT sometimes sends escaped newlines in JSON strings
  let processedContent = content;

  // Replace literal \n (two chars) with actual newlines, but not \\n (escaped backslash + n)
  // First, preserve actual escaped backslashes
  processedContent = processedContent.replace(/\\\\n/g, '___ESCAPED_NEWLINE___');
  // Then convert \n to actual newlines
  processedContent = processedContent.replace(/\\n/g, '\n');
  // Restore escaped backslashes
  processedContent = processedContent.replace(/___ESCAPED_NEWLINE___/g, '\\n');

  // Also handle \t (tabs) and \r (carriage returns)
  processedContent = processedContent.replace(/\\t/g, '\t');
  processedContent = processedContent.replace(/\\r/g, '');

  const command = `mkdir -p "$(dirname '${filePath}')" && cat > '${filePath}' << 'ESTRO_EOF'
${processedContent}
ESTRO_EOF`;

  return execCommand(containerId, command);
}

/**
 * Read file from container
 */
async function readFile(containerId, filePath) {
  return execCommand(containerId, `cat '${filePath}'`);
}

/**
 * List files in container directory - optimized for speed
 */
async function listFiles(containerId, dirPath = '/workspace') {
  // Use find with maxdepth and timeout for faster response
  // Exclude common large directories, use -maxdepth to limit recursion
  const result = await execCommand(containerId,
    `find '${dirPath}' -maxdepth 10 \\( -name "node_modules" -o -name ".git" -o -name ".next" -o -name "dist" -o -name "build" -o -name ".cache" -o -name "coverage" \\) -prune -o -type f -print -o -type d -print 2>/dev/null | head -300`,
    { timeout: 10000 } // 10 second timeout for listing
  );

  if (result.exitCode === -1 && result.error === 'Command timed out') {
    logger.warn('listFiles timed out, returning partial results');
  }

  const files = result.output.split('\n').filter(Boolean);
  logger.info(`Listed ${files.length} files in ${dirPath}`);
  return files;
}

/**
 * Get container status
 */
async function getContainerStatus(containerId) {
  try {
    const container = docker.getContainer(containerId);
    const info = await container.inspect();
    return {
      status: info.State.Status,
      running: info.State.Running,
      port: info.NetworkSettings.Ports['3000/tcp']?.[0]?.HostPort,
    };
  } catch (error) {
    return { status: 'not_found', running: false };
  }
}

module.exports = {
  docker,
  createContainer,
  execCommand,
  destroyContainer,
  writeFile,
  readFile,
  listFiles,
  getContainerStatus,
};
