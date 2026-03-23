import { useState, useEffect, useRef } from 'react';
import './PresencePanel.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(ts) {
  if (!ts) return '';
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 5)  return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({ displayName, avatarColor }) {
  const letter = (displayName ?? '?')[0].toUpperCase();
  return (
    <span
      className="presence-avatar"
      style={{ background: avatarColor ?? '#528bff' }}
      aria-hidden="true"
    >
      {letter}
    </span>
  );
}

// ── Single user row ───────────────────────────────────────────────────────────

function UserRow({ user, isOwner, isTyping, lastSeen, canKick, onKick }) {
  return (
    <li className="presence-user">
      <Avatar displayName={user.displayName} avatarColor={user.avatarColor} />
      <div className="presence-user-info">
        <div className="presence-user-name">
          <span>{user.displayName ?? 'Anonymous'}</span>
          {isOwner && <span className="owner-badge">owner</span>}
          {isTyping && <span className="typing-dots" aria-label="typing">···</span>}
        </div>
        {lastSeen != null && (
          <span className="presence-last-seen">{timeAgo(lastSeen)}</span>
        )}
      </div>
      {canKick && (
        <button
          className="kick-btn"
          onClick={() => onKick(user.userId)}
          title={`Remove ${user.displayName ?? 'user'}`}
          aria-label={`Kick ${user.displayName ?? 'user'}`}
        >
          ×
        </button>
      )}
    </li>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const TYPING_TIMEOUT_MS  = 2_000;
const REFRESH_INTERVAL_MS = 5_000;

/**
 * @param {{
 *   users:          object[],
 *   wsClient:       object | null,
 *   session:        object | null,
 *   isOpen:         boolean,
 *   onToggle:       () => void,
 *   viewerIsOwner:  boolean,
 *   viewerUserId:   string | null,
 *   onKick:         (targetUserId: string) => void,
 * }} props
 */
export function PresencePanel({ users = [], wsClient, session, isOpen, onToggle, viewerIsOwner = false, viewerUserId = null, onKick }) {
  // userId → timestamp of last cursor/activity event
  const lastSeenRef  = useRef(new Map());
  const [, forceUpdate] = useState(0); // tick to trigger re-render every 5s

  // Subscribe to cursor events to track typing + last-seen
  useEffect(() => {
    if (!wsClient) return;
    const unsub = wsClient.on('cursor', (payload) => {
      if (!payload?.userId) return;
      lastSeenRef.current.set(payload.userId, Date.now());
    });
    return unsub;
  }, [wsClient]);

  // Tick every 5s to refresh relative timestamps
  useEffect(() => {
    const id = setInterval(() => forceUpdate((n) => n + 1), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const ownerId = session?.owner?.toString?.() ?? session?.owner;
  const now = Date.now();

  return (
    <aside className={`presence-panel ${isOpen ? 'open' : 'closed'}`}>
      {/* Toggle tab */}
      <button
        className="presence-toggle"
        onClick={onToggle}
        title={isOpen ? 'Collapse panel' : 'Show collaborators'}
        aria-expanded={isOpen}
      >
        <span className="toggle-icon">{isOpen ? '›' : '‹'}</span>
        {!isOpen && users.length > 0 && (
          <span className="presence-badge">{users.length}</span>
        )}
      </button>

      {isOpen && (
        <div className="presence-inner">
          <div className="presence-header">
            <span className="presence-title">
              {users.length} online
            </span>
          </div>

          {users.length === 0 ? (
            <p className="presence-empty">No one else here yet.</p>
          ) : (
            <ul className="presence-list">
              {users.map((user) => {
                const ls  = lastSeenRef.current.get(user.userId);
                const isTyping = ls != null && (now - ls) < TYPING_TIMEOUT_MS;
                const canKick = viewerIsOwner && user.userId !== ownerId && user.userId !== viewerUserId;
                return (
                  <UserRow
                    key={user.userId}
                    user={user}
                    isOwner={user.userId === ownerId}
                    isTyping={isTyping}
                    lastSeen={ls}
                    canKick={canKick}
                    onKick={onKick}
                  />
                );
              })}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}
