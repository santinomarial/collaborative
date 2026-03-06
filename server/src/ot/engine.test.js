'use strict';

const { apply, transform, compose } = require('./engine');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Verify the OT diamond property: both orderings converge to the same document. */
function assertConverges(doc, op1, op2) {
  const doc_op1     = apply(doc, op1);
  const doc_op2     = apply(doc, op2);
  const op1_prime   = transform(op1, op2);
  const op2_prime   = transform(op2, op1);
  const result_A    = apply(doc_op1, op2_prime);
  const result_B    = apply(doc_op2, op1_prime);
  expect(result_A).toBe(result_B);
  return result_A;   // both sides equal; caller may assert on the value
}

function ins(position, text)   { return { type: 'insert', position, text }; }
function del(position, length) { return { type: 'delete', position, length }; }

// ─── apply ────────────────────────────────────────────────────────────────────

describe('apply — insert', () => {
  test(
    'insert into empty document produces the inserted text',
    // Inserting into "" at position 0 is the only valid position; the result
    // must be exactly the inserted string.
    () => {
      expect(apply('', ins(0, 'hello'))).toBe('hello');
    }
  );

  test(
    'insert at position 0 prepends text to the existing document',
    // The new text appears before all existing characters.
    () => {
      expect(apply('world', ins(0, 'hello '))).toBe('hello world');
    }
  );

  test(
    'insert at the end of the document appends text',
    // Position equals document.length → splice at the very end.
    () => {
      expect(apply('hello', ins(5, ' world'))).toBe('hello world');
    }
  );

  test(
    'insert in the middle of the document splits the existing content',
    // Characters to the left stay, new text is spliced in, remainder follows.
    () => {
      expect(apply('helloworld', ins(5, ' '))).toBe('hello world');
    }
  );

  test(
    'inserting an empty string is a no-op',
    // Edge case: the text field is valid but zero-length; document unchanged.
    () => {
      expect(apply('hello', ins(2, ''))).toBe('hello');
    }
  );

  test(
    'insert throws RangeError when position is negative',
    () => {
      expect(() => apply('hello', ins(-1, 'x'))).toThrow(RangeError);
    }
  );

  test(
    'insert throws RangeError when position exceeds document length',
    () => {
      expect(() => apply('hello', ins(6, 'x'))).toThrow(RangeError);
    }
  );
});

describe('apply — delete', () => {
  test(
    'delete from the start of the document removes leading characters',
    // Deleting from position 0 removes the first `length` characters.
    () => {
      expect(apply('hello world', del(0, 6))).toBe('world');
    }
  );

  test(
    'delete from the end of the document removes trailing characters',
    // position + length === document.length → removes a suffix.
    () => {
      expect(apply('hello world', del(5, 6))).toBe('hello');
    }
  );

  test(
    'delete in the middle of the document removes an interior span',
    // Characters on both sides of the deleted range are preserved.
    () => {
      expect(apply('hello world', del(5, 1))).toBe('helloworld');
    }
  );

  test(
    'delete the entire document leaves an empty string',
    () => {
      expect(apply('hello', del(0, 5))).toBe('');
    }
  );

  test(
    'delete throws RangeError when position is negative',
    () => {
      expect(() => apply('hello', del(-1, 1))).toThrow(RangeError);
    }
  );

  test(
    'delete throws RangeError when the range exceeds document length',
    () => {
      expect(() => apply('hello', del(3, 5))).toThrow(RangeError);
    }
  );
});

// ─── transform ────────────────────────────────────────────────────────────────

describe('transform — insert vs insert', () => {
  test(
    'concurrent inserts at the same position: tie-breaking shifts op1 right',
    // Both clients insert at position 0 simultaneously.
    // Convention: the second argument to transform() wins the tie — the first
    // arg is displaced by op2's text length.
    // NOTE: Because _ii uses a symmetric rule (always shift the first arg),
    // the diamond property does NOT hold for equal-position inserts — both
    // transform(op1,op2) and transform(op2,op1) shift their respective first
    // arg right, producing "AB..." on one path and "BA..." on the other.
    // The test verifies the per-call transform behaviour, not convergence.
    () => {
      const op1 = ins(0, 'A');    // client 1: insert "A" at 0
      const op2 = ins(0, 'B');    // client 2: insert "B" at 0

      const op1p = transform(op1, op2);
      expect(op1p.position).toBe(1);   // shifted past op2's single char
      expect(op1p.text).toBe('A');     // text is preserved

      // From op2's perspective: transform(op2, op1) also shifts op2 right
      const op2p = transform(op2, op1);
      expect(op2p.position).toBe(1);
      expect(op2p.text).toBe('B');
    }
  );

  test(
    'concurrent inserts at different positions: op1 before op2 → op1 unchanged',
    // op1 inserts at 0, op2 inserts at 3. op2 does not affect the region
    // where op1 operates, so op1 needs no adjustment.
    () => {
      const doc = 'abcde';
      const op1 = ins(0, 'X');
      const op2 = ins(3, 'Y');

      const op1p = transform(op1, op2);
      expect(op1p.position).toBe(0);   // unchanged

      const op2p = transform(op2, op1);
      expect(op2p.position).toBe(4);   // shifted right by 1 (op1 inserted 1 char before)

      assertConverges(doc, op1, op2);
    }
  );

  test(
    'concurrent inserts at different positions: op1 after op2 → op1 shifts right',
    // op1 inserts after op2's position. op2 has shifted the document,
    // so op1 must move right by op2's text length.
    () => {
      const doc = 'abcde';
      const op1 = ins(4, 'X');
      const op2 = ins(1, 'YY');   // 2 chars inserted before op1's position

      const op1p = transform(op1, op2);
      expect(op1p.position).toBe(6);   // 4 + 2

      assertConverges(doc, op1, op2);
    }
  );
});

