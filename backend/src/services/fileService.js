const Workspace = require('../models/Workspace');
const dockerUtils = require('../utils/docker');
const logger = require('../utils/logger');

// Simple in-memory cache for file lists (TTL: 5 seconds)
const fileListCache = new Map();
const FILE_LIST_CACHE_TTL = 5000;

/**
 * Read file from workspace container - optimized for speed
 */
async function readFile(workspaceId, filePath) {
  const workspace = await Workspace.findById(workspaceId);
  if (!workspace || !workspace.containerId) {
    throw new Error('Workspace not found or container not ready');
  }

  try {
    // Single command: check if file and read in one go
    const result = await dockerUtils.execCommand(
      workspace.containerId,
      `[ -f '${filePath}' ] && cat '${filePath}' || ([ -d '${filePath}' ] && echo "DIRECTORY_ERROR" || echo "FILE_NOT_FOUND")`,
      { timeout: 5000 } // 5 second timeout for reading
    );

    // Check for directory error
    if (result.output === 'DIRECTORY_ERROR') {
      throw new Error('Cannot read directory as file');
    }

    if (result.output === 'FILE_NOT_FOUND') {
      throw new Error('File not found');
    }

    // exitCode 0 means success
    if (result.exitCode !== undefined && result.exitCode !== 0) {
      logger.error(`File read failed with exit code ${result.exitCode}: ${result.error || result.output}`);
      throw new Error(result.error || result.output || 'Failed to read file');
    }

    return result.output || '';
  } catch (error) {
    logger.error(`Error reading file ${filePath}:`, error.message);
    throw new Error(`Failed to read file: ${error.message}`);
  }
}

/**
 * Write file to workspace container - using atomic updates
 */
async function writeFile(workspaceId, filePath, content) {
  const workspace = await Workspace.findById(workspaceId);
  if (!workspace || !workspace.containerId) {
    throw new Error('Workspace not found or container not ready');
  }

  const result = await dockerUtils.writeFile(workspace.containerId, filePath, content);
  if (result.exitCode !== 0) {
    throw new Error(result.error || 'Failed to write file');
  }

  // Use atomic update to avoid version conflicts
  // First try to update existing file's timestamp
  const updateResult = await Workspace.findOneAndUpdate(
    { _id: workspaceId, 'files.path': filePath },
    { $set: { 'files.$.lastModified': new Date() } }
  );

  // If file doesn't exist in array, add it
  if (!updateResult) {
    await Workspace.findByIdAndUpdate(workspaceId, {
      $push: {
        files: {
          path: filePath,
          type: 'file',
          lastModified: new Date(),
        }
      }
    });
  }

  // Invalidate cache since files changed
  invalidateFileListCache(workspaceId);

  logger.info(`File written: ${filePath} in workspace ${workspaceId}`);
  return { success: true };
}

/**
 * Delete file from workspace container - using atomic updates
 */
async function deleteFile(workspaceId, filePath) {
  const workspace = await Workspace.findById(workspaceId);
  if (!workspace || !workspace.containerId) {
    throw new Error('Workspace not found or container not ready');
  }

  const result = await dockerUtils.execCommand(workspace.containerId, `rm -f '${filePath}'`);
  if (result.exitCode !== 0) {
    throw new Error(result.error || 'Failed to delete file');
  }

  // Atomic update to remove from file list
  await Workspace.findByIdAndUpdate(workspaceId, {
    $pull: { files: { path: filePath } }
  });

  // Invalidate cache
  invalidateFileListCache(workspaceId);

  return { success: true };
}

/**
 * List files in workspace container - with caching
 */
async function listFiles(workspaceId, dirPath = '/workspace') {
  const cacheKey = `${workspaceId}:${dirPath}`;

  // Check cache first
  const cached = fileListCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < FILE_LIST_CACHE_TTL) {
    logger.info(`Returning cached file list for ${workspaceId}`);
    return cached.files;
  }

  const workspace = await Workspace.findById(workspaceId);
  if (!workspace || !workspace.containerId) {
    throw new Error('Workspace not found or container not ready');
  }

  const files = await dockerUtils.listFiles(workspace.containerId, dirPath);

  // Cache the result
  fileListCache.set(cacheKey, { files, timestamp: Date.now() });

  return files;
}

/**
 * Invalidate file list cache for a workspace
 */
function invalidateFileListCache(workspaceId) {
  for (const key of fileListCache.keys()) {
    if (key.startsWith(`${workspaceId}:`)) {
      fileListCache.delete(key);
    }
  }
}

/**
 * Create directory in workspace container
 */
async function createDirectory(workspaceId, dirPath) {
  const workspace = await Workspace.findById(workspaceId);
  if (!workspace || !workspace.containerId) {
    throw new Error('Workspace not found or container not ready');
  }

  const result = await dockerUtils.execCommand(workspace.containerId, `mkdir -p '${dirPath}'`);
  if (result.exitCode !== 0) {
    throw new Error(result.error || 'Failed to create directory');
  }

  workspace.files.push({
    path: dirPath,
    type: 'directory',
    lastModified: new Date(),
  });
  await workspace.save();

  return { success: true };
}

/**
 * Rename/move file in workspace container
 */
async function renameFile(workspaceId, oldPath, newPath) {
  const workspace = await Workspace.findById(workspaceId);
  if (!workspace || !workspace.containerId) {
    throw new Error('Workspace not found or container not ready');
  }

  const result = await dockerUtils.execCommand(workspace.containerId, `mv '${oldPath}' '${newPath}'`);
  if (result.exitCode !== 0) {
    throw new Error(result.error || 'Failed to rename file');
  }

  // Update file list
  const file = workspace.files.find((f) => f.path === oldPath);
  if (file) {
    file.path = newPath;
    file.lastModified = new Date();
  }
  await workspace.save();

  return { success: true };
}

module.exports = {
  readFile,
  writeFile,
  deleteFile,
  listFiles,
  createDirectory,
  renameFile,
  invalidateFileListCache,
};
