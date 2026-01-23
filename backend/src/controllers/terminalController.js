const terminalService = require('../services/terminalService');
const logger = require('../utils/logger');

/**
 * Execute command in workspace terminal
 */
async function executeCommand(req, res) {
  try {
    const { workspaceId } = req.params;
    const { command } = req.body;

    if (!command) {
      return res.status(400).json({ error: 'Command is required' });
    }

    const result = await terminalService.executeCommand(workspaceId, command);
    res.json(result);
  } catch (error) {
    logger.error('Execute command error:', error);
    res.status(500).json({ error: 'Failed to execute command' });
  }
}

/**
 * Start development server
 */
async function startServer(req, res) {
  try {
    const { workspaceId } = req.params;
    const result = await terminalService.startDevServer(workspaceId);
    res.json(result);
  } catch (error) {
    logger.error('Start server error:', error);
    res.status(500).json({ error: 'Failed to start server' });
  }
}

/**
 * Stop development server
 */
async function stopServer(req, res) {
  try {
    const { workspaceId } = req.params;
    const result = await terminalService.stopDevServer(workspaceId);
    res.json(result);
  } catch (error) {
    logger.error('Stop server error:', error);
    res.status(500).json({ error: 'Failed to stop server' });
  }
}

/**
 * Get server logs
 */
async function getServerLogs(req, res) {
  try {
    const { workspaceId } = req.params;
    const { lines } = req.query;
    const logs = await terminalService.getServerLogs(workspaceId, parseInt(lines) || 100);
    res.json({ logs });
  } catch (error) {
    logger.error('Get server logs error:', error);
    res.status(500).json({ error: 'Failed to get server logs' });
  }
}

/**
 * Install npm packages
 */
async function installPackages(req, res) {
  try {
    const { workspaceId } = req.params;
    const { packages } = req.body;
    const result = await terminalService.installPackages(workspaceId, packages || []);
    res.json(result);
  } catch (error) {
    logger.error('Install packages error:', error);
    res.status(500).json({ error: 'Failed to install packages' });
  }
}

module.exports = {
  executeCommand,
  startServer,
  stopServer,
  getServerLogs,
  installPackages,
};
