import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { EditorState }                                        from '@codemirror/state';
import { EditorView }                                        from '@codemirror/view';
import { syntaxHighlighting, defaultHighlightStyle }         from '@codemirror/language';
import { oneDark }                                           from '@codemirror/theme-one-dark';
import { lineNumbers }                                       from '@codemirror/view';
import { getLanguageExtension }                              from '../editor/languages';
import { apply }                                             from '../editor/otEngine';
import './HistoryScrubber.css';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

// ── Data fetching ─────────────────────────────────────────────────────────────

/** Fetches all history pages, returns flat operations array sorted by revision. */
async function fetchAllHistory(sessionId) {
  const PAGE_LIMIT = 200;
  let page = 1;
  let all  = [];
  let totalPages = 1;

  do {
    const res = await fetch(
      `${API_BASE}/api/sessions/${sessionId}/history?page=${page}&limit=${PAGE_LIMIT}`,
      { credentials: 'include' }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    all        = all.concat(data.operations ?? []);
    totalPages = data.pages ?? 1;
    page++;
  } while (page <= totalPages);

  // Guarantee ascending revision order regardless of server sort
  return all.sort((a, b) => a.revision - b.revision);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTs(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour:  '2-digit', minute: '2-digit',
  });
}

// ── Read-only CM preview ──────────────────────────────────────────────────────

/**
 * A plain CM EditorView — not via useEditor, so it carries no collab extensions.
 * Created once per mount; doc is updated imperatively when the slider moves.
 */
function usePreviewEditor(containerRef, language) {
  const viewRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: '',
      extensions: [
        lineNumbers(),
        syntaxHighlighting(defaultHighlightStyle),
        getLanguageExtension(language ?? 'javascript'),
        oneDark,
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
        EditorView.theme({
          '&': {
            height: '100%',
            background: '#1a1d23',
            fontSize:   '13px',
          },
          '.cm-scroller': {
            fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
            overflow:   'auto',
          },
          '.cm-gutters': {
            background:  '#1a1d23',
            borderRight: '1px solid #2c313a',
            color:       '#3e4451',
          },
          '.cm-cursor': { display: 'none' },
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  // language change triggers a fresh editor (simpler than Compartment here)
  }, [language]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Replace the entire document content. */
  const setDoc = useCallback((text) => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === text) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: text } });
  }, []);

  return setDoc;
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * @param {{
 *   isOpen:   boolean,
 *   onClose:  () => void,
 *   session:  object | null,
 *   isOwner:  boolean,
 * }} props
 */
export function HistoryScrubber({ isOpen, onClose, session, isOwner }) {
  const [operations, setOperations] = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [sliderIdx,  setSliderIdx]  = useState(0);

  const previewContainerRef = useRef(null);
  const setDoc = usePreviewEditor(previewContainerRef, session?.language);

  // ── Fetch when drawer opens ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen || !session?._id) return;
    setLoading(true);
    setFetchError(null);
    fetchAllHistory(session._id)
      .then((ops) => {
        setOperations(ops);
        setSliderIdx(ops.length); // start at the latest revision
      })
      .catch((e) => setFetchError(e.message))
      .finally(() => setLoading(false));
  }, [isOpen, session?._id]);

  // ── Pre-compute all intermediate document states ────────────────────────────
  //
  // states[0]   = '' (the base before any stored op — see NOTE below)
  // states[i]   = document string after applying operations[0..i-1]
  // states[N]   = document at the latest stored revision
  //
  // NOTE: history only contains ops since the last checkpoint. For sessions
  // without a checkpoint (< 100 ops) states[0] === '' is exactly correct.
  // For checkpointed sessions, states[0] is an approximation; a future version
  // should store a "base snapshot" on the server alongside the op log.
  const states = useMemo(() => {
    const docs = [''];
    let current = '';
    for (const operation of operations) {
      for (const op of operation.ops) {
        try {
          current = apply(current, op);
        } catch (err) {
          // Individual ops that fall out of range are skipped — the replay
          // continues from whatever state we've reached so far.
          console.warn('[HistoryScrubber] apply skipped', op, err.message);
        }
      }
      docs.push(current);
    }
    return docs;
  }, [operations]);

  // ── Keep the CM preview in sync with the slider ─────────────────────────────
  useEffect(() => {
    setDoc(states[sliderIdx] ?? '');
  }, [sliderIdx, states, setDoc]);

  if (!isOpen) return null;

  const max       = operations.length;
  const currentOp = sliderIdx > 0 ? operations[sliderIdx - 1] : null;

  async function handleRestore() {
    if (!currentOp || !session?._id) return;
    try {
      const res = await fetch(`${API_BASE}/api/sessions/${session._id}/restore`, {
        method:      'PATCH',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ revision: currentOp.revision, snapshot: states[sliderIdx] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      window.location.reload();
    } catch (err) {
      console.error('[HistoryScrubber] restore failed', err);
    }
  }

  return (
    <div className="history-scrubber" role="dialog" aria-label="History scrubber">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="hs-header">
        <span className="hs-label">History</span>

        <div className="hs-meta">
          {loading && <span className="hs-loading">Loading…</span>}
          {fetchError && <span className="hs-error">{fetchError}</span>}
          {!loading && !fetchError && max === 0 && (
            <span className="hs-empty">No operations recorded yet.</span>
          )}
          {!loading && !fetchError && max > 0 && currentOp && (
            <>
              <span className="hs-badge">Rev {currentOp.revision}</span>
              <span className="hs-dot">·</span>
              <span className="hs-time">{formatTs(currentOp.timestamp)}</span>
              <span className="hs-dot">·</span>
              <span className="hs-author" title={currentOp.userId}>
                {currentOp.userId ? currentOp.userId.slice(0, 8) + '…' : 'unknown'}
              </span>
            </>
          )}
          {!loading && !fetchError && max > 0 && !currentOp && (
            <span className="hs-base">Initial state</span>
          )}
        </div>

        <div className="hs-actions">
          {isOwner && currentOp && (
            <button className="hs-restore-btn" onClick={handleRestore}>
              Restore to this version
            </button>
          )}
          <button className="hs-close-btn" onClick={onClose} aria-label="Close history">
            ×
          </button>
        </div>
      </div>

      {/* ── Timeline slider ────────────────────────────────────────────────── */}
      {max > 0 && (
        <div className="hs-slider-row">
          <span className="hs-tick">0</span>
          <input
            type="range"
            className="hs-slider"
            min={0}
            max={max}
            value={sliderIdx}
            onChange={(e) => setSliderIdx(parseInt(e.target.value, 10))}
            aria-label={`Revision ${sliderIdx} of ${max}`}
          />
          <span className="hs-tick">{max}</span>
        </div>
      )}

      {/* ── Read-only preview ──────────────────────────────────────────────── */}
      <div className="hs-preview" ref={previewContainerRef} />
    </div>
  );
}
