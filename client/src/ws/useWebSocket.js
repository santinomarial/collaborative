import { useEffect, useRef, useState, useCallback } from 'react';
import { WSClient } from './WSClient';

/**
 * @typedef {'connected'|'reconnecting'|'disconnected'} WsStatus
 */

/**
 * React hook that manages a WSClient lifecycle.
 *
 * Reads sessionId and token from:
 *   1. The URL search params  (?sessionId=xxx&token=yyy)
 *   2. Fallback props passed to the hook
 *
 * @param {{ sessionId?: string, token?: string, baseUrl?: string }} [options]
 * @returns {{
 *   sendOp:    (revision: number, ops: object[]) => void,
 *   sendCursor:(cursor: object) => void,
 *   status:    WsStatus,
 *   users:     object[],
 * }}
 */
export function useWebSocket({ sessionId: propSid, token: propToken, baseUrl } = {}) {
  // Resolve sessionId + token from URL params first, props as fallback
  const params    = new URLSearchParams(window.location.search);
  const sessionId = propSid   ?? params.get('sessionId') ?? null;
  const token     = propToken ?? params.get('token')     ?? null;

  const clientRef = useRef(null);

  const [status, setStatus] = useState(/** @type {WsStatus} */ ('disconnected'));
  const [users,  setUsers]  = useState([]);

  useEffect(() => {
    if (!sessionId || !token) return;

    const client = new WSClient(sessionId, token, baseUrl);
    clientRef.current = client;

    // ── Status ────────────────────────────────────────────────────────────
    client.on('status', setStatus);

    // ── Presence ──────────────────────────────────────────────────────────
    client.on('presence', (payload) => {
      setUsers(payload?.users ?? []);
    });

    client.connect();

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [sessionId, token, baseUrl]);

  const sendOp = useCallback((revision, ops) => {
    clientRef.current?.sendOp(revision, ops);
  }, []);

  const sendCursor = useCallback((cursor) => {
    clientRef.current?.sendCursor(cursor);
  }, []);

  return { sendOp, sendCursor, status, users };
}
