import { Editor } from './components/Editor';
import './App.css';

const INITIAL_DOC = `// Welcome to Collaborative Editor
// Select a language and start typing.

function greet(name) {
  const message = \`Hello, \${name}!\`;
  console.log(message);
  return message;
}

greet('world');
`;

export default function App() {
  return (
    <div className="app">
      <Editor initialDoc={INITIAL_DOC} language="javascript" />
    </div>
  );
}
