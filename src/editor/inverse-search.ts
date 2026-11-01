import {
  inverseCapability,
  inverseProjection,
  type ProjectionProgress,
} from './inverse-projection';
import {
  searchParameters,
  parameterPlan,
  type SearchReport,
  type SearchTemplate,
  type SolutionFamily,
} from './solution-search';
import { solutionSpace } from './solution-space';
import { conditionDomain } from './condition-domain';
import { controlEnvelope } from './control-envelope';
import { physicalPlanKey, mergeOverlappingFamilies } from './solution-groups';
import { BoxComponents, BoxComponentLimit } from './research/box-components';
import { createRun, tick } from '../world/engine';
import { craftCenter } from '../world/craft-center';
import { flightShape } from './flight-shape';
import { programEvents, commandNames, missionTimeLimit } from '../world/program';
import type { Stage, RoutePlan, Run } from '../world/types';

export type InverseSearchOptions = {
  global?: boolean;
  budget?: number;
  maxCommands?: number;
  quota?: { remaining: number; total: number };
};

type Job = {
  template: SearchTemplate;
  iterator: Generator<ProjectionProgress>;
  boxes: BoxComponents;
  statistics: ProjectionProgress['statistics'];
  finished: boolean;
  native?: { run: Run; plan: RoutePlan; box: number; trace: Run['trail'] };
};

/** Production success-relation search. Symbolic programs carry continuous
 * control domains; only certified region representatives enter the real engine.
 * No grid/Halton/coordinate/seed-flight fallback exists in this execution path. */
