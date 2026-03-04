'use strict';

/**
 * OT Engine — Operational Transformation for collaborative text editing.
 *
 * Op: { type: "insert" | "delete", position: number, text?: string, length?: number }
 *
 * Exports:
 *   apply(document, op)      → new document string
 *   transform(op1, op2)      → op1ʹ adjusted to apply after op2 has already been applied
 *   compose(op1, op2)        → single op equivalent to applying op1 then op2 in sequence
 */

// ─── apply ────────────────────────────────────────────────────────────────────

/**
 * Apply a single operation to a document string.
 *
 * insert: splice op.text in at op.position
 * delete: remove op.length characters starting at op.position
 */
function apply(document, op) {
  if (typeof document !== 'string') {
    throw new TypeError('document must be a string');
  }

  if (op.type === 'insert') {
    const { position: pos, text } = op;
    if (pos < 0 || pos > document.length) {
      throw new RangeError(
        `Insert position ${pos} out of bounds [0, ${document.length}]`
      );
    }
    return document.slice(0, pos) + text + document.slice(pos);
  }

  if (op.type === 'delete') {
    const { position: pos, length: len } = op;
    if (pos < 0 || pos > document.length) {
      throw new RangeError(
        `Delete position ${pos} out of bounds [0, ${document.length}]`
      );
    }
    if (pos + len > document.length) {
      throw new RangeError(
        `Delete [${pos}, ${pos + len}) exceeds document length ${document.length}`
      );
    }
    return document.slice(0, pos) + document.slice(pos + len);
  }

  throw new TypeError(`Unknown op type: "${op.type}"`);
}

// ─── transform ────────────────────────────────────────────────────────────────

/**
 * Transform op1 against op2.
 *
 * Returns op1ʹ such that applying op1ʹ after op2 produces the same
 * intended effect as applying op1 to the original document.
 *
 * Convergence (diamond property):
 *   apply(apply(doc, op2), transform(op1, op2))
 *     === apply(apply(doc, op1), transform(op2, op1))
 *
 * Handles all four conflict cases:
 *   insert / insert
 *   insert / delete
 *   delete / insert
 *   delete / delete
 */
function transform(op1, op2) {
  if (op1.type === 'insert' && op2.type === 'insert') return _ii(op1, op2);
  if (op1.type === 'insert' && op2.type === 'delete') return _id(op1, op2);
  if (op1.type === 'delete' && op2.type === 'insert') return _di(op1, op2);
  if (op1.type === 'delete' && op2.type === 'delete') return _dd(op1, op2);
  throw new TypeError(`Cannot transform "${op1.type}" against "${op2.type}"`);
}

/**
 * insert vs insert
 *
 * Rule: if op2 inserts at or before op1's position, op1 must shift right.
 * Tie-breaking (equal positions): op2 wins — op1 shifts right.
 * This is the standard "left-bias for the concurrent op" convention.
 */
function _ii(op1, op2) {
  if (op2.position <= op1.position) {
    return { ...op1, position: op1.position + op2.text.length };
  }
  return { ...op1 };
}

/**
 * insert vs delete
 *
 * op2 removed characters; adjust op1's position accordingly.
 *
 * Three regions:
 *   [0, p2)         → before deletion, op1 unchanged
 *   [p2, p2+l2)     → inside deleted range, clamp op1 to p2
 *   [p2+l2, ∞)      → after deletion, op1 shifts left by l2
 */
function _id(op1, op2) {
  const { position: p1 } = op1;
  const { position: p2, length: l2 } = op2;

  if (p1 <= p2)        return { ...op1 };                        // before deletion
  if (p1 <= p2 + l2)   return { ...op1, position: p2 };          // inside deleted range
  return               { ...op1, position: p1 - l2 };            // after deletion
}

/**
 * delete vs insert
 *
 * op2 inserted characters; adjust op1's position and possibly its length.
 *
 * Three regions (relative to op1's deletion range [p1, p1+l1)):
 *   p2 <= p1          → insert before op1 → shift op1 right
 *   p1 < p2 < p1+l1   → insert inside op1's range → expand length so the new
 *                        text is also captured by the delete
 *   p2 >= p1+l1       → insert after op1's range → unchanged
 */
function _di(op1, op2) {
  const { position: p1, length: l1 } = op1;
  const { position: p2, text } = op2;
  const ins = text.length;

  if (p2 <= p1)         return { ...op1, position: p1 + ins };   // before → shift right
  if (p2 < p1 + l1)    return { ...op1, length:   l1 + ins };   // inside → expand
  return                { ...op1 };                               // after  → unchanged
}

/**
 * delete vs delete
 *
 * Some of op1's target characters may have already been removed by op2.
 * Calculate the overlap and adjust both position and length.
 *
 * Position adjustment:
 *   p1 < p2           → op1 starts before op2, position unchanged
 *   p1 in [p2, p2+l2) → op1 starts inside op2's range, clamp to p2
 *   p1 >= p2+l2       → op1 starts after op2, shift left by l2
 *
 * Length adjustment:
 *   new length = l1 − |intersection([p1,p1+l1), [p2,p2+l2))|
 */
function _dd(op1, op2) {
  const { position: p1, length: l1 } = op1;
  const { position: p2, length: l2 } = op2;

  // Characters already deleted by op2 that overlap op1's intended range
  const overlap = Math.max(0, Math.min(p1 + l1, p2 + l2) - Math.max(p1, p2));

  let newPos;
  if      (p1 < p2)        newPos = p1;       // before op2 → unchanged
  else if (p1 < p2 + l2)  newPos = p2;       // inside op2 → clamp
  else                     newPos = p1 - l2;  // after  op2 → shift left

  return { ...op1, position: newPos, length: l1 - overlap };
}

