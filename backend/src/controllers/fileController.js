const fileService = require('../services/fileService');
const logger = require('../utils/logger');

/**
 * Read file from workspace
 */
async function readFile(req, res) {
  try {
    const { workspaceId } = req.params;
    const { path: filePath } = req.query;

    if (!filePath) {
      return res.status(400).json({ error: 'File path is required' });
    }

    const content = await fileService.readFile(workspaceId, filePath);
    res.json({ content });
  } catch (error) {
    logger.error('Read file error:', error.message);
    // Return empty content with error message to prevent frontend crashes
    res.json({ content: '', error: error.message, pending: true });
  }
}

/**
 * Write file to workspace
 */
async function writeFile(req, res) {
  try {
    const { workspaceId } = req.params;
    const { path: filePath, content } = req.body;

    if (!filePath || content === undefined) {
      return res.status(400).json({ error: 'File path and content are required' });
    }

    await fileService.writeFile(workspaceId, filePath, content);
    res.json({ success: true });
  } catch (error) {
    logger.error('Write file error:', error);
    res.status(500).json({ error: 'Failed to write file' });
  }
}

/**
 * Delete file from workspace
 */
async function deleteFile(req, res) {
  try {
    const { workspaceId } = req.params;
    const { path: filePath } = req.query;

    if (!filePath) {
      return res.status(400).json({ error: 'File path is required' });
    }

    await fileService.deleteFile(workspaceId, filePath);
    res.json({ success: true });
  } catch (error) {
    logger.error('Delete file error:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
}

/**
 * List files in workspace directory
 */
async function listFiles(req, res) {
  try {
    const { workspaceId } = req.params;
    const { path: dirPath } = req.query;

    const files = await fileService.listFiles(workspaceId, dirPath || '/workspace');
    res.json({ files });
  } catch (error) {
    logger.error('List files error:', error.message);
    // Return empty array with error message instead of 500 to prevent frontend crashes
    // This happens when container isn't ready yet or workspace is being created
    res.json({ files: [], error: error.message, pending: true });
  }
}

/**
 * Create directory in workspace
 */
async function createDirectory(req, res) {
  try {
    const { workspaceId } = req.params;
    const { path: dirPath } = req.body;

    if (!dirPath) {
      return res.status(400).json({ error: 'Directory path is required' });
    }

    await fileService.createDirectory(workspaceId, dirPath);
    res.json({ success: true });
  } catch (error) {
    logger.error('Create directory error:', error);
    res.status(500).json({ error: 'Failed to create directory' });
  }
}

/**
 * Rename/move file in workspace
 */
async function renameFile(req, res) {
  try {
    const { workspaceId } = req.params;
    const { oldPath, newPath } = req.body;

    if (!oldPath || !newPath) {
      return res.status(400).json({ error: 'Old path and new path are required' });
    }

    await fileService.renameFile(workspaceId, oldPath, newPath);
    res.json({ success: true });
  } catch (error) {
    logger.error('Rename file error:', error);
    res.status(500).json({ error: 'Failed to rename file' });
  }
}

module.exports = {
  readFile,
  writeFile,
  deleteFile,
  listFiles,
  createDirectory,
  renameFile,
};
