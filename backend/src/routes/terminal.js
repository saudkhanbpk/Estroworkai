const express = require('express');
const router = express.Router();
const terminalController = require('../controllers/terminalController');
const { authenticate } = require('../controllers/authController');

// All routes require authentication
router.use(authenticate);

// Execute command
router.post('/:workspaceId/exec', terminalController.executeCommand);

// Start dev server
router.post('/:workspaceId/start', terminalController.startServer);

// Stop dev server
router.post('/:workspaceId/stop', terminalController.stopServer);

// Get server logs
router.get('/:workspaceId/logs', terminalController.getServerLogs);

// Install npm packages
router.post('/:workspaceId/install', terminalController.installPackages);

module.exports = router;
