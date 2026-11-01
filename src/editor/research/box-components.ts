import type { Interval } from '../interval';
type Bounds = Readonly<Record<string, Interval>>;
type Node = {
  id: number;
  lo: number;
  hi: number;
  max: number;
  height: number;
  left?: Node;
  right?: Node;
};
export class BoxComponentLimit extends Error {}

/** Incremental exact connectivity of certified CLOSED boxes. An augmented AVL
 * interval tree finds sweep-axis overlaps in O(log n + candidates); DSU merges
 * actual k-dimensional intersections. No sampled bridge flights. Worst-case
 * candidates remain quadratic in arbitrary high-dimensional geometry. */
export class BoxComponents {
  private root?: Node;
  private boxes: Bounds[] = [];
  private parent: number[] = [];
  private sizes: number[] = [];
  private verified: boolean[] = [];
  private names?: string[];
  private count = 0;
  constructor(private capacity = 32768) {}
  get components() {
    return this.count;
  }
  private find(id: number): number {
    let root = id;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[id] !== id) {
      const next = this.parent[id];
      this.parent[id] = root;
      id = next;
    }
    return root;
  }
  private join(a: number, b: number) {
    a = this.find(a);
    b = this.find(b);
    if (a === b) return;
    if (this.sizes[a] < this.sizes[b]) [a, b] = [b, a];
    this.parent[b] = a;
    this.sizes[a] += this.sizes[b];
    this.verified[a] ||= this.verified[b];
    this.count--;
  }
  private update(n: Node) {
    n.height = 1 + Math.max(n.left?.height ?? 0, n.right?.height ?? 0);
    n.max = Math.max(n.hi, n.left?.max ?? -Infinity, n.right?.max ?? -Infinity);
    return n;
  }
  private rotateLeft(n: Node) {
    const r = n.right!;
    n.right = r.left;
    r.left = this.update(n);
    return this.update(r);
  }
  private rotateRight(n: Node) {
    const l = n.left!;
    n.left = l.right;
    l.right = this.update(n);
    return this.update(l);
  }
  private insert(n: Node | undefined, item: Node): Node {
    if (!n) return item;
    if (item.lo < n.lo || (item.lo === n.lo && item.id < n.id)) n.left = this.insert(n.left, item);
    else n.right = this.insert(n.right, item);
    this.update(n);
    const balance = (n.left?.height ?? 0) - (n.right?.height ?? 0);
    if (balance > 1) {
      if ((n.left!.left?.height ?? 0) < (n.left!.right?.height ?? 0))
        n.left = this.rotateLeft(n.left!);
      return this.rotateRight(n);
    }
    if (balance < -1) {
      if ((n.right!.right?.height ?? 0) < (n.right!.left?.height ?? 0))
        n.right = this.rotateRight(n.right!);
      return this.rotateLeft(n);
    }
    return n;
  }
  add(bounds: Bounds) {
    if (this.boxes.length >= this.capacity)
      throw new BoxComponentLimit('인증 영역 연결 저장 한도에 도달했습니다.');
    this.names ??= Object.keys(bounds);
    if (
      Object.keys(bounds).length !== this.names.length ||
      this.names.some((k) => !bounds[k] || !(bounds[k].lo <= bounds[k].hi))
    )
      throw Error('Invalid certified box interface');
    const id = this.boxes.length;
    this.boxes.push(bounds);
    this.parent.push(id);
    this.sizes.push(1);
    this.verified.push(false);
    this.count++;
    const axis = this.names[0],
      d = axis ? bounds[axis] : { lo: 0, hi: 0 };
    const visit = (n: Node | undefined) => {
      if (!n || n.max < d.lo) return;
      visit(n.left);
      if (
        n.lo <= d.hi &&
        d.lo <= n.hi &&
        this.names!.every(
          (k) => bounds[k].lo <= this.boxes[n.id][k].hi && this.boxes[n.id][k].lo <= bounds[k].hi,
        )
      )
        this.join(id, n.id);
      if (n.lo <= d.hi) visit(n.right);
    };
    visit(this.root);
    this.root = this.insert(this.root, { id, lo: d.lo, hi: d.hi, max: d.hi, height: 1 });
    return { id, needsWitness: !this.verified[this.find(id)] };
  }
  confirm(id: number) {
    this.verified[this.find(id)] = true;
  }
}
