import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import './JoinPage.css';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

const AVATAR_COLORS = [
  '#528bff', '#e06c75', '#98c379', '#e5c07b',
  '#c678dd', '#56b6c2', '#d19a66', '#abb2bf',
];

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

function getPasswordStrength(pw) {
  if (!pw) return null;
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return 'weak';
  if (score <= 3) return 'medium';
  return 'strong';
}

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function getInitials(name) {
  return name.trim().slice(0, 2).toUpperCase() || '?';
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function EyeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}

// ── Primitives ────────────────────────────────────────────────────────────────

function FieldError({ message }) {
  if (!message) return null;
  return <p className="field-error">{message}</p>;
}

function PasswordInput({ id, value, onChange, onBlur, placeholder, hasError }) {
  const [show, setShow] = useState(false);
  return (
    <div className="input-wrap">
      <input
        id={id}
        className={`join-input${hasError ? ' input-error' : ''}`}
        type={show ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        autoComplete="off"
      />
      <button
        type="button"
        className="eye-btn"
        onClick={() => setShow((s) => !s)}
        tabIndex={-1}
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

function StrengthBar({ strength }) {
  if (!strength) return null;
  const labels = { weak: 'Weak', medium: 'Medium', strong: 'Strong' };
  return (
    <div className="strength-wrap">
      <div className={`strength-bar strength-${strength}`}>
        <span /><span /><span />
      </div>
      <span className={`strength-label strength-label-${strength}`}>
        {labels[strength]}
      </span>
    </div>
  );
}

function BtnSpinner() {
  return <span className="btn-spinner" aria-hidden="true" />;
}

// ── Register form ─────────────────────────────────────────────────────────────

function RegisterForm({ returnSessionId, onSuccess }) {
  const [fields, setFields] = useState({
    displayName: '', email: '', password: '', confirm: '', title: 'Untitled',
  });
  const [touched, setTouched] = useState({});
  const [loading, setLoading]   = useState(false);
  const [success, setSuccess]   = useState(false);
  const [globalErr, setGlobalErr] = useState('');

  const set  = (key) => (e) => setFields((f) => ({ ...f, [key]: e.target.value }));
  const blur = (key) => ()  => setTouched((t) => ({ ...t, [key]: true }));

  const errors = {
    displayName: !fields.displayName.trim()
      ? 'Display name is required' : '',
    email: !fields.email
      ? 'Email is required'
      : !isValidEmail(fields.email)
        ? 'Enter a valid email address' : '',
    password: !fields.password
      ? 'Password is required'
      : fields.password.length < 8
        ? 'Minimum 8 characters' : '',
    confirm: !fields.confirm
      ? 'Please confirm your password'
      : fields.confirm !== fields.password
        ? 'Passwords do not match' : '',
  };
  const valid = Object.values(errors).every((e) => !e);

  async function submit(e) {
    e.preventDefault();
    setGlobalErr('');
    setLoading(true);
    try {
      await apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: fields.email,
          password: fields.password,
          displayName: fields.displayName,
        }),
      });
      const { token } = await apiFetch('/api/auth/token');
      let sessionId = returnSessionId;
      if (!sessionId) {
        const sess = await apiFetch('/api/sessions', {
          method: 'POST',
          body: JSON.stringify({ title: fields.title || 'Untitled', language: 'javascript' }),
        });
        sessionId = sess._id;
      }
      setSuccess(true);
      setTimeout(() => onSuccess(`/session/${sessionId}?token=${token}`), 900);
    } catch (err) {
      setGlobalErr(err.message);
    } finally {
      setLoading(false);
    }
  }

  const disabled = loading || success || !valid;
  const strength = getPasswordStrength(fields.password);

  return (
    <form onSubmit={submit} className="join-form" noValidate>
      <div className="field-group">
        <label className="field-label" htmlFor="r-name">Display name</label>
        <input
          id="r-name"
          className={`join-input${touched.displayName && errors.displayName ? ' input-error' : ''}`}
          placeholder="Your name"
          value={fields.displayName}
          onChange={set('displayName')}
          onBlur={blur('displayName')}
        />
        {touched.displayName && <FieldError message={errors.displayName} />}
      </div>

      <div className="field-group">
        <label className="field-label" htmlFor="r-email">Email</label>
        <input
          id="r-email"
          className={`join-input${touched.email && errors.email ? ' input-error' : ''}`}
          type="email"
          placeholder="you@example.com"
          value={fields.email}
          onChange={set('email')}
          onBlur={blur('email')}
        />
        {touched.email && <FieldError message={errors.email} />}
      </div>

      <div className="field-group">
        <label className="field-label" htmlFor="r-pw">Password</label>
        <PasswordInput
          id="r-pw"
          placeholder="Minimum 8 characters"
          value={fields.password}
          onChange={set('password')}
          onBlur={blur('password')}
          hasError={touched.password && !!errors.password}
        />
        <StrengthBar strength={strength} />
        {touched.password && <FieldError message={errors.password} />}
      </div>

      <div className="field-group">
        <label className="field-label" htmlFor="r-confirm">Confirm password</label>
        <PasswordInput
          id="r-confirm"
          placeholder="Repeat your password"
          value={fields.confirm}
          onChange={set('confirm')}
          onBlur={blur('confirm')}
          hasError={touched.confirm && !!errors.confirm}
        />
        {touched.confirm && <FieldError message={errors.confirm} />}
      </div>

      {!returnSessionId && (
        <div className="field-group">
          <label className="field-label" htmlFor="r-title">Session title</label>
          <input
            id="r-title"
            className="join-input"
            placeholder="Untitled"
            value={fields.title}
            onChange={set('title')}
          />
        </div>
      )}

      {globalErr && <p className="global-error">{globalErr}</p>}

      <button
        className={`join-btn primary${success ? ' btn-success-state' : ''}`}
        type="submit"
        disabled={disabled}
      >
        {loading  ? <><BtnSpinner />Please wait…</>      :
         success  ? <><span className="btn-check"><CheckIcon /></span>Account created!</> :
         returnSessionId ? 'Sign in & join' : 'Create account'}
      </button>
    </form>
  );
}

