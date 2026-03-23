import { Routes, Route, Navigate } from 'react-router-dom';
import { JoinPage }    from './components/JoinPage';
import { SessionPage } from './pages/SessionPage';
import './App.css';

export default function App() {
  return (
    <Routes>
      <Route path="/"            element={<JoinPage />} />
      <Route path="/session/:id" element={<SessionPage />} />
      {/* Catch-all: back to join page */}
      <Route path="*"            element={<Navigate to="/" replace />} />
    </Routes>
  );
}
