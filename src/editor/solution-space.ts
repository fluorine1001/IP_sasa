import type { Stage, RoutePlan } from '../world/types';
import { planningTimeLimit, commandNames, type CommandKind } from '../world/program';
import { searchParameters, type SearchTemplate } from './solution-search';

type Action = { kind: CommandKind; actorId: string };
type State = { counts: number[]; separated: number; deployed: bigint };
const kinds: CommandKind[] = ['ignite', 'stop', 'turn', 'separate', 'push', 'deploy'];
/** Discrete programs are enumerated, not selected by an author's preferred trajectory.
 * DP counts suffixes; rank/unrank avoids materialising exponentially many programs.
 * Lengths are dovetailed, so a long program is investigated before short ones exhaust. */
export function solutionSpace(stage: Stage, maxCommands?: number) {
  if (maxCommands !== undefined && (!Number.isSafeInteger(maxCommands) || maxCommands < 0))
    throw Error('탐색 예약 개수는 음수가 아닌 안전한 정수로 지정하세요.');
  const supported = stage.rocket
    ? [...kinds.slice(0, 4), ...(stage.rocket.payloads?.length ? ['deploy' as const] : [])]
    : stage.rules.maneuverBudget > 0
      ? ['push']
      : [];
  const limits = kinds.map((kind) => {
    if (!supported.includes(kind)) return 0;
    const n = stage.rules.commandLimits?.[kind] ?? Infinity;
    return kind === 'separate'
      ? Math.min(n, stage.rocket?.parts.length ?? 0)
      : kind === 'deploy'
        ? Math.min(n, stage.rocket?.payloads?.length ?? 0)
        : n;
  });
  const allowed = limits.reduce((n, v) => n + v, 0);
  const depth = Math.max(0, Math.floor(maxCommands ?? (Number.isFinite(allowed) ? allowed : 6)));
  const capped = limits.map((n) => Math.min(n, depth));
  const memo = new Map<string, bigint>();
  let countLimited = false;
  function choices(state: State): Action[] {
    const actors = [
      'craft',
      ...(stage.rocket?.parts.slice(0, state.separated).map((p) => p.id) ?? []),
    ];
    return kinds.flatMap<Action>((kind, i) => {
      if (state.counts[i] >= capped[i]) return [];
      if (kind === 'deploy')
        return (stage.rocket?.payloads ?? [])
          .filter((_, i) => !(state.deployed & (1n << BigInt(i))))
          .map((p) => ({ kind, actorId: p.id }));
      if (kind === 'separate') return [{ kind, actorId: 'craft' }];
      return (
        kind === 'push'
          ? ['craft']
          : actors.filter(
              (actor) => actor !== 'craft' || state.separated < (stage.rocket?.parts.length ?? 0),
            )
      ).map((actorId) => ({ kind, actorId }));
    });
  }
  function advance(state: State, action: Action): State {
    const counts = state.counts.slice();
    counts[kinds.indexOf(action.kind)]++;
    return {
      counts,
      separated: state.separated + Number(action.kind === 'separate'),
      deployed:
        action.kind === 'deploy'
          ? state.deployed |
            (1n << BigInt(stage.rocket!.payloads!.findIndex((p) => p.id === action.actorId)))
          : state.deployed,
    };
  }
  function count(state: State, remaining: number): bigint {
    if (!remaining) return 1n;
    if (remaining > 96) {
      countLimited = true;
      throw Error('count-depth');
    }
    const key = `${remaining}:${state.counts.join(',')}:${state.deployed}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    if (memo.size > 100000) {
      countLimited = true;
      throw Error('count-limit');
    }
    // Actor choices share the same future state, but remain distinct programs.
    const value = choices(state).reduce(
      (n, action) => n + count(advance(state, action), remaining - 1),
      0n,
    );
    memo.set(key, value);
    return value;
  }
  const empty = (): State => ({ counts: kinds.map(() => 0), separated: 0, deployed: 0n });
  const totals: (bigint | undefined)[] = [];
  for (let n = 0; n <= depth; n++) {
    try {
      totals.push(count(empty(), n));
    } catch {
      totals.push(undefined);
      break;
    }
  }
  // If the counting budget is exhausted, lazy DFS remains complete within each length.
  function* words(state: State, remaining: number): Generator<Action[]> {
    const stack = [{ state, actions: choices(state), at: 0 }];
    const prefix: Action[] = [];
    if (!remaining) {
      yield [];
      return;
    }
    while (stack.length) {
      const frame = stack.at(-1)!;
      if (frame.at === frame.actions.length) {
        stack.pop();
        prefix.pop();
        continue;
      }
      const action = frame.actions[frame.at++];
      prefix.push(action);
      if (prefix.length === remaining) {
        yield prefix.slice();
        prefix.pop();
      } else {
        const next = advance(frame.state, action);
        stack.push({ state: next, actions: choices(next), at: 0 });
      }
    }
  }
  function unrank(n: number, rank: bigint): Action[] {
    let state = empty();
    const result: Action[] = [];
    for (let remaining = n; remaining; remaining--) {
      for (const action of choices(state)) {
        const next = advance(state, action),
          size = count(next, remaining - 1);
        if (rank >= size) {
          rank -= size;
          continue;
        }
        result.push(action);
        state = next;
        break;
      }
    }
    return result;
  }
  const ranks = Array.from({ length: depth + 1 }, () => 0n);
  const gcd = (a: bigint, b: bigint): bigint => {
    while (b) {
      const t = a % b;
      a = b;
      b = t;
    }
    return a;
  };
  const strides = totals.map((total) => {
    if (!total || total === 1n) return 1n;
    let stride = (total * 618033989n) / 1000000000n || 1n;
    while (gcd(stride, total) !== 1n) stride++;
    return stride;
  });
  const fallback = new Map<number, Generator<Action[]>>();
  const finished = new Set<number>();
  let lengthCursor = 0,
    serial = 0;
  function materialise(actions: Action[]): SearchTemplate {
    const h = Math.min(planningTimeLimit(stage), stage.audit.timeLimit ?? stage.rules.maxTime);
    const angle = stage.launchAngle ?? 0;
    const plan: RoutePlan = {
      launch: {
        x: Math.cos(angle) * stage.rules.launchLimit * 0.5,
        y: Math.sin(angle) * stage.rules.launchLimit * 0.5,
      },
      impulses: [],
      engineCommands: [],
    };
    actions.forEach((action, i) => {
      const id = `search-${i}`,
        time = ((i + 1) / (actions.length + 1)) * h;
      if (action.kind === 'push')
        plan.impulses.push({
          id,
          time,
          vector: { x: (stage.rules.maneuverBudget / Math.max(1, actions.length)) * 0.5, y: 0 },
        });
      else
        plan.engineCommands!.push({
          id,
          time,
          actorId: action.kind === 'deploy' ? 'craft' : action.actorId,
          ...(action.kind === 'deploy'
            ? { releasePayload: action.actorId }
            : action.kind === 'separate'
              ? { separate: true }
              : action.kind === 'turn'
                ? { direction: { x: 0, y: 1 } }
                : { throttle: action.kind === 'ignite' ? 0.5 : 0 }),
        });
    });
    return {
      id: `space-${serial++}`,
      label: actions.length
        ? actions
            .map(
              (a) =>
                `${commandNames[a.kind]}${a.actorId === 'craft' ? '' : ` (${[...(stage.rocket?.parts ?? []), ...(stage.rocket?.payloads ?? [])].find((p) => p.id === a.actorId)?.name})`}`,
            )
            .join(' → ')
        : '첫 출력만',
      plan,
      parameters: searchParameters(stage, plan),
    };
  }
  return {
    /** Weighted automaton: each legal action edge carries its finite value-grid size.
     * Rank/unrank addresses the product space without materialising it. */
    commandLimit: allowed,
    grid(divisions: number | bigint = 2) {
      if (typeof divisions === 'number' && !Number.isSafeInteger(divisions))
        throw Error('격자 분할 수는 양의 정수입니다.');
      const d = BigInt(divisions);
      if (d < 1n) throw Error('격자 분할 수는 양의 정수입니다.');
      const base = d + 1n,
        weighted = new Map<string, bigint>();
      const radices = (kind: CommandKind) =>
        kind === 'ignite'
          ? [base, d]
          : kind === 'turn'
            ? [base, base]
            : kind === 'push'
              ? [base, base, base]
              : [base];
      const product = (values: bigint[]) => values.reduce((p, n) => p * n, 1n);
      function weight(state: State, left: number): bigint {
        if (!left) return 1n;
        if (left > 96) throw Error('weighted-count-depth');
        const key = `${left}:${state.counts.join(',')}:${state.deployed}`;
        const previous = weighted.get(key);
        if (previous !== undefined) return previous;
        if (weighted.size > 100000) throw Error('weighted-count-limit');
        const value = choices(state).reduce(
          (n, a) => n + product(radices(a.kind)) * weight(advance(state, a), left - 1),
          0n,
        );
        weighted.set(key, value);
        return value;
      }
      const initialDims = stage.rules.launchLimit > 0 ? (stage.rocket ? 1 : 2) : 0;
      const initialWeight = base ** BigInt(initialDims),
        sizes: (bigint | undefined)[] = [];
      for (let n = 0; n <= depth; n++) {
        try {
          sizes.push(initialWeight * weight(empty(), n));
        } catch {
          sizes.push(undefined);
        }
      }
      const ordinals = Array.from({ length: depth + 1 }, () => 0n),
        done = new Set<number>();
      const gridStrides = sizes.map((size) => {
        if (!size) return 1n;
        let stride = (size * 618033989n) / 1000000000n || 1n;
        while (gcd(stride, size) !== 1n) stride++;
        return stride;
      });
      let cursor = 0;
      const digits = (rank: bigint, rs: bigint[]) =>
        rs.map((r) => {
          const digit = rank % r;
          rank /= r;
          return digit;
        });
      // Convert enormous rational grids without overflowing Number(divisions).
      const denominatorShift = Math.max(0, d.toString(2).length - 53);
      const denominatorHead = Number(d >> BigInt(denominatorShift));
      const coordinate = (n: bigint) => {
        if (!n) return 0;
        const shift = Math.max(0, n.toString(2).length - 53);
        return (Number(n >> BigInt(shift)) / denominatorHead) * 2 ** (shift - denominatorShift);
      };
      const fallbackCases = new Map<
        number,
        Generator<{ template: SearchTemplate; coordinates: number[] }>
      >();
      function* fallbackGrid(
        n: number,
      ): Generator<{ template: SearchTemplate; coordinates: number[] }> {
        for (const actions of words(empty(), n)) {
          const template = materialise(actions),
            rs = [
              ...Array<bigint>(initialDims).fill(base),
              ...actions.flatMap((a) => radices(a.kind)),
            ];
          const total = product(rs);
          for (let at = 0n; at < total; at++) {
            const ds = digits(at, rs);
            let index = initialDims;
            const values = ds.slice(0, index).map(coordinate);
            for (const a of actions)
              for (let j = 0; j < radices(a.kind).length; j++)
                values.push(coordinate(ds[index++] + BigInt(a.kind === 'ignite' && j === 1)));
            yield { template, coordinates: values };
          }
        }
      }
      return {
        divisions,
        releaseCounts() {
          weighted.clear();
          memo.clear();
        },
        total: sizes.every((v) => v !== undefined)
          ? sizes.reduce<bigint>((a, b) => a + b!, 0n).toString()
          : undefined,
        get exhausted() {
          return done.size === depth + 1;
        },
        next(): { template: SearchTemplate; coordinates: number[] } | undefined {
          for (let tries = 0; tries <= depth; tries++) {
            const n = cursor++ % (depth + 1);
            if (done.has(n)) continue;
            const size = sizes[n];
            if (size === undefined) {
              const iterator = fallbackCases.get(n) ?? fallbackGrid(n);
              fallbackCases.set(n, iterator);
              const item = iterator.next();
              if (item.done) {
                done.add(n);
                continue;
              }
              return item.value;
            }
            const ordinal = ordinals[n]++;
            if (ordinal >= size) {
              done.add(n);
              continue;
            }
            // Coprime rank permutation spreads early cases, but visits each exactly once.
            let rank = (ordinal * gridStrides[n]) % size;
            const suffix = weight(empty(), n),
              launchRank = rank / suffix;
            rank %= suffix;
            const coordinates = digits(launchRank, Array<bigint>(initialDims).fill(base)).map(
              coordinate,
            );
            let state = empty();
            const actions: Action[] = [];
            for (let left = n; left; left--) {
              for (const action of choices(state)) {
                const future = advance(state, action),
                  tail = weight(future, left - 1),
                  rs = radices(action.kind),
                  block = product(rs) * tail;
                if (rank >= block) {
                  rank -= block;
                  continue;
                }
                const ds = digits(rank / tail, rs);
                rank %= tail;
                coordinates.push(
                  ...ds.map((digit, j) =>
                    coordinate(digit + BigInt(action.kind === 'ignite' && j === 1)),
                  ),
                );
                actions.push(action);
                state = future;
                break;
              }
            }
            return { template: materialise(actions), coordinates };
          }
          return undefined;
        },
      };
    },
    maxCommands: depth,
    bounded: Number.isFinite(allowed) && depth >= allowed,
    total: !countLimited
      ? totals.reduce<bigint>((n, v) => n + (v ?? 0n), 0n).toString()
      : undefined,
    get exhausted() {
      return finished.size === depth + 1;
    },
    next(): SearchTemplate | undefined {
      for (let attempt = 0; attempt <= depth; attempt++) {
        const n = lengthCursor++ % (depth + 1);
        if (finished.has(n)) continue;
        let actions: Action[];
        const total = totals[n];
        if (total !== undefined) {
          if (ranks[n] >= total) {
            finished.add(n);
            continue;
          }
          // A coprime permutation visits every rank once and spreads early prefixes.
          const ordinal = ranks[n]++,
            rank = (ordinal * strides[n]) % total;
          actions = unrank(n, rank);
        } else {
          let iterator = fallback.get(n);
          if (!iterator) {
            iterator = words(empty(), n);
            fallback.set(n, iterator);
          }
          const next = iterator.next();
          if (next.done) {
            finished.add(n);
            continue;
          }
          actions = next.value;
        }
        return materialise(actions);
      }
      return undefined;
    },
  };
}
