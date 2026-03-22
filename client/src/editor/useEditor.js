import { useEffect, useRef, useCallback, useState } from 'react';
import { Compartment, EditorState }                  from '@codemirror/state';
import { EditorView, lineNumbers, keymap }           from '@codemirror/view';
import {
  defaultKeymap,
  historyKeymap,
  history,
}                                                    from '@codemirror/commands';
import {
  syntaxHighlighting,
  defaultHighlightStyle,
}                                                    from '@codemirror/language';
import { oneDark }                                   from '@codemirror/theme-one-dark';
import { getLanguageExtension }                      from './languages';
import { createCollabExtension }                     from './CollabExtension';

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
} = {}) {
  const editorRef    = useRef(null);
  const viewRef      = useRef(null);
  const onChangeRef  = useRef(onChange);
  const langComp     = useRef(new Compartment());
  const themeComp    = useRef(new Compartment());

  // { doc: string, revision: number } loaded from the server, or null while pending
  const [sessionData, setSessionData] = useState(null);

  onChangeRef.current = onChange;

  // ── Fetch initial snapshot ─────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) {
      setSessionData({ doc: '', revision: 0 });
      return;
    }

    fetch(`${API_BASE}/api/sessions/${sessionId}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        setSessionData({
          doc:      data.snapshot ?? '',
          revision: data.revision ?? 0,
        });
      })
      .catch((err) => {
        console.error('[useEditor] snapshot fetch failed', err);
        setSessionData({ doc: '', revision: 0 });
      });
  }, [sessionId]);

  // ── Create / destroy EditorView ────────────────────────────────────────────
  // Waits until sessionData is available so the initial revision is correct.
  useEffect(() => {
    if (!editorRef.current || sessionData === null) return;

    const collabExt = wsClient
      ? createCollabExtension(wsClient, sessionData.revision)
      : [];

    const state = EditorState.create({
      doc: sessionData.doc,
      extensions: [
        history(),
        lineNumbers(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        syntaxHighlighting(defaultHighlightStyle),
        langComp.current.of(getLanguageExtension(language)),
        themeComp.current.of(theme === 'dark' ? darkTheme : lightTheme),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
        }),
        EditorView.theme({ '&': { height: '100%' } }),
        collabExt,
      ],
    });

    const view = new EditorView({ state, parent: editorRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionData]); // re-create only if session changes

  // ── Reconfigure language ──────────────────────────────────────────────────
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: langComp.current.reconfigure(getLanguageExtension(language)),
    });
  }, [language]);

  // ── Reconfigure theme ─────────────────────────────────────────────────────
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeComp.current.reconfigure(theme === 'dark' ? darkTheme : lightTheme),
    });
  }, [theme]);

  // ── Imperative API ────────────────────────────────────────────────────────
  const updateDoc = useCallback((content) => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
    });
  }, []);

  return { editorRef, updateDoc };
}
