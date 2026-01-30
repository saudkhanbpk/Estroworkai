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

const WORKSPACE_IMAGE = process.env.WORKSPACE_IMAGE || 'estro-ai-workspaces:latest';
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
 * Supports timeouts up to 10 minutes (600000ms)
 */
async function execCommand(containerId, command, options = {}) {
  // Support timeouts up to 10 minutes (600000ms), default 30 seconds
  const maxTimeout = 600000; // 10 minutes
  const defaultTimeout = 30000; // 30 seconds
  const requestedTimeout = options.timeout || defaultTimeout;
  const timeout = Math.min(requestedTimeout, maxTimeout);
  
  const onData = options.onData;

  // Log timeout for long-running commands
  if (timeout > 60000) {
    logger.info(`Executing command with extended timeout: ${timeout}ms (${Math.round(timeout / 1000)}s)`);
  }

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
      let lastDataTime = Date.now();

      // Timeout handler
      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          stream.destroy();
          const elapsed = Math.round((Date.now() - lastDataTime) / 1000);
          logger.warn(`Command timed out after ${timeout}ms: ${command.substring(0, 100)}`);
          resolve({
            output: output.trim(),
            error: `Command timed out after ${Math.round(timeout / 1000)} seconds`,
            exitCode: -1,
            timedOut: true,
          });
        }
      }, timeout);

      stream.on('data', (chunk) => {
        // Docker multiplexes stdout/stderr, first 8 bytes are header
        const rawData = chunk.slice(8);
        const data = rawData.toString();
        output += data;
        lastDataTime = Date.now();

        // Stream data if callback provided
        if (onData) {
          try {
            onData(data);
          } catch (e) {
            logger.warn('Error in onData callback:', e.message);
          }
        }
      });

      stream.on('error', (err) => {
        errorOutput += err.message;
        logger.error('Stream error:', err.message);
      });

      stream.on('end', async () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeoutId);
        try {
          const execInfo = await exec.inspect();
          const result = {
            output: output.trim(),
            error: errorOutput || undefined,
            exitCode: execInfo.ExitCode,
          };
          
          // Log command completion for long-running commands
          if (timeout > 60000) {
            logger.info(`Command completed with exit code ${execInfo.ExitCode}`);
          }
          
          resolve(result);
        } catch (e) {
          logger.error('Error inspecting exec:', e.message);
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

/**
 * Fix esbuild binary permissions issue (EACCES error)
 * @param {string} containerId - Docker container ID
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function fixEsbuildPermissions(containerId) {
  try {
    logger.info('Attempting to fix esbuild permissions...');
    
    // Fix permissions on esbuild binary if it exists
    const fixResult = await execCommand(
      containerId,
      'cd /workspace && find node_modules/esbuild -type f -name "esbuild" -exec chmod +x {} \\; 2>/dev/null || true',
      { timeout: 10000 }
    );
    
    // Rebuild esbuild to ensure it's properly installed
    const rebuildResult = await execCommand(
      containerId,
      'cd /workspace && npm rebuild esbuild --force 2>&1 || true',
      { timeout: 60000 }
    );
    
    // Verify esbuild binary is now executable
    const verifyResult = await execCommand(
      containerId,
      '[ -x /workspace/node_modules/esbuild/bin/esbuild ] && echo "EXECUTABLE" || echo "NOT_EXECUTABLE"',
      { timeout: 5000 }
    );
    
    if (verifyResult.output?.trim() === 'EXECUTABLE') {
      logger.info('esbuild permissions fixed successfully');
      return { success: true, message: 'esbuild binary is now executable' };
    } else {
      logger.warn('esbuild binary still not executable after fix attempt');
      return { success: false, message: 'Could not fix esbuild permissions' };
    }
  } catch (error) {
    logger.error('Error fixing esbuild permissions:', error);
    return { success: false, message: error.message };
  }
}

/**
 * Verify that dependencies are installed in the workspace
 * @param {string} containerId - Docker container ID
 * @returns {Promise<{installed: boolean, packagesFound: string[], missingPackages: string[], details: object}>}
 */
async function verifyDependencies(containerId) {
  try {
    // Check if node_modules directory exists
    const checkNodeModules = await execCommand(
      containerId,
      '[ -d /workspace/node_modules ] && echo "EXISTS" || echo "MISSING"',
      { timeout: 5000 }
    );

    const hasNodeModules = checkNodeModules.output?.trim() === 'EXISTS';

    // Check for package.json
    const checkPackageJson = await execCommand(
      containerId,
      '[ -f /workspace/package.json ] && echo "EXISTS" || echo "MISSING"',
      { timeout: 5000 }
    );

    const hasPackageJson = checkPackageJson.output?.trim() === 'EXISTS';

    if (!hasPackageJson) {
      return {
        installed: false,
        packagesFound: [],
        missingPackages: ['package.json'],
        details: { reason: 'No package.json found' }
      };
    }

    // Read package.json to check required dependencies
    let packageJson = null;
    try {
      const pkgResult = await readFile(containerId, '/workspace/package.json');
      if (pkgResult.exitCode === 0 && pkgResult.output) {
        packageJson = JSON.parse(pkgResult.output);
      }
    } catch (e) {
      logger.warn('Failed to parse package.json:', e.message);
    }

    const packagesFound = [];
    const missingPackages = [];

    if (hasNodeModules) {
      // Check for common required packages
      const commonPackages = ['vite', 'react', 'react-dom', '@vitejs/plugin-react'];
      
      for (const pkg of commonPackages) {
        const checkPkg = await execCommand(
          containerId,
          `[ -d /workspace/node_modules/${pkg} ] && echo "EXISTS" || echo "MISSING"`,
          { timeout: 5000 }
        );
        
        if (checkPkg.output?.trim() === 'EXISTS') {
          packagesFound.push(pkg);
        } else if (packageJson && (
          (packageJson.dependencies && packageJson.dependencies[pkg]) ||
          (packageJson.devDependencies && packageJson.devDependencies[pkg])
        )) {
          missingPackages.push(pkg);
        }
      }

      // Check for package-lock.json or yarn.lock
      const checkLock = await execCommand(
        containerId,
        '[ -f /workspace/package-lock.json ] || [ -f /workspace/yarn.lock ] && echo "EXISTS" || echo "MISSING"',
        { timeout: 5000 }
      );
      const hasLockFile = checkLock.output?.trim() === 'EXISTS';

      // If node_modules exists and has at least some packages, consider it installed
      // But warn if critical packages are missing
      if (packagesFound.length > 0 || hasLockFile) {
        return {
          installed: true,
          packagesFound,
          missingPackages,
          details: {
            hasNodeModules: true,
            hasLockFile,
            totalPackagesFound: packagesFound.length
          }
        };
      }
    }

    // If we get here, dependencies are not properly installed
    return {
      installed: false,
      packagesFound,
      missingPackages: missingPackages.length > 0 ? missingPackages : ['node_modules'],
      details: {
        hasNodeModules,
        hasPackageJson,
        reason: hasNodeModules ? 'node_modules exists but required packages missing' : 'node_modules directory not found'
      }
    };
  } catch (error) {
    logger.error('Error verifying dependencies:', error);
    return {
      installed: false,
      packagesFound: [],
      missingPackages: ['verification_failed'],
      details: { error: error.message }
    };
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
  verifyDependencies,
  fixEsbuildPermissions,
};
