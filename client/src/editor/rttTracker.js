/**
 * Module-level RTT sample store shared between CollabExtension (writer)
 * and any UI component that wants to display live latency stats (reader).
 *
 * Keeps the last MAX_SAMPLES measurements and notifies subscribers
 * with the current rolling p95 whenever a new sample arrives.
 */

const MAX_SAMPLES = 100;

let _samples = [];
const _listeners = new Set();

/** Record a new RTT measurement (milliseconds). */
export function recordRtt(ms) {
  _samples.push(ms);
  if (_samples.length > MAX_SAMPLES) _samples.shift();
  const p95 = getPercentile(95);
  _listeners.forEach((fn) => fn(p95));
}

/** Return the p-th percentile of all recorded samples, or null if empty. */
export function getPercentile(p) {
  if (_samples.length === 0) return null;
  const sorted = [..._samples].sort((a, b) => a - b);
  const idx    = Math.min(Math.floor((sorted.length * p) / 100), sorted.length - 1);
  return sorted[idx];
}

/**
 * Subscribe to rolling p95 updates.
 * @param {(p95: number) => void} handler
 * @returns {() => void} unsubscribe function
 */
export function onP95Update(handler) {
  _listeners.add(handler);
  return () => _listeners.delete(handler);
}
