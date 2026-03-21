import { useEffect, useRef, useCallback } from 'react';
import { Compartment, EditorState }        from '@codemirror/state';
import { EditorView, lineNumbers, keymap } from '@codemirror/view';
import {
  defaultKeymap,
  historyKeymap,
  history,
}                                          from '@codemirror/commands';
import {
  syntaxHighlighting,
  defaultHighlightStyle,
}                                          from '@codemirror/language';
import { oneDark }                         from '@codemirror/theme-one-dark';
import { getLanguageExtension }            from './languages';

// Light base theme: give the editor a white background and dark text so it
// looks intentional rather than inheriting random container colours.
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

/**
 * @param {{ initialDoc?: string, language?: string, theme?: 'dark'|'light', onChange?: (doc: string) => void }} options
 * @returns {{ editorRef: React.RefObject, updateDoc: (content: string) => void }}
 */
export function useEditor({ initialDoc = '', language = 'javascript', theme = 'dark', onChange } = {}) {
  const editorRef    = useRef(null);
  const viewRef      = useRef(null);
  const onChangeRef  = useRef(onChange);
  const langComp     = useRef(new Compartment());
  const themeComp    = useRef(new Compartment());

  // Keep onChange ref current without recreating the editor
  onChangeRef.current = onChange;

  // ── Create / destroy view ─────────────────────────────────────────────────
  useEffect(() => {
    if (!editorRef.current) return;

    const state = EditorState.create({
      doc: initialDoc,
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
      ],
    });

    const view = new EditorView({ state, parent: editorRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally only on mount

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
