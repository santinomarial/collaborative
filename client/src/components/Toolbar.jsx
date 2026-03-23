import { useState, useRef, useEffect } from 'react';
import { LANGUAGES }     from '../editor/languages';
import { ConnectionDot } from './ConnectionDot';
import './Toolbar.css';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function patchSession(sessionId, body) {
  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}`, {
    method:      'PATCH',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json' },
    body:        JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
  return res.json();
}

const EXPIRY_OPTIONS = [
  { label: '1 hour',    value: () => new Date(Date.now() + 60 * 60 * 1000).toISOString() },
  { label: '24 hours',  value: () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() },
  { label: 'Permanent', value: () => null },
];

// ── Inline editable title ─────────────────────────────────────────────────────

function EditableTitle({ title, isOwner, sessionId, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(title ?? '');
  const inputRef = useRef(null);

  // Keep draft in sync when title prop changes
  useEffect(() => { setDraft(title ?? ''); }, [title]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  async function save() {
    setEditing(false);
    const trimmed = draft.trim();
    if (!trimmed || trimmed === title) return;
    try {
      const updated = await patchSession(sessionId, { title: trimmed });
      onUpdate(updated);
    } catch {
      setDraft(title ?? '');
    }
  }

  if (!isOwner) {
    return <span className="session-title readonly">{title || 'Untitled'}</span>;
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="session-title editing"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') { setDraft(title ?? ''); setEditing(false); }
        }}
      />
    );
  }

  return (
    <button
      className="session-title editable"
      onClick={() => setEditing(true)}
      title="Click to rename"
    >
      {title || 'Untitled'}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * @param {{
 *   session:          object | null,
 *   isOwner:          boolean,
 *   language:         string,
 *   onLanguageChange: (l: string) => void,
 *   theme:            'dark'|'light',
 *   onThemeChange:    (t: string) => void,
 *   token:            string | null,
 *   status:           'connected'|'reconnecting'|'disconnected',
 *   onSessionUpdate:  (s: object) => void,
 * }} props
 */
export function Toolbar({
  session,
  isOwner,
  language,
  onLanguageChange,
  theme,
  onThemeChange,
  token,
  status,
  onSessionUpdate,
  historyOpen,
  onHistoryToggle,
}) {
  const [toastMsg, setToastMsg] = useState('');
  const toastTimer = useRef(null);

  function showToast(msg) {
    clearTimeout(toastTimer.current);
    setToastMsg(msg);
    toastTimer.current = setTimeout(() => setToastMsg(''), 2000);
  }

  // ── Share ───────────────────────────────────────────────────────────────────
  function share() {
    const url = new URL(window.location.href);
    // Ensure the token is in the URL so the recipient is auto-authed
    if (token) url.searchParams.set('token', token);
    navigator.clipboard.writeText(url.toString())
      .then(() => showToast('Copied!'))
      .catch(() => showToast('Copy failed'));
  }

  // ── Lock / unlock ───────────────────────────────────────────────────────────
  async function toggleLock() {
    if (!session) return;
    try {
      const updated = await patchSession(session._id, { isLocked: !session.isLocked });
      onSessionUpdate(updated);
    } catch (e) {
      showToast('Failed to update lock');
    }
  }

  // ── Expiry ──────────────────────────────────────────────────────────────────
  async function handleExpiry(e) {
    if (!session) return;
    const opt = EXPIRY_OPTIONS[parseInt(e.target.value, 10)];
    try {
      const updated = await patchSession(session._id, { expiresAt: opt.value() });
      onSessionUpdate(updated);
    } catch {
      showToast('Failed to update expiry');
    }
  }

  const locked = session?.isLocked ?? false;

  return (
    <div className={`toolbar toolbar--${theme}`}>
      {/* Left: connection + title */}
      <div className="toolbar-left">
        <ConnectionDot status={status} />
        {session && (
          <EditableTitle
            title={session.title}
            isOwner={isOwner}
            sessionId={session._id}
            onUpdate={onSessionUpdate}
          />
        )}
      </div>

      {/* Right: controls */}
      <div className="toolbar-right">
        {isOwner && (
          <>
            <select
              className="tb-select expiry-select"
              onChange={handleExpiry}
              defaultValue=""
              title="Session expiry"
            >
              <option value="" disabled>Expiry</option>
              {EXPIRY_OPTIONS.map((o, i) => (
                <option key={o.label} value={i}>{o.label}</option>
              ))}
            </select>

            <button
              className={`tb-btn lock-btn ${locked ? 'locked' : ''}`}
              onClick={toggleLock}
              title={locked ? 'Unlock session' : 'Lock session (read-only for guests)'}
            >
              {locked ? '🔒' : '🔓'}
            </button>
          </>
        )}

        <select
          className="tb-select"
          value={language}
          onChange={(e) => onLanguageChange(e.target.value)}
          aria-label="Language"
        >
          {LANGUAGES.map(({ id, label }) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>

        <button
          className="tb-btn"
          onClick={share}
          title="Copy session link"
        >
          {toastMsg || 'Share'}
        </button>

        <button
          className={`tb-btn ${historyOpen ? 'active' : ''}`}
          onClick={onHistoryToggle}
          title="Toggle history scrubber"
        >
          History
        </button>

        <button
          className="tb-btn theme-toggle"
          onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
        >
          {theme === 'dark' ? '☀' : '☽'}
        </button>
      </div>
    </div>
  );
}