// ─── compose ──────────────────────────────────────────────────────────────────

/**
 * Compose op1 followed by op2 into a single equivalent operation.
 *
 * op2's positions are relative to the document AFTER op1 is applied.
 *
 * Not all pairs can be expressed as a single op with the current op shape;
 * throws when composition would require a richer representation (e.g.
 * non-adjacent ops or a delete+insert "replace").
 *
 * Composable cases:
 *   insert + insert  — when op2 falls within / adjacent to op1's text
 *   insert + delete  — when delete is contained within inserted text,
 *                      or covers the entire inserted text (+ more chars)
 *   delete + delete  — when the two deletions are contiguous
 *   delete + insert  — always throws (requires "replace" op shape)
 */
function compose(op1, op2) {
  if (op1.type === 'insert' && op2.type === 'insert') return _cii(op1, op2);
  if (op1.type === 'insert' && op2.type === 'delete') return _cid(op1, op2);
  if (op1.type === 'delete' && op2.type === 'insert') return _cdi(op1, op2);
  if (op1.type === 'delete' && op2.type === 'delete') return _cdd(op1, op2);
  throw new TypeError(`Cannot compose "${op1.type}" with "${op2.type}"`);
}

/**
 * compose insert + insert
 *
 * op2's position is in the post-op1 document.
 *
 * Composable when:
 *   - op2 inserts within or adjacent to op1's text → splice texts together
 *   - op2 inserts immediately before op1 (adjacent from the left)
 */
function _cii(op1, op2) {
  const { position: p1, text: t1 } = op1;
  const { position: p2, text: t2 } = op2;

  // op2 falls within or at either edge of op1's inserted region
  if (p2 >= p1 && p2 <= p1 + t1.length) {
    const offset = p2 - p1;
    return {
      type: 'insert',
      position: p1,
      text: t1.slice(0, offset) + t2 + t1.slice(offset),
    };
  }

  // op2 is to the left but the two texts are adjacent after accounting for op1
  // (op2 ends exactly where op1 starts → net: t2 + t1 starting at p2)
  if (p2 < p1 && p2 + t2.length === p1) {
    return { type: 'insert', position: p2, text: t2 + t1 };
  }

  throw new Error(
    `compose insert(${p1}) + insert(${p2}): ops are non-adjacent; ` +
    `cannot reduce to a single insert`
  );
}

/**
 * compose insert + delete
 *
 * op2's position is in the post-op1 document.
 *
 * Case 1: delete entirely within inserted text
 *   → trim the inserted text; result is a (possibly empty) insert
 *
 * Case 2: delete entirely covers the inserted text and may extend further
 *   → inserted text is cancelled; result is a delete of the extra original chars
 *
 * All other configurations require two ops and will throw.
 */
function _cid(op1, op2) {
  const { position: p1, text: t1 } = op1;
  const insLen = t1.length;
  const insEnd = p1 + insLen;
  const { position: p2, length: l2 } = op2;
  const delEnd = p2 + l2;

  // Case 1: delete is entirely within the inserted text
  if (p2 >= p1 && delEnd <= insEnd) {
    const newText = t1.slice(0, p2 - p1) + t1.slice(delEnd - p1);
    return { type: 'insert', position: p1, text: newText };
  }

  // Case 2: delete covers (and possibly extends past) the entire inserted text
  // p2 may equal p1 (delete starts at insert position) or precede it
  if (p2 <= p1 && delEnd >= insEnd) {
    const netLength = l2 - insLen;
    // If the delete only targeted the inserted text itself (netLength === 0),
    // the net result is a no-op; represent as an empty insert.
    if (netLength === 0) {
      return { type: 'insert', position: p2, text: '' };
    }
    return { type: 'delete', position: p2, length: netLength };
  }

  throw new Error(
    `compose insert(${p1}, len=${insLen}) + delete(${p2}, ${l2}): ` +
    `partial or non-overlapping combination cannot be expressed as a single op`
  );
}

/**
 * compose delete + insert
 *
 * A delete followed by an insert at arbitrary positions is a "replace"
 * which our op shape cannot express as a single operation.
 */
function _cdi(op1, op2) {
  throw new Error(
    `compose delete(${op1.position}) + insert(${op2.position}): ` +
    `delete+insert requires a "replace" op shape; cannot reduce to single op`
  );
}

/**
 * compose delete + delete
 *
 * op2's position is in the post-op1 document.
 * After op1 removes [p1, p1+l1), a position q in the post-op1 doc
 * maps to original position:
 *   q < p1  → q
 *   q >= p1 → q + l1
 *
 * Composable when the two deletions are contiguous in the original document:
 *
 *   p2 === p1  → op2 continues from the same point op1 left off
 *                (original: [p1, p1+l1) then [p1+l1, p1+l1+l2))
 *                → delete(p1, l1+l2)
 *
 *   p2 < p1 and p2+l2 === p1
 *              → op2 deletes a run ending exactly where op1 began
 *                (original: [p2, p1) then [p1, p1+l1))
 *                → delete(p2, l1+l2)
 */
function _cdd(op1, op2) {
  const { position: p1, length: l1 } = op1;
  const { position: p2, length: l2 } = op2;

  if (p2 === p1) {
    // Continuing the same deletion from op1's position (e.g. holding Delete)
    return { type: 'delete', position: p1, length: l1 + l2 };
  }

  if (p2 < p1 && p2 + l2 === p1) {
    // op2 deletes up to but not including op1's range (e.g. holding Backspace)
    return { type: 'delete', position: p2, length: l1 + l2 };
  }

  throw new Error(
    `compose delete(${p1}, ${l1}) + delete(${p2}, ${l2}): ` +
    `non-adjacent deletions cannot be reduced to a single op`
  );
}

module.exports = { apply, transform, compose };
