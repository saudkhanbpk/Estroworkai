const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

/**
 * Setup WebSocket handlers
 */
function setupWebSocket(io) {
  // Authentication middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.user = decoded;
      next();
    } catch (error) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    logger.info(`WebSocket connected: ${socket.user.email}`);

    // Join workspace room
    socket.on('workspace:join', (workspaceId) => {
      socket.join(`workspace:${workspaceId}`);
      logger.info(`User ${socket.user.email} joined workspace: ${workspaceId}`);
    });

    // Leave workspace room
    socket.on('workspace:leave', (workspaceId) => {
      socket.leave(`workspace:${workspaceId}`);
      logger.info(`User ${socket.user.email} left workspace: ${workspaceId}`);
    });

    // Editor content change (for real-time collaboration)
    socket.on('editor:change', (data) => {
      const { workspaceId, filePath, changes } = data;
      // Broadcast to other users in same workspace
      socket.to(`workspace:${workspaceId}`).emit('editor:update', {
        filePath,
        changes,
        userId: socket.user.id,
      });
    });

    // Editor cursor position
    socket.on('editor:cursor', (data) => {
      const { workspaceId, filePath, position } = data;
      socket.to(`workspace:${workspaceId}`).emit('editor:cursor', {
        filePath,
        position,
        userId: socket.user.id,
        userName: socket.user.name,
      });
    });

    // Terminal input
    socket.on('terminal:input', async (data) => {
      const { workspaceId, input } = data;
      // This would be handled by a more sophisticated terminal service
      // For now, just broadcast output
      socket.emit('terminal:output', {
        workspaceId,
        output: `> ${input}\n`,
      });
    });

    // Disconnect
    socket.on('disconnect', () => {
      logger.info(`WebSocket disconnected: ${socket.user.email}`);
    });
  });

  return io;
}

module.exports = setupWebSocket;
