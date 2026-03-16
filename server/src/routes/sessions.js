const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../middleware/auth');
const Session = require('../models/Session');
const Operation = require('../models/Operation');
const { createSession, getSession } = require('../services/SessionService');

const router = express.Router();

router.use(requireAuth);

function formatZodError(err) {
  const fields = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] = issue.message;
  }
  return { error: 'Validation failed', fields };
}

// POST /api/sessions
const createSessionSchema = z.object({
  title: z.string().min(1).max(100),
  language: z.string().min(1).max(50),
});

router.post('/', async (req, res) => {
  const parsed = createSessionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));

  const { title, language } = parsed.data;

  try {
    const session = await createSession(req.user.userId, title, language);
    return res.status(201).json(session);
  } catch (err) {
    console.error('create session error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/sessions/:id
router.get('/:id', async (req, res) => {
  try {
    const session = await getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    return res.json({
      _id: session._id,
      title: session.title,
      language: session.language,
      owner: session.owner,
      collaborators: session.collaborators,
      isLocked: session.isLocked,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      snapshot: session.snapshot,
      revision: session.revision,
    });
  } catch (err) {
    console.error('get session error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/sessions/:id/history
const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

router.get('/:id/history', async (req, res) => {
  const parsed = historyQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));

  const { page, limit } = parsed.data;

  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const total = await Operation.countDocuments({ sessionId: req.params.id });
    const ops = await Operation.find({ sessionId: req.params.id })
      .sort({ revision: 1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return res.json({
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      operations: ops,
    });
  } catch (err) {
    console.error('history error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/sessions/:id — owner only
router.delete('/:id', async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    if (session.owner.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await Operation.deleteMany({ sessionId: req.params.id });
    await Session.findByIdAndDelete(req.params.id);

    return res.json({ message: 'Session deleted' });
  } catch (err) {
    console.error('delete session error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/sessions/:id — owner only
const patchSessionSchema = z
  .object({
    title: z.string().min(1).max(100),
    language: z.string().min(1).max(50),
    isLocked: z.boolean(),
    expiresAt: z.iso.datetime().nullable(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field required' });

router.patch('/:id', async (req, res) => {
  const parsed = patchSessionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));

  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    if (session.owner.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const updated = await Session.findByIdAndUpdate(
      req.params.id,
      { $set: parsed.data },
      { returnDocument: 'after' }
    );

    return res.json(updated);
  } catch (err) {
    console.error('patch session error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
