type Node = { key: string; left?: Node; right?: Node; height: number };
type History = { key: string; previous?: History; size: number };
const height = (n?: Node) => n?.height ?? 0;
const node = (key: string, left?: Node, right?: Node): Node => ({
  key,
  left,
  right,
  height: 1 + Math.max(height(left), height(right)),
});
function right(n: Node) {
  const c = n.left!;
  return node(c.key, c.left, node(n.key, c.right, n.right));
}
function left(n: Node) {
  const c = n.right!;
  return node(c.key, node(n.key, n.left, c.left), c.right);
}
function insert(n: Node | undefined, key: string): Node {
  if (!n) return node(key);
  let v =
    key < n.key
      ? node(n.key, insert(n.left, key), n.right)
      : node(n.key, n.left, insert(n.right, key));
  const b = height(v.left) - height(v.right);
  if (b > 1) {
    if (key > v.left!.key) v = node(v.key, left(v.left!), v.right);
    return right(v);
  }
  if (b < -1) {
    if (key < v.right!.key) v = node(v.key, v.left, right(v.right!));
    return left(v);
  }
  return v;
}
/** Persistent AVL membership + insertion history: O(1) copy, O(log N) add/has.
 * Solver-local only: never send this custom class through structuredClone/IPC. */
export class BranchSet implements Set<string> {
  private tree?: Node;
  private history?: History;
  readonly [Symbol.toStringTag] = 'Set';
  constructor(values: Iterable<string> = []) {
    if (values instanceof BranchSet) {
      this.tree = values.tree;
      this.history = values.history;
    } else for (const key of values) this.add(key);
  }
  get size() {
    return this.history?.size ?? 0;
  }
  has(key: string) {
    let n = this.tree;
    while (n) {
      if (key === n.key) return true;
      n = key < n.key ? n.left : n.right;
    }
    return false;
  }
  add(key: string) {
    if (!this.has(key)) {
      this.tree = insert(this.tree, key);
      this.history = { key, previous: this.history, size: this.size + 1 };
    }
    return this;
  }
  clear() {
    this.tree = undefined;
    this.history = undefined;
  }
  delete(key: string) {
    if (!this.has(key)) return false;
    const keep = [...this].filter((v) => v !== key);
    this.clear();
    for (const v of keep) this.add(v);
    return true;
  }
  since(prefix: BranchSet) {
    let at = this.history;
    const values: string[] = [];
    while (at && at !== prefix.history && at.size > prefix.size) {
      values.push(at.key);
      at = at.previous;
    }
    return at === prefix.history ? values.reverse() : undefined;
  }
  private list() {
    const v: string[] = [];
    for (let n = this.history; n; n = n.previous) v.push(n.key);
    return v.reverse();
  }
  values(): SetIterator<string> {
    return new Set(this.list()).values();
  }
  keys(): SetIterator<string> {
    return this.values();
  }
  entries(): SetIterator<[string, string]> {
    return new Set(this.list()).entries();
  }
  [Symbol.iterator](): SetIterator<string> {
    return this.values();
  }
  forEach(callback: (value: string, key: string, set: Set<string>) => void, thisArg?: unknown) {
    for (const key of this) callback.call(thisArg, key, key, this);
  }
}
