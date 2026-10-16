/** Immutable variable order shared by Boolean and weighted diagrams. IDs keep
 * their meaning when reordered; unknown variables follow the supplied prefix. */
export class VariableOrder {
  private ranks: Map<number, number>;
  constructor(prefix: readonly number[] = []) {
    if (
      new Set(prefix).size !== prefix.length ||
      prefix.some((v) => !Number.isSafeInteger(v) || v < 0)
    )
      throw Error('Invalid symbolic variable order.');
    this.ranks = new Map(prefix.map((v, i) => [v, i]));
  }
  compare = (a: number, b: number): number => {
    if (a === b) return 0;
    if (a === Infinity) return 1;
    if (b === Infinity) return -1;
    const x = this.ranks.get(a),
      y = this.ranks.get(b);
    if (x !== undefined || y !== undefined)
      return x === undefined ? 1 : y === undefined ? -1 : x - y;
    return a - b;
  };
  first(a: number, b: number) {
    return this.compare(a, b) <= 0 ? a : b;
  }
}
