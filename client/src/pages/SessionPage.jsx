import { useState, useEffect, useMemo } from 'react';
import { useParams, useSearchParams, Navigate, useNavigate } from 'react-router-dom';
import { WSClient }          from '../ws/WSClient';
import { useWebSocket }      from '../ws/useWebSocket';
import { Editor }            from '../components/Editor';
import { Toolbar }           from '../components/Toolbar';
import { PresencePanel }     from '../components/PresencePanel';
import { HistoryScrubber }   from '../components/HistoryScrubber';
import './SessionPage.css';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';
const WS_BASE  = import.meta.env.VITE_WS_BASE_URL  ?? 'ws://localhost:3001';

// ── JWT helpers ───────────────────────────────────────────────────────────────

function parseJwt(token) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function SessionPage() {
  const { id: sessionId }        = useParams();
  const [searchParams]           = useSearchParams();
  const navigate                 = useNavigate();

  // Token: prefer URL param so magic links work; fall back to cookie endpoint
  const [token,        setToken]        = useState(() => searchParams.get('token'));
  const [session,      setSession]      = useState(null);
  const [wsClient,     setWsClient]     = useState(null);
  const [language,     setLanguage]     = useState('javascript');
  const [theme,        setTheme]        = useState('dark');
  const [panelOpen,    setPanelOpen]    = useState(true);
  const [historyOpen,  setHistoryOpen]  = useState(false);
  const [authError,    setAuthError]    = useState(null);

  // Resolve token from cookie if not in URL
  useEffect(() => {
    if (token) return;
    fetch(`${API_BASE}/api/auth/token`, { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error('not authenticated');
        return r.json();
      })
      .then(({ token: t }) => setToken(t))
      .catch(() => setAuthError(true));
  }, [token]);

  // Fetch session metadata once token is available
  useEffect(() => {
    if (!sessionId || !token) return;
    fetch(`${API_BASE}/api/sessions/${sessionId}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        setSession(data);
        if (data.language) setLanguage(data.language);
      })
      .catch(console.error);
  }, [sessionId, token]);

  // Create and connect WSClient
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

  const { status, users } = useWebSocket(wsClient);

  // Listen for server-initiated kick
  useEffect(() => {
    if (!wsClient) return;
    return wsClient.on('error', (payload) => {
      if (payload?.code === 'KICKED') {
        navigate('/?kicked=1', { replace: true });
      }
    });
  }, [wsClient, navigate]);

  function onKick(targetUserId) {
    wsClient?.send('admin', { action: 'kick', targetUserId });
  }

  const jwtPayload = useMemo(() => (token ? parseJwt(token) : null), [token]);
  const isOwner = !!(
    jwtPayload?.userId &&
    session?.owner &&
    String(jwtPayload.userId) === String(session.owner)
  );

  const readOnly = (session?.isLocked ?? false) && !isOwner;

  if (authError) {
    return <Navigate to={`/?sessionId=${sessionId}`} replace />;
  }

  return (
    <div className={`session-layout theme-${theme}`} data-theme={theme}>
      <Toolbar
        session={session}
        isOwner={isOwner}
        language={language}
        onLanguageChange={setLanguage}
        theme={theme}
        onThemeChange={setTheme}
        token={token}
        status={status}
        onSessionUpdate={setSession}
        historyOpen={historyOpen}
        onHistoryToggle={() => setHistoryOpen((o) => !o)}
      />

      <div className="session-body">
        <Editor
          sessionId={sessionId}
          wsClient={wsClient}
          language={language}
          theme={theme}
          readOnly={readOnly}
        />

        <PresencePanel
          users={users}
          wsClient={wsClient}
          session={session}
          isOpen={panelOpen}
          onToggle={() => setPanelOpen((o) => !o)}
          viewerIsOwner={isOwner}
          viewerUserId={jwtPayload?.userId ?? null}
          onKick={onKick}
        />
      </div>

      <HistoryScrubber
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        session={session}
        isOwner={isOwner}
      />
    </div>
  );
}
