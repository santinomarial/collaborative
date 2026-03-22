import { useEffect, useState } from 'react';
import { Editor }    from './components/Editor';
import { WSClient }  from './ws/WSClient';
import './App.css';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';
const WS_BASE  = import.meta.env.VITE_WS_BASE_URL  ?? 'ws://localhost:3001';

function getUrlParams() {
  const p = new URLSearchParams(window.location.search);
  return { sessionId: p.get('sessionId'), token: p.get('token') };
}

export default function App() {
  const [sessionId, setSessionId] = useState(() => getUrlParams().sessionId);
  const [token,     setToken]     = useState(() => getUrlParams().token);
  const [wsClient,  setWsClient]  = useState(null);
  const [error,     setError]     = useState(null);

  // ── Resolve token if missing (user is already logged in via cookie) ────────
  useEffect(() => {
    if (token) return;

    fetch(`${API_BASE}/api/auth/token`, { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error('Not authenticated — visit /api/auth/login first');
        return r.json();
      })
      .then(({ token: t }) => setToken(t))
      .catch((e) => setError(e.message));
  }, [token]);

  // ── Create and connect WSClient once sessionId + token are both known ──────
  useEffect(() => {
    if (!sessionId || !token) return;

    const client = new WSClient(sessionId, token, WS_BASE);
    client.connect();
    setWsClient(client);

    return () => {
      client.disconnect();
      setWsClient(null);
    };
  }, [sessionId, token]);

  // ── No session in URL: show a minimal launcher ────────────────────────────
  if (!sessionId) {
    return (
      <div className="app-launcher">
        <SessionLauncher token={token} onSession={setSessionId} error={error} />
      </div>
    );
  }

  return (
    <div className="app">
      <Editor
        language="javascript"
        sessionId={sessionId}
        wsClient={wsClient}
      />
    </div>
  );
}

// ── Minimal session launcher (shown when no ?sessionId= in URL) ───────────────
function SessionLauncher({ token, onSession, error }) {
  const [loading, setLoading] = useState(false);
  const [title,   setTitle]   = useState('Untitled');

  async function createSession() {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/sessions`, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ title, language: 'javascript' }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { _id } = await res.json();

      // Update URL so the tab can be shared / reopened
      const url = new URL(window.location.href);
      url.searchParams.set('sessionId', _id);
      url.searchParams.set('token', token);
      window.history.replaceState(null, '', url.toString());

      onSession(_id);
    } catch (e) {
      alert('Failed to create session: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="launcher-card">
      <h2>Collaborative Editor</h2>
      {error && <p className="launcher-error">{error}</p>}
      <input
        className="launcher-input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Session title"
        disabled={!token}
      />
      <button
        className="launcher-btn"
        onClick={createSession}
        disabled={!token || loading}
      >
        {loading ? 'Creating…' : 'New session'}
      </button>
      {!token && <p className="launcher-hint">Sign in at <code>/api/auth/login</code> first.</p>}
    </div>
  );
}