// ── Login form ────────────────────────────────────────────────────────────────

function LoginForm({ returnSessionId, onSuccess }) {
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [touched, setTouched]       = useState({});
  const [loading, setLoading]       = useState(false);
  const [success, setSuccess]       = useState(false);
  const [globalErr, setGlobalErr]   = useState('');

  const errors = {
    email:    !email    ? 'Email is required'    : !isValidEmail(email) ? 'Enter a valid email address' : '',
    password: !password ? 'Password is required' : '',
  };
  const valid = Object.values(errors).every((e) => !e);

  async function submit(e) {
    e.preventDefault();
    setGlobalErr('');
    setLoading(true);
    try {
      await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      const { token } = await apiFetch('/api/auth/token');
      let sessionId = returnSessionId;
      if (!sessionId) {
        const sess = await apiFetch('/api/sessions', {
          method: 'POST',
          body: JSON.stringify({ title: 'Untitled', language: 'javascript' }),
        });
        sessionId = sess._id;
      }
      setSuccess(true);
      setTimeout(() => onSuccess(`/session/${sessionId}?token=${token}`), 900);
    } catch (err) {
      setGlobalErr(err.message);
    } finally {
      setLoading(false);
    }
  }

  const disabled = loading || success || !valid;

  return (
    <form onSubmit={submit} className="join-form" noValidate>
      <div className="field-group">
        <label className="field-label" htmlFor="l-email">Email</label>
        <input
          id="l-email"
          className={`join-input${touched.email && errors.email ? ' input-error' : ''}`}
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, email: true }))}
        />
        {touched.email && <FieldError message={errors.email} />}
      </div>

      <div className="field-group">
        <div className="label-row">
          <label className="field-label" htmlFor="l-pw">Password</label>
          <button type="button" className="link-btn">Forgot password?</button>
        </div>
        <PasswordInput
          id="l-pw"
          placeholder="Your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, password: true }))}
          hasError={touched.password && !!errors.password}
        />
        {touched.password && <FieldError message={errors.password} />}
      </div>

      <label className="checkbox-label">
        <input
          type="checkbox"
          className="checkbox-native"
          checked={rememberMe}
          onChange={(e) => setRememberMe(e.target.checked)}
        />
        <span className="checkbox-custom" />
        <span className="checkbox-text">Remember me</span>
      </label>

      {globalErr && <p className="global-error">{globalErr}</p>}

      <button
        className={`join-btn primary${success ? ' btn-success-state' : ''}`}
        type="submit"
        disabled={disabled}
      >
        {loading ? <><BtnSpinner />Please wait…</>     :
         success ? <><span className="btn-check"><CheckIcon /></span>Signed in!</> :
         returnSessionId ? 'Sign in & join' : 'Sign in'}
      </button>
    </form>
  );
}

// ── Create panel (tabs: register / login) ─────────────────────────────────────

