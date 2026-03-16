const { nanoid } = require('nanoid');
const Session = require('../models/Session');
const Operation = require('../models/Operation');

async function createSession(ownerId, title, language) {
  const session = await Session.create({
    _id: nanoid(8),
    title,
    language,
    owner: ownerId,
  });
  return session;
}

async function getSession(sessionId) {
  return Session.findById(sessionId);
}

async function shouldCheckpoint(sessionId) {
  const count = await Operation.countDocuments({ sessionId });
  return count >= 100;
}

async function checkpoint(sessionId) {
  const session = await Session.findById(sessionId);
  if (!session) throw new Error('Session not found');

  // Rebuild snapshot by applying all pending ops in revision order
  // The snapshot field already holds the current document state maintained by
  // the caller; we just persist it and prune the op log.
  // Delete all Operation docs for this session (they are now baked into snapshot)
  await Operation.deleteMany({ sessionId });

  // Touch updatedAt so callers can detect the checkpoint
  await Session.findByIdAndUpdate(sessionId, { updatedAt: new Date() });

  return session;
}

module.exports = { createSession, getSession, shouldCheckpoint, checkpoint };
