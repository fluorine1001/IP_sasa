import { solutionSpace } from './solution-space';
import { mergeOverlappingFamilies } from './solution-groups';
import {
  searchSolutions,
  searchParameters,
  type SearchReport,
  type SearchTemplate,
} from './solution-search';
import type { Stage } from '../world/types';
import { programEvents, commandNames, commandUsage, planConstraints } from '../world/program';

/** Fair mixed discrete/continuous search. Half the scheduling slots discover new
 * programs; the other half refine existing programs in round-robin order.
 * Failure samples never prune an unproved region. All jobs share one hard budget. */
export function* globalSearch(
  stage: Stage,
  templates: SearchTemplate[],
  budget: number,
  maxCommands?: number,
  continuation?: { remaining: number; total: number },
): Generator<SearchReport> {
  if (!Number.isFinite(budget)) throw Error('유한한 검사 예산을 지정하세요.');
  budget = Math.max(1, Math.min(8192, Math.floor(budget)));
  const space = solutionSpace(stage, maxCommands),
    quota = continuation ?? { remaining: budget, total: budget },
    start = performance.now();
  const jobs: { iterator: Generator<SearchReport>; report?: SearchReport }[] = [];
  const keys = new Set<string>();
  const pending = templates.slice();
  let cursor = 0,
    turn = 0,
    observed = 0;
  let fullyExhausted = false;
  const key = (t: SearchTemplate) =>
    JSON.stringify(
      [...(t.plan.engineCommands ?? [])]
        .map((c) => [
          c.actorId,
          c.separate
            ? 'separate'
            : c.throttle === 0
              ? 'stop'
              : c.throttle !== undefined
                ? 'ignite'
                : 'turn',
          !!c.direction,
        ])
        .concat(t.plan.impulses.map(() => ['craft', 'push', true])),
    );
  function discover() {
    // Warm starts are ordinary observed programs, not a different kind of solution.
    // Alternate them with previously unvisited control programs.
    for (let tries = 0; tries < 128; tries++) {
      const fromRecord = observed++ % 2 === 0 && pending.length > 0;
      const template = fromRecord ? pending.shift() : (space.next() ?? pending.shift());
      if (!template) return undefined;
      if (
        Object.values(commandUsage(template.plan)).reduce((n, v) => n + v, 0) > space.maxCommands ||
        planConstraints(stage, template.plan).length
      )
        continue;
      template.parameters = searchParameters(stage, template.plan);
      const topology = key(template);
      if (keys.has(topology)) continue;
      keys.add(topology);
      template.label = programEvents(template.plan)
        .map(
          (event) =>
            `${event.id === 'launch' ? '발사' : commandNames[event.kind as keyof typeof commandNames]}${event.actorId === 'craft' ? '' : ` (${stage.rocket?.parts.find((p) => p.id === event.actorId)?.name})`}`,
        )
        .join(' → ');
      const job = {
        iterator: searchSolutions(stage, template, 8192, false, quota),
        report: undefined as SearchReport | undefined,
      };
      jobs.push(job);
      return job;
    }
    return undefined;
  }
  const report = (done: boolean): SearchReport => ({
    evaluated: quota.total - quota.remaining,
    cached: jobs.reduce((n, j) => n + (j.report?.cached ?? 0), 0),
    successes: jobs.reduce((n, j) => n + (j.report?.successes ?? 0), 0),
    illegal: jobs.reduce((n, j) => n + (j.report?.illegal ?? 0), 0),
    budget: quota.total,
    done,
    continuable: !!continuation && !fullyExhausted && quota.total < 8192,
    elapsed: performance.now() - start,
    frontier: jobs.reduce((n, j) => n + (j.report?.frontier ?? 0), 0),
    families: mergeOverlappingFamilies(
      stage,
      jobs.flatMap((j, i) =>
        (j.report?.families ?? []).map((f) => ({ ...f, id: i * 10000 + f.id })),
      ),
    ),
    scope: {
      programs: jobs.length,
      total: space.total,
      exhausted: space.exhausted,
      maxCommands: space.maxCommands,
      bounded: space.bounded,
      horizon: stage.audit.timeLimit ?? stage.rules.maxTime,
    },
  });
  while (true) {
    let exhausted = false;
    while (quota.remaining > 0) {
      const active = jobs.filter((job) => !job.report?.done);
      const job =
        turn++ % 2 === 0 || !active.length
          ? (discover() ?? active[cursor++ % Math.max(1, active.length)])
          : active[cursor++ % active.length];
      if (!job) {
        exhausted = true;
        fullyExhausted = true;
        break;
      }
      const next = job.iterator.next();
      if (!next.done) job.report = next.value;
      else if (job.report) job.report.done = true;
      yield report(false);
    }
    yield report(true);
    if (!continuation || exhausted) return;
  }
}