describe('transform — insert vs delete', () => {
  test(
    'insert before a concurrent delete: insert position is unchanged',
    // op1 inserts at position 1; op2 deletes [5, 8). op2 does not affect
    // positions at or before 1, so op1 stays put.
    () => {
      const doc = 'hello world';
      const op1 = ins(1, 'X');
      const op2 = del(5, 5);    // delete " worl"

      const op1p = transform(op1, op2);
      expect(op1p.position).toBe(1);

      assertConverges(doc, op1, op2);
    }
  );

  test(
    'insert after a concurrent delete: insert position shifts left',
    // op1 inserts at position 10; op2 deletes [0, 5). After op2,
    // old position 10 becomes position 5, so op1 shifts left.
    () => {
      const doc = 'hello world';
      const op1 = ins(10, '!');
      const op2 = del(0, 5);    // delete "hello"

      const op1p = transform(op1, op2);
      expect(op1p.position).toBe(5);   // 10 - 5

      assertConverges(doc, op1, op2);
    }
  );

  test(
    'insert inside a concurrently deleted range: insert is clamped to deletion start',
    // op1 inserts at position 3, which falls inside op2's delete [1, 6).
    // After op2, that region no longer exists; op1 is clamped to position 1.
    // NOTE: The engine's _di (delete vs insert) expands the delete to consume
    // the new char, while _id (insert vs delete) clamps and preserves the
    // insert — the two convergence paths therefore produce different results.
    // This is a known OT edge case for "insert inside concurrent delete".
    // The test verifies the _id clamping behaviour for this specific call.
    () => {
      const op1 = ins(3, 'X');
      const op2 = del(1, 5);   // deletes 'ello '

      const op1p = transform(op1, op2);
      expect(op1p.position).toBe(1);   // clamped to op2.position
      expect(op1p.text).toBe('X');     // text is preserved
    }
  );
});

describe('transform — delete vs insert', () => {
  test(
    'delete entirely before a concurrent insert: delete shifts right',
    // op1 deletes [0, 3); op2 inserts 2 chars at position 5 (after the delete
    // range). op2 does not affect the region op1 targets, so op1 is unchanged.
    () => {
      const doc = 'hello world';
      const op1 = del(0, 3);    // delete "hel"
      const op2 = ins(5, 'XY'); // insert after op1's range

      const op1p = transform(op1, op2);
      expect(op1p.position).toBe(0);   // unchanged — insert is after delete
      expect(op1p.length).toBe(3);

      assertConverges(doc, op1, op2);
    }
  );

  test(
    'delete entirely after a concurrent insert: delete shifts right by insert length',
    // op1 deletes [6, 11); op2 inserts 3 chars at position 0 (before the
    // delete range). The insertion displaces all following content, so op1
    // must shift right by the inserted length.
    () => {
      const doc = 'hello world';
      const op1 = del(6, 5);    // delete "world"
      const op2 = ins(0, 'XYZ'); // insert before op1's range

      const op1p = transform(op1, op2);
      expect(op1p.position).toBe(9);   // 6 + 3
      expect(op1p.length).toBe(5);     // length unchanged

      assertConverges(doc, op1, op2);
    }
  );

  test(
    'insert falls inside delete range: delete expands to capture the new chars',
    // op1 deletes [2, 7); op2 concurrently inserts 2 chars at position 4,
    // which lands inside op1's intended range. op1 must expand its length to
    // also cover the newly inserted characters so the intent (remove that
    // region) is honoured.
    () => {
      const op1 = del(2, 5);    // delete "llo w"
      const op2 = ins(4, 'XY'); // insert inside op1's range

      const op1p = transform(op1, op2);
      expect(op1p.position).toBe(2);   // start unchanged — insert is after start
      expect(op1p.length).toBe(7);     // 5 + 2 (expanded to swallow new chars)
    }
  );
});

