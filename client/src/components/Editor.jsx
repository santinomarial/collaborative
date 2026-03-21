import { useState } from 'react';
import { useEditor }   from '../editor/useEditor';
import { LANGUAGES }   from '../editor/languages';
import './Editor.css';

export function Editor({ initialDoc = '', language: initialLang = 'javascript', onChange }) {
  const [language, setLanguage] = useState(initialLang);
  const [theme, setTheme]       = useState('dark');

  const { editorRef } = useEditor({ initialDoc, language, theme, onChange });

  return (
    <div className={`editor-shell ${theme}`}>
      <div className="editor-toolbar">
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

      <div className="editor-container" ref={editorRef} />
    </div>
  );
}
