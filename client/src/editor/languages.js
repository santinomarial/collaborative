import { javascript } from '@codemirror/lang-javascript';
import { python }     from '@codemirror/lang-python';
import { go }         from '@codemirror/lang-go';
import { rust }       from '@codemirror/lang-rust';
import { html }       from '@codemirror/lang-html';
import { css }        from '@codemirror/lang-css';
import { json }       from '@codemirror/lang-json';

export const LANGUAGES = [
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'python',     label: 'Python'     },
  { id: 'go',         label: 'Go'         },
  { id: 'rust',       label: 'Rust'       },
  { id: 'html',       label: 'HTML'       },
  { id: 'css',        label: 'CSS'        },
  { id: 'json',       label: 'JSON'       },
];

export function getLanguageExtension(id) {
  switch (id) {
    case 'javascript': return javascript();
    case 'typescript': return javascript({ typescript: true });
    case 'python':     return python();
    case 'go':         return go();
    case 'rust':       return rust();
    case 'html':       return html();
    case 'css':        return css();
    case 'json':       return json();
    default:           return javascript();
  }
}
