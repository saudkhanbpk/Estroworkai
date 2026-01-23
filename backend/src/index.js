const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const logger = require('./utils/logger');

// Import routes
const workspaceRoutes = require('./routes/workspace');
const fileRoutes = require('./routes/file');
const terminalRoutes = require('./routes/terminal');
const authRoutes = require('./routes/auth');

// Import WebSocket handlers
const setupWebSocket = require('./websocket');

const app = express();
const server = http.createServer(app);

// Socket.io setup with production-ready CORS
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:3000',
  'http://localhost:3000',
  'http://localhost',
].filter(Boolean);

// In production, also allow the EC2 public IP/domain
if (process.env.NODE_ENV === 'production' && process.env.DOMAIN) {
  allowedOrigins.push(`http://${process.env.DOMAIN}`);
  allowedOrigins.push(`https://${process.env.DOMAIN}`);
}

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  // Production optimizations
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
}));
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      process.env.FRONTEND_URL || 'http://localhost:3000',
      'http://localhost:3000',
      'http://localhost',
    ];
    
    // In production, allow EC2 domain
    if (process.env.NODE_ENV === 'production' && process.env.DOMAIN) {
      allowedOrigins.push(`http://${process.env.DOMAIN}`);
      allowedOrigins.push(`https://${process.env.DOMAIN}`);
    }
    
    if (allowedOrigins.includes(origin) || origin.includes('localhost')) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all origins in development
    }
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Make io accessible to routes
app.set('io', io);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/workspace', workspaceRoutes);
app.use('/api/file', fileRoutes);
app.use('/api/terminal', terminalRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Setup WebSocket handlers
setupWebSocket(io);

// Connect to MongoDB and start server
const PORT = process.env.PORT || 5000;

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    logger.info('Connected to MongoDB');
    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    logger.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down...');
  server.close(() => {
    mongoose.connection.close(false, () => {
      process.exit(0);
    });
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
  // Don't exit in dev mode to allow debugging
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit in dev mode to allow debugging
});

module.exports = { app, io };
