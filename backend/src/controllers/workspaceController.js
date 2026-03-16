const jwt = require('jsonwebtoken');
const workspaceService = require('../services/workspaceService');
const codeValidator = require('../services/codeValidator');
const logger = require('../utils/logger');

/**
 * Create a new workspace
 */
async function createWorkspace(req, res) {
  try {
    const { name, prompt } = req.body;
    const userId = req.user.id;

    if (!name || !prompt) {
      return res.status(400).json({ error: 'Name and prompt are required' });
    }

    const workspace = await workspaceService.createWorkspace(userId, name, prompt);
    const io = req.app.get('io');

    // Return workspace immediately
    res.status(201).json({
      success: true,
      workspace: {
        id: workspace._id,
        name: workspace.name,
        status: workspace.status,
        previewUrl: workspace.previewUrl,
        port: workspace.port,
      },
    });

    // Start AI agent in background (non-blocking)
    logger.info(`Starting AI agent for workspace: ${workspace._id}`);
    workspaceService.startAgent(workspace._id, io).catch((err) => {
      logger.error('Background agent error:', err);
    });
  } catch (error) {
    logger.error('Create workspace error:', error);
    res.status(500).json({ error: 'Failed to create workspace' });
  }
}

/**
 * Start AI agent for workspace
 */
async function startAgent(req, res) {
  try {
    const { id } = req.params;
    const io = req.app.get('io');

    const result = await workspaceService.startAgent(id, io);

    res.json({
      success: result.success,
      output: result.output,
      error: result.error,
    });
  } catch (error) {
    logger.error('Start agent error:', error);
    res.status(500).json({ error: 'Failed to start agent' });
  }
}

/**
 * Run a new prompt on existing workspace
 */
async function runPrompt(req, res) {
  try {
    const { id } = req.params;
    const { prompt } = req.body;
    const io = req.app.get('io');

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Return immediately, run agent in background
    res.json({ success: true, message: 'Processing prompt...' });

    // Run agent with new prompt in background
    logger.info(`Running prompt for workspace ${id}: ${prompt.substring(0, 50)}...`);
    workspaceService.runPrompt(id, prompt, io).catch((err) => {
      logger.error('Run prompt error:', err);
    });
  } catch (error) {
    logger.error('Run prompt error:', error);
    res.status(500).json({ error: 'Failed to process prompt' });
  }
}

/**
 * Get workspace by ID
 */
async function getWorkspace(req, res) {
  try {
    const { id } = req.params;
    const workspace = await workspaceService.getWorkspace(id);

    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    res.json({ workspace });
  } catch (error) {
    logger.error('Get workspace error:', error);
    res.status(500).json({ error: 'Failed to get workspace' });
  }
}

/**
 * Get all workspaces for current user
 */
async function getUserWorkspaces(req, res) {
  try {
    const userId = req.user.id;
    const workspaces = await workspaceService.getUserWorkspaces(userId);

    res.json({ workspaces });
  } catch (error) {
    logger.error('Get user workspaces error:', error);
    res.status(500).json({ error: 'Failed to get workspaces' });
  }
}

/**
 * Get workspace status
 */
async function getWorkspaceStatus(req, res) {
  try {
    const { id } = req.params;
    const status = await workspaceService.getWorkspaceStatus(id);

    res.json(status);
  } catch (error) {
    logger.error('Get workspace status error:', error);
    res.status(500).json({ error: 'Failed to get workspace status' });
  }
}

/**
 * Destroy workspace
 */
async function destroyWorkspace(req, res) {
  try {
    const { id } = req.params;
    await workspaceService.destroyWorkspace(id);

    res.json({ success: true, message: 'Workspace destroyed' });
  } catch (error) {
    logger.error('Destroy workspace error:', error);
    res.status(500).json({ error: 'Failed to destroy workspace' });
  }
}

/**
 * Add chat message to workspace
 */
async function addChatMessage(req, res) {
  try {
    const { id } = req.params;
    const { role, content, type } = req.body;

    if (!role || !content) {
      return res.status(400).json({ error: 'Role and content are required' });
    }

    const message = await workspaceService.addChatMessage(id, { role, content, type });
    res.json({ success: true, message });
  } catch (error) {
    logger.error('Add chat message error:', error.message);
    // Return success: false with error message instead of 500 to prevent frontend crashes
    // This can happen during race conditions when workspace is still being created
    res.json({ success: false, error: error.message, pending: true });
  }
}

/**
 * Get chat messages for workspace
 */
async function getChatMessages(req, res) {
  try {
    const { id } = req.params;
    const messages = await workspaceService.getChatMessages(id);
    res.json({ messages });
  } catch (error) {
    logger.error('Get chat messages error:', error);
    res.status(500).json({ error: 'Failed to get chat messages' });
  }
}

/**
 * Validate workspace code before preview
 * Returns user-friendly error messages
 */
