import { nearbySamples } from './nearby-plans';
import { planningTimeLimit, planConstraints } from '../world/program';
import { learningDesign, readingText } from '../world/evidence';
import { bodyPosition } from '../world/celestial.ts';
import type { Stage, RoutePlan } from '../world/types.ts';
import { execute } from '../world/engine.ts';
import { issues } from '../stages/validation.ts';
import { length, scale, unit, sub } from '../physics/vector.ts';
export type AuditResult = {
  feedback?: {
    nearbyWins: number;
    nearbyTotal: number;
    distinctReports: number;
    changedOrder?: number;
    changedOrderWins?: number;
    controls?: { label: string; won: boolean; reason: string; changedOrder: boolean }[];
  };
  checked: number;
  total: number;
  randomWins: number;
  simpleWins: string[];
  referenceWins: number;
  warnings: string[];
  errors: string[];
  counterexamples: { label: string; plan: RoutePlan }[];
  successes: RoutePlan[];
  done: boolean;
};
export function seeded(seed: number) {
  let value = seed | 0 || 1;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 4294967296;
  };
}
// Keep random candidates legal without making one forbidden tool discard other tools.
export function constrainAuditPlan(stage: Stage, source: RoutePlan): RoutePlan {
  const result: RoutePlan = { ...structuredClone(source), impulses: [], engineCommands: [] };
  for (const impulse of source.impulses) {
    result.impulses.push(structuredClone(impulse));
    if (planConstraints(stage, result).length) result.impulses.pop();
  }
  for (const command of source.engineCommands ?? []) {
    result.engineCommands!.push(structuredClone(command));
    if (planConstraints(stage, result).length) result.engineCommands!.pop();
  }
  return result;
}
export function* auditStage(stage: Stage): Generator<AuditResult> {
  const result: AuditResult = {
    checked: 0,
    total: Math.max(16, Math.min(2048, stage.audit.samples)),
    randomWins: 0,
    simpleWins: [],
    referenceWins: 0,
    warnings: [],
    errors: issues(stage),
    counterexamples: [],
    successes: [],
    done: false,
  };
  if (result.errors.length) {
    result.done = true;
    yield result;
    return;
  }
  if (stage.rules.maxTimeUnlimited)
    result.warnings.push(
      '무제한 임무: 자동 검사는 ' +
        (stage.audit.timeLimit ?? stage.rules.maxTime) +
        '초까지의 표본만 확인합니다.',
    );
  const remember = (plan: RoutePlan) => {
    result.warnings = result.warnings.filter(
      (w) => !w.startsWith('아직 확인된 성공 비행이 없습니다.'),
    );
    if (!result.successes.some((p) => JSON.stringify(p) === JSON.stringify(plan)))
      result.successes.push(structuredClone(plan));
  };
  for (const p of stage.referencePlans)
    if (execute(stage, p).status === 'won') {
      result.referenceWins++;
      remember(p);
    }
  if (!result.referenceWins)
    result.warnings.push(
      '아직 확인된 성공 비행이 없습니다. 직접 시험하거나 유효해 탐색에서 성공 기록을 확보하세요.',
    );
  if (stage.goalMode === 'any' && stage.goals.length > 1)
    result.warnings.push('목표 중 하나만 달성해도 성공합니다. 의도한 조건인지 확인하세요.');
  const limit = stage.rules.launchLimit,
    base = stage.spawn.velocity,
    nearest = stage.bodies.length
      ? stage.bodies.reduce((a, b) =>
          length(sub(bodyPosition(stage, a, 0), stage.spawn.position)) <
          length(sub(bodyPosition(stage, b, 0), stage.spawn.position))
            ? a
            : b,
        )
      : undefined;
  const simple: [string, RoutePlan][] = [
    ['무추진', { launch: { x: 0, y: 0 }, impulses: [] }],
    [
      '최대 순방향 추진',
      { launch: scale(length(base) ? unit(base) : { x: 0, y: 1 }, limit), impulses: [] },
    ],
    [
      '최대 역방향 추진',
      { launch: scale(length(base) ? unit(base) : { x: 0, y: 1 }, -limit), impulses: [] },
    ],
  ];
  if (nearest) {
    const toward = unit(sub(bodyPosition(stage, nearest, 0), stage.spawn.position));
    simple.push(
      ['천체를 향해 직진', { launch: scale(toward, limit), impulses: [] }],
      ['천체에서 멀어지기', { launch: scale(toward, -limit), impulses: [] }],
    );
  }
  for (const [label, plan] of simple)
    if (execute(stage, plan).status === 'won') {
      result.simpleWins.push(label);
      remember(plan);
      result.counterexamples.push({ label, plan });
    }
  if (result.simpleWins.length)
    result.warnings.push(
      `단순 전략으로 성공: ${result.simpleWins.join(', ')}. 입문 임무라면 허용하고 고급 퍼즐에서는 조건을 조정하세요.`,
    );
  if (stage.learning) {
    const design = learningDesign(stage),
      reports = new Set<string>();
    let nearbyWins = 0,
      nearbyTotal = 0,
      changedOrder = 0,
      changedOrderWins = 0;
    const controls: NonNullable<NonNullable<AuditResult['feedback']>['controls']> = [];
    const reference = stage.referencePlans.find((p) => execute(stage, p).status === 'won');
    if (reference) {
      for (const sample of nearbySamples(stage, reference)) {
        const run = execute(stage, sample.plan),
          won = run.status === 'won';
        if (sample.changedOrder) {
          changedOrder++;
          if (won) changedOrderWins++;
        } else {
          nearbyTotal++;
          if (won) nearbyWins++;
        }
        controls.push({
          label: sample.label,
          won,
          reason: run.reason,
          changedOrder: sample.changedOrder,
        });
      }
      for (const factor of [0.8, 0.9, 1, 1.1]) {
        const p = structuredClone(reference);
        p.launch = scale(
          p.launch,
          Math.min(factor, stage.rules.launchLimit / Math.max(length(p.launch), 1e-9)),
        );
        p.impulses = [];
        const r = execute(stage, p, true);
        reports.add(
          design.instruments.map((i) => readingText(i, r.evidence.readings[i.id])).join(' / '),
        );
      }
    }
    result.feedback = {
      nearbyWins,
      nearbyTotal,
      distinctReports: reports.size,
      changedOrder,
      changedOrderWins,
      controls,
    };
    if (nearbyTotal && nearbyWins / nearbyTotal < 0.5)
      result.warnings.push(
        '같은 조작 순서에서 5% 출력·0.25초 시각·5° 방향 변경 표본의 성공이 절반 미만입니다. 배치·자원·허용 영역의 조작 여유를 확인하세요. 순서가 뒤집힌 표본은 별도로 집계합니다.',
      );
    if (reports.size < 2)
      result.warnings.push(
        '서로 다른 첫 추진의 관측 안내가 구분되지 않습니다. 실패의 원인을 좁힐 단서를 추가하세요.',
      );
  }
  yield structuredClone(result);
  const random = seeded(stage.audit.seed || 1);
  const samplingDuration = Math.min(
    planningTimeLimit(stage),
    stage.audit.timeLimit ?? stage.rules.maxTime,
  );
  for (let i = 0; i < result.total; i++) {
    const angle = random() * 2 * Math.PI,
      amount = Math.sqrt(random()) * limit,
      plan: RoutePlan = {
        launch: { x: Math.cos(angle) * amount, y: Math.sin(angle) * amount },
        impulses: [],
      };
    if (i % 3 === 0 && stage.rules.maneuverBudget > 0) {
      const a = random() * 2 * Math.PI,
        m = random() * stage.rules.maneuverBudget;
      plan.impulses.push({
        id: `audit-${i}`,
        time: random() * samplingDuration,
        vector: { x: Math.cos(a) * m, y: Math.sin(a) * m },
      });
    }
    if (stage.rocket && i % 2 === 0) {
      plan.engineCommands = [];
      let time = 0;
      for (let j = 0; j < stage.rocket.parts.length * 3; j++) {
        time += random() * Math.min(samplingDuration / (stage.rocket.parts.length * 3), 4);
        const a = random() * Math.PI * 2;
        plan.engineCommands.push({
          id: `engine-${i}-${j}`,
          time,
          actorId: 'craft',
          throttle: random(),
          direction: { x: Math.cos(a), y: Math.sin(a) },
        });
        if (j % 3 === 2)
          plan.engineCommands.push({
            id: `sep-${i}-${j}`,
            time: time + 0.01,
            actorId: 'craft',
            separate: true,
          });
      }
    }
    const legalPlan = constrainAuditPlan(stage, plan);
    if (execute(stage, legalPlan).status === 'won') {
      result.randomWins++;
      remember(legalPlan);
      if (result.counterexamples.length < 8)
        result.counterexamples.push({ label: `임의 경로 ${i + 1}`, plan: legalPlan });
    }
    result.checked++;
    if (i % 8 === 7) yield structuredClone(result);
  }
  if (result.randomWins / result.total > stage.audit.maxPassRate)
    result.warnings.push(
      '임의 발사 성공률이 설계 기준보다 높습니다. 허용 영역·속력·유지 시간·추진 예산을 좁혀 다시 시험하세요.',
    );
  result.done = true;
  yield structuredClone(result);
}
