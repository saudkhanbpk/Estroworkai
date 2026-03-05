const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Register
router.post('/register', authController.register);

// Login
router.post('/login', authController.login);

// Get profile (requires auth)
router.get('/profile', authController.authenticate, authController.getProfile);

// SSO: Verify a short-lived token from Estrowork — auto-logs user in
router.post('/sso/verify-token', authController.ssoVerify);

module.exports = router;
