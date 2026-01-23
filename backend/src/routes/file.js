const express = require('express');
const router = express.Router();
const fileController = require('../controllers/fileController');
const { authenticate } = require('../controllers/authController');

// All routes require authentication
router.use(authenticate);

// List files in workspace
router.get('/:workspaceId/list', fileController.listFiles);

// Read file
router.get('/:workspaceId/read', fileController.readFile);

// Write file
router.post('/:workspaceId/write', fileController.writeFile);

// Delete file
router.delete('/:workspaceId/delete', fileController.deleteFile);

// Create directory
router.post('/:workspaceId/mkdir', fileController.createDirectory);

// Rename/move file
router.post('/:workspaceId/rename', fileController.renameFile);

module.exports = router;
