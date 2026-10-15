import { logic, type HybridAlgebra } from '../../physics/hybrid-kernel';
import type { Condition } from '../../world/conditions';
import type { Expression } from '../../world/expressions';
import type { Goal } from '../../world/types';
import { WindowRelation } from '../../physics/window-kernel';

export type Known<T> = { value: T; known: T };
export type HistoryScope = {
  owner: string;
  path: string;
  actorId?: string;
  targetId?: string;
  binding?: string;
  references: readonly string[];
};
export type HistoryReaders<T> = {
  metric(
    expression: Extract<Expression, { kind: 'metric' }>,
    scope: HistoryScope,
    enabled: T,
  ): Known<T>;
  event(
    condition: Extract<Condition, { kind: 'event' }>,
    scope: HistoryScope,
    enabled: T,
  ): Known<T>;
  /** Extra arithmetic needs a physical theory implementation. Window history
   * is compiled internally, rather than supplied as a free predicate.
   * No opaque predicate bit or sampled answer may substitute for that relation. */
  extension?(expression: Expression, scope: HistoryScope, enabled: T): Known<T>;
};
type Memory<T> = { hold: T; index: T; latched: T };
type Capture<T> = { present: T; value: T; time: T };
export class UnsupportedHistoryExpression extends Error {
  constructor(operation: string) {
    super('Arithmetic operation requires an explicit relation: ' + operation);
    this.name = 'UnsupportedHistoryExpression';
  }
}

/** Compiles the complete Condition control structure, not an enumerated list of
 * goal histories. Updates are gated per scope, preserving three-valued unknowns,
 * reference bindings, captures, dependencies, windows of eligibility, and the
 * engine's one-sequence-child-per-tick rule. Physical metric/event relations are
 * required from the caller; this is not a whole-mission success-set solver. */
