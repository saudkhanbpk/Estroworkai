const mongoose = require('mongoose');

const workspaceSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  prompt: {
    type: String,
    required: true,
  },
  containerId: {
    type: String,
    default: null,
  },
  assignedToOrganization: {
    type: Boolean,
    default: false
  },
  containerName: {
    type: String,
    default: null,
  },
  port: {
    type: Number,
    default: null,
  },
  status: {
    type: String,
    enum: ['pending', 'creating', 'running', 'stopped', 'ready', 'error', 'destroyed'],
    default: 'pending',
  },
  files: [{
    path: String,
    type: { type: String, enum: ['file', 'files', 'directory'] },
    lastModified: Date,
  }],
  agentLogs: [{
    timestamp: { type: Date, default: Date.now },
    action: String,
    details: mongoose.Schema.Types.Mixed,
  }],
  chatMessages: [{
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    type: { type: String, enum: ['text', 'file', 'files', 'command', 'error', 'success'], default: 'text' },
    timestamp: { type: Date, default: Date.now },
  }],
  previewUrl: {
    type: String,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Update timestamp on save
workspaceSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

// Index for faster queries
workspaceSchema.index({ userId: 1, status: 1 });
workspaceSchema.index({ containerId: 1 });

module.exports = mongoose.model('Workspace', workspaceSchema);
