// Client-side mirror of server/src/ot/engine.js — pure functions, no deps.

export function transform(op1, op2) {
  if (op1.type === 'insert' && op2.type === 'insert') return _ii(op1, op2);
  if (op1.type === 'insert' && op2.type === 'delete') return _id(op1, op2);
  if (op1.type === 'delete' && op2.type === 'insert') return _di(op1, op2);
  if (op1.type === 'delete' && op2.type === 'delete') return _dd(op1, op2);
  throw new TypeError(`Cannot transform "${op1.type}" against "${op2.type}"`);
}

function _ii(op1, op2) {
  if (op2.position <= op1.position) return { ...op1, position: op1.position + op2.text.length };
  return { ...op1 };
}

function _id(op1, op2) {
  const { position: p1 } = op1;
  const { position: p2, length: l2 } = op2;
  if (p1 <= p2)       return { ...op1 };
  if (p1 <= p2 + l2)  return { ...op1, position: p2 };
  return                     { ...op1, position: p1 - l2 };
}

function _di(op1, op2) {
  const { position: p1, length: l1 } = op1;
  const { position: p2, text } = op2;
  const ins = text.length;
  if (p2 <= p1)        return { ...op1, position: p1 + ins };
  if (p2 < p1 + l1)   return { ...op1, length: l1 + ins };
  return                      { ...op1 };
}

function _dd(op1, op2) {
  const { position: p1, length: l1 } = op1;
  const { position: p2, length: l2 } = op2;
  const overlap = Math.max(0, Math.min(p1 + l1, p2 + l2) - Math.max(p1, p2));
  let newPos;
  if      (p1 < p2)       newPos = p1;
  else if (p1 < p2 + l2)  newPos = p2;
  else                     newPos = p1 - l2;
  return { ...op1, position: newPos, length: l1 - overlap };
}