export function* inverseSearch(
  stage: Stage,
  templates: SearchTemplate[],
  options: InverseSearchOptions = {},
): Generator<SearchReport> {
  const batch = options.budget ?? 256;
  if (!Number.isFinite(batch) || batch < 1) throw Error('유한한 양의 역산 작업 예산이 필요합니다.');
  const quota = options.quota ?? { remaining: Math.floor(batch), total: Math.floor(batch) };
  // Necessary-condition elimination is itself a relation calculation, not a
  // candidate trial. Preserve sound global emptiness proofs before compilation.
  const logical = conditionDomain(stage);
  const envelope = logical.impossible ? undefined : controlEnvelope(stage);
  const proof = envelope?.proofReady
    ? conditionDomain(stage, { metricRange: envelope.metricRange })
    : logical;
  if (proof.impossible) {
    yield {
      evaluated: 0,
      cached: 0,
      successes: 0,
      illegal: 0,
      budget: quota.total,
      done: true,
      elapsed: 0,
      frontier: 0,
      continuable: false,
      families: [],
      proof: {
        kind: logical.impossible ? 'predicate-domain' : 'control-envelope',
        reasons: proof.reasons,
        visited: proof.visited,
      },
      inverse: {
        method: 'success-relation',
        phase: 'finished',
        layouts: 0,
        closed: 0,
        unsupported: 0,
        unresolved: 0,
        complete: true,
        issues: [],
        work: 0,
      },
    };
    return;
  }
  const start = performance.now(),
    issues = new Set(inverseCapability(stage));
  const jobs: Job[] = [],
    families: SolutionFamily[] = [];
  let merged: SolutionFamily[] = [],
    evaluated = 0,
    successes = 0,
    cached = 0,
    rejected = 0;
  let unsupported = Number(issues.size > 0),
    unresolved = unsupported,
    closed = 0,
    work = 0,
    layouts = 0;
  let phase: NonNullable<SearchReport['inverse']>['phase'] = 'compiling';
  // Only record layouts need deduplication against the unique grammar words.
  // Do not retain an ever-growing set of every visited word.
  const recordKeys = new Set<string>(),
    nativeKeys = new Map<string, 'pending' | 'won' | 'failed'>();
  const retired = { cells: 0, visits: 0, regions: 0, groups: 0 };
  const space =
    options.global && !issues.size ? solutionSpace(stage, options.maxCommands) : undefined;
  let initial = 0,
    exhausted = !!issues.size,
    cursor = 0;
  const horizon = Math.min(stage.audit.timeLimit ?? stage.rules.maxTime, missionTimeLimit(stage));
  if (horizon < missionTimeLimit(stage))
    issues.add(`현재 역산은 ${horizon}초까지입니다. 그 이후의 성공 관계는 미결입니다.`);
  if (space && !space.bounded)
    issues.add(`현재 예약 구성 깊이는 ${space.maxCommands}개까지입니다. 더 긴 구성은 미결입니다.`);
  const report = (done: boolean, continuable = false): SearchReport => ({
    evaluated,
    cached,
    successes,
    illegal: rejected,
    budget: quota.total,
    done,
    elapsed: performance.now() - start,
    frontier: jobs.filter((j) => !j.finished).length,
    continuable,
    families: merged,
    pending: jobs.some((j) => !!j.native),
    projection: {
      cells: jobs.reduce((n, j) => n + j.statistics.cells, retired.cells),
      visits: jobs.reduce((n, j) => n + j.statistics.visits, retired.visits),
      regions: jobs.reduce((n, j) => n + j.statistics.regions, retired.regions),
      groups: jobs.reduce((n, j) => n + j.boxes.components, retired.groups),
    },
    scope: {
      programs: layouts,
      total: space?.total,
      exhausted,
      maxCommands: space?.maxCommands ?? options.maxCommands ?? 0,
      bounded: space?.bounded ?? !options.global,
      horizon,
    },
    inverse: {
      method: 'success-relation',
      phase: done ? 'finished' : phase,
      layouts,
      closed,
      unsupported,
      unresolved,
      complete:
        exhausted &&
        !jobs.some((j) => !j.finished) &&
        !unsupported &&
        !unresolved &&
        !rejected &&
        (space?.bounded ?? !options.global) &&
        horizon >= missionTimeLimit(stage),
      issues: [...issues].slice(0, 32),
      work,
    },
  });
  const identify = (t: SearchTemplate) =>
    JSON.stringify([
      programEvents(t.plan)
        .filter((e) => e.id !== 'launch')
        .map((e) => [e.kind, e.actorId]),
      t.after ?? null,
      ...(!options.global ? [t.parameters] : []),
    ]);
  function discover() {
    if (exhausted || jobs.filter((j) => !j.finished).length >= 4) return;
    const fromRecord = initial < templates.length;
    const source = fromRecord ? templates[initial++] : space?.next();
    if (!source) {
      exhausted = true;
      return;
    }
    const template = structuredClone(source);
    if (
      options.global &&
      programEvents(template.plan).filter((e) => e.id !== 'launch').length > space!.maxCommands
    )
      return;
    if (options.global) template.parameters = searchParameters(stage, template.plan);
    const key = identify(template);
    if (recordKeys.has(key)) return;
    if (fromRecord) recordKeys.add(key);
    layouts++;
    // A compiler binding, NOT a flown seed. Strict mode refuses every enabled
    // coordinate that cannot yet be represented as a relation input.
    const seed = template.parameters.filter((p) => p.enabled).map(() => 0.5);
    jobs.push({
      template,
      boxes: new BoxComponents(4096),
      finished: false,
      statistics: { cells: 0, visits: 0, regions: 0, groups: 0 },
      iterator: inverseProjection(stage, template, seed, parameterPlan(template, seed), undefined, {
        strict: true,
        cells: Infinity,
      }),
    });
  }
  const tracePoint = (run: Run): Run['trail'][number] => ({
    position: craftCenter(stage, run),
    velocity: { ...run.velocity },
    time: run.time,
  });
  function finishNative(job: Job) {
    const native = job.native!;
    job.native = undefined;
    if (native.run.status !== 'won') {
      nativeKeys.set(physicalPlanKey(stage, native.plan), 'failed');
      rejected++;
      unresolved++;
      issues.add(
        '인증된 실수 관계의 대표가 실제 엔진에서 성공하지 않았습니다. 반올림·전이 경계는 미결로 남깁니다.',
      );
      return;
    }
    successes++;
    nativeKeys.set(physicalPlanKey(stage, native.plan), 'won');
    job.boxes.confirm(native.box);
    native.trace.push(tracePoint(native.run));
    const plan = native.plan;
    families.push({
      id: successes,
      template: programEvents(plan)
        .map((e) =>
          e.id === 'launch' ? '발사' : commandNames[e.kind as keyof typeof commandNames],
        )
        .join(' → '),
      representative: plan,
      count: 1,
      samples: [plan],
      trail: native.trace,
      shape: flightShape(
        stage,
        plan,
        native.trace.map((p) => p.position),
        native.run,
      ),
      horizon,
      ranges: searchParameters(stage, plan).map((p) => ({
        label: p.label,
        min: p.value,
        max: p.value,
      })),
    });
    merged = mergeOverlappingFamilies(stage, families).map((f) => ({
      ...f,
      samples: f.samples.slice(0, 16),
    }));
  }
  function retireJobs() {
    for (let i = jobs.length - 1; i >= 0; i--) {
      const job = jobs[i];
      if (!job.finished) continue;
      retired.cells += job.statistics.cells;
      retired.visits += job.statistics.visits;
      retired.regions += job.statistics.regions;
      retired.groups += job.boxes.components;
      job.iterator.return(undefined);
      jobs.splice(i, 1); // Release the relation DAG, contraction arena and box tree.
    }
    // Optional deduplication cache; eviction cannot exclude a successful region.
    if (nativeKeys.size > 16384) {
      for (const [key, state] of nativeKeys) {
        if (state !== 'pending') nativeKeys.delete(key);
        if (nativeKeys.size <= 8192) break;
      }
    }
  }
  yield report(false);
  if (exhausted) {
    yield report(true);
    return;
  }
  try {
    while (true) {
      retireJobs();
      if (families.length >= 4096) {
        issues.add('검증 대표 보관 한도 4096개에 도달했습니다. 나머지 성공 관계는 미결입니다.');
        unresolved++;
        yield report(true);
        return;
      }
      if (quota.remaining <= 0) {
        const continuable = !exhausted || jobs.some((j) => !j.finished);
        yield report(true, continuable);
        if (!options.quota || !continuable) return;
        if (quota.remaining <= 0) continue;
      }
      if (!exhausted) discover();
      const active = jobs.filter((j) => !j.finished);
      if (!active.length) {
        if (exhausted) {
          yield report(true);
          return;
        }
        quota.remaining--;
        work++;
        yield report(false);
        continue;
      }
      const job = active[cursor++ % active.length];
      let cost = 1;
      if (job.native) {
        phase = 'verifying';
        const { run, trace } = job.native;
        for (
          let i = 0;
          i < 8 &&
          (run.status === 'running' || run.status === 'impact') &&
          run.time < horizon - 1e-8;
          i++
        ) {
          tick(run, stage, Math.min(0.1, horizon - run.time), stage.objects, false);
          if (run.time - (trace.at(-1)?.time ?? -1) >= 0.1) trace.push(tracePoint(run));
          if (trace.length > 256)
            trace.splice(0, trace.length, ...trace.filter((_, at) => at % 2 === 0));
        }
        if (!['running', 'impact'].includes(run.status) || run.time >= horizon - 1e-8)
          finishNative(job);
      } else {
        const next = job.iterator.next();
        if (next.done) {
          job.finished = true;
          unresolved++;
          issues.add('전이 관계가 결론 없이 종료되었습니다.');
        } else {
          const previous = job.statistics;
          job.statistics = next.value.statistics;
          cost += Math.floor(Math.max(0, job.statistics.visits - previous.visits) / 4096);
          phase = job.statistics.cells ? 'projecting' : 'compiling';
          if (next.value.summary) {
            const s = next.value.summary;
            job.finished = true;
            job.iterator.return(undefined);
            if (s.status === 'closed') closed++;
            else {
              unresolved += Math.max(1, s.pending);
              if (s.status === 'unsupported') unsupported++;
            }
            for (const issue of s.issues) issues.add(issue);
          } else if (next.value.coordinates && next.value.bounds) {
            const cell = job.boxes.add(next.value.bounds);
            if (cell.needsWitness) {
              const plan = parameterPlan(job.template, next.value.coordinates),
                key = physicalPlanKey(stage, plan);
              if (nativeKeys.has(key)) {
                cached++;
                if (nativeKeys.get(key) === 'won') job.boxes.confirm(cell.id);
              } else {
                nativeKeys.set(key, 'pending');
                evaluated++;
                const run = createRun(stage, plan);
                job.native = { run, plan, box: cell.id, trace: [tracePoint(run)] };
              }
            }
          }
        }
      }
      quota.remaining = Math.max(0, quota.remaining - cost);
      work += cost;
      yield report(false);
    }
  } catch (error) {
    if (!(error instanceof BoxComponentLimit)) throw error;
    issues.add(error.message);
    unresolved++;
    yield report(true);
  } finally {
    for (const job of jobs) job.iterator.return(undefined);
  }
}
