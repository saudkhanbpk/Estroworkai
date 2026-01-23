const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true,
  },
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
  description: {
    type: String,
    default: '',
  },
  prompt: {
    type: String,
    required: true,
  },
  framework: {
    type: String,
    enum: ['react', 'vue', 'angular', 'nextjs', 'express', 'vanilla', 'other'],
    default: 'vanilla',
  },
  settings: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
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

projectSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

projectSchema.index({ userId: 1 });
projectSchema.index({ workspaceId: 1 });

module.exports = mongoose.model('Project', projectSchema);