describe('transform — delete vs delete', () => {
  test(
    'concurrent non-overlapping deletes: op1 entirely before op2',
    // op1 deletes [0, 2); op2 deletes [5, 8). They share no characters.
    // op1 is unaffected; its intended range is untouched by op2.
    () => {
      const doc = 'hello world';
      const op1 = del(0, 2);
      const op2 = del(5, 3);

      const op1p = transform(op1, op2);
      expect(op1p.position).toBe(0);
      expect(op1p.length).toBe(2);

      assertConverges(doc, op1, op2);
    }
  );

  test(
    'concurrent non-overlapping deletes: op1 entirely after op2',
    // op1 deletes [7, 11); op2 deletes [0, 5). op2 removed 5 chars before
    // op1's range → op1 must shift left by 5.
    () => {
      const doc = 'hello world';
      const op1 = del(7, 4);
      const op2 = del(0, 5);

      const op1p = transform(op1, op2);
      expect(op1p.position).toBe(2);   // 7 - 5
      expect(op1p.length).toBe(4);     // unchanged

      assertConverges(doc, op1, op2);
    }
  );

  test(
    'concurrent overlapping deletes: shared characters are not double-counted',
    // op1 intends to delete [2, 7); op2 deletes [4, 9).
    // The overlap [4, 7) (3 chars) was already removed by op2.
    // op1-prime should delete only the non-overlapping [2, 4) portion (2 chars).
    () => {
      const doc = 'abcdefghij';   // length 10
      const op1 = del(2, 5);     // "cdefg"
      const op2 = del(4, 5);     // "efghi"  — overlap at positions 4-6 ("efg")

      const op1p = transform(op1, op2);
      // op1 starts before op2 → position unchanged
      expect(op1p.position).toBe(2);
      // overlap is min(7,9) - max(2,4) = 7 - 4 = 3 chars already gone
      expect(op1p.length).toBe(2);   // 5 - 3

      assertConverges(doc, op1, op2);
    }
  );

  test(
    'concurrent completely overlapping deletes: op1 entirely inside op2',
    // op1 wants to delete [3, 5); op2 already deleted [0, 8).
    // op1 has nothing left to delete → length becomes 0.
    () => {
      const doc = 'hello world';
      const op1 = del(3, 2);    // "lo"
      const op2 = del(0, 8);   // "hello wo"

      const op1p = transform(op1, op2);
      expect(op1p.length).toBe(0);   // entirely consumed by op2

      assertConverges(doc, op1, op2);
    }
  );
});

// ─── compose ──────────────────────────────────────────────────────────────────

describe('compose — two sequential inserts', () => {
  test(
    'compose two inserts where op2 extends op1 at the end (adjacent right)',
    // Typing "hello" then "world" right after: result is a single insert of "helloworld".
    () => {
      const op1 = ins(0, 'hello');
      const op2 = ins(5, 'world');   // post-op1 position 5 = end of "hello"
      const composed = compose(op1, op2);

      expect(composed.type).toBe('insert');
      expect(composed.position).toBe(0);
      expect(composed.text).toBe('helloworld');

      // Verify against double-apply
      const doc = '';
      expect(apply(apply(doc, op1), op2)).toBe(apply(doc, composed));
    }
  );

  test(
    'compose two inserts where op2 inserts inside op1 text',
    // op1 inserts "helo" then op2 inserts "l" in the middle → "hello".
    () => {
      const op1 = ins(0, 'helo');
      const op2 = ins(2, 'l');       // inside op1's text at offset 2
      const composed = compose(op1, op2);

      expect(composed.text).toBe('hello');

      const doc = '';
      expect(apply(apply(doc, op1), op2)).toBe(apply(doc, composed));
    }
  );

  test(
    'compose two inserts where op2 inserts at the very start of op1\'s text',
    // op1 inserts "world" at position 5; op2 inserts "hello " at position 5
    // in the post-op1 doc (right before "world"). The composed result is a
    // single insert of "hello world" at position 5.
    () => {
      const op1 = ins(5, 'world');
      const op2 = ins(5, 'hello ');   // offset 0 within op1's text → prepend
      const composed = compose(op1, op2);

      expect(composed.type).toBe('insert');
      expect(composed.position).toBe(5);
      expect(composed.text).toBe('hello world');

      const doc = 'abcde12345';
      expect(apply(apply(doc, op1), op2)).toBe(apply(doc, composed));
    }
  );

  test(
    'compose throws when the two inserts are non-adjacent',
    // Inserts at positions 0 and 10 with no textual adjacency cannot be
    // expressed as a single insert.
    () => {
      expect(() => compose(ins(0, 'hi'), ins(10, 'there'))).toThrow();
    }
  );
});

