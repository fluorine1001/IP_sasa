import { seeded, constrainAuditPlan } from '../audit';
import { execute } from '../../world/engine';
import { parseStage } from '../../stages/validation';
import { planConstraints } from '../../world/program';
import { buildBlueprint, polar } from './templates';
import { makeRecipe } from './recipes';
import { validateRequest, type GenerationRequest, type GenerationReport } from './protocol';
import type { RoutePlan, Stage } from '../../world/types';
import { exploreMethods, type MethodReport } from './solutions';
import { reviewCandidate, selectCourse } from './curation';
import type { Candidate } from './protocol';
import { completeMasteryMethods } from './mastery-methods';
import { practicesFocus } from './mastery';
import { auditGravity } from './gravity-audit';

export function randomSurfacePlan(stage: Stage, random: () => number): RoutePlan {
  const angle = stage.launchAngle ?? 0;
  const body = stage.bodies.find((b) => b.id === stage.launchBodyId) ?? stage.bodies[0];
  const clock = Math.sqrt(body.radius ** 3 / body.mu),
    stop = random() * clock;
  const plan: RoutePlan = {
    launch: polar(random() * stage.rules.launchLimit, angle),
    impulses: [],
    engineCommands: [
      {
        id: 'random-heading',
        actorId: 'craft',
        time: 0,
        direction: polar(1, angle + (random() - 0.5) * Math.PI * 1.2),
      },
      {
        id: 'random-cutoff',
        actorId: 'craft',
        time: stop,
        throttle: 0,
      },
    ],
  };
  if (random() < 0.5)
    plan.engineCommands!.push({
      id: 'random-power',
      actorId: 'craft',
      time: stop / 2,
      throttle: random(),
    });
  if (random() < 0.4)
    plan.engineCommands!.push(
      {
        id: 'random-coast-turn',
        actorId: 'craft',
        time: stop + clock * 0.1,
        direction: polar(1, angle + random() * Math.PI),
      },
      { id: 'random-reignite', actorId: 'craft', time: stop + clock * 0.2, throttle: random() },
      {
        id: 'random-final-stop',
        actorId: 'craft',
        time: stop + clock * (0.3 + random() * 0.3),
        throttle: 0,
      },
    );
  plan.engineCommands!.sort((a, b) => a.time - b.time);
  return constrainAuditPlan(stage, plan);
}
/** Bounded authoring worker. No existing document, storage or publication is changed. */
export function* generateCandidates(input: GenerationRequest): Generator<GenerationReport> {
  const request = validateRequest(input);
  const report: GenerationReport = {
    candidates: [],
    seed: request.seed,
    attempted: 0,
    checked: 0,
    rejected: {
      duplicate: 0,
      witness: 0,
      omission: 0,
      random: 0,
      invalid: 0,
      margin: 0,
      difficulty: 0,
      gravity: 0,
    },
    phase: '표면 출발 후보 준비',
    done: false,
    limited: false,
  };
  const started = performance.now(),
    seen = new Set<string>();
  yield report;
  outer: for (let i = 0; i < request.count * 8 && report.candidates.length < request.count; i++) {
    if (
      performance.now() - started >=
      (request.mastery
        ? 180000
        : request.progression ||
            request.planetCount !== 1 ||
            !['mixed', 'survey', 'relay'].includes(request.kind) ||
            request.environment !== 'planetary'
          ? 120000
          : 45000)
    ) {
      report.limited = true;
      break;
    }
    report.attempted++;
    const random = seeded((request.seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0);
    const focusIndex = request.mastery
      ? Math.floor(report.candidates.length / request.mastery.perGroup)
      : 0;
    const difficulty = request.mastery
      ? focusIndex < 2
        ? 'easy'
        : 'normal'
      : request.progression
        ? (['easy', 'normal', 'challenge'] as const)[
            Math.min(2, Math.floor((report.candidates.length * 3) / request.count))
          ]
        : request.difficulty;
    const kind =
      request.kind === 'varied'
        ? request.mastery
          ? report.candidates.length % 2
            ? 'relay'
            : 'survey'
          : (['survey', 'landing', 'orbit', 'escape', 'relay'] as const)[i % 5]
        : request.kind === 'mixed'
          ? report.candidates.length % 2
            ? 'relay'
            : 'survey'
          : request.kind;
    const recipe = makeRecipe({ ...request, difficulty, kind }, i, random),
      intro =
        request.progression &&
        report.candidates.length === 0 &&
        (kind === 'survey' || kind === 'relay');
    if ((request.progression || request.mastery) && difficulty === 'easy') {
      recipe.targetAngle =
        Math.sign(recipe.targetAngle) * Math.min(Math.abs(recipe.targetAngle), Math.PI / 12);
      if (intro) recipe.targetRadius = Math.min(recipe.targetRadius, 1.7);
    }
    if (request.progression && difficulty === 'normal' && kind === 'survey') {
      recipe.targetAngle =
        Math.sign(recipe.targetAngle) *
        Math.min(Math.abs(recipe.targetAngle), (Math.PI * 45) / 180);
      recipe.targetRadius = Math.min(recipe.targetRadius, 1.75);
    }
    const blueprint = buildBlueprint(recipe);
    report.checked += blueprint.preparationChecks;
    if (seen.has(blueprint.fingerprint)) {
      report.rejected.duplicate++;
      yield report;
      continue;
    }
    const { stage, witness, assessment } = blueprint;
    stage.audit.seed = (request.seed ^ (i + 1)) >>> 0;
    report.phase = '표면 발사와 실제 성공 검사';
    try {
      parseStage(stage);
      if (planConstraints(stage, witness).length) throw Error('불법 검증 계획');
    } catch {
      report.rejected.invalid++;
      yield report;
      continue;
    }
    report.checked++;
    if (execute(stage, witness).status !== 'won') {
      report.rejected.witness++;
      yield report;
      continue;
    }
    report.phase = '추가 천체별 중력 기여와 중력 제거 비행 비교';
    let gravityCheck = auditGravity(stage, witness);
    report.checked += gravityCheck.checked;
    if (!gravityCheck.passed) {
      report.rejected.gravity++;
      yield report;
      continue;
    }
    if (!assessment) {
      report.rejected.difficulty++;
      yield report;
      continue;
    }
    if (intro && assessment.style !== '짧은 상승') {
      report.rejected.difficulty++;
      yield report;
      continue;
    }
    yield report;
    report.phase = '핵심 조작 생략 검사';
    for (const omission of blueprint.omissions) {
      report.checked++;
      if (execute(stage, omission.plan).status === 'won') {
        report.rejected.omission++;
        yield report;
        continue outer;
      }
      yield report;
    }
    report.phase = '임의 초기 출력·방향·종료 검사';
    const sampler = seeded(stage.audit.seed),
      randomTotal = 16;
    let randomWins = 0;
    for (let j = 0; j < randomTotal; j++) {
      report.checked++;
      if (execute(stage, randomSurfacePlan(stage, sampler)).status === 'won') randomWins++;
      yield report;
    }
    if (randomWins / randomTotal > stage.audit.maxPassRate) {
      report.rejected.random++;
      yield report;
      continue;
    }
    report.phase = '둥근 수치·여러 조작 방식 실제 비행 검사';
    let methods: MethodReport | undefined,
      previousChecks = 0;
    for (const step of exploreMethods(
      stage,
      [witness],
      kind === 'survey' || kind === 'relay' ? 250 : 80,
    )) {
      methods = step;
      report.checked += step.checked - previousChecks;
      previousChecks = step.checked;
      yield report;
    }
    if (!methods!.methods.length) {
      report.rejected.witness++;
      yield report;
      continue;
    }
    if (request.mastery) {
      report.phase = `${focusIndex + 1}묶음 · 이전 조작과 새 조작을 함께 쓰는 비행 검사`;
      let refinementChecks = 0;
      for (const step of completeMasteryMethods(stage, methods!.methods, focusIndex)) {
        report.checked += step.checked - refinementChecks;
        refinementChecks = step.checked;
        methods!.methods = step.methods;
        yield report;
      }
      if (!methods!.methods.some((m) => practicesFocus(m, focusIndex))) {
        report.rejected.difficulty++;
        yield report;
        continue;
      }
    }
    if (stage.bodies.length > 1) {
      report.phase = '표시할 각 풀이의 천체별 중력 영향 재검사';
      const meaningful = [];
      for (const method of methods!.methods) {
        const comparison = auditGravity(stage, method.plan);
        report.checked += comparison.checked;
        if (comparison.passed) {
          if (!meaningful.length) gravityCheck = comparison;
          meaningful.push(method);
        }
        yield report;
      }
      methods!.methods = meaningful;
      if (!meaningful.length) {
        report.rejected.gravity++;
        yield report;
        continue;
      }
    }
    if (request.mastery && !methods!.methods.some((m) => practicesFocus(m, focusIndex))) {
      report.rejected.gravity++;
      yield report;
      continue;
    }
    if (
      intro &&
      (new Set(methods!.methods.filter((m) => m.coarse).map((m) => m.kind)).size < 2 ||
        !methods!.methods.some(
          (m) => m.kind === 'coast' && m.coarse && m.nearbyWins / Math.max(1, m.nearbyTotal) >= 0.5,
        ))
    ) {
      report.rejected.difficulty++;
      yield report;
      continue;
    }
    stage.referencePlans = methods!.methods.map((m) => m.plan);
    const candidate: Candidate = {
      stage,
      recipe,
      assessment,
      fingerprint: blueprint.fingerprint,
      index: i + 1,
      seed: request.seed,
      nearbyWins: assessment.nearbyWins,
      nearbyTotal: assessment.nearbyTotal,
      randomWins,
      randomTotal,
      omissions: blueprint.omissions.length,
      methods: methods!.methods,
      gravity: gravityCheck,
      warnings: [
        '난이도는 경로·출발 정렬·주변 중력·조작 여유에 따른 제작용 추정입니다. 직접 플레이로 확인하세요.',
      ],
    };
    if (request.mastery && !reviewCandidate(candidate).eligible) {
      report.rejected.difficulty++;
      yield report;
      continue;
    }
    if (
      request.progression &&
      request.kind !== 'varied' &&
      (kind === 'survey' || kind === 'relay') &&
      selectCourse(
        [...report.candidates, candidate].map(reviewCandidate),
        report.candidates.length + 1,
      ).entries.length !==
        report.candidates.length + 1
    ) {
      report.rejected.difficulty++;
      yield report;
      continue;
    }
    seen.add(blueprint.fingerprint);
    report.candidates.push(candidate);
    report.phase = '검토할 표면 출발 후보 추가';
    yield report;
  }
  report.done = true;
  report.limited ||= report.candidates.length < request.count;
  report.phase = report.limited ? '한도 안에서 확인된 후보만 표시합니다.' : '후보 생성 완료';
  yield report;
}