async function validateWorkspace(req, res) {
  try {
    const { id } = req.params;
    const workspace = await workspaceService.getWorkspace(id);

    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    if (!workspace.containerId) {
      return res.status(400).json({
        valid: false,
        summary: 'Workspace container is not ready.',
        errors: [{
          category: 'server',
          severity: 'high',
          title: 'Container Not Ready',
          message: 'The workspace container has not been created yet.',
          suggestion: 'Please wait for the workspace to finish initializing.',
          canAutoFix: false,
        }],
        warnings: [],
        checks: [],
        availableFixes: [],
      });
    }

    const validation = await codeValidator.validateWorkspace(workspace.containerId);
    const response = codeValidator.formatValidationResponse(validation);

    res.json(response);
  } catch (error) {
    logger.error('Validate workspace error:', error);
    res.status(500).json({
      valid: false,
      summary: 'Failed to validate workspace.',
      errors: [{
        category: 'unknown',
        severity: 'high',
        title: 'Validation Error',
        message: 'An error occurred while validating your code.',
        suggestion: 'Please try again or refresh the page.',
        canAutoFix: false,
      }],
      warnings: [],
      checks: [],
      availableFixes: [],
    });
  }
}

/**
 * Auto-fix detected issues in workspace
 */
async function autoFixWorkspace(req, res) {
  try {
    const { id } = req.params;
    const { fixes } = req.body;
    const workspace = await workspaceService.getWorkspace(id);

    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    if (!workspace.containerId) {
      return res.status(400).json({ error: 'Workspace container is not ready' });
    }

    if (!fixes || !Array.isArray(fixes) || fixes.length === 0) {
      return res.status(400).json({ error: 'No fixes provided' });
    }

    const io = req.app.get('io');

    // Emit that we're starting auto-fix
    io?.to(`workspace:${id}`).emit('autofix:start', {
      message: 'Applying fixes...',
      fixCount: fixes.length,
    });

    const result = await codeValidator.autoFix(workspace.containerId, fixes);

    // Emit completion
    io?.to(`workspace:${id}`).emit('autofix:complete', {
      success: result.successCount === result.totalFixes,
      results: result.results,
    });

    // Re-validate after fixes
    const validation = await codeValidator.validateWorkspace(workspace.containerId);
    const validationResponse = codeValidator.formatValidationResponse(validation);

    res.json({
      fixResults: result,
      validation: validationResponse,
    });
  } catch (error) {
    logger.error('Auto-fix workspace error:', error);
    res.status(500).json({ error: 'Failed to apply fixes' });
  }
}

/**
 * Get server logs for workspace with parsed errors
 */
async function getServerLogs(req, res) {
  try {
    const { id } = req.params;
    const workspace = await workspaceService.getWorkspace(id);

    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    if (!workspace.containerId) {
      return res.status(400).json({ error: 'Workspace container is not ready' });
    }

    const logResult = await codeValidator.checkServerLogs(workspace.containerId);
    const serverStatus = await codeValidator.checkServerStatus(workspace.containerId);

    res.json({
      server: serverStatus,
      logs: {
        hasLogs: logResult.hasLogs,
        errors: logResult.errors,
        warnings: logResult.warnings,
        raw: logResult.raw,
      },
    });
  } catch (error) {
    logger.error('Get server logs error:', error);
    res.status(500).json({ error: 'Failed to get server logs' });
  }
}

/**
 * Assign workspace to organization in main Estrowork system
 */
async function assignToOrganization(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const email = req.user.email;

    const workspace = await workspaceService.getWorkspace(id);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    if (workspace.userId.toString() !== userId.toString()) {
      return res.status(403).json({ error: 'Not authorized to assign this workspace' });
    }

    // 1. Update local status
    workspace.assignedToOrganization = true;
    await workspace.save();

    // 2. Notify main backend
    // const mainBackendUrl = "https://estrowork.com/api" || 'http://127.0.0.1:4001';
    const mainBackendUrl = 'http://localhost:4001';

    const ssoSecret = "estrowork-sso-shared-secret-2026-3-5-12";

    if (!ssoSecret) {
      logger.error('SSO_SECRET not configured');
      return res.status(500).json({ error: 'SSO configuration missing' });
    }

    // Generate service-to-service token
    console.log('DEBUG: Generating token for email:', email);
    console.log('DEBUG: Using SSO_SECRET length:', ssoSecret?.length || 0);

    const token = jwt.sign(
      { 
        email, 
        containerId: workspace.containerId, 
        name: workspace.name, 
        prompt: workspace.prompt, 
        source: 'estroworkai' 
      },
      ssoSecret,
      { expiresIn: '5m' }
    );

    const response = await fetch(`${mainBackendUrl}/api/v1/ai-projects/assign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Token': `Bearer ${token}`
      },
      body: JSON.stringify({
        email,
        containerId: workspace.containerId,
        name: workspace.name,
        prompt: workspace.prompt
      })
    });


    const result = await response.json();

    if (!response.ok) {
      logger.error('Main backend assignment failed:', result);
      return res.status(response.status).json({
        success: false,
        error: result.error || 'Failed to notify main backend'
      });
    }

    res.json({
      success: true,
      message: 'Workspace assigned to organization successfully',
      workspace: {
        id: workspace._id,
        assignedToOrganization: workspace.assignedToOrganization
      }
    });
  } catch (error) {
    logger.error('Assign to organization error:', error);
    res.status(500).json({ error: 'Failed to assign to organization' });
  }
}

module.exports = {
  createWorkspace,
  startAgent,
  runPrompt,
  getWorkspace,
  getUserWorkspaces,
  getWorkspaceStatus,
  destroyWorkspace,
  addChatMessage,
  getChatMessages,
  validateWorkspace,
  autoFixWorkspace,
  getServerLogs,
  assignToOrganization,
};
