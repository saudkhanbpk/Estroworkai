const express = require('express');
const router = express.Router();
const workspaceController = require('../controllers/workspaceController');
const { authenticate } = require('../controllers/authController');

// All routes require authentication
router.use((req, res, next) => {
  console.log(`DEBUG: Workspace route accessed: ${req.method} ${req.originalUrl}`);
  next();
}, authenticate);

// Create new workspace
router.post('/create', workspaceController.createWorkspace);

// Start AI agent for workspace
router.post('/:id/start-agent', workspaceController.startAgent);

// Run a new prompt on existing workspace
router.post('/:id/run-prompt', workspaceController.runPrompt);

// Get user's workspaces
router.get('/', workspaceController.getUserWorkspaces);

// Get single workspace
router.get('/:id', workspaceController.getWorkspace);

// Get workspace status
router.get('/:id/status', workspaceController.getWorkspaceStatus);

// Chat messages
router.get('/:id/chat', workspaceController.getChatMessages);
router.post('/:id/chat', workspaceController.addChatMessage);

// Validation and error handling
router.get('/:id/validate', workspaceController.validateWorkspace);
router.post('/:id/autofix', workspaceController.autoFixWorkspace);
router.get('/:id/logs', workspaceController.getServerLogs);

// Assign workspace to organization
router.post('/:id/assign', workspaceController.assignToOrganization);

// Destroy workspace
router.delete('/:id', workspaceController.destroyWorkspace);

module.exports = router;
