import { useEditor } from '../editor/useEditor';

/**
 * Pure editor surface — no toolbar chrome.
 * All controls (language, theme, lock) live in Toolbar.jsx at the page level.
 */
export function Editor({
  language  = 'javascript',
  theme     = 'dark',
  sessionId = null,
  wsClient  = null,
  onChange,
  readOnly  = false,
}) {
  const { editorRef } = useEditor({
    language,
    theme,
    onChange,
    wsClient,
    sessionId,
    readOnly,
  });

  return (
    <div
      className="editor-surface"
      ref={editorRef}
      style={{ flex: 1, minWidth: 0, height: '100%', overflow: 'hidden' }}
    />
  );
}
