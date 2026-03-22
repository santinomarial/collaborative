import { Annotation, Transaction } from '@codemirror/state';
import { ViewPlugin }               from '@codemirror/view';
import { transform }                from './otEngine';

// ── Annotation to mark transactions that came from the network ────────────────
// Used in two places:
//   1. updateListener — skip sending these back to the server
//   2. history — Transaction.addToHistory.of(false) keeps them out of undo stack
export const isRemote = Annotation.define(Boolean);

// ── CM ChangeSet → op array ───────────────────────────────────────────────────
//
// CM6 iterChanges gives changes relative to the ORIGINAL document.
// We convert to sequential ops where each position is relative to the doc
// AFTER all previous ops in the same batch have been applied.
//
// offset: cumulative shift caused by deletes (negative) and inserts (positive)

function changesToOps(changes) {
  const ops = [];
  let offset = 0;

  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const pos = fromA + offset;

    if (toA > fromA) {
      const len = toA - fromA;
      ops.push({ type: 'delete', position: pos, length: len });
      offset -= len;
    }

    if (inserted.length > 0) {
      const text = inserted.toString();
      ops.push({ type: 'insert', position: pos, text });
      offset += text.length;
    }
  });

  return ops;
}

// ── op → CM change spec ───────────────────────────────────────────────────────
function opToChangeSpec(op) {
  if (op.type === 'insert') return { from: op.position, insert: op.text };
  if (op.type === 'delete') return { from: op.position, to: op.position + op.length };
  return null;
}

// ── Transform an ops array against another ops array ─────────────────────────
function transformBatch(clientOps, serverOps) {
  let result = [...clientOps];
  for (const sOp of serverOps) {
    result = result.map((cOp) => transform(cOp, sOp));
  }
  return result;
}

// ── ViewPlugin ────────────────────────────────────────────────────────────────

/**
 * Creates a CodeMirror extension that wires the editor to a WSClient.
 *
 * Local edits:
 *   CM change → ops → wsClient.sendOp(clientRevision, ops)
 *
 * Remote ops:
 *   1. Transform incoming ops against all pending (unacked) local ops so they
 *      land correctly on top of our optimistic local state.
 *   2. Re-base each pending op against the incoming remote op (diamond property).
 *   3. Dispatch to CM with isRemote + addToHistory=false so ctrl+z ignores them.
 *
 * @param {import('../ws/WSClient').WSClient} wsClient
 * @param {number} [initialRevision=0]
 */
export function createCollabExtension(wsClient, initialRevision = 0) {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.view           = view;
        this.clientRevision = initialRevision;

        // Each entry: { revision: number, ops: op[] }
        // Represents ops we've sent but not yet received an ack for.
        this._pending = [];

        this._unsubAck = wsClient.on('ack', (p) => this._onAck(p));
        this._unsubOp  = wsClient.on('op',  (p) => this._onRemoteOp(p));
      }

      // ── CM update ──────────────────────────────────────────────────────
      update(update) {
        if (!update.docChanged) return;

        // Ignore transactions we dispatched ourselves (remote ops)
        if (update.transactions.some((tr) => tr.annotation(isRemote))) return;

        const ops = changesToOps(update.changes);
        if (ops.length === 0) return;

        const revision = this.clientRevision;
        this._pending.push({ revision, ops });
        wsClient.sendOp(revision, ops);
      }

      // ── Ack received ───────────────────────────────────────────────────
      _onAck({ revision }) {
        this._pending.shift();          // FIFO — acks are ordered
        this.clientRevision = revision;
      }

      // ── Remote op received ─────────────────────────────────────────────
      _onRemoteOp({ revision, ops: remoteOps }) {
        // --- 1. Compute editor ops: transform remote through all pending ----
        // The remote op was committed by the server at `revision` against the
        // base state (before any of our pending ops). We need to "fast-forward"
        // it through everything we've applied locally so far.
        let opsForEditor = [...remoteOps];
        let remoteForRebase = [...remoteOps];

        const newPending = this._pending.map(({ revision: r, ops: pendingOps }) => {
          // Adjust remote op to land after this pending batch
          opsForEditor = transformBatch(opsForEditor, pendingOps);

          // Rebase pending batch against the remote (using the version of
          // remote that has been transformed against all previous pending batches)
          const rebased = transformBatch(pendingOps, remoteForRebase);

          // Advance remoteForRebase past this pending batch for the next iteration
          remoteForRebase = transformBatch(remoteForRebase, pendingOps);

          return { revision: r, ops: rebased };
        });

        this._pending = newPending;
        this.clientRevision = revision;

        // --- 2. Apply to editor -------------------------------------------
        for (const op of opsForEditor) {
          const spec = opToChangeSpec(op);
          if (!spec) continue;
          try {
            this.view.dispatch({
              changes: spec,
              annotations: [
                isRemote.of(true),
                Transaction.addToHistory.of(false),
              ],
            });
          } catch (e) {
            console.error('[CollabExtension] failed to apply remote op', op, e);
          }
        }
      }

      destroy() {
        this._unsubAck();
        this._unsubOp();
      }
    }
  );
}
