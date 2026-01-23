const Workspace = require('../models/Workspace');
const dockerUtils = require('../utils/docker');
const logger = require('../utils/logger');

/**
 * Execute command in workspace terminal
 */
async function executeCommand(workspaceId, command) {
  const workspace = await Workspace.findById(workspaceId);
  if (!workspace || !workspace.containerId) {
    throw new Error('Workspace not found or container not ready');
  }

  const result = await dockerUtils.execCommand(workspace.containerId, command);

  logger.info(`Terminal command executed in ${workspaceId}: ${command}`);

  return {
    output: result.output,
    error: result.error,
    exitCode: result.exitCode,
  };
}

/**
 * Start development server in workspace
 */
async function startDevServer(workspaceId) {
  const workspace = await Workspace.findById(workspaceId);
  if (!workspace || !workspace.containerId) {
    throw new Error('Workspace not found or container not ready');
  }

  // Kill any existing server first
  await dockerUtils.execCommand(workspace.containerId, 'pkill -f "node|vite|serve" 2>/dev/null || true');
  await new Promise(resolve => setTimeout(resolve, 500));

  // Check if it's a Vite project
  const checkVite = await dockerUtils.execCommand(
    workspace.containerId,
    '[ -f /workspace/vite.config.js ] || [ -f /workspace/vite.config.ts ] && echo "VITE" || echo "OTHER"'
  );

  let startCommand;

  if (checkVite.output?.trim() === 'VITE') {
    // Vite project - use npx vite directly to ensure it's found from node_modules/.bin
    startCommand = 'cd /workspace && npx vite --host 0.0.0.0 --port 3000';
    logger.info('Detected Vite project');
  } else {
    // Check package.json for other project types
    const pkgResult = await dockerUtils.execCommand(workspace.containerId, 'cat /workspace/package.json');

    if (pkgResult.exitCode === 0) {
      try {
        const pkg = JSON.parse(pkgResult.output);
        if (pkg.scripts?.dev) {
          // Use npx to run the dev script's command directly if it uses vite
          startCommand = 'cd /workspace && npx vite --host 0.0.0.0 --port 3000';
        } else if (pkg.scripts?.start) {
          startCommand = 'cd /workspace && npm start';
        } else {
          startCommand = 'serve /workspace -l 3000';
        }
      } catch {
        startCommand = 'serve /workspace -l 3000';
      }
    } else {
      // No package.json - static file server
      startCommand = 'serve /workspace -l 3000';
    }
  }

  logger.info(`Starting server with command: ${startCommand}`);

  // Run in background using bash with proper detach
  // Use setsid to create new session and detach from terminal
  const result = await dockerUtils.execCommand(
    workspace.containerId,
    `bash -c '${startCommand} > /tmp/server.log 2>&1 &'`,
    { timeout: 5000 }
  );

  logger.info(`Server start result: ${JSON.stringify(result)}`);

  // Wait a moment for server to start
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Check if server started by looking at logs
  const logCheck = await dockerUtils.execCommand(
    workspace.containerId,
    'cat /tmp/server.log 2>/dev/null | tail -20'
  );
  logger.info(`Server logs: ${logCheck.output}`);

  // Also check if process is running
  const processCheck = await dockerUtils.execCommand(
    workspace.containerId,
    'ps aux | grep -E "node|vite|serve" | grep -v grep || echo "No process found"'
  );
  logger.info(`Running processes: ${processCheck.output}`);

  return {
    command: startCommand,
    success: true,
    previewUrl: workspace.previewUrl,
    logs: logCheck.output,
  };
}

/**
 * Stop development server in workspace
 */
async function stopDevServer(workspaceId) {
  const workspace = await Workspace.findById(workspaceId);
  if (!workspace || !workspace.containerId) {
    throw new Error('Workspace not found or container not ready');
  }

  // Kill any process on port 3000
  await dockerUtils.execCommand(workspace.containerId, 'pkill -f "node|serve" || true');

  return { success: true };
}

/**
 * Get server logs
 */
async function getServerLogs(workspaceId, lines = 100) {
  const workspace = await Workspace.findById(workspaceId);
  if (!workspace || !workspace.containerId) {
    throw new Error('Workspace not found or container not ready');
  }

  const result = await dockerUtils.execCommand(
    workspace.containerId,
    `tail -n ${lines} /tmp/server.log 2>/dev/null || echo "No logs available"`
  );

  return result.output;
}

/**
 * Install npm packages
 */
async function installPackages(workspaceId, packages = []) {
  const workspace = await Workspace.findById(workspaceId);
  if (!workspace || !workspace.containerId) {
    throw new Error('Workspace not found or container not ready');
  }

  const command = packages.length > 0
    ? `npm install ${packages.join(' ')}`
    : 'npm install';

  const result = await dockerUtils.execCommand(workspace.containerId, command);

  return {
    output: result.output,
    error: result.error,
    success: result.exitCode === 0,
  };
}

module.exports = {
  executeCommand,
  startDevServer,
  stopDevServer,
  getServerLogs,
  installPackages,
};