function CreatePanel({ returnSessionId }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState('register');

  return (
    <div className="join-panel">
      <h3 className="panel-title">
        {returnSessionId ? 'Sign in to join' : 'New session'}
      </h3>

      <div className="tab-row">
        <button
          type="button"
          className={`tab-btn${tab === 'register' ? ' active' : ''}`}
          onClick={() => setTab('register')}
        >
          Register
        </button>
        <button
          type="button"
          className={`tab-btn${tab === 'login' ? ' active' : ''}`}
          onClick={() => setTab('login')}
        >
          Sign in
        </button>
      </div>

      {tab === 'register' ? (
        <RegisterForm
          key="register"
          returnSessionId={returnSessionId}
          onSuccess={(path) => navigate(path)}
        />
      ) : (
        <LoginForm
          key="login"
          returnSessionId={returnSessionId}
          onSuccess={(path) => navigate(path)}
        />
      )}
    </div>
  );
}

// ── Guest panel ───────────────────────────────────────────────────────────────

function GuestPanel({ returnSessionId }) {
  const navigate = useNavigate();
  const [displayName, setDisplayName]   = useState('');
  const [nameTouched, setNameTouched]   = useState(false);
  const [selectedColor, setSelectedColor] = useState(AVATAR_COLORS[0]);
  const [sessionInput, setSessionInput] = useState('');
  const [loading, setLoading]           = useState(false);
  const [success, setSuccess]           = useState(false);
  const [error, setError]               = useState('');

  const nameError = nameTouched && !displayName.trim() ? 'Display name is required' : '';
  const valid = displayName.trim().length > 0
    && (returnSessionId != null || sessionInput.trim().length > 0);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiFetch('/api/auth/guest', {
        method: 'POST',
        body: JSON.stringify({ displayName: displayName.trim() }),
      });
      const { token } = await apiFetch('/api/auth/token');

      let sid = returnSessionId ?? sessionInput.trim();
      const urlMatch = sid.match(/\/session\/([^/?]+)/);
      if (urlMatch) sid = urlMatch[1];
      if (!sid) throw new Error('Enter a session ID or URL');

      setSuccess(true);
      setTimeout(() => navigate(`/session/${sid}?token=${token}`), 900);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const disabled = loading || success || !valid;

  return (
    <div className="join-panel">
      <h3 className="panel-title">Join as guest</h3>
      <p className="panel-sub">No account needed — paste a session link to collaborate.</p>

      <form onSubmit={submit} className="join-form" noValidate>
        <div className="field-group">
          <div className="label-row">
            <label className="field-label" htmlFor="g-name">Display name</label>
            <span className="char-counter">{displayName.length}/50</span>
          </div>
          <input
            id="g-name"
            className={`join-input${nameError ? ' input-error' : ''}`}
            placeholder="Pick a name"
            value={displayName}
            maxLength={50}
            onChange={(e) => setDisplayName(e.target.value)}
            onBlur={() => setNameTouched(true)}
          />
          {nameError && <FieldError message={nameError} />}
        </div>

        <div className="field-group">
          <label className="field-label">Avatar</label>
          <div className="avatar-row">
            <div className="color-swatches">
              {AVATAR_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`color-swatch${selectedColor === color ? ' selected' : ''}`}
                  style={{ background: color }}
                  onClick={() => setSelectedColor(color)}
                  aria-label={`Select color ${color}`}
                />
              ))}
            </div>
            <div className="avatar-preview" style={{ background: selectedColor }}>
              {getInitials(displayName)}
            </div>
          </div>
        </div>

        {!returnSessionId && (
          <div className="field-group">
            <label className="field-label" htmlFor="g-session">Session URL or ID</label>
            <input
              id="g-session"
              className="join-input"
              placeholder="https://… or session ID"
              value={sessionInput}
              onChange={(e) => setSessionInput(e.target.value)}
            />
          </div>
        )}

        {error && <p className="global-error">{error}</p>}

        <button
          className={`join-btn secondary${success ? ' btn-success-state' : ''}`}
          type="submit"
          disabled={disabled}
        >
          {loading ? <><BtnSpinner />Joining…</>     :
           success ? <><span className="btn-check"><CheckIcon /></span>Joined!</> :
           'Join as guest'}
        </button>
      </form>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function JoinPage() {
  const [searchParams] = useSearchParams();
  const returnSessionId = searchParams.get('sessionId') ?? null;

  return (
    <div className="join-page">
      <div className="join-hero">
        <div className="join-logo">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
            stroke="#528bff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 18 22 12 16 6"/>
            <polyline points="8 6 2 12 8 18"/>
          </svg>
        </div>
        <h1 className="join-heading">Collaborative Editor</h1>
        <p className="join-sub">Real-time code editing — no setup required.</p>
      </div>

      <div className="join-cards">
        <CreatePanel returnSessionId={returnSessionId} />
        <div className="join-divider"><span>or</span></div>
        <GuestPanel  returnSessionId={returnSessionId} />
      </div>
    </div>
  );
}
