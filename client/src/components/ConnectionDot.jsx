import './ConnectionDot.css';

const LABELS = {
  connected:    'Connected',
  reconnecting: 'Reconnecting…',
  disconnected: 'Disconnected',
};

export function ConnectionDot({ status = 'disconnected' }) {
  return (
    <span
      className={`conn-dot conn-dot--${status}`}
      title={LABELS[status] ?? status}
      aria-label={LABELS[status] ?? status}
    />
  );
}