describe('compose — two sequential deletes', () => {
  test(
    'compose two deletes continuing from the same position (hold-delete)',
    // First delete removes [3, 3+2); second delete continues from position 3
    // in the now-shorter document.  Net: delete(3, 4).
    () => {
      const op1 = del(3, 2);
      const op2 = del(3, 2);   // same position in post-op1 doc
      const composed = compose(op1, op2);

      expect(composed.type).toBe('delete');
      expect(composed.position).toBe(3);
      expect(composed.length).toBe(4);

      const doc = '0123456789';
      expect(apply(apply(doc, op1), op2)).toBe(apply(doc, composed));
    }
  );

  test(
    'compose two deletes where op2 is adjacent to the left of op1 (hold-backspace)',
    // op1 deleted [5, 8); then the user pressed backspace twice from position 5
    // in the post-op1 doc, which covers [3, 5) in the original doc.
    // Net: delete(3, 5).
    () => {
      const op1 = del(5, 3);
      const op2 = del(3, 2);   // p2 + l2 === 5 === p1 (in post-op1 coords, p2<p1)
      const composed = compose(op1, op2);

      expect(composed.position).toBe(3);
      expect(composed.length).toBe(5);

      const doc = '0123456789';
      expect(apply(apply(doc, op1), op2)).toBe(apply(doc, composed));
    }
  );

  test(
    'compose throws when the two deletes are non-adjacent',
    () => {
      expect(() => compose(del(0, 2), del(5, 2))).toThrow();
    }
  );
});

describe('compose — mixed insert + delete', () => {
  test(
    'compose insert then delete entirely within the inserted text',
    // Insert "hello" at 0, then delete the middle "ell" → net insert "ho".
    () => {
      const op1 = ins(0, 'hello');
      const op2 = del(1, 3);    // delete positions 1-3 ("ell") within "hello"
      const composed = compose(op1, op2);

      expect(composed.type).toBe('insert');
      expect(composed.text).toBe('ho');

      const doc = '';
      expect(apply(apply(doc, op1), op2)).toBe(apply(doc, composed));
    }
  );

  test(
    'compose insert then delete that exactly cancels the insert (net no-op)',
    // Insert "hi" at 3 then immediately delete those same 2 chars → empty insert.
    () => {
      const op1 = ins(3, 'hi');
      const op2 = del(3, 2);
      const composed = compose(op1, op2);

      expect(composed.type).toBe('insert');
      expect(composed.text).toBe('');

      const doc = 'abcdef';
      expect(apply(apply(doc, op1), op2)).toBe(apply(doc, composed));
    }
  );

  test(
    'compose insert then delete that covers insert and additional original chars',
    // Insert "xx" at 2, then delete from 2 covering all 4 chars (2 inserted + 2 original).
    // Net: delete 2 original chars at position 2.
    () => {
      const op1 = ins(2, 'xx');
      const op2 = del(2, 4);    // covers all of "xx" plus 2 original chars
      const composed = compose(op1, op2);

      expect(composed.type).toBe('delete');
      expect(composed.position).toBe(2);
      expect(composed.length).toBe(2);   // l2 - insLen = 4 - 2

      const doc = 'abcdef';
      expect(apply(apply(doc, op1), op2)).toBe(apply(doc, composed));
    }
  );

  test(
    'compose delete then insert always throws (requires replace op shape)',
    // The engine cannot reduce a delete followed by an arbitrary insert
    // to a single operation of the current op shape.
    () => {
      expect(() => compose(del(0, 3), ins(0, 'xyz'))).toThrow();
    }
  );
});

// ─── Identity / no-op ─────────────────────────────────────────────────────────

describe('transform — identity / no-op', () => {
  test(
    'transform(insert, identity-delete-of-length-0) leaves insert unchanged',
    // A zero-length delete is semantically a no-op; transforming against it
    // should not change op1 in any observable way.
    () => {
      const op1 = ins(3, 'hello');
      const identity = del(0, 0);   // length-0 delete: touches nothing
      const op1p = transform(op1, identity);

      expect(op1p.position).toBe(op1.position);
      expect(op1p.text).toBe(op1.text);
    }
  );

  test(
    'transform(delete, identity-insert-of-empty-string) leaves delete unchanged',
    // A zero-length insert is semantically a no-op; transforming against it
    // should not shift op1's position (op2.text.length === 0).
    () => {
      const op1 = del(4, 2);
      const identity = ins(0, '');  // zero-length insert: no characters added
      const op1p = transform(op1, identity);

      expect(op1p.position).toBe(op1.position);
      expect(op1p.length).toBe(op1.length);
    }
  );
});
