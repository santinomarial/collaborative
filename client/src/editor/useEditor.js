import { useEffect, useRef, useCallback, useState } from 'react';
import { Compartment, EditorState }                  from '@codemirror/state';
import { EditorView, lineNumbers, keymap }           from '@codemirror/view';
// EditorView.editable is a Facet — reconfigured via Compartment for readOnly
import {
  defaultKeymap,
  historyKeymap,
  history,
}                                                    from '@codemirror/commands';
import {
  closeBrackets,
  closeBracketsKeymap,
}                                                    from '@codemirror/autocomplete';
import {
  syntaxHighlighting,
  defaultHighlightStyle,
}                                                    from '@codemirror/language';
import { oneDark }                                   from '@codemirror/theme-one-dark';
import { getLanguageExtension }                      from './languages';
import { createCollabExtension, isRemote }           from './CollabExtension';
import { cursorLayerExtension, updateCursors }       from './CursorLayer';

// ── Themes ────────────────────────────────────────────────────────────────────
const lightTheme = EditorView.theme(
  {
    '&': { background: '#ffffff', color: '#1a1a1a', height: '100%' },
    '.cm-content': { caretColor: '#1a1a1a' },
    '.cm-cursor': { borderLeftColor: '#1a1a1a' },
    '.cm-gutters': { background: '#f5f5f5', color: '#999', border: 'none' },
    '.cm-activeLineGutter': { background: '#e8e8e8' },
    '.cm-activeLine': { background: '#f0f0f0' },
    '.cm-selectionBackground': { background: '#b3d4ff' },
    '&.cm-focused .cm-selectionBackground': { background: '#b3d4ff' },
    '.cm-scroller': { fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: '14px' },
  },
  { dark: false }
);

const darkTheme = [
  oneDark,
  EditorView.theme({
    '&': { height: '100%' },
    '.cm-scroller': { fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: '14px' },
  }),
];

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

// ── Utility ───────────────────────────────────────────────────────────────────
function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * @param {{
 *   language?:        string,
 *   theme?:           'dark'|'light',
 *   onChange?:        (doc: string) => void,
 *   wsClient?:        import('../ws/WSClient').WSClient | null,
 *   sessionId?:       string | null,
 * }} options
 */
export function useEditor({
  language  = 'javascript',
  theme     = 'dark',
  onChange,
  wsClient  = null,
  sessionId = null,
  readOnly  = false,
} = {}) {
  const editorRef    = useRef(null);
  const viewRef      = useRef(null);
  const onChangeRef  = useRef(onChange);
  const wsClientRef  = useRef(wsClient);       // stable ref — avoids stale closures
  const langComp     = useRef(new Compartment());
  const themeComp    = useRef(new Compartment());
  const editableComp = useRef(new Compartment());

  // Map of userId → latest cursor payload; updated on cursor + presence events.
  const remoteCursorsRef = useRef(new Map());

  // Stable debounced cursor sender; (re)created with the editor view.
  const sendCursorRef = useRef(null);

  // { doc: string, revision: number } — null while loading
  const [sessionData, setSessionData] = useState(null);

  // Keep mutable refs current on every render so CM callbacks never go stale.
  onChangeRef.current = onChange;
  wsClientRef.current = wsClient;

  // ── Fetch initial snapshot ──────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) {
      setSessionData({ doc: '', revision: 0 });
      return;
    }

    fetch(`${API_BASE}/api/sessions/${sessionId}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((data) =>
        setSessionData({ doc: data.snapshot ?? '', revision: data.revision ?? 0 })
      )
      .catch((err) => {
        console.error('[useEditor] snapshot fetch failed', err);
        setSessionData({ doc: '', revision: 0 });
      });
  }, [sessionId]);

  // ── Create / destroy EditorView ─────────────────────────────────────────────
  useEffect(() => {
    if (!editorRef.current || sessionData === null) return;

    const collabExt = wsClient
      ? createCollabExtension(wsClient, sessionData.revision)
      : [];

    // Debounced cursor sender. Reads wsClientRef so it always uses the latest
    // client — avoids the need to recreate the editor if the client changes.
    sendCursorRef.current = debounce(() => {
      const view = viewRef.current;
      const wsc  = wsClientRef.current;
      if (!view || !wsc) return;
      const sel = view.state.selection.main;
      wsc.sendCursor({ position: sel.head, anchor: sel.anchor, head: sel.head });
    }, 50);

    const state = EditorState.create({
      doc: sessionData.doc,
      extensions: [
        history(),
        lineNumbers(),
        closeBrackets(),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
        syntaxHighlighting(defaultHighlightStyle),
        langComp.current.of(getLanguageExtension(language)),
        themeComp.current.of(theme === 'dark' ? darkTheme : lightTheme),
        editableComp.current.of(EditorView.editable.of(!readOnly)),
        EditorView.theme({ '&': { height: '100%' } }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current?.(update.state.doc.toString());
          }
          // Send cursor after any selection change that we initiated locally
          // (skip remote transactions so we don't echo their cursor back).
          if (
            update.selectionSet &&
            !update.transactions.some((tr) => tr.annotation(isRemote))
          ) {
            sendCursorRef.current?.();
          }
        }),
        cursorLayerExtension,
        collabExt,
      ],
    });

    const view = new EditorView({ state, parent: editorRef.current });
    viewRef.current = view;

    // Repaint any cursors that arrived before the view was ready (reconnect case).
    const existingCursors = [...remoteCursorsRef.current.values()];
    if (existingCursors.length > 0) updateCursors(view, existingCursors);

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionData]); // intentionally recreate only when session changes

  // ── Reconfigure language ────────────────────────────────────────────────────
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: langComp.current.reconfigure(getLanguageExtension(language)),
    });
  }, [language]);

  // ── Reconfigure theme ───────────────────────────────────────────────────────
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeComp.current.reconfigure(theme === 'dark' ? darkTheme : lightTheme),
    });
  }, [theme]);

  // ── Reconfigure readOnly ────────────────────────────────────────────────────
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: editableComp.current.reconfigure(EditorView.editable.of(!readOnly)),
    });
  }, [readOnly]);

  // ── Remote cursor / presence subscriptions ──────────────────────────────────
  useEffect(() => {
    if (!wsClient) return;

    // Individual cursor message: update this user's entry and repaint.
    const unsubCursor = wsClient.on('cursor', (payload) => {
      if (!payload?.userId) return;
      remoteCursorsRef.current.set(payload.userId, payload);
      const view = viewRef.current;
      if (view) updateCursors(view, [...remoteCursorsRef.current.values()]);
    });

    // Presence broadcast: evict cursors for users who are no longer in the session.
    // Handles the "user disconnects → cursor disappears within 5s" requirement —
    // the server sends a presence update after the heartbeat detects a dead socket.
    const unsubPresence = wsClient.on('presence', (payload) => {
      const activeIds = new Set((payload?.users ?? []).map((u) => u.userId));
      let changed = false;
      for (const uid of remoteCursorsRef.current.keys()) {
        if (!activeIds.has(uid)) {
          remoteCursorsRef.current.delete(uid);
          changed = true;
        }
      }
      if (changed) {
        const view = viewRef.current;
        if (view) updateCursors(view, [...remoteCursorsRef.current.values()]);
      }
    });

    return () => {
      unsubCursor();
      unsubPresence();
    };
  }, [wsClient]);

  // ── Imperative API ────────────────────────────────────────────────────────────
  const updateDoc = useCallback((content) => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
    });
  }, []);

  return { editorRef, updateDoc };
}
