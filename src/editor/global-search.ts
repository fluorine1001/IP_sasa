import { solutionSpace } from './solution-space';
import { fairCases } from './fair-cases';
import { mergeOverlappingFamilies, physicalPlanKey } from './solution-groups';
import {
  searchSolutions,
  searchParameters,
  parameterPlan,
  type SearchReport,
  type SearchTemplate,
  type SolutionFamily,
} from './solution-search';
import type { Stage } from '../world/types';
import { conditionDomain } from './condition-domain';
import { FlightPrefixCache } from './flight-prefix';
import { conicPrograms } from './conic-programs';
import {
  programEvents,
  commandNames,
  commandUsage,
  planConstraints,
  missionTimeLimit,
} from '../world/program';

/** Independent fair cases + continuous refinement. Physical trials yield in fixed
 * quanta. Only sound grammar constraints remove cases; heuristic scores do not. */
export function* globalSearch(
  stage: Stage,
  templates: SearchTemplate[],
  budget: number,
  maxCommands?: number,
  continuation?: { remaining: number; total: number },
  divisions = 2,
): Generator<SearchReport> {
  if (!Number.isFinite(budget)) throw Error('유한한 검사 예산을 지정하세요.');
  budget = Math.max(1, Math.min(8192, Math.floor(budget)));
  const proof = conditionDomain(stage);
  if (proof.impossible) {
    yield {
      evaluated: 0,
      cached: 0,
      successes: 0,
      illegal: 0,
      budget,
      done: true,
      elapsed: 0,
      frontier: 0,
      continuable: false,
      families: [],
      proof: { kind: 'predicate-domain', reasons: proof.reasons, visited: proof.visited },
    };
    return;
  }
  const domain = solutionSpace(stage, 0).commandLimit;
  const space = solutionSpace(stage, Math.min(6, maxCommands ?? domain));
  const cases = fairCases(stage, maxCommands, divisions);
  const quota = continuation ?? { remaining: budget, total: budget };
  const start = performance.now();
  const prefixes = new FlightPrefixCache();
  const inverse = conicPrograms(stage);
  let inverseDone = false;
  type Job = {
    iterator: Generator<SearchReport>;
    report?: SearchReport;
    served: boolean;
    completed: number;
  };
  const jobs: Job[] = [];
  const caseJobs: (Job & { key: string; analytic: boolean })[] = [];
  let caseTurn = 0,
    expansionTurn = 0,
    caseCursor = 0;
  const memo = new Map<string, SearchReport>();
  let caseFamilies: SolutionFamily[] = [],
    successes = 0,
    illegal = 0,
    cached = 0,
    serial = 0;
  const keys = new Set<string>(),
    pending = templates.slice();
  let cursor = 0,
    turn = 0,
    fullyExhausted = false,
    lastDiscovery = 0;
  let merged: SolutionFamily[] = [],
    lastInputs: SolutionFamily[][] = [];
  const keyOf = (t: SearchTemplate) =>
    JSON.stringify([
      programEvents(t.plan)
        .filter((e) => e.id !== 'launch')
        .map((e) => [e.kind, e.actorId]),
      // A total-order seed covers only one shuffle of independent actors. Do
      // not let that seed suppress the wider causal-DAG timing domain.
      !!t.after && new Set(t.plan.engineCommands?.map((c) => c.actorId)).size > 1,
    ]);
  function discover() {
    for (let tries = 0; tries < 128; tries++) {
      const fromRecord = pending.length > 0;
      const template = fromRecord ? pending.shift() : (space.next() ?? pending.shift());
      if (!template) return;
      if (
        Object.values(commandUsage(template.plan)).reduce((n, v) => n + v, 0) >
          (maxCommands ?? domain) ||
        planConstraints(stage, template.plan).length
      )
        continue;
      template.parameters = searchParameters(stage, template.plan);
      const topology = keyOf(template);
      if (keys.has(topology)) continue;
      keys.add(topology);
      template.label = programEvents(template.plan)
        .map(
          (e) =>
            (e.id === 'launch' ? '발사' : commandNames[e.kind as keyof typeof commandNames]) +
            (e.actorId === 'craft'
              ? ''
              : ' (' +
                ([...(stage.rocket?.parts ?? []), ...(stage.rocket?.payloads ?? [])].find(
                  (p) => p.id === e.actorId,
                )?.name ?? e.actorId) +
                ')'),
        )
        .join(' → ');
      const job: Job = {
        iterator: searchSolutions(stage, template, 8192, false, quota, prefixes),
        served: false,
        completed: 0,
      };
      jobs.push(job);
      lastDiscovery = quota.total - quota.remaining;
      return job;
    }
  }
  function report(done: boolean): SearchReport {
    const inputs = [caseFamilies, ...jobs.map((j) => j.report?.families ?? [])];
    if (inputs.length !== lastInputs.length || inputs.some((f, i) => f !== lastInputs[i])) {
      merged = mergeOverlappingFamilies(stage, [
        ...caseFamilies,
        ...jobs.flatMap((j, i) =>
          (j.report?.families ?? []).map((f) => ({ ...f, id: i * 10000 + f.id })),
        ),
      ]);
      lastInputs = inputs;
    }
    return {
      evaluated: quota.total - quota.remaining,
      cached: cached + jobs.reduce((n, j) => n + (j.report?.cached ?? 0), 0),
      successes: successes + jobs.reduce((n, j) => n + (j.report?.successes ?? 0), 0),
      illegal: illegal + jobs.reduce((n, j) => n + (j.report?.illegal ?? 0), 0),
      budget: quota.total,
      done,
      reuse: {
        prefixes: prefixes.reused,
        terminal: prefixes.terminalReused,
        savedSeconds: prefixes.savedSeconds,
      },
      continuable: !!continuation && !fullyExhausted && quota.total < Number.MAX_SAFE_INTEGER,
      coverage: {
        divisions: (BigInt(divisions) << BigInt(cases.level)).toString(),
        checked: cases.checked,
        exhausted: cases.exhausted,
      },
      elapsed: performance.now() - start,
      frontier: caseJobs.length + jobs.reduce((n, j) => n + (j.report?.frontier ?? 0), 0),
      families: merged,
      sensitivity: {
        ticks: jobs.reduce((n, j) => n + (j.report?.sensitivity?.ticks ?? 0), 0),
        passes: jobs.reduce((n, j) => n + (j.report?.sensitivity?.passes ?? 0), 0),
        dimensions: jobs.reduce((n, j) => Math.max(n, j.report?.sensitivity?.dimensions ?? 0), 0),
        stateWidth: jobs.reduce((n, j) => Math.max(n, j.report?.sensitivity?.stateWidth ?? 0), 0),
      },
      profiles: done
        ? jobs.map((j, i) => ({
            program: [...keys][i],
            evaluated: j.report?.evaluated ?? 0,
            quality: j.report?.quality ?? 0,
          }))
        : undefined,
      scope: {
        programs: jobs.length,
        total: space.total,
        exhausted: space.exhausted,
        maxCommands: cases.maxCommands,
        bounded: cases.bounded,
        horizon: cases.horizon,
      },
    };
  }
  function advanceCase() {
    let job =
      caseJobs.find((j) => j.analytic) ?? caseJobs[caseCursor++ % Math.max(1, caseJobs.length)];
    if (
      !job?.analytic &&
      quota.remaining > 0 &&
      caseJobs.length < 8 &&
      (!job || caseTurn++ % 2 === 0)
    ) {
      // Alternate analytic boundary-graph expansion with the general grammar. The
      // operator eliminates continuous controls; only its derived trajectories are flown.
      const branch =
        !inverseDone && (expansionTurn++ % 2 === 0 || cases.exhausted) ? inverse.next() : undefined;
      if (branch?.done) inverseDone = true;
      if (branch && !branch.done && !branch.value) return;
      const conic = branch && !branch.done ? branch.value : undefined;
      if (
        conic &&
        Object.values(commandUsage(conic)).reduce((n, v) => n + v, 0) > (maxCommands ?? domain)
      )
        return;
      const item = conic
        ? {
            stage,
            horizon: Number.isFinite(missionTimeLimit(stage))
              ? missionTimeLimit(stage)
              : (stage.audit.timeLimit ?? stage.rules.maxTime),
            template: {
              id: 'conic-boundary',
              label: '궤도 경계값 연결',
              plan: conic,
              parameters: searchParameters(stage, conic),
            },
            coordinates: [] as number[],
          }
        : cases.next();
      if (!item) return;
      const plan = conic ?? parameterPlan(item.template, item.coordinates);
      const key = physicalPlanKey(stage, plan) + '@' + item.horizon;
      if (memo.has(key) || caseJobs.some((j) => j.key === key)) {
        cached++;
        return;
      }
      const fixed = {
        ...item.template,
        plan,
        // parameterPlan has already sorted this concrete schedule. Its indices
        // no longer name the original canonical word's causal DAG.
        after: undefined,
        parameters: searchParameters(item.stage, plan).map((p) => ({ ...p, enabled: false })),
      };
      job = {
        key,
        analytic: !!conic,
        iterator: searchSolutions(item.stage, fixed, 1, false, quota, prefixes),
        served: false,
        completed: 0,
      };
      caseJobs.push(job);
    }
    if (!job) return;
    const next = job.iterator.next();
    if (!next.done) job.report = next.value;
    if (!next.done && !next.value.done) return;
    const result = job.report!;
    memo.set(job.key, result);
    if (memo.size > 4096) memo.delete(memo.keys().next().value!);
    successes += result.successes;
    illegal += result.illegal;
    if (result.families.length)
      caseFamilies = mergeOverlappingFamilies(stage, [
        ...caseFamilies,
        ...result.families.map((f) => ({ ...f, id: -Number.MAX_SAFE_INTEGER + ++serial })),
      ]).map((f) => ({ ...f, samples: f.samples.slice(0, 16) }));
    caseJobs.splice(caseJobs.indexOf(job), 1);
  }
  // Bounded graph startup, not a new trial budget. Derive one early candidate
  // before generic jobs consume the quota; deep graphs still yield to the grammar.
  for (let i = 0; i < 16 && !inverseDone && !caseJobs.some((j) => j.analytic); i++) {
    advanceCase();
    yield report(false);
  }
  while (true) {
    while (quota.remaining > 0 || caseJobs.length || jobs.some((j) => j.report?.pending)) {
      const slot = turn++;
      let active = jobs.filter(
        (j) => !j.report?.done && (j.report?.pending || (quota.remaining > 0 && !j.served)),
      );
      if (!active.length && quota.remaining > 0) {
        jobs.forEach((j) => (j.served = false));
        active = jobs.filter((j) => !j.report?.done);
      }
      if (
        (slot % 2 === 0 && caseJobs.some((j) => j.analytic)) ||
        (slot % 4 === 3 && (caseJobs.length || quota.remaining > 0)) ||
        (caseJobs.length && !active.length && quota.remaining <= 0)
      ) {
        advanceCase();
      } else {
        const exploratory = active[cursor++ % Math.max(1, active.length)];
        const job =
          quota.remaining > 0 &&
          (jobs.length < Math.min(8, Number(space.total ?? 8)) ||
            quota.total - quota.remaining - lastDiscovery >= 64 ||
            !active.length)
            ? (discover() ?? exploratory)
            : slot % 4 === 1 && quota.remaining > 0
              ? jobs
                  .filter((j) => !j.report?.done)
                  .reduce<Job | undefined>(
                    (best, j) =>
                      (j.report?.quality ?? 0) > (best?.report?.quality ?? 0) ? j : best,
                    exploratory,
                  )
              : exploratory;
        if (job) {
          const next = job.iterator.next();
          if (!next.done) job.report = next.value;
          else if (job.report) job.report.done = true;
          if (job.report?.done) job.iterator.return(undefined);
          if (job.report && !job.report.pending && job.report.evaluated > job.completed) {
            job.completed = job.report.evaluated;
            job.served = true;
          }
        } else if (quota.remaining > 0) {
          if (inverseDone && cases.exhausted && !caseJobs.length) {
            fullyExhausted = true;
            break;
          }
          advanceCase();
        }
      }
      yield report(false);
    }
    yield report(true);
    if (!continuation || fullyExhausted) return;
  }
}
