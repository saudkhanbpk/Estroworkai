const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');
const Workspace = require('../models/Workspace');
const dockerUtils = require('../utils/docker');
const { executeAgent, AgentMode } = require('../agents/codeAgent');
const logger = require('../utils/logger');
const errorHandler = require('../utils/errorHandler');

// Windows-compatible path
const isWindows = process.platform === 'win32';
const WORKSPACE_BASE_PATH = process.env.WORKSPACE_BASE_PATH || (isWindows ? 'C:/estro-workspaces' : '/var/workspaces');

/**
 * Copy pre-built template to workspace (dependencies already installed)
 */
async function copyTemplateToWorkspace(containerId) {
  try {
    logger.info('Copying pre-built template to workspace...');
    
    // Copy template files to workspace (template has node_modules pre-installed)
    const copyResult = await dockerUtils.execCommand(
      containerId,
      'cp -r /template/* /workspace/ && cp -r /template/node_modules /workspace/ 2>/dev/null || true',
      { timeout: 30000 }
    );
    
    if (copyResult.exitCode !== 0 && !copyResult.output?.includes('No such file')) {
      logger.warn('Template copy warning:', copyResult.error || copyResult.output);
    }
    
    // Verify template was copied
    const verifyResult = await dockerUtils.execCommand(
      containerId,
      '[ -d /workspace/node_modules ] && [ -f /workspace/package.json ] && echo "OK" || echo "FAILED"',
      { timeout: 5000 }
    );
    
    if (verifyResult.output?.trim() === 'OK') {
      logger.info('Template copied successfully with pre-installed dependencies');
      return { success: true };
    } else {
      logger.warn('Template copy verification failed, will fall back to npm install');
      return { success: false };
    }
  } catch (error) {
    logger.error('Error copying template:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Create a new workspace with isolated container
 */
async function createWorkspace(userId, name, prompt) {
  const workspaceId = uuidv4();
  const workspacePath = path.join(WORKSPACE_BASE_PATH, workspaceId);

  // Create workspace directory
  try {
    await fs.mkdir(workspacePath, { recursive: true });
  } catch (err) {
    logger.warn('Directory creation note:', err.message);
  }

  // Create workspace record
  const workspace = new Workspace({
    userId,
    name,
    prompt,
    status: 'creating',
    // Save the initial user prompt as first chat message
    chatMessages: [{
      role: 'user',
      content: prompt,
      type: 'text',
      timestamp: new Date(),
    }],
  });
  await workspace.save();

  try {
    // Create Docker container
    const containerInfo = await dockerUtils.createContainer(workspaceId);

    // Update workspace with container info
    workspace.containerId = containerInfo.containerId;
    workspace.containerName = containerInfo.containerName;
    workspace.port = containerInfo.port;
    workspace.status = 'running';
    // Use actual port for local development/host-mode, virtual hostname for container-mode
    const domain = process.env.DOMAIN || 'localhost';
    const publicIp = process.env.PUBLIC_IP; // NEW: Support for manual IP mapping

    if (containerInfo.port) {
      // Host mode: Docker maps port to host
      const host = publicIp || 'localhost';
      workspace.previewUrl = `http://${host}:${containerInfo.port}`;
    } else {
      // Container mode: Virtual hostname
      workspace.previewUrl = `http://preview-${workspaceId}.${domain}`;
    }
    await workspace.save();
    
    // Copy pre-built template to workspace (includes node_modules)
    const templateResult = await copyTemplateToWorkspace(containerInfo.containerId);
    if (templateResult.success) {
      logger.info('Workspace initialized with pre-built template');
    } else {
      logger.info('Template not available, AI will create project from scratch');
    }

    logger.info(`Workspace created: ${workspaceId}`);

    return workspace;
  } catch (error) {
    workspace.status = 'error';
    workspace.agentLogs.push({
      action: 'createError',
      details: { error: error.message },
    });
    await workspace.save();
    throw error;
  }
}

/**
 * Start AI agent to generate code
 */
async function startAgent(workspaceId, io) {
  const workspace = await Workspace.findById(workspaceId);
  if (!workspace || !workspace.containerId) {
    throw new Error('Workspace not found or container not ready');
  }

  // Collect logs in memory to avoid race conditions
  const agentLogs = [];

  const onUpdate = async (update) => {
    // Emit real-time updates via WebSocket
    try {
      io?.to(`workspace:${workspaceId}`).emit('agent:update', update);

      // If a file was written or updated, or a command finished effectively, refresh file list
      if (
        (update.action === 'writeFile' || update.action === 'updateFile' || (update.action === 'runCommand' && update.success)) &&
        !update.ephemeral
      ) {
        // Run listFiles in background to update frontend
        dockerUtils.listFiles(workspace.containerId).then(files => {
          io?.to(`workspace:${workspaceId}`).emit('workspace:updated', {
            files: files.map((f) => ({
              path: f,
              type: f.endsWith('/') ? 'directory' : 'file',
              lastModified: new Date(),
            })),
            status: 'running'
          });
        }).catch(err => {
          logger.warn('Failed to refresh file list:', err.message);
        });
      }

      // NEW: Add chat message for file operations
      if ((update.action === 'writeFile' || update.action === 'updateFile') && update.success && !update.ephemeral) {
        const messageContent = update.action === 'writeFile'
          ? `Created file: ${update.path}`
          : `Updated file: ${update.path}`;

        const chatMessage = {
          role: 'assistant',
          content: messageContent,
          type: 'success',
          timestamp: new Date()
        };

        try {
          await Workspace.findByIdAndUpdate(workspaceId, {
            $push: { chatMessages: chatMessage }
          });
          io?.to(`workspace:${workspaceId}`).emit('message:new', chatMessage);
        } catch (err) {
          logger.warn('Failed to save chat message:', err.message);
        }
      }
    } catch (err) {
      logger.warn('WebSocket emit error:', err.message);
    }

    // Collect logs to save later, skipping ephemeral updates
    if (!update.ephemeral) {
      agentLogs.push({
        action: update.action,
        details: update,
        timestamp: new Date(),
      });
    }
  };

  try {
    const result = await executeAgent(workspace.containerId, workspace.prompt, onUpdate);

    // Use atomic update to avoid version conflicts
    const updateData = {
      $push: {
        agentLogs: { $each: agentLogs }
      }
    };

    if (result.success) {
      // Update file list
      const files = await dockerUtils.listFiles(workspace.containerId);
      updateData.$set = {
        status: 'ready',
        files: files.map((f) => ({
          path: f,
          type: f.endsWith('/') ? 'directory' : 'file',
          lastModified: new Date(),
        }))
      };

      // Auto-start server for preview
      try {
        logger.info(`Auto-starting server for workspace: ${workspaceId}`);
        
        // First, verify dependencies are installed
        logger.info('Verifying dependencies before starting server...');
        const verification = await dockerUtils.verifyDependencies(workspace.containerId);
        
        if (!verification.installed) {
          logger.warn(`Dependencies not installed. Missing: ${verification.missingPackages.join(', ')}`);
          logger.info('Running npm install to install missing dependencies...');
          
          // Check if npm install is already running
          const checkNpmProcess = await dockerUtils.execCommand(
            workspace.containerId,
            'ps aux | grep -E "npm install|npm i" | grep -v grep || echo "NOT_RUNNING"',
            { timeout: 5000 }
          );
          
          if (checkNpmProcess.output?.trim() !== 'NOT_RUNNING') {
            logger.info('npm install is already running, waiting for it to complete...');
            // Wait up to 5 minutes for npm install to complete
            for (let i = 0; i < 30; i++) {
              await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
              const stillRunning = await dockerUtils.execCommand(
                workspace.containerId,
                'ps aux | grep -E "npm install|npm i" | grep -v grep || echo "NOT_RUNNING"',
                { timeout: 5000 }
              );
              if (stillRunning.output?.trim() === 'NOT_RUNNING') {
                logger.info('npm install completed');
                break;
              }
              if (i === 29) {
                logger.warn('npm install still running after 5 minutes, proceeding anyway...');
              }
            }
          } else {
            // Run npm install with extended timeout
            const npmInstallTimeout = parseInt(process.env.NPM_INSTALL_TIMEOUT) || 300000; // 5 minutes
            logger.info(`Running npm install with ${npmInstallTimeout}ms timeout...`);
            
            io?.to(`workspace:${workspaceId}`).emit('agent:update', {
              action: 'log',
              message: 'Installing dependencies before starting server...',
              ephemeral: false
            });
            
            const installResult = await dockerUtils.execCommand(
              workspace.containerId,
              'cd /workspace && npm install --legacy-peer-deps',
              { 
                timeout: npmInstallTimeout,
                onData: (data) => {
                  io?.to(`workspace:${workspaceId}`).emit('agent:update', {
                    action: 'log',
                    message: data,
                    ephemeral: true
                  });
                }
              }
            );
            
            if (installResult.exitCode !== 0) {
              const errorMsg = installResult.error || installResult.output || '';
              
              // Check if it's the esbuild EACCES error
              if (errorMsg.includes('esbuild/bin/esbuild') && errorMsg.includes('EACCES')) {
                logger.warn('Detected esbuild EACCES error, attempting auto-fix...');
                io?.to(`workspace:${workspaceId}`).emit('agent:update', {
                  action: 'log',
                  message: 'Fixing esbuild permissions...',
                  ephemeral: false
                });
                
                // Fix esbuild permissions
                const fixResult = await dockerUtils.fixEsbuildPermissions(workspace.containerId);
                
                if (fixResult.success) {
                  logger.info('esbuild permissions fixed, retrying npm install...');
                  io?.to(`workspace:${workspaceId}`).emit('agent:update', {
                    action: 'log',
                    message: 'Retrying npm install after fixing permissions...',
                    ephemeral: false
                  });
                  
                  // Retry npm install
                  const retryResult = await dockerUtils.execCommand(
                    workspace.containerId,
                    'cd /workspace && npm install --legacy-peer-deps',
                    { 
                      timeout: npmInstallTimeout,
                      onData: (data) => {
                        io?.to(`workspace:${workspaceId}`).emit('agent:update', {
                          action: 'log',
                          message: data,
                          ephemeral: true
                        });
                      }
                    }
                  );
                  
                  if (retryResult.exitCode === 0) {
                    logger.info('npm install succeeded after esbuild fix');
                    // Continue to verification below
                  } else {
                    logger.error(`npm install still failed after esbuild fix: ${retryResult.error || retryResult.output}`);
                    io?.to(`workspace:${workspaceId}`).emit('server:error', {
                      errors: [{
                        title: 'Dependency Installation Failed',
                        message: retryResult.error || retryResult.output || 'npm install failed even after fixing esbuild',
                        suggestion: 'Try running npm install manually in the terminal'
                      }],
                      autoFixApplied: true
                    });
                    throw new Error('Failed to install dependencies after esbuild fix');
                  }
                } else {
                  logger.error(`Could not fix esbuild permissions: ${fixResult.message}`);
                  io?.to(`workspace:${workspaceId}`).emit('server:error', {
                    errors: [{
                      title: 'Dependency Installation Failed',
                      message: `esbuild permission error: ${errorMsg}`,
                      suggestion: 'Try running: chmod +x node_modules/esbuild/bin/esbuild && npm rebuild esbuild'
                    }],
                    autoFixApplied: false
                  });
                  throw new Error('Failed to install dependencies - esbuild permission issue');
                }
              } else {
                // Other npm install errors
                logger.error(`npm install failed: ${errorMsg}`);
                io?.to(`workspace:${workspaceId}`).emit('server:error', {
                  errors: [{
                    title: 'Dependency Installation Failed',
                    message: errorMsg || 'npm install failed',
                    suggestion: 'Try running npm install manually in the terminal'
                  }],
                  autoFixApplied: false
                });
                throw new Error('Failed to install dependencies');
              }
            }
            
            // Verify again after installation
            const reVerification = await dockerUtils.verifyDependencies(workspace.containerId);
            if (!reVerification.installed) {
              logger.error(`Dependencies still missing after install: ${reVerification.missingPackages.join(', ')}`);
              throw new Error(`Dependencies verification failed: ${reVerification.missingPackages.join(', ')}`);
            }
            
            logger.info('Dependencies verified successfully');
          }
        } else {
          logger.info(`Dependencies verified. Found packages: ${verification.packagesFound.join(', ')}`);
        }
        
        // Kill any existing processes
        await dockerUtils.execCommand(
          workspace.containerId,
          'pkill -f "node|vite|serve" 2>/dev/null || true'
        );
        await new Promise(resolve => setTimeout(resolve, 500));

        // Check if it's a Vite/React project (has vite.config)
        const checkVite = await dockerUtils.execCommand(
          workspace.containerId,
          '[ -f /workspace/vite.config.js ] || [ -f /workspace/vite.config.ts ] && echo "VITE" || echo "STATIC"'
        );

        let serverCommand;
        if (checkVite.output?.trim() === 'VITE') {
          // Run Vite dev server with host flag to allow external access
          logger.info('Starting Vite dev server...');
          serverCommand = 'cd /workspace && npx vite --host 0.0.0.0 --port 3000';
        } else {
          // Fallback to static serve for vanilla HTML projects
          logger.info('Starting static file server...');
          serverCommand = 'serve /workspace -l 3000';
        }

        // Start server in background using bash
        await dockerUtils.execCommand(
          workspace.containerId,
          `bash -c '${serverCommand} > /tmp/server.log 2>&1 &'`,
          { timeout: 5000 }
        );

        // Wait for server to start
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Log server status
        const logCheck = await dockerUtils.execCommand(
          workspace.containerId,
          'cat /tmp/server.log 2>/dev/null | tail -10'
        );
        logger.info(`Server logs: ${logCheck.output}`);

        // Check if server failed due to missing modules and try again
        if (logCheck.output?.includes('Cannot find module')) {
          // Parse the error to get user-friendly message
          const parsedErrors = errorHandler.parseErrors(logCheck.output);
          const fixes = errorHandler.getAutoFixCommands(parsedErrors);

          logger.info('Server failed due to missing module, attempting auto-fix...');
          logger.info(`Detected issues: ${errorHandler.createErrorSummary(parsedErrors)}`);

          await dockerUtils.execCommand(
            workspace.containerId,
            'pkill -f "node|vite" 2>/dev/null || true'
          );

          // Run specific fixes if available
          for (const fix of fixes) {
            logger.info(`Running auto-fix: ${fix.command}`);
            await dockerUtils.execCommand(
              workspace.containerId,
              `cd /workspace && ${fix.command}`,
              { timeout: 60000 }
            );
          }

          // Fallback to npm install if no specific fixes
          if (fixes.length === 0) {
            const npmInstallTimeout = parseInt(process.env.NPM_INSTALL_TIMEOUT) || 300000; // 5 minutes
            logger.info('Running npm install as fallback fix...');
            await dockerUtils.execCommand(
              workspace.containerId,
              'cd /workspace && npm install --legacy-peer-deps',
              { timeout: npmInstallTimeout }
            );
            
            // Verify dependencies after install
            const postFixVerification = await dockerUtils.verifyDependencies(workspace.containerId);
            if (!postFixVerification.installed) {
              logger.error(`Dependencies still missing after fix: ${postFixVerification.missingPackages.join(', ')}`);
            }
          }

          await dockerUtils.execCommand(
            workspace.containerId,
            `bash -c '${serverCommand} > /tmp/server.log 2>&1 &'`,
            { timeout: 5000 }
          );
          await new Promise(resolve => setTimeout(resolve, 3000));

          // Emit the parsed errors to frontend
          io?.to(`workspace:${workspaceId}`).emit('server:error', {
            errors: errorHandler.formatErrorsForResponse(parsedErrors),
            autoFixApplied: fixes.length > 0,
          });
        }

        logger.info(`Server started for workspace: ${workspaceId}`);
      } catch (serverErr) {
        logger.warn('Failed to auto-start server:', serverErr.message);
      }
    } else {
      updateData.$set = { status: 'error' };
    }

    // Atomic update - no version conflicts
    const updatedWorkspace = await Workspace.findByIdAndUpdate(
      workspaceId,
      updateData,
      { new: true }
    );

    // Emit completion to all clients
    io?.to(`workspace:${workspaceId}`).emit('workspace:updated', {
      files: updatedWorkspace?.files?.map(f => f.path) || [],
      status: updatedWorkspace?.status,
    });

    return result;
  } catch (error) {
    logger.error('Agent execution error:', error);

    // Try to update workspace status atomically
    try {
      await Workspace.findByIdAndUpdate(workspaceId, {
        $set: { status: 'error' },
        $push: { agentLogs: { action: 'error', details: { message: error.message } } }
      });
    } catch (updateErr) {
      logger.error('Failed to update workspace status:', updateErr);
    }

    throw error;
  }
}

/**
 * Get workspace by ID
 */
async function getWorkspace(workspaceId) {
  return Workspace.findById(workspaceId);
}

/**
 * Get all workspaces for a user
 */
async function getUserWorkspaces(userId) {
  return Workspace.find({ userId, status: { $ne: 'destroyed' } })
    .sort({ updatedAt: -1 });
}

/**
 * Destroy workspace and cleanup
 */
async function destroyWorkspace(workspaceId) {
  const workspace = await Workspace.findById(workspaceId);
  if (!workspace) {
    throw new Error('Workspace not found');
  }

  if (workspace.containerId) {
    try {
      await dockerUtils.destroyContainer(workspace.containerId);
    } catch (error) {
      logger.warn('Error destroying container:', error);
    }
  }

  workspace.status = 'destroyed';
  workspace.containerId = null;
  await workspace.save();

  // Optionally cleanup files
  const workspacePath = path.join(WORKSPACE_BASE_PATH, workspaceId);
  try {
    await fs.rm(workspacePath, { recursive: true, force: true });
  } catch (error) {
    logger.warn('Error cleaning up workspace files:', error);
  }

  return workspace;
}

/**
 * Get workspace status
 */
async function getWorkspaceStatus(workspaceId) {
  const workspace = await Workspace.findById(workspaceId);
  if (!workspace) {
    return { status: 'not_found' };
  }

  if (workspace.containerId) {
    const containerStatus = await dockerUtils.getContainerStatus(workspace.containerId);
    return {
      ...workspace.toObject(),
      containerStatus,
    };
  }

  return workspace.toObject();
}

/**
 * Run a new prompt on existing workspace (for follow-up requests)
 */
async function runPrompt(workspaceId, prompt, io) {
  const workspace = await Workspace.findById(workspaceId);
  if (!workspace || !workspace.containerId) {
    throw new Error('Workspace not found or container not ready');
  }

  // Collect logs in memory
  const agentLogs = [];

  const onUpdate = async (update) => {
    try {
      io?.to(`workspace:${workspaceId}`).emit('agent:update', update);

      // If a file was written or updated, or a command finished effectively, refresh file list
      if (
        (update.action === 'writeFile' || update.action === 'updateFile' || (update.action === 'runCommand' && update.success)) &&
        !update.ephemeral
      ) {
        dockerUtils.listFiles(workspace.containerId).then(files => {
          io?.to(`workspace:${workspaceId}`).emit('workspace:updated', {
            files: files.map((f) => ({
              path: f,
              type: f.endsWith('/') ? 'directory' : 'file',
              lastModified: new Date(),
            })),
            status: 'running'
          });
        }).catch(err => {
          logger.warn('Failed to refresh file list:', err.message);
        });
      }
      // Auto-detect URL format
      const publicIp = process.env.PUBLIC_IP;
      const host = publicIp || 'localhost';
      const domain = process.env.DOMAIN || 'localhost';

      // If we have a direct port mapping, use it
      if (workspace.port) {
        // In host mode, we might update the previewUrl just in case
        // but usually it stays the same unless container recreated
      } else {
        // ensure correct format
      }
      // NEW: Add chat message for file operations
      if ((update.action === 'writeFile' || update.action === 'updateFile') && update.success && !update.ephemeral) {
        const messageContent = update.action === 'writeFile'
          ? `Created file: ${update.path}`
          : `Updated file: ${update.path}`;

        const chatMessage = {
          role: 'assistant',
          content: messageContent,
          type: 'success',
          timestamp: new Date()
        };

        try {
          await Workspace.findByIdAndUpdate(workspaceId, {
            $push: { chatMessages: chatMessage }
          });
          io?.to(`workspace:${workspaceId}`).emit('message:new', chatMessage);
        } catch (err) {
          logger.warn('Failed to save chat message:', err.message);
        }
      }
    } catch (err) {
      logger.warn('WebSocket emit error:', err.message);
    }

    // Skip ephemeral logs for database storage
    if (!update.ephemeral) {
      agentLogs.push({
        action: update.action,
        details: update,
        timestamp: new Date(),
      });
    }
  };

  try {
    // Use UPDATE mode for follow-up prompts - this tells the agent to read files first
    // and use updateFile instead of writeFile
    const contextPrompt = `User's request: ${prompt}

IMPORTANT: This is a modification request for an EXISTING project.
You MUST read the relevant files first before making changes.
Use updateFile to modify existing files, not writeFile.`;

    // Execute in UPDATE mode - agent will read files first before modifying
    const result = await executeAgent(workspace.containerId, contextPrompt, onUpdate, AgentMode.UPDATE);

    // Use atomic update to avoid version conflicts
    const updateData = {
      $push: {
        agentLogs: { $each: agentLogs }
      }
    };

    if (result.success) {
      // Update file list
      const files = await dockerUtils.listFiles(workspace.containerId);
      updateData.$set = {
        status: 'ready',
        files: files.map((f) => ({
          path: f,
          type: f.endsWith('/') ? 'directory' : 'file',
          lastModified: new Date(),
        }))
      };

      // Auto-restart server for preview
      try {
        logger.info(`Restarting server for workspace: ${workspaceId}`);
        
        // Verify dependencies before restarting server
        logger.info('Verifying dependencies before restarting server...');
        const verification = await dockerUtils.verifyDependencies(workspace.containerId);
        
        if (!verification.installed) {
          logger.warn(`Dependencies not installed. Missing: ${verification.missingPackages.join(', ')}`);
          logger.info('Running npm install to install missing dependencies...');
          
          const npmInstallTimeout = parseInt(process.env.NPM_INSTALL_TIMEOUT) || 300000; // 5 minutes
          logger.info(`Running npm install with ${npmInstallTimeout}ms timeout...`);
          
          io?.to(`workspace:${workspaceId}`).emit('agent:update', {
            action: 'log',
            message: 'Installing dependencies before restarting server...',
            ephemeral: false
          });
          
          const installResult = await dockerUtils.execCommand(
            workspace.containerId,
            'cd /workspace && npm install --legacy-peer-deps',
            { 
              timeout: npmInstallTimeout,
              onData: (data) => {
                io?.to(`workspace:${workspaceId}`).emit('agent:update', {
                  action: 'log',
                  message: data,
                  ephemeral: true
                });
              }
            }
          );
          
          if (installResult.exitCode !== 0) {
            const errorMsg = installResult.error || installResult.output || '';
            
            // Check if it's the esbuild EACCES error
            if (errorMsg.includes('esbuild/bin/esbuild') && errorMsg.includes('EACCES')) {
              logger.warn('Detected esbuild EACCES error, attempting auto-fix...');
              io?.to(`workspace:${workspaceId}`).emit('agent:update', {
                action: 'log',
                message: 'Fixing esbuild permissions...',
                ephemeral: false
              });
              
              // Fix esbuild permissions
              const fixResult = await dockerUtils.fixEsbuildPermissions(workspace.containerId);
              
              if (fixResult.success) {
                logger.info('esbuild permissions fixed, retrying npm install...');
                io?.to(`workspace:${workspaceId}`).emit('agent:update', {
                  action: 'log',
                  message: 'Retrying npm install after fixing permissions...',
                  ephemeral: false
                });
                
                // Retry npm install
                const retryResult = await dockerUtils.execCommand(
                  workspace.containerId,
                  'cd /workspace && npm install --legacy-peer-deps',
                  { 
                    timeout: npmInstallTimeout,
                    onData: (data) => {
                      io?.to(`workspace:${workspaceId}`).emit('agent:update', {
                        action: 'log',
                        message: data,
                        ephemeral: true
                      });
                    }
                  }
                );
                
                if (retryResult.exitCode === 0) {
                  logger.info('npm install succeeded after esbuild fix');
                  // Continue to verification below
                } else {
                  logger.error(`npm install still failed after esbuild fix: ${retryResult.error || retryResult.output}`);
                  throw new Error('Failed to install dependencies after esbuild fix');
                }
              } else {
                logger.error(`Could not fix esbuild permissions: ${fixResult.message}`);
                throw new Error('Failed to install dependencies - esbuild permission issue');
              }
            } else {
              // Other npm install errors
              logger.error(`npm install failed: ${errorMsg}`);
              throw new Error('Failed to install dependencies');
            }
          }
          
          // Verify again after installation
          const reVerification = await dockerUtils.verifyDependencies(workspace.containerId);
          if (!reVerification.installed) {
            logger.error(`Dependencies still missing after install: ${reVerification.missingPackages.join(', ')}`);
            throw new Error(`Dependencies verification failed: ${reVerification.missingPackages.join(', ')}`);
          }
          
          logger.info('Dependencies verified successfully');
        }
        
        await dockerUtils.execCommand(
          workspace.containerId,
          'pkill -f "node|vite|serve" 2>/dev/null || true'
        );
        await new Promise(resolve => setTimeout(resolve, 500));

        // Check if it's a Vite/React project
        const checkVite = await dockerUtils.execCommand(
          workspace.containerId,
          '[ -f /workspace/vite.config.js ] || [ -f /workspace/vite.config.ts ] && echo "VITE" || echo "STATIC"'
        );

        let serverCommand;
        if (checkVite.output?.trim() === 'VITE') {
          logger.info('Starting Vite dev server...');
          serverCommand = 'cd /workspace && npx vite --host 0.0.0.0 --port 3000';
        } else {
          logger.info('Starting static file server...');
          serverCommand = 'serve /workspace -l 3000';
        }

        await dockerUtils.execCommand(
          workspace.containerId,
          `bash -c '${serverCommand} > /tmp/server.log 2>&1 &'`,
          { timeout: 5000 }
        );

        // Wait for server to start
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Check if server failed and retry
        const logCheck = await dockerUtils.execCommand(
          workspace.containerId,
          'cat /tmp/server.log 2>/dev/null | tail -10'
        );
        if (logCheck.output?.includes('Cannot find module')) {
          // Parse and auto-fix errors
          const parsedErrors = errorHandler.parseErrors(logCheck.output);
          const fixes = errorHandler.getAutoFixCommands(parsedErrors);

          logger.info('Server failed, applying auto-fixes...');
          await dockerUtils.execCommand(workspace.containerId, 'pkill -f "node|vite" 2>/dev/null || true');

          // Apply fixes
          for (const fix of fixes) {
            await dockerUtils.execCommand(workspace.containerId, `cd /workspace && ${fix.command}`, { timeout: 60000 });
          }

          if (fixes.length === 0) {
            const npmInstallTimeout = parseInt(process.env.NPM_INSTALL_TIMEOUT) || 300000; // 5 minutes
            logger.info('Running npm install as fallback fix...');
            await dockerUtils.execCommand(
              workspace.containerId, 
              'cd /workspace && npm install --legacy-peer-deps', 
              { timeout: npmInstallTimeout }
            );
            
            // Verify dependencies after install
            const postFixVerification = await dockerUtils.verifyDependencies(workspace.containerId);
            if (!postFixVerification.installed) {
              logger.error(`Dependencies still missing after fix: ${postFixVerification.missingPackages.join(', ')}`);
            }
          }

          await dockerUtils.execCommand(workspace.containerId, `bash -c '${serverCommand} > /tmp/server.log 2>&1 &'`, { timeout: 5000 });
          await new Promise(resolve => setTimeout(resolve, 3000));

          // Emit errors to frontend
          io?.to(`workspace:${workspaceId}`).emit('server:error', {
            errors: errorHandler.formatErrorsForResponse(parsedErrors),
            autoFixApplied: fixes.length > 0,
          });
        }
      } catch (serverErr) {
        logger.warn('Failed to restart server:', serverErr.message);
      }
    } else {
      updateData.$set = { status: 'error' };
    }

    // Atomic update - no version conflicts
    const updatedWorkspace = await Workspace.findByIdAndUpdate(
      workspaceId,
      updateData,
      { new: true }
    );

    // Emit completion
    io?.to(`workspace:${workspaceId}`).emit('workspace:updated', {
      files: updatedWorkspace?.files?.map(f => f.path) || [],
      status: updatedWorkspace?.status,
    });

    return result;
  } catch (error) {
    logger.error('Run prompt error:', error);

    try {
      await Workspace.findByIdAndUpdate(workspaceId, {
        $set: { status: 'error' },
        $push: { agentLogs: { action: 'error', details: { message: error.message } } }
      });
    } catch (updateErr) {
      logger.error('Failed to update workspace status:', updateErr);
    }

    throw error;
  }
}

/**
 * Add a chat message to workspace - using atomic update
 */
async function addChatMessage(workspaceId, message) {
  const chatMessage = {
    role: message.role,
    content: message.content,
    type: message.type || 'text',
    timestamp: new Date(),
  };

  const result = await Workspace.findByIdAndUpdate(
    workspaceId,
    { $push: { chatMessages: chatMessage } },
    { new: true }
  );

  if (!result) {
    throw new Error('Workspace not found');
  }

  return chatMessage;
}

/**
 * Get chat messages for workspace
 */
async function getChatMessages(workspaceId) {
  const workspace = await Workspace.findById(workspaceId);
  if (!workspace) {
    throw new Error('Workspace not found');
  }

  return workspace.chatMessages || [];
}

module.exports = {
  createWorkspace,
  startAgent,
  runPrompt,
  getWorkspace,
  getUserWorkspaces,
  destroyWorkspace,
  addChatMessage,
  getChatMessages,
  getWorkspaceStatus,
};
