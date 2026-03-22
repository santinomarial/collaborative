const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const User = require('../models/User');

const router = express.Router();

const BCRYPT_ROUNDS = 12;
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

function randomHexColor() {
  return '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
}

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function formatZodError(err) {
  const fields = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] = issue.message;
  }
  return { error: 'Validation failed', fields };
}

// POST /api/auth/register
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  displayName: z.string().min(1).max(50),
  avatarColor: z.string().regex(HEX_COLOR_RE, 'Must be a hex color (#rrggbb)').optional(),
});

router.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));

  const { email, password, displayName, avatarColor } = parsed.data;

  try {
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: 'Validation failed', fields: { email: 'Email already in use' } });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await User.create({
      email,
      passwordHash,
      displayName,
      avatarColor: avatarColor ?? randomHexColor(),
    });

    const token = signToken({
      userId: user._id.toString(),
      displayName: user.displayName,
      avatarColor: user.avatarColor,
      role: 'user',
    });

    res.cookie('token', token, COOKIE_OPTS);
    return res.status(201).json({
      userId: user._id,
      displayName: user.displayName,
      avatarColor: user.avatarColor,
    });
  } catch (err) {
    console.error('register error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/login
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));

  const { email, password } = parsed.data;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken({
      userId: user._id.toString(),
      displayName: user.displayName,
      avatarColor: user.avatarColor,
      role: 'user',
    });

    res.cookie('token', token, COOKIE_OPTS);
    return res.json({
      userId: user._id,
      displayName: user.displayName,
      avatarColor: user.avatarColor,
    });
  } catch (err) {
    console.error('login error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/guest
const guestSchema = z.object({
  displayName: z.string().min(1).max(50),
  avatarColor: z.string().regex(HEX_COLOR_RE, 'Must be a hex color (#rrggbb)').optional(),
});

router.post('/guest', (req, res) => {
  const parsed = guestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));

  const { displayName, avatarColor } = parsed.data;

  const token = signToken({
    userId: null,
    displayName,
    avatarColor: avatarColor ?? randomHexColor(),
    role: 'guest',
  });

  res.cookie('token', token, COOKIE_OPTS);
  return res.json({ displayName, avatarColor: avatarColor ?? null, role: 'guest' });
});

// GET /api/auth/token — returns the JWT so the browser can use it for WebSocket auth
router.get('/token', (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    jwt.verify(token, process.env.JWT_SECRET);
    return res.json({ token });
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
});

// POST /api/auth/logout
router.post('/logout', (_req, res) => {
  res.clearCookie('token', { httpOnly: true, sameSite: 'lax' });
  return res.json({ message: 'Logged out' });
});

module.exports = router;
