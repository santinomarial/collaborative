import { useEffect, useState, useCallback } from 'react';

/**
 * React hook that subscribes to an existing WSClient instance.
 * Lifecycle (connect / disconnect) is managed by the caller (App.jsx).
 *
 * @param {import('./WSClient').WSClient | null} wsClient
 * @returns {{
 *   sendOp:     (revision: number, ops: object[]) => void,
 *   sendCursor: (cursor: object) => void,
 *   status:     'connected'|'reconnecting'|'disconnected',
 *   users:      object[],
 * }}
 */
export function useWebSocket(wsClient) {
  const [status, setStatus] = useState('disconnected');
  const [users,  setUsers]  = useState([]);

  useEffect(() => {
    if (!wsClient) return;

    const unsubStatus   = wsClient.on('status',   setStatus);
    const unsubPresence = wsClient.on('presence',  (p) => setUsers(p?.users ?? []));

    return () => {
      unsubStatus();
      unsubPresence();
    };
  }, [wsClient]);

  const sendOp     = useCallback((revision, ops) => wsClient?.sendOp(revision, ops),  [wsClient]);
  const sendCursor = useCallback((cursor)          => wsClient?.sendCursor(cursor),    [wsClient]);

  return { sendOp, sendCursor, status, users };
}
