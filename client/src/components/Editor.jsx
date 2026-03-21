import { useState }        from 'react';
import { useEditor }        from '../editor/useEditor';
import { LANGUAGES }        from '../editor/languages';
import { useWebSocket }     from '../ws/useWebSocket';
import { ConnectionDot }    from './ConnectionDot';
import './Editor.css';

export function Editor({
  initialDoc   = '',
  language: initialLang = 'javascript',
  sessionId,
  token,
  onChange,
}) {
  const [language, setLanguage] = useState(initialLang);
  const [theme, setTheme]       = useState('dark');

  const { editorRef }            = useEditor({ initialDoc, language, theme, onChange });
  const { status, users }        = useWebSocket({ sessionId, token });

  return (
    <div className={`editor-shell ${theme}`}>
      <div className="editor-toolbar">
        {/* Left side: connection status + user count */}
        <div className="toolbar-left">
          <ConnectionDot status={status} />
          {users.length > 0 && (
            <span className="user-count" title={users.map(u => u.displayName).join(', ')}>
              {users.length} online
            </span>
          )}
        </div>

        {/* Right side: controls */}
        <div className="toolbar-right">
          <select
            className="lang-select"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            aria-label="Language"
          >
            {LANGUAGES.map(({ id, label }) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>

          <button
            className="theme-toggle"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            aria-label="Toggle theme"
            title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
          >
            {theme === 'dark' ? '☀' : '☽'}
          </button>
        </div>
      </div>

      <div className="editor-container" ref={editorRef} />
    </div>
  );
}
