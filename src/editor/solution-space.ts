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
  if (
    maxCommands !== undefined &&
    (!Number.isInteger(maxCommands) || maxCommands < 0 || maxCommands > 256)
  )
    throw Error('탐색 예약 개수는 0~256의 정수로 지정하세요.');
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
  const depth = Math.max(
    0,
    Math.min(256, Math.floor(maxCommands ?? (Number.isFinite(allowed) ? allowed : 6))),
  );
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
  function* words(state: State, remaining: number, prefix: Action[] = []): Generator<Action[]> {
    if (!remaining) {
      yield prefix;
      return;
    }
    for (const action of choices(state))
      yield* words(advance(state, action), remaining - 1, [...prefix, action]);
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
