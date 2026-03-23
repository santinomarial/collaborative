import {
  StateEffect,
  StateField,
  RangeSetBuilder,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  WidgetType,
} from '@codemirror/view';

// ── Color derivation ──────────────────────────────────────────────────────────

/** Convert HSL values to a 6-digit hex color string. */
function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n) => {
    const k = (n + h / 30) % 12;
    const value = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * value).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/**
 * Map a userId string to a deterministic, readable hex color.
 * Fixed saturation 70%, lightness 55% — always visible on dark backgrounds.
 */
export function userColor(userId) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (Math.imul(31, hash) + userId.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return hslToHex(hue, 70, 55);
}

// ── Cursor widget (WidgetDecoration) ──────────────────────────────────────────

class CursorWidget extends WidgetType {
  /** @param {string} color  @param {string} label */
  constructor(color, label) {
    super();
    this.color = color;
    this.label = label;
  }

  eq(other) {
    return other instanceof CursorWidget
      && other.color === this.color
      && other.label === this.label;
  }

  toDOM() {
    // Outer span: zero-width, the 2-px left border is the visible caret line.
    const wrap = document.createElement('span');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.style.cssText = [
      'position: relative',
      'display: inline-block',
      'width: 0',
      'height: 1.2em',
      `border-left: 2px solid ${this.color}`,
      'vertical-align: text-bottom',
      'pointer-events: none',
      'user-select: none',
      'z-index: 1',
    ].join(';');

    // Label floats above the caret.
    const label = document.createElement('span');
    label.textContent = this.label;
    label.style.cssText = [
      'position: absolute',
      'bottom: 100%',
      'left: -1px',
      `background: ${this.color}`,
      'color: #fff',
      'font-size: 10px',
      'font-family: system-ui, sans-serif',
      'font-weight: 500',
      'line-height: 1.4',
      'padding: 1px 4px',
      'border-radius: 2px 2px 2px 0',
      'white-space: nowrap',
      'pointer-events: none',
      'user-select: none',
      'z-index: 10',
    ].join(';');

    wrap.appendChild(label);
    return wrap;
  }

  ignoreEvent() { return true; }
}

// ── StateEffect & StateField ──────────────────────────────────────────────────

/**
 * Dispatch this effect to replace all remote cursor decorations.
 * Payload: array of cursor objects (see buildDecorations).
 */
export const setCursorsEffect = StateEffect.define();

/**
 * Build a DecorationSet from an array of remote cursor objects.
 *
 * Each cursor: { userId, displayName?, avatarColor?, position, anchor?, head? }
 *   - position / head : where the blinking caret sits
 *   - anchor          : selection anchor (if a range is selected)
 */
function buildDecorations(cursors, docLength) {
  const clamp  = (n) => Math.max(0, Math.min(n ?? 0, docLength));
  const ranges = [];

  for (const cursor of cursors) {
    if (!cursor?.userId) continue;

    const color = cursor.avatarColor ?? userColor(cursor.userId);
    const label = cursor.displayName ?? cursor.userId;
    const head  = clamp(cursor.head ?? cursor.position ?? 0);
    const anchor = clamp(cursor.anchor ?? head);

    // Selection highlight (only when range is non-empty)
    const selFrom = Math.min(head, anchor);
    const selTo   = Math.max(head, anchor);
    if (selFrom < selTo) {
      ranges.push({
        from: selFrom,
        to:   selTo,
        deco: Decoration.mark({
          // Append "33" for ~20% opacity on the avatarColor hex
          attributes: { style: `background-color: ${color}33` },
        }),
      });
    }

    // Cursor caret widget
    ranges.push({
      from: head,
      to:   head,
      deco: Decoration.widget({
        widget: new CursorWidget(color, label),
        // side:1  → render after any content at `head`; handles end-of-doc
        side: 1,
      }),
    });
  }

  // RangeSetBuilder requires non-decreasing order: sort by from, then to.
  // Widgets (to === from) come before marks (to > from) when start is equal.
  ranges.sort((a, b) => (a.from !== b.from ? a.from - b.from : a.to - b.to));

  const builder = new RangeSetBuilder();
  for (const { from, to, deco } of ranges) {
    builder.add(from, to, deco);
  }
  return builder.finish();
}

const cursorField = StateField.define({
  create: () => Decoration.none,

  update(deco, tr) {
    // Keep decorations in sync with document mutations (inserts / deletes shift
    // positions automatically; out-of-range positions are clamped).
    deco = deco.map(tr.changes);

    // Replace the full set whenever we get a new cursors effect.
    for (const effect of tr.effects) {
      if (effect.is(setCursorsEffect)) {
        deco = buildDecorations(effect.value, tr.state.doc.length);
      }
    }
    return deco;
  },

  provide: (f) => EditorView.decorations.from(f),
});

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * The extension to include in EditorState.create({ extensions: [...] }).
 * Provides the cursor StateField; no configuration required.
 */
export const cursorLayerExtension = cursorField;

/**
 * Push a fresh set of remote cursors into the editor.
 *
 * @param {import('@codemirror/view').EditorView} view
 * @param {Array<{
 *   userId:        string,
 *   displayName?:  string,
 *   avatarColor?:  string,
 *   position?:     number,
 *   head?:         number,
 *   anchor?:       number,
 * }>} cursors
 */
export function updateCursors(view, cursors) {
  view.dispatch({ effects: setCursorsEffect.of(cursors) });
}