export class GoalHistory<T> {
  private memories = new Map<string, Memory<T>>();
  private captures = new Map<string, Capture<T>>();
  private completed = new Map<string, T>();
  private windows = new Map<string, WindowRelation<T>>();
  private time!: T;
  private dt!: T;
  private readers!: HistoryReaders<T>;
  constructor(
    private a: HybridAlgebra<T>,
    private goals: readonly Goal[],
    private options: { eliminateDeadMemoryGuards?: boolean } = {},
  ) {}
  private get zero() {
    return this.a.literal(0);
  }
  private get one() {
    return this.a.literal(1);
  }
  private get boolean() {
    return logic(this.a);
  }
  private yes(v: Known<T>) {
    return this.boolean.and(v.known, v.value);
  }
  private unknown(): Known<T> {
    return { known: this.zero, value: this.zero };
  }
  private constant(value: T): Known<T> {
    return { known: this.one, value };
  }
  private fold(values: readonly T[], all: boolean) {
    return values.reduce(
      (s, v) => (all ? this.boolean.and(s, v) : this.boolean.or(s, v)),
      all ? this.one : this.zero,
    );
  }
  private key(s: HistoryScope, name: string) {
    return JSON.stringify([s.owner, name]);
  }
  private checkpointKey(s: HistoryScope, name: string) {
    return this.key(s, s.binding ? s.binding + ':' + name : name);
  }
  private expression(e: Expression, s: HistoryScope, enabled: T): Known<T> {
    const a = this.a;
    if (e.kind === 'constant') {
      if (!Number.isFinite(e.value)) return this.unknown();
      return this.constant(a.literal(e.value));
    }
    if (e.kind === 'recorded') {
      const old = this.captures.get(this.checkpointKey(s, e.key));
      return old ? { value: old.value, known: old.present } : this.unknown();
    }
    if (e.kind === 'metric') {
      if ((e.actorId === '$actor' && !s.actorId) || (e.targetId === '$target' && !s.targetId))
        return this.unknown();
      return this.readers.metric(
        {
          ...e,
          actorId: e.actorId === '$actor' ? s.actorId : e.actorId,
          targetId: e.targetId === '$target' ? s.targetId! : e.targetId,
        },
        s,
        enabled,
      );
    }
    if (e.kind === 'window') {
      const domain = this.expression(e.domain, { ...s, path: s.path + '.domain' }, enabled);
      const width = this.expression(e.width, { ...s, path: s.path + '.width' }, enabled);
      const value = this.expression(e.value, { ...s, path: s.path + '.value' }, enabled);
      const key = this.key(s, s.path);
      let history = this.windows.get(key);
      if (!history) {
        history = new WindowRelation(a, e.operation);
        this.windows.set(key, history);
      }
      return history.advance({
        domain: domain.value,
        width: width.value,
        value: value.value,
        known: this.fold([domain.known, width.known, value.known], true),
        enabled,
        time: this.time,
      });
    }
    if (['power', 'sin', 'cos', 'atan2', 'ellipseDistance'].includes(e.operation)) {
      if (!this.readers.extension) throw new UnsupportedHistoryExpression(e.operation);
      return this.readers.extension(e, s, enabled);
    }
    const args = e.args.map((v, i) =>
      this.expression(v, { ...s, path: `${s.path}.args.${i}` }, enabled),
    );
    let known = this.fold(
        args.map((v) => v.known),
        true,
      ),
      value: T;
    const operands = args.map((v) => v.value);
    switch (e.operation) {
      case 'add':
        value = operands.reduce((s, v) => a.add(s, v), this.zero);
        break;
      case 'multiply':
        value = operands.reduce((s, v) => a.multiply(s, v), this.one);
        break;
      case 'subtract':
        value = a.subtract(operands[0], operands[1]);
        break;
      case 'divide': {
        const valid = this.boolean.not(this.boolean.eq(operands[1], this.zero));
        known = this.boolean.and(known, valid);
        value = a.divide(operands[0], a.select(valid, operands[1], this.one));
        break;
      }
      case 'sqrt':
        known = this.boolean.and(known, a.lte(this.zero, operands[0]));
        value = a.sqrt(a.max(this.zero, operands[0]));
        break;
      case 'abs':
        value = a.max(operands[0], a.multiply(operands[0], a.literal(-1)));
        break;
      case 'min':
      case 'max':
        if (!operands.length) return this.unknown();
        value = operands
          .slice(1)
          .reduce((s, v) => (e.operation === 'min' ? a.min(s, v) : a.max(s, v)), operands[0]);
        break;
      default:
        throw Error('Unsupported expression relation.');
    }
    return { known, value };
  }
  private eligible(goal: Goal) {
    return this.fold(
      [
        ...goal.dependsOn.map((id) => this.completed.get(id) ?? this.zero),
        this.a.lte(this.a.literal(goal.startTime), this.time),
        goal.endTimeUnlimited ? this.one : this.a.lte(this.time, this.a.literal(goal.endTime)),
      ],
      true,
    );
  }
  private condition(node: Condition, scope: HistoryScope, enabled: T): Known<T> {
    const a = this.a,
      b = this.boolean,
      zero = this.zero,
      one = this.one;
    const key = this.key(scope, scope.path),
      old = this.memories.get(key) ?? { hold: zero, index: zero, latched: zero };
    const child = (node: Condition, suffix: string, active = enabled) =>
      this.condition(node, { ...scope, path: scope.path + suffix }, active);
    if (node.kind === 'reference') {
      if (scope.references.includes(node.goalId)) return this.unknown();
      const goal = this.goals.find((g) => g.id === node.goalId);
      if (!goal) return this.constant(zero);
      const eligible = this.eligible(goal),
        path = scope.path + '.ref:' + goal.id;
      const value = this.condition(
        goal.condition,
        { ...scope, path, binding: path, references: [...scope.references, goal.id] },
        b.and(enabled, eligible),
      );
      return {
        known: a.select(eligible, value.known, one),
        value: a.select(eligible, value.value, zero),
      };
    }
    if (node.kind === 'quantify') {
      const values: Known<T>[] = [];
      for (const actorId of node.actorIds)
        for (const targetId of node.targetIds ?? [scope.targetId ?? '']) {
          if (node.excludeSelf && actorId === targetId) continue;
          const path = `${scope.path}.${actorId}.${targetId}`;
          values.push(
            this.condition(
              node.child,
              { ...scope, actorId, targetId, path, binding: path },
              enabled,
            ),
          );
        }
      if (!values.length) return this.unknown();
      const passed = values.reduce((s, v) => a.add(s, this.yes(v)), zero);
      const unknown = values.reduce((s, v) => a.add(s, b.not(v.known)), zero);
      const needed = a.literal(
        node.mode === 'all' ? values.length : node.mode === 'any' ? 1 : (node.count ?? 1),
      );
      const success = a.lte(needed, passed),
        impossible = a.lt(a.add(passed, unknown), needed);
      return { value: success, known: b.or(success, impossible) };
    }
    if (node.kind === 'compare') {
      const x = this.expression(node.left, { ...scope, path: scope.path + '.left' }, enabled),
        y = this.expression(node.right, { ...scope, path: scope.path + '.right' }, enabled);
      let value: T;
      switch (node.operator) {
        case 'lt':
          value = a.lt(x.value, y.value);
          break;
        case 'lte':
          value = a.lte(x.value, y.value);
          break;
        case 'gt':
          value = a.lt(y.value, x.value);
          break;
        case 'gte':
          value = a.lte(y.value, x.value);
          break;
        case 'eq': {
          const d = a.subtract(x.value, y.value);
          value = a.lte(a.max(d, a.multiply(d, a.literal(-1))), a.literal(1e-6));
          break;
        }
      }
      return { known: b.and(x.known, y.known), value };
    }
    if (node.kind === 'all' || node.kind === 'any') {
      const values = node.children.map((v, i) => child(v, '.' + i));
      const allKnown = this.fold(
        values.map((v) => v.known),
        true,
      );
      const force = this.fold(
        values.map((v) => b.and(v.known, node.kind === 'all' ? b.not(v.value) : v.value)),
        false,
      );
      return { known: b.or(allKnown, force), value: node.kind === 'all' ? b.not(force) : force };
    }
    if (node.kind === 'sequence') {
      let active: Known<T> = this.constant(one);
      for (let i = 0; i < node.children.length; i++) {
        const selected = b.eq(old.index, a.literal(i)),
          v = child(node.children[i], '.' + i, b.and(enabled, selected));
        active = {
          known: a.select(selected, v.known, active.known),
          value: a.select(selected, v.value, active.value),
        };
      }
      const finished = a.lte(a.literal(node.children.length), old.index);
      const index = a.select(
        b.and(enabled, b.and(b.not(finished), this.yes(active))),
        a.add(old.index, one),
        old.index,
      );
      this.memories.set(key, { ...old, index });
      return {
        known: a.select(finished, one, active.known),
        value: a.lte(a.literal(node.children.length), index),
      };
    }
    if (node.kind === 'not') {
      const v = child(node.child, '.child');
      return { known: v.known, value: b.not(v.value) };
    }
    if (node.kind === 'once') {
      const v = child(node.child, '.child', b.and(enabled, b.not(old.latched)));
      const latched = b.or(old.latched, b.and(enabled, this.yes(v)));
      this.memories.set(key, { ...old, latched });
      return {
        known: a.select(old.latched, one, v.known),
        value: a.select(old.latched, one, v.value),
      };
    }
    if (node.kind === 'hold') {
      const v = child(node.child, '.child'),
        elapsed = a.select(this.yes(v), a.add(old.hold, this.dt), zero);
      this.memories.set(key, { ...old, hold: a.select(enabled, elapsed, old.hold) });
      return {
        known: v.known,
        value: b.and(this.yes(v), a.lte(a.literal(node.duration), a.add(elapsed, a.literal(1e-8)))),
      };
    }
    if (node.kind === 'capture') {
      const checkpoint = this.checkpointKey(scope, node.key),
        captured = this.captures.get(checkpoint) ?? { present: zero, value: zero, time: zero };
      const ready = child(node.when, '.when', b.and(enabled, b.not(captured.present)));
      const value = this.expression(
        node.value,
        { ...scope, path: scope.path + '.value' },
        b.and(enabled, b.and(b.not(captured.present), this.yes(ready))),
      );
      const take = this.fold(
        [enabled, b.not(captured.present), this.yes(ready), value.known],
        true,
      );
      this.captures.set(checkpoint, {
        present: b.or(captured.present, take),
        value: a.select(take, value.value, captured.value),
        time: a.select(take, this.time, captured.time),
      });
      return {
        known: a.select(
          captured.present,
          one,
          b.and(ready.known, a.select(ready.value, value.known, one)),
        ),
        value: b.or(captured.present, b.and(this.yes(ready), value.known)),
      };
    }
    if (node.kind !== 'event') throw Error('Unknown condition relation.');
    if (
      (node.actorId === '$actor' && !scope.actorId) ||
      (node.targetId === '$target' && !scope.targetId)
    )
      return this.unknown();
    return this.readers.event(
      {
        ...node,
        actorId: node.actorId === '$actor' ? scope.actorId : node.actorId,
        targetId: node.targetId === '$target' ? scope.targetId! : node.targetId,
      },
      scope,
      enabled,
    );
  }
  advance(time: T, dt: T, readers: HistoryReaders<T>, running = this.one): Record<string, T> {
    this.time = time;
    this.dt = dt;
    this.readers = readers;
    for (const goal of this.goals) {
      const complete = this.completed.get(goal.id) ?? this.zero;
      const enabled = this.boolean.and(
        running,
        this.boolean.and(this.boolean.not(complete), this.eligible(goal)),
      );
      const value = this.condition(
        goal.condition,
        { owner: goal.id, path: 'root', references: [] },
        // Valid only for absorbing execution with unobservable completed-goal
        // private memory. Completion itself remains strictly gated below.
        this.options.eliminateDeadMemoryGuards ? this.eligible(goal) : enabled,
      );
      this.completed.set(
        goal.id,
        this.boolean.or(complete, this.boolean.and(enabled, this.yes(value))),
      );
    }
    return Object.fromEntries(this.completed);
  }
  /** Snapshots carry all temporal memory, not just the current truth/ratio.
   * Callers must also retain expression-window and physical resource state. */
  snapshot() {
    return {
      completed: new Map(this.completed),
      memories: new Map(this.memories),
      captures: new Map(this.captures),
      windows: new Map([...this.windows].map(([key, history]) => [key, history.snapshot()])),
    };
  }
}
