import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import './JoinPage.css';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Create-session panel ──────────────────────────────────────────────────────

function CreatePanel({ returnSessionId }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState('register'); // 'login' | 'register'
  const [title, setTitle] = useState('Untitled');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      // 1. Auth
      if (tab === 'register') {
        await apiFetch('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ email, password, displayName }),
        });
      } else {
        await apiFetch('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
      }
      // 2. Get token for WS
      const { token } = await apiFetch('/api/auth/token');
      // 3. Create or join session
      let sessionId = returnSessionId;
      if (!sessionId) {
        const session = await apiFetch('/api/sessions', {
          method: 'POST',
          body: JSON.stringify({ title, language: 'javascript' }),
        });
        sessionId = session._id;
      }
      navigate(`/session/${sessionId}?token=${token}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="join-panel">
      <h3 className="panel-title">
        {returnSessionId ? 'Sign in to join' : 'New session'}
      </h3>

      <div className="tab-row">
        <button
          className={`tab-btn ${tab === 'register' ? 'active' : ''}`}
          onClick={() => setTab('register')}
        >
          Register
        </button>
        <button
          className={`tab-btn ${tab === 'login' ? 'active' : ''}`}
          onClick={() => setTab('login')}
        >
          Sign in
        </button>
      </div>

      <form onSubmit={submit} className="join-form">
        {tab === 'register' && (
          <input
            className="join-input"
            placeholder="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
        )}
        <input
          className="join-input"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="join-input"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
        />
        {!returnSessionId && tab === 'register' && (
          <input
            className="join-input"
            placeholder="Session title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        )}
        {error && <p className="join-error">{error}</p>}
        <button className="join-btn primary" type="submit" disabled={loading}>
          {loading ? 'Please wait…' : returnSessionId ? 'Sign in & join' : 'Create session'}
        </button>
      </form>
    </div>
  );
}

// ── Guest panel ───────────────────────────────────────────────────────────────

function GuestPanel({ returnSessionId }) {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [sessionInput, setSessionInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await apiFetch('/api/auth/guest', {
        method: 'POST',
        body: JSON.stringify({ displayName }),
      });
      const { token } = await apiFetch('/api/auth/token');

      // Resolve session ID from the input (handle full URLs too)
      let sid = returnSessionId ?? sessionInput.trim();
      const urlMatch = sid.match(/\/session\/([^/?]+)/);
      if (urlMatch) sid = urlMatch[1];

      if (!sid) throw new Error('Enter a session ID or URL');
      navigate(`/session/${sid}?token=${token}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="join-panel">
      <h3 className="panel-title">Join as guest</h3>
      <p className="panel-sub">No account needed. Paste a session link to collaborate.</p>

      <form onSubmit={submit} className="join-form">
        <input
          className="join-input"
          placeholder="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
          minLength={1}
        />
        {!returnSessionId && (
          <input
            className="join-input"
            placeholder="Session URL or ID"
            value={sessionInput}
            onChange={(e) => setSessionInput(e.target.value)}
          />
        )}
        {error && <p className="join-error">{error}</p>}
        <button className="join-btn secondary" type="submit" disabled={loading}>
          {loading ? 'Joining…' : 'Join as guest'}
        </button>
      </form>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function JoinPage() {
  const [searchParams] = useSearchParams();
  // If someone arrives at / with ?sessionId=xxx, they want to join that session.
  const returnSessionId = searchParams.get('sessionId') ?? null;

  return (
    <div className="join-page">
      <div className="join-hero">
        <h1 className="join-heading">Collaborative Editor</h1>
        <p className="join-sub">Real-time code editing — no setup required.</p>
      </div>

      <div className="join-cards">
        <CreatePanel returnSessionId={returnSessionId} />
        <div className="join-divider">or</div>
        <GuestPanel  returnSessionId={returnSessionId} />
      </div>
    </div>
  );
}
