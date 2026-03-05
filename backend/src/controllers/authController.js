const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_EXPIRES_IN = '7d';

/**
 * Register new user
 */
async function register(req, res) {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are required' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    // Create user
    const user = new User({
      name,
      email,
      passwordHash: password,
    });
    await user.save();

    // Generate token
    const token = jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });

    logger.info(`User registered: ${email}`);

    res.status(201).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    logger.error('Register error:', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
}

/**
 * Login user
 */
async function login(req, res) {
  try {
    let { email, password } = req.body;

    // 1️⃣ Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // 2️⃣ Normalize email (VERY IMPORTANT)
    email = email.trim().toLowerCase();

    // 3️⃣ Find user (passwordHash is included by default in schema)
    const user = await User.findOne({ email });

    if (!user) {
      logger.warn(`Login attempt with non-existent email: ${email}`);
      // Do not reveal whether email exists
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // 4️⃣ Compare password
    const isValid = await user.comparePassword(password);

    if (!isValid) {
      logger.warn(`Failed login attempt for: ${email}`);
    }

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // 5️⃣ Generate JWT
    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    logger.info(`User logged in: ${user.email}`);

    // 6️⃣ Send response
    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });

  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
}


/**
 * Get current user profile
 */
async function getProfile(req, res) {
  try {
    const user = await User.findById(req.user.id).select('-passwordHash');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (error) {
    logger.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
}

/**
 * Auth middleware
 */
function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}


/**
 * SSO: Verify a short-lived token issued by Estrowork backend.
 * Creates the user in EstroworkAI if they don't have an account yet.
 * POST /api/auth/sso/verify-token
 */
async function ssoVerify(req, res) {
  try {
    const { ssoToken } = req.body;

    if (!ssoToken) {
      return res.status(400).json({ error: 'SSO token is required' });
    }

    const SSO_SECRET = process.env.SSO_SECRET;
    if (!SSO_SECRET) {
      logger.error('SSO_SECRET is not set in environment variables');
      return res.status(500).json({ error: 'SSO not configured on server' });
    }

    let payload;
    try {
      payload = jwt.verify(ssoToken, SSO_SECRET);
    } catch (e) {
      logger.warn(`SSO token verification failed: ${e.message}`);
      return res.status(401).json({ error: 'Invalid or expired SSO token' });
    }

    if (payload.source !== 'estrowork') {
      return res.status(401).json({ error: 'Invalid SSO token source' });
    }

    const email = payload.email.trim().toLowerCase();
    let user = await User.findOne({ email });

    if (!user) {
      // Auto-create the user — they verified their identity via Estrowork
      logger.info(`[SSO] Auto-creating EstroworkAI user for: ${email}`);
      user = new User({
        name: payload.name || email.split('@')[0],
        email,
        // Random hash — user can set a password later if needed
        passwordHash: require('crypto').randomBytes(32).toString('hex'),
      });
      await user.save();
    } else {
      logger.info(`[SSO] Existing EstroworkAI user found: ${email}`);
    }

    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    logger.error('SSO verify error:', error);
    res.status(500).json({ error: 'SSO verification failed' });
  }
}

module.exports = {
  register,
  login,
  getProfile,
  authenticate,
  ssoVerify,
};
